import "server-only"
import { randomUUID } from "node:crypto"
import { getSql } from "./db"
import { applyReviewEmailEvent } from "./review-email-attempts"
import { alreadyRecordedSent, principalForResendEmail, recordClientEvent, type EngagementEventType } from "./client-engagement"

type Sql = ReturnType<typeof getSql>
export const DELIVERY_EVENT_TYPES = ["email.sent", "email.delivered", "email.opened", "email.clicked", "email.bounced", "email.failed", "email.complained", "email.delivery_delayed", "email.suppressed"] as const
export type DeliveryEventType = typeof DELIVERY_EVENT_TYPES[number]
export type VerifiedDeliveryEvent = { id: string; messageId: string; type: DeliveryEventType; occurredAt: Date }

export async function deliveryInboxReady(sql: Sql = getSql()): Promise<boolean> {
  const [row] = await sql`select to_regclass('public.email_delivery_inbox') is not null as ok`
  return row?.ok === true
}

/** Call only after the raw payload's provider signature has been verified. */
export async function saveVerifiedDeliveryEvent(event: VerifiedDeliveryEvent, sql: Sql = getSql()): Promise<void> {
  if (![event.id, event.messageId].every((v) => /^[A-Za-z0-9_-]{1,200}$/.test(v)) ||
    !DELIVERY_EVENT_TYPES.includes(event.type) || !Number.isFinite(event.occurredAt.getTime()) || event.occurredAt.getTime() > Date.now() + 300_000) {
    throw new Error("Invalid delivery event")
  }
  // Replayed IDs may not replace the original message, type or timestamp.
  await sql`insert into email_delivery_inbox(event_id,provider_message_id,event_type,occurred_at)
    values(${event.id},${event.messageId},${event.type},${event.occurredAt}) on conflict(event_id) do nothing`
}

const CLIENT_TYPES: Partial<Record<DeliveryEventType, EngagementEventType>> = {
  "email.sent": "signin_email_sent", "email.delivered": "email_delivered", "email.opened": "email_opened",
  "email.clicked": "email_clicked", "email.bounced": "email_bounced", "email.failed": "email_failed", "email.suppressed": "email_failed",
}

async function applyEvent(event: { event_id: string; provider_message_id: string; event_type: DeliveryEventType; occurred_at: string | Date }, sql: Sql): Promise<boolean> {
  const date = new Date(event.occurred_at)
  if (await applyReviewEmailEvent(event.provider_message_id, event.event_type, date)) return true
  const principal = await principalForResendEmail(event.provider_message_id)
  if (principal) {
    const type = CLIENT_TYPES[event.event_type]
    if (type && !(principal.welcome && type === "signin_email_sent") &&
      !(type === "signin_email_sent" && await alreadyRecordedSent(event.provider_message_id))) {
      await recordClientEvent(principal, type, { resendEmailId: event.provider_message_id, webhookEventId: event.event_id, occurredAt: date })
    }
    return true
  }
  // Internal operational emails have no subscriber principal.
  const [alert] = await sql`select 1 as ok from operations_alerts where provider_message_id=${event.provider_message_id} limit 1`
  return Boolean(alert)
}

export async function replayDeliveryEvent(eventId: string, sql: Sql = getSql()): Promise<"applied" | "waiting" | "busy"> {
  const lease = randomUUID()
  const [event] = await sql`update email_delivery_inbox set lease_token=${lease}::uuid,
    lease_until=now()+interval '1 minute',attempts=attempts+1
    where event_id=${eventId} and applied_at is null and next_attempt_at <= now()
      and (lease_until is null or lease_until < now())
    returning event_id,provider_message_id,event_type,occurred_at,attempts`
  if (!event) return "busy"
  try {
    const applied = await applyEvent(event as { event_id: string; provider_message_id: string; event_type: DeliveryEventType; occurred_at: string | Date }, sql)
    await sql`update email_delivery_inbox set applied_at=case when ${applied} then now() else null end,
      last_error_code=case when ${applied} then null else 'awaiting_message_record' end,
      next_attempt_at=now()+least(1440,5*power(2,least(10,attempts-1)))*interval '1 minute',lease_token=null,lease_until=null
      where event_id=${eventId} and lease_token=${lease}::uuid`
    return applied ? "applied" : "waiting"
  } catch {
    await sql`update email_delivery_inbox set last_error_code='apply_failed',next_attempt_at=now()+interval '5 minutes',
      lease_token=null,lease_until=null where event_id=${eventId} and lease_token=${lease}::uuid`
    return "waiting"
  }
}

/** Database-only replay: no sends, provider lookups or reader grants. */
export async function drainDeliveryInbox(limit = 25, sql: Sql = getSql(), deadline = Infinity): Promise<{ checked: number; applied: number; waiting: number }> {
  if (!(await deliveryInboxReady(sql))) return { checked: 0, applied: 0, waiting: 0 }
  const size = Math.max(1, Math.min(100, Math.floor(limit)))
  const rows = await sql`select event_id from email_delivery_inbox where applied_at is null and next_attempt_at <= now()
    and (lease_until is null or lease_until < now()) order by attempts,next_attempt_at,received_at,event_id limit ${size}`
  const result = { checked: 0, applied: 0, waiting: 0 }
  for (const row of rows) {
    if (Date.now() >= deadline) break
    const state = await replayDeliveryEvent(String(row.event_id), sql)
    result.checked++
    if (state === "applied") result.applied++
    if (state === "waiting") result.waiting++
  }
  return result
}

export type DeliveryEvidence = { delivered: boolean; bounced: boolean; complained: boolean; delayed: boolean; failed: boolean }
export function deliveryEvidenceStatus(outcome: string, evidence: DeliveryEvidence): string {
  if (evidence.complained) return "Recipient reported spam"
  if (evidence.bounced) return "Bounced"
  if (evidence.failed) return "Provider reported failure"
  if (evidence.delivered) return "Delivered to receiving mail server"
  if (evidence.delayed) return "Provider reported a delay"
  if (outcome === "accepted") return "Accepted; no delivery report yet"
  if (outcome === "not_configured") return "Not sent: email not configured"
  if (outcome === "rejected" || outcome === "failed") return "Not accepted"
  if (outcome === "unknown") return "Unknown; may have been accepted"
  if (outcome === "sending") return "Send in progress"
  return "Not attempted"
}

/** Owner-only page calls this; it never returns bodies, codes, tokens or links. */
export async function recentEmailDiagnostics(sql: Sql = getSql()): Promise<Array<{ id: string; context: string; kind: string; recipient: string; outcome: string; createdAt: string; status: string }>> {
  if (!(await deliveryInboxReady(sql))) return []
  const rows = await sql`
    with attempts as (
      select id::text,'review' as context,kind,email as recipient,outcome,provider_message_id,created_at,
        delivered_at is not null as previous_delivered,
        bounced_at is not null and coalesce(last_event,'') not in ('failed','suppressed') as previous_bounced,
        complained_at is not null as previous_complained,delayed_at is not null as previous_delayed,
        coalesce(last_event,'') in ('failed','suppressed') as previous_failed from review_email_attempts
      union all
      select m.id::text,'subscriber',m.kind,s.email,m.state,m.provider_message_id,m.created_at,false,false,false,false,false
      from subscriber_onboarding_messages m join subscribers s on s.id=m.subscriber_id
      union all
      select e.id::text,'subscriber','sign_in_or_publication',s.email,'accepted',e.resend_email_id,e.occurred_at,false,false,false,false,false
      from client_engagement_events e join subscribers s on s.id=e.subscriber_id
      where e.event_type in ('signin_email_sent','publication_notification_sent') and e.resend_email_id is not null
        and not exists(select 1 from subscriber_onboarding_messages m where m.provider_message_id=e.resend_email_id)
    )
    select a.*,a.previous_delivered or exists(select 1 from email_delivery_inbox d where d.provider_message_id=a.provider_message_id and d.event_type='email.delivered')
        or exists(select 1 from client_engagement_events e where e.resend_email_id=a.provider_message_id and e.event_type='email_delivered') as delivered,
      a.previous_bounced or exists(select 1 from email_delivery_inbox d where d.provider_message_id=a.provider_message_id and d.event_type='email.bounced')
        or exists(select 1 from client_engagement_events e where e.resend_email_id=a.provider_message_id and e.event_type='email_bounced') as bounced,
      a.previous_complained or exists(select 1 from email_delivery_inbox d where d.provider_message_id=a.provider_message_id and d.event_type='email.complained') as complained,
      a.previous_delayed or exists(select 1 from email_delivery_inbox d where d.provider_message_id=a.provider_message_id and d.event_type='email.delivery_delayed') as delayed,
      a.previous_failed or exists(select 1 from email_delivery_inbox d where d.provider_message_id=a.provider_message_id and d.event_type in ('email.failed','email.suppressed'))
        or exists(select 1 from client_engagement_events e where e.resend_email_id=a.provider_message_id and e.event_type='email_failed') as failed
    from attempts a order by created_at desc,id limit 50`
  return rows.map((r) => ({ id: String(r.id),context: String(r.context),kind: String(r.kind),recipient: String(r.recipient),outcome: String(r.outcome),
    createdAt: new Date(r.created_at as string | Date).toISOString(),status: deliveryEvidenceStatus(String(r.outcome),r as DeliveryEvidence) }))
}
