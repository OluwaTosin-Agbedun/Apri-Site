import "server-only"
import { createHash, randomUUID } from "node:crypto"
import { getSql } from "./db"
import { effectiveRelease } from "./access-policy"
import {
  loadSubscriberAccess,
  loadLegacyPublicationAccess,
} from "./access-policy-dal"
import { sendEditionAlert, type EditionAlert } from "./subscriber-email"
import { safeText, type EmailOutcome } from "./email-delivery"
import { portalDocumentTitle } from "./papermark-dataroom-contract"

type Sql = ReturnType<typeof getSql>
export const NOTICE_MIGRATION = "20261115_stage5_publication_notifications.sql"
export function publicationEmailsConfigured(): boolean {
  return process.env.DATAROOM_NEW_DOCUMENT_EMAILS === "enabled"
}
export async function noticeSchemaReady(sql: Sql = getSql()): Promise<boolean> {
  const [row] =
    await sql`select to_regclass('public.publication_notice_settings') is not null
    and to_regclass('public.publication_notice_jobs') is not null and to_regclass('public.publication_notice_events') is not null as ok`
  return row?.ok === true
}
export async function noticeSettings(sql: Sql = getSql()) {
  const [row] =
    await sql`select * from publication_notice_settings where singleton=true`
  return row
}

export async function setPublicationNotices(
  actor: string,
  enabled: boolean,
  reason: string,
  sql: Sql = getSql(),
): Promise<void> {
  if (reason.trim().length < 10 || reason.length > 300)
    throw new Error("An approval reason is required")
  // The row lock also serializes the release-capture trigger with baseline
  // creation. A concurrently released edition cannot fall between the two.
  await sql.transaction([
    sql`select singleton from publication_notice_settings where singleton=true for update`,
    sql`insert into publication_notice_seen(publication_id,baseline)
      select id,true from documents where ${enabled} and visibility<>'OPEN' and status<>'archived'
        and (paid_release_state='released' or (paid_release_state is null and status='published')) on conflict do nothing`,
    sql`update publication_notice_settings set enabled=${enabled},baseline_at=case when ${enabled} then coalesce(baseline_at,now()) else baseline_at end,
      approved_by=${actor}::uuid,updated_at=now() where singleton=true`,
    sql`insert into publication_notice_audit(actor_id,action,reason) values(${actor}::uuid,${
      enabled ? "enabled_from_baseline" : "paused"
    },${reason.trim()})`,
  ])
}

export async function queuePublicationNotice(
  publicationId: string,
  actor: string | null,
  revision = "first",
  reason = "Explicit publication alert",
  sql: Sql = getSql(),
): Promise<string | null> {
  if (!(await noticeSchemaReady(sql))) return null
  const settings = await noticeSettings(sql)
  if (!settings?.enabled || !settings.baseline_at) return null
  if (
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(revision) ||
    reason.length > 300 ||
    reason.trim().length < 10
  )
    throw new Error("Use a version label and an approval reason")
  const kind = revision === "first" ? "publication" : "correction"
  const [, events] = await sql.transaction([
    sql`select id from documents where id=${publicationId}::uuid for update`,
    sql`with inserted as (insert into publication_notice_events(publication_id,revision_key,kind,reason,approved_by)
    select id,${revision},${kind},${reason.trim()},${actor}::uuid from documents where id=${publicationId}::uuid and visibility<>'OPEN'
      and status<>'archived' and (paid_release_state='released' or (paid_release_state is null and status='published'))
      and exists(select 1 from publication_notice_settings where singleton=true and enabled=true and baseline_at is not null)
    on conflict(publication_id,revision_key) do nothing returning id),
    old as (update publication_notice_events set state='cancelled' where publication_id=${publicationId}::uuid
      and exists(select 1 from inserted) and id<>(select id from inserted) and state<>'cancelled' returning id),
    cancelled as (update publication_notice_jobs set state='cancelled',detail='Superseded by an approved announcement',updated_at=now()
      where event_id in (select id from old) and state in ('pending','held','failed')),
    audit as (insert into publication_notice_audit(actor_id,action,publication_id,reason)
      select ${actor}::uuid,'announcement_approved',${publicationId}::uuid,${reason.trim()} from inserted)
    select id from inserted`,
  ])
  const event = events[0]
  if (!event) return null
  return String(event.id)
}

type Eligibility = {
  state: "ready" | "held" | "excluded"
  reason: string
  alert?: EditionAlert
  fence?: string
}
/** Uses the same policy as the portal; this performs database reads only. */
export async function notificationEligibility(
  subscriberId: string,
  publicationId: string,
  sql: Sql = getSql(),
): Promise<Eligibility> {
  const [before] =
    await sql`select publication_notice_access_fence(${subscriberId}::uuid,${publicationId}::uuid) as fence`
  const [pub] =
    await sql`select title,series,to_char(edition_date,'YYYY-MM-DD') as edition_date,visibility,status,paid_release_state,
    coalesce(summary,'') as teaser from documents where id=${publicationId}::uuid`
  if (
    !pub ||
    pub.visibility === "OPEN" ||
    pub.status === "archived" ||
    effectiveRelease({
      paidRelease: pub.paid_release_state,
      editorialStatus: pub.status,
    }) !== "released"
  )
    return { state: "excluded", reason: "Publication is not released" }
  const [preference] =
    await sql`select enabled from publication_notice_preferences where subscriber_id=${subscriberId}::uuid`
  if (preference?.enabled === false)
    return { state: "excluded", reason: "Publication emails are turned off" }
  const access = await loadSubscriberAccess(subscriberId)
  if (access.state !== "ok")
    return {
      state: access.state === "not_found" ? "excluded" : "held",
      reason: "Access could not be checked",
    }
  if (access.subscriber.subscription.state !== "active")
    return { state: "excluded", reason: "Subscription is not current" }
  let title = String(pub.title)
  if (access.room) {
    const document = access.documents.find(
      (d) => d.publicationId === publicationId,
    )
    if (!document)
      return {
        state: "held",
        reason: "Publication is not yet linked in the library",
      }
    if (document.decision.outcome === "excluded")
      return { state: "excluded", reason: document.decision.reason }
    if (
      document.decision.outcome !== "allowed" ||
      document.delivery !== "open" ||
      !document.link
    )
      return {
        state: "held",
        reason: "Access or the personal link is being prepared",
      }
    const [confirmed] =
      await sql`select 1 as ok from papermark_subscriber_document_links l
      join subscriber_access_reconciliations r on r.subscriber_id=l.subscriber_id
      where l.id=${document.link.rowId}::uuid and r.state='complete' and l.revoke_state='live'
        and l.verification_generation=r.generation and l.last_verified_at is not null
        and l.verification_result->>'state'='found' and lower(l.assigned_email)=lower(${access.subscriber.email})
        and (l.expires_at is null or l.expires_at>now())`
    if (!confirmed)
      return {
        state: "held",
        reason: "Waiting for saved Papermark confirmation",
      }
    title = portalDocumentTitle({
      syncedName: document.fileTitle,
      editorialTitle: document.editorialTitle,
      editorialTitleIsOverride: document.titleOverride,
    })
  } else {
    const legacy = await loadLegacyPublicationAccess(subscriberId)
    if (legacy.state !== "ok")
      return { state: "held", reason: "Library access could not be checked" }
    const item = legacy.items.find((d) => d.publicationId === publicationId)
    if (!item || item.decision.outcome === "excluded")
      return {
        state: "excluded",
        reason: item?.decision.reason ?? "Not assigned",
      }
    if (item.decision.outcome !== "allowed" || item.delivery !== "open")
      return {
        state: "held",
        reason: "Personal library copy is being prepared",
      }
  }
  const [after] =
    await sql`select publication_notice_access_fence(${subscriberId}::uuid,${publicationId}::uuid) as fence`
  if (before?.fence !== after?.fence)
    return {
      state: "held",
      reason: "Access changed while the notice was being prepared",
    }
  return {
    state: "ready",
    reason: "Ready",
    fence: String(after.fence),
    alert: {
      email: access.subscriber.email,
      fullName: access.subscriber.fullName,
      title,
      series: String(pub.series ?? ""),
      editionDate: pub.edition_date ?? null,
      // The approved protected summary has its own store and never enters email.
      summary: String(pub.teaser),
      linkUrl: null,
    },
  }
}

export async function fanoutNotices(
  sql: Sql = getSql(),
  deadline = Date.now() + 15_000,
): Promise<number> {
  const token = randomUUID()
  const [event] =
    await sql`update publication_notice_events set state='fanning',lease_token=${token}::uuid,lease_until=now()+interval '1 minute'
    where id=(select id from publication_notice_events where state in ('pending','fanning') and next_attempt_at<=now()
      and (lease_until is null or lease_until<now()) order by created_at,id limit 1)
      and state in ('pending','fanning') and (lease_until is null or lease_until<now())
    returning id,publication_id,cursor_id,created_at::text as created_at`
  if (!event) return 0
  let queued = 0
  try {
    const candidates =
      await sql`select id from subscribers where client_type='subscriber' and lower(status)='active'
      and created_at<=${event.created_at}::timestamptz
      and not exists(select 1 from subscriber_onboarding_messages m where m.subscriber_id=subscribers.id
        and m.kind='welcome' and m.created_at>${event.created_at}::timestamptz)
      and (${event.cursor_id}::uuid is null or id>${event.cursor_id}::uuid) order by id limit 20`
    let checked = 0
    for (const candidate of candidates) {
      if (Date.now() >= deadline) break
      const eligibility = await notificationEligibility(
        String(candidate.id),
        String(event.publication_id),
        sql,
      )
      if (eligibility.state !== "excluded") {
        const rows =
          await sql`insert into publication_notice_jobs(event_id,subscriber_id,state,detail)
          select ${event.id}::uuid,${candidate.id}::uuid,${
            eligibility.state === "ready" ? "pending" : "held"
          },${eligibility.reason}
          from publication_notice_events where id=${event.id}::uuid and lease_token=${token}::uuid and state='fanning' and lease_until>now()
          on conflict(event_id,subscriber_id) do nothing returning id`
        queued += rows.length
      }
      await sql`update publication_notice_events set cursor_id=${candidate.id}::uuid where id=${event.id}::uuid and lease_token=${token}::uuid and state='fanning'`
      checked++
    }
    if (checked === candidates.length && candidates.length < 20)
      await sql`update publication_notice_events set state='complete' where id=${event.id}::uuid and lease_token=${token}::uuid and state='fanning'`
    return queued
  } finally {
    await sql`update publication_notice_events set lease_token=null,lease_until=null where id=${event.id}::uuid and lease_token=${token}::uuid`
  }
}

export type NoticeSender = (
  alert: EditionAlert,
  key: string,
) => Promise<EmailOutcome>
export async function drainPublicationNotices(
  options: {
    limit?: number
    budgetMs?: number
    sql?: Sql
    send?: NoticeSender
    paceMs?: number
  } = {},
) {
  const sql = options.sql ?? getSql()
  const counts = {
    ok: true,
    queued: 0,
    checked: 0,
    accepted: 0,
    held: 0,
    cancelled: 0,
    unknown: 0,
  }
  if (!(await noticeSchemaReady(sql)))
    return { ...counts, ok: false, reason: "migration_required" }
  await sql`update publication_notice_settings set worker_at=now() where singleton=true`
  const settings = await noticeSettings(sql)
  if (
    !settings?.enabled ||
    !settings.baseline_at ||
    !publicationEmailsConfigured()
  )
    return { ...counts, reason: "sending_paused" }
  if (!options.send && !process.env.RESEND_API_KEY)
    return { ...counts, ok: false, reason: "email_not_configured" }
  const deadline =
    Date.now() + Math.min(45_000, Math.max(1, options.budgetMs ?? 45_000))
  await sql`update publication_notice_jobs set state='unknown',detail='Worker stopped before a settled send result',updated_at=now()
    where state='sending' and lease_until<now()`
  counts.queued = await fanoutNotices(
    sql,
    Math.min(deadline - 8_000, Date.now() + 15_000),
  )
  const rows =
    await sql`select j.id from publication_notice_jobs j join publication_notice_events e on e.id=j.event_id
    where j.state in ('pending','held','failed') and j.attempts<3 and j.next_attempt_at<=now() and e.state<>'cancelled'
      and (j.lease_until is null or j.lease_until<now()) order by j.next_attempt_at,j.created_at,j.id limit ${Math.max(1, Math.min(10, options.limit ?? 10))}`
  const send =
    options.send ??
    ((alert, key) => sendEditionAlert(alert, key, { timeoutMs: 7000 }))
  for (const item of rows) {
    if (Date.now() + 8_000 > deadline) break
    const token = randomUUID()
    const [job] =
      await sql`update publication_notice_jobs set lease_token=${token}::uuid,lease_until=now()+interval '1 minute'
      where id=${item.id}::uuid and state in ('pending','held','failed') and next_attempt_at<=now()
        and (lease_until is null or lease_until<now()) and attempts<3
      returning id,event_id,subscriber_id`
    if (!job) continue
    counts.checked++
    try {
      const [event] =
        await sql`select publication_id,kind,state from publication_notice_events where id=${job.event_id}::uuid`
      const eligibility =
        event && event.state !== "cancelled"
          ? await notificationEligibility(
              String(job.subscriber_id),
              String(event.publication_id),
              sql,
            )
          : { state: "excluded", reason: "Announcement superseded" }
      if (
        eligibility.state !== "ready" ||
        !("alert" in eligibility) ||
        !eligibility.alert
      ) {
        const cancelled = eligibility.state === "excluded"
        await sql`update publication_notice_jobs set state=${
          cancelled ? "cancelled" : "held"
        },detail=${eligibility.reason},
          next_attempt_at=now()+interval '15 minutes',lease_token=null,lease_until=null,updated_at=now()
          where id=${job.id}::uuid and lease_token=${token}::uuid`
        if (cancelled) counts.cancelled++
        else counts.held++
        continue
      }
      const claimed =
        await sql`update publication_notice_jobs set state='sending',attempts=attempts+1,updated_at=now()
        where id=${job.id}::uuid and lease_token=${token}::uuid and lease_until>now()
          and exists(select 1 from publication_notice_settings where singleton=true and enabled=true)
          and exists(select 1 from subscribers s where s.id=${job.subscriber_id}::uuid
            and s.client_type='subscriber' and lower(s.status)='active'
            and s.term_start<=(now() at time zone 'Africa/Lagos')::date
            and s.term_end>=(now() at time zone 'Africa/Lagos')::date)
          and exists(select 1 from publication_notice_events e join documents d on d.id=e.publication_id
            where e.id=${job.event_id}::uuid and e.state<>'cancelled' and d.status<>'archived' and d.visibility<>'OPEN'
              and (d.paid_release_state='released' or (d.paid_release_state is null and d.status='published')))
          and not exists(select 1 from publication_notice_preferences p where p.subscriber_id=${job.subscriber_id}::uuid and p.enabled=false)
          and publication_notice_access_fence(${job.subscriber_id}::uuid,${event.publication_id}::uuid)=${eligibility.fence ?? ""}
        returning id`
      if (!claimed.length) continue
      const alert: EditionAlert = {
        ...eligibility.alert,
        notificationKind:
          event.kind === "correction" ? "correction" : "publication",
      }
      const outcome = await send(alert, `publication-notice/${job.id}`)
      if (outcome.status === "accepted") {
        await sql`with settled as (update publication_notice_jobs set state='accepted',outcome='accepted',provider_message_id=${outcome.providerMessageId},
          accepted_at=now(),updated_at=now(),detail=null,lease_token=null,lease_until=null
          where id=${job.id}::uuid and lease_token=${token}::uuid returning subscriber_id),
          held as (update alert_holds set released_at=now() where publication_id=${event.publication_id}::uuid
            and subscriber_id in (select subscriber_id from settled) and released_at is null)
          insert into client_engagement_events(subscriber_id,event_type,resend_email_id)
          select subscriber_id,'publication_notification_sent',${outcome.providerMessageId} from settled`
        counts.accepted++
      } else {
        const retry = outcome.status === "rejected" && outcome.retryable
        await sql`update publication_notice_jobs set state=${
          outcome.status === "unknown" ? "unknown" : "failed"
        },outcome=${outcome.status},detail=${safeText(outcome.message)},
          attempts=case when ${retry} then attempts else 3 end,next_attempt_at=now()+interval '1 hour',updated_at=now(),lease_token=null,lease_until=null
          where id=${job.id}::uuid and lease_token=${token}::uuid`
        if (outcome.status === "unknown") counts.unknown++
      }
      // Paced independently of Papermark: no calls to that provider here.
      if ((options.paceMs ?? 600) > 0)
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(1000, options.paceMs ?? 600)),
        )
    } catch {
      // If a send may have happened, preserve the ambiguity permanently.
      await sql`update publication_notice_jobs set state=case when state='sending' then 'unknown' else 'held' end,
        detail='Processing interrupted; review provider evidence before retrying an uncertain send',next_attempt_at=now()+interval '15 minutes',
        updated_at=now(),lease_token=null,lease_until=null where id=${job.id}::uuid and lease_token=${token}::uuid`
    } finally {
      await sql`update publication_notice_jobs set lease_token=null,lease_until=null where id=${job.id}::uuid and lease_token=${token}::uuid and state<>'sending'`
    }
  }
  await sql`update publication_notice_settings set worker_at=now() where singleton=true`
  return counts
}

export function noticeRevision(label: string): string {
  return `update:${createHash("sha256").update(label.trim().toLowerCase()).digest("hex")}`
}
