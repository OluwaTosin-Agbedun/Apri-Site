import "server-only"
import { randomUUID } from "node:crypto"
import { Resend } from "resend"
import { getSql } from "./db"
import { deliverEmail, type ProviderSend } from "./email-delivery"
import { drainDeliveryInbox } from "./email-delivery-inbox"

type Sql = ReturnType<typeof getSql>
export const OPERATIONS_MIGRATION = "20261115_stage4_operations_security.sql"
export type HealthFinding = { key: string; severity: "attention" | "critical"; message: string }
export async function operationsReady(sql: Sql = getSql()): Promise<boolean> {
  const [row] = await sql`select to_regclass('public.operations_settings') is not null
    and to_regclass('public.operations_alerts') is not null and to_regclass('public.email_delivery_inbox') is not null as ok`
  return row?.ok === true
}

export async function readOperations(sql: Sql = getSql()) {
  const [settings] = await sql`select * from operations_settings where singleton=true`
  if (!settings) throw new Error("Operations configuration missing")
  return settings
}

/** Database observations only: never calls Papermark or creates reader work. */
export async function findHealthIssues(sql: Sql = getSql()): Promise<HealthFinding[]> {
  const settings = await readOperations(sql)
  const [counts] = await sql`select
    (select count(*)::int from review_reader_room_jobs where state='attention') as review_failed,
    (select count(*)::int from review_reader_room_jobs where state in ('pending','running') and requested_at < now()-(${Number(settings.queue_stale_hours)} * interval '1 hour')) as review_old,
    (select count(*)::int from subscriber_access_reconciliations where state='failed') as paid_failed,
    (select count(*)::int from subscriber_access_reconciliations where state='pending' and requested_at < now()-(${Number(settings.queue_stale_hours)} * interval '1 hour')) as paid_old,
    (select count(*)::int from email_delivery_inbox where applied_at is null and received_at < now()-interval '1 hour') as unmatched,
    (select count(*)::int from subscriber_onboarding_messages where state in ('failed','unknown')) as onboarding,
    (select count(*)::int from admins a left join admin_security s on s.admin_id=a.id where a.is_active=true and s.totp_ciphertext is null) as unenrolled,
    (select count(*)::int from privacy_retention_policies) as policies`
  const findings: HealthFinding[] = []
  const add = (key: string, message: string, severity: HealthFinding["severity"] = "attention") => findings.push({key,message,severity})
  const [poll] = await sql`select value from app_settings where key='papermark_last_poll'`
  let polledAt = NaN
  try { const value = JSON.parse(String(poll?.value ?? "{}")); polledAt = typeof value.at === "string" ? Date.parse(value.at) : NaN } catch { /* absent evidence stays unknown */ }
  if (!Number.isFinite(polledAt) || polledAt > Date.now()+300_000) add("collector_missing", "No valid successful analytics poll is recorded. Check the analytics worker.")
  else if (Date.now()-polledAt > Number(settings.poll_stale_hours)*3_600_000) add("collector_stale", "The analytics poll is overdue; reader reports may be incomplete.")
  if (Number(counts.review_failed) || Number(counts.paid_failed)) add("access_failed", `${Number(counts.review_failed)} review repairs and ${Number(counts.paid_failed)} subscriber repairs need attention.`, "critical")
  if (Number(counts.review_old) || Number(counts.paid_old)) add("access_waiting", `${Number(counts.review_old)} review jobs and ${Number(counts.paid_old)} subscriber jobs have been waiting beyond the agreed threshold.`)
  if (Number(counts.unmatched)) add("email_unmatched", `${Number(counts.unmatched)} delivery reports have not matched a message record after one hour.`)
  if (Number(counts.onboarding)) add("onboarding_attention", `${Number(counts.onboarding)} onboarding messages have failed or uncertain provider results.`)
  if (Number(counts.unenrolled)) add("staff_enrolment", `${Number(counts.unenrolled)} active administrators have not set up an authenticator.`)
  if (!Number(counts.policies)) add("retention_unagreed", "Retention periods have not been approved. No automatic cleanup is enabled.")
  const contacts = await sql`select id from admins where is_active=true and id in (${settings.incident_owner_id}::uuid,${settings.deputy_id}::uuid)`
  if (!settings.incident_owner_id || !settings.deputy_id || contacts.length !== 2) add("incident_owner", "Choose an active incident owner and a different deputy before enabling alert emails.")
  for (const kind of ["backup", "restore"] as const) {
    const [checkpoint] = await sql`select result from operations_checkpoints where kind=${kind} order by occurred_at desc,recorded_at desc,id limit 1`
    if (!checkpoint) add(`${kind}_evidence`, `No ${kind === "backup" ? "backup" : "restore rehearsal"} evidence has been recorded. This page does not create or verify a Neon backup.`)
    else if (checkpoint.result === "fail") add(`${kind}_failed`, `The latest recorded ${kind} check failed. Review its evidence with the incident owner.`, "critical")
  }
  return findings
}

/** Alerts persist until the observation clears; acknowledging does not resolve. */
export async function refreshOperations(sql: Sql = getSql()): Promise<HealthFinding[]|null> {
  const token=randomUUID()
  const lease=await sql`update operations_settings set check_lease_token=${token}::uuid,check_lease_until=now()+interval '1 minute'
    where singleton=true and (check_lease_until is null or check_lease_until<now()) returning singleton`
  if (!lease.length) return null
  try {
    const settings = await readOperations(sql)
    const findings = await findHealthIssues(sql)
    for (const finding of findings) {
    await sql`insert into operations_alerts(alert_key,severity,message,notification_state)
      select ${finding.key},${finding.severity},${finding.message},${settings.alerts_email_enabled ? "pending" : "disabled"}
        from operations_settings where singleton=true and check_lease_token=${token}::uuid and check_lease_until>now()
      on conflict(alert_key) do update set severity=excluded.severity,message=excluded.message,last_seen_at=now(),
        opened_at=case when operations_alerts.resolved_at is not null then now() else operations_alerts.opened_at end,
        notification_generation=operations_alerts.notification_generation+case when operations_alerts.resolved_at is not null then 1 else 0 end,
        notification_state=case when operations_alerts.resolved_at is not null then excluded.notification_state else operations_alerts.notification_state end,
        notification_attempts=case when operations_alerts.resolved_at is not null then 0 else operations_alerts.notification_attempts end,
        acknowledged_at=case when operations_alerts.resolved_at is not null then null else operations_alerts.acknowledged_at end,
        acknowledged_by=case when operations_alerts.resolved_at is not null then null else operations_alerts.acknowledged_by end,
        resolved_at=null`
    }
    await sql`update operations_alerts set resolved_at=now() where resolved_at is null and not(alert_key=any(${findings.map(f=>f.key)}::text[]))
      and exists(select 1 from operations_settings where singleton=true and check_lease_token=${token}::uuid and check_lease_until>now())`
    const finished=await sql`update operations_settings set last_checked_at=now() where singleton=true and check_lease_token=${token}::uuid and check_lease_until>now() returning singleton`
    return finished.length?findings:null
  } finally {
    await sql`update operations_settings set check_lease_token=null,check_lease_until=null where singleton=true and check_lease_token=${token}::uuid`
  }
}

type AlertSend = (addresses: string[], message: string) => ProviderSend
function provider(addresses: string[], message: string): ProviderSend {
  if (!process.env.RESEND_API_KEY) return null
  const resend = new Resend(process.env.RESEND_API_KEY)
  const from = process.env.SUBSCRIBER_FROM_EMAIL ?? process.env.RESEND_FROM_EMAIL ?? "briefings@apri.athenacentre.org"
  return key => resend.emails.send({ from:`APRA Operations <${from}>`,to:addresses,subject:"APRA operations: attention needed",text:`${message}\n\nOpen Admin → Operations to review. This is an internal service alert; no reader access was changed.` }, { idempotencyKey:key })
}

/** Explicit opt-in only. An uncertain or interrupted send is never blindly retried. */
export async function sendOperationsAlerts(sql: Sql = getSql(), makeSend: AlertSend = provider, deadline = Infinity): Promise<{ accepted: number; attempted: number }> {
  const settings = await readOperations(sql)
  if (!settings.alerts_email_enabled || !settings.incident_owner_id || !settings.deputy_id) return {accepted:0,attempted:0}
  const contacts = await sql`select email from admins where is_active=true and id in (${settings.incident_owner_id}::uuid,${settings.deputy_id}::uuid) order by id`
  if (contacts.length !== 2) return {accepted:0,attempted:0}
  // An instance may have died after handing a message to the provider.
  await sql`update operations_alerts set notification_state='unknown',last_notification_error='Worker stopped before a settled result.'
    where notification_state='sending' and notification_claim_until < now()`
  const due = await sql`select alert_key from operations_alerts where resolved_at is null and notification_state in ('pending','failed')
    and notification_attempts < 3 and next_notification_at <= now() order by opened_at,alert_key limit 2`
  const result = {accepted:0,attempted:0}
  for (const item of due) {
    if (Date.now()+16_000 >= deadline) break
    const token = randomUUID()
    const [alert] = await sql`update operations_alerts set notification_state='sending',notification_claim_token=${token}::uuid,
      notification_claim_until=now()+interval '1 minute',notification_attempts=notification_attempts+1
      where alert_key=${item.alert_key} and resolved_at is null and notification_state in ('pending','failed')
        and notification_attempts<3 and next_notification_at<=now()
        and exists(select 1 from operations_settings where singleton=true and alerts_email_enabled=true
          and incident_owner_id=${settings.incident_owner_id}::uuid and deputy_id=${settings.deputy_id}::uuid)
        and (select count(*) from admins where is_active=true and id in (${settings.incident_owner_id}::uuid,${settings.deputy_id}::uuid))=2
      returning message,notification_generation,notification_attempts`
    if (!alert) continue
    result.attempted++
    const outcome = await deliverEmail(makeSend(contacts.map(c=>String(c.email)),String(alert.message)),`operations/${item.alert_key}/${alert.notification_generation}`)
    const state = outcome.status === "accepted" ? "accepted" : outcome.status === "unknown" ? "unknown" : "failed"
    // Only a known temporary rejection can be retried automatically.
    const retry = outcome.status === "rejected" && outcome.retryable
    await sql`update operations_alerts set notification_state=${state},provider_message_id=${outcome.status === "accepted" ? outcome.providerMessageId : null},
      notified_at=case when ${outcome.status === "accepted"} then now() else null end,
      notification_attempts=case when ${retry} then notification_attempts else 3 end,
      last_notification_error=${outcome.status === "accepted" ? null : outcome.message},
      next_notification_at=now()+interval '1 hour',notification_claim_token=null,notification_claim_until=null
      where alert_key=${item.alert_key} and notification_claim_token=${token}::uuid and notification_generation=${alert.notification_generation}`
    if (outcome.status === "accepted") result.accepted++
  }
  return result
}

export async function runOperations(sql: Sql = getSql()) {
  if (!(await operationsReady(sql))) return {ok:false,reason:"migration_required"}
  const deadline = Date.now()+45_000
  const delivery = await drainDeliveryInbox(25,sql,Date.now()+10_000)
  const findings = await refreshOperations(sql)
  if (!findings) return {ok:true,busy:true,delivery}
  const notifications = await sendOperationsAlerts(sql,provider,deadline)
  await sql`insert into app_settings(key,value) values('operations_last_worker_at',${new Date().toISOString()})
    on conflict(key) do update set value=excluded.value`
  return {ok:true,delivery,issues:findings.length,notifications}
}
