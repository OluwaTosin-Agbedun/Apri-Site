import "server-only"
import { getSql } from "./db"
import { effectiveRelease } from "./access-policy"
import {
  noticeSchemaReady,
  noticeSettings,
  notificationEligibility,
  queuePublicationNotice,
  NOTICE_MIGRATION,
} from "./publication-notifications"

export type AlertSplit = {
  publicationId: string
  publicationTitle: string
  entitled: number
  withCopies: number
  held: number
  blockedReason?: string
}
export type AlertOutcome = {
  ok: boolean
  sent: number
  held: number
  failed: number
  message: string
}

/** Current shared policy for both room and legacy libraries, never level-only. */
export async function previewAlert(
  publicationId: string,
): Promise<AlertSplit | null> {
  const sql = getSql()
  const [pub] =
    await sql`select title,visibility,status,paid_release_state from documents where id=${publicationId}::uuid`
  if (!pub || pub.visibility === "OPEN") return null
  const result: AlertSplit = {
    publicationId,
    publicationTitle: String(pub.title),
    entitled: 0,
    withCopies: 0,
    held: 0,
  }
  if (!(await noticeSchemaReady(sql)))
    return {
      ...result,
      blockedReason: `Apply ${NOTICE_MIGRATION} before using the saved notification queue.`,
    }
  if (
    pub.status === "archived" ||
    effectiveRelease({
      paidRelease: pub.paid_release_state,
      editorialStatus: pub.status,
    }) !== "released"
  )
    return {
      ...result,
      blockedReason:
        "Release this edition to subscribers before announcing it.",
    }
  const settings = await noticeSettings(sql)
  if (!settings?.enabled)
    return {
      ...result,
      blockedReason:
        "An owner must approve the notification baseline in Admin → Publication Alerts first.",
    }
  const people =
    await sql`select id from subscribers where client_type='subscriber' and lower(status)='active' order by id limit 501`
  if (people.length > 500)
    return {
      ...result,
      blockedReason:
        "Use the bounded Publication Alerts worker to prepare this larger audience.",
    }
  for (const person of people) {
    const access = await notificationEligibility(
      String(person.id),
      publicationId,
      sql,
    )
    if (access.state === "ready") result.withCopies++
    else if (access.state === "held") result.held++
  }
  result.entitled = result.withCopies + result.held
  return result
}
export async function sendPublishAlert(
  publicationId: string,
  actor: string | null = null,
): Promise<AlertOutcome> {
  const preview = await previewAlert(publicationId)
  if (!preview || preview.blockedReason)
    return {
      ok: false,
      sent: 0,
      held: 0,
      failed: 0,
      message:
        preview?.blockedReason ?? "This edition has no subscriber audience.",
    }
  if (!preview.entitled)
    return {
      ok: false,
      sent: 0,
      held: 0,
      failed: 0,
      message:
        "No current subscriber is eligible or awaiting access preparation.",
    }
  const event = await queuePublicationNotice(
    publicationId,
    actor,
    "first",
    "Explicitly queued from the publication alert preview",
  )
  return {
    ok: true,
    sent: 0,
    held: preview.held,
    failed: 0,
    message: event
      ? "Publication alert saved. The worker will recheck permissions and send to each eligible reader; no delivery is claimed yet."
      : "An announcement for this edition is already recorded. Check Publication Alerts; the same edition is not emailed twice.",
  }
}
/** Compatibility for provisioned legacy holds. Only acceptance releases a
 * hold; issuing a PDF never directly sends an untracked email. */
export async function releaseHeldAlert(
  subscriberId: string,
  publicationId: string,
): Promise<boolean> {
  if (!(await noticeSchemaReady())) return false
  const sql = getSql()
  const [hold] =
    await sql`select released_at from alert_holds where subscriber_id=${subscriberId}::uuid and publication_id=${publicationId}::uuid`
  if (!hold) return false
  if (hold.released_at) return true
  const access = await notificationEligibility(subscriberId, publicationId, sql)
  if (access.state === "ready")
    await queuePublicationNotice(
      publicationId,
      null,
      "first",
      "A previously held publication copy became ready",
    )
  return false
}
export type HeldAlert = {
  subscriberId: string
  subscriberName: string
  organisation: string
  publicationId: string
  publicationCode: string | null
  publicationTitle: string
  heldAt: string
  ageDays: number
}
export async function getHeldAlerts(): Promise<HeldAlert[]> {
  const rows =
    await getSql()`select h.subscriber_id,h.publication_id,h.held_at,coalesce(nullif(s.full_name,''),s.name) as name,
    s.organization,d.code,d.title from alert_holds h join subscribers s on s.id=h.subscriber_id join documents d on d.id=h.publication_id
    where h.released_at is null order by h.held_at asc limit 200`
  return rows.map((r) => ({
    subscriberId: String(r.subscriber_id),
    subscriberName: String(r.name),
    organisation: String(r.organization),
    publicationId: String(r.publication_id),
    publicationCode: r.code ?? null,
    publicationTitle: String(r.title),
    heldAt: new Date(r.held_at as string).toISOString(),
    ageDays: Math.max(
      0,
      Math.floor(
        (Date.now() - new Date(r.held_at as string).getTime()) / 86_400_000,
      ),
    ),
  }))
}
