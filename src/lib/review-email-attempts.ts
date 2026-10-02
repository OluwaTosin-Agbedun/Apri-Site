import "server-only"
import { getSql } from "./db"
import { safeText, type EmailOutcome } from "./email-delivery"

/**
 * The owner-only record of Complimentary Review emails (migration 20261010).
 *
 * `outcome` is what the provider said when APRI handed it the email.
 * "accepted" means the provider took it -- not that it reached an inbox.
 * Delivery, bounces, complaints and delays are recorded only from the
 * provider's signed webhook events (applyReviewEmailEvent), so the Admin
 * screen says "delivered" only with that evidence.
 *
 * Never a token, a code, a link or a body. Addresses are shown masked except
 * in an owner's own lookup.
 */

export type ReviewEmailKind =
  | "review_verification"
  | "review_manager_notice"
  | "review_access"
  | "library_sign_in"
  | "subscription_confirmation"
  | "subscription_messages"

let ready: { value: boolean; at: number } | null = null
export async function reviewEmailAttemptsReady(): Promise<boolean> {
  if (ready && Date.now() - ready.at < (ready.value ? 300_000 : 60_000)) return ready.value
  try {
    const [row] = (await getSql()`select to_regclass('public.review_email_attempts') is not null as ok`) as { ok: boolean }[]
    ready = { value: row?.ok === true, at: Date.now() }
  } catch {
    ready = { value: false, at: Date.now() }
  }
  return ready.value
}
export function resetReviewEmailAttemptsCache() {
  ready = null
}

/** Records what the provider said. Never fails the caller. */
export async function recordReviewEmailAttempt(kind: ReviewEmailKind, email: string, outcome: EmailOutcome): Promise<void> {
  try {
    if (!(await reviewEmailAttemptsReady())) return
    const providerId = outcome.status === "accepted" ? outcome.providerMessageId : null
    const detail = outcome.status === "accepted" ? null : safeText(outcome.message)
    await getSql()`
      insert into review_email_attempts (kind, email, outcome, provider_message_id, detail)
      values (${kind}, ${email.trim().toLowerCase()}, ${outcome.status}, ${providerId}, ${detail})
      on conflict (provider_message_id) where provider_message_id is not null do nothing
    `
  } catch {
    // Diagnostics only.
  }
}

const EVENT_COLUMN: Record<string, "delivered_at" | "bounced_at" | "complained_at" | "delayed_at" | null> = {
  "email.delivered": "delivered_at",
  "email.bounced": "bounced_at",
  "email.complained": "complained_at",
  "email.delivery_delayed": "delayed_at",
  "email.failed": "bounced_at",
  "email.sent": null,
  "email.opened": null,
  "email.clicked": null,
}

/**
 * Applies one signed provider event to the review email it belongs to.
 * Returns whether a review email matched (so the webhook can ignore the rest).
 */
export async function applyReviewEmailEvent(providerMessageId: string, eventType: string, occurredAt: Date): Promise<boolean> {
  try {
    if (!(await reviewEmailAttemptsReady())) return false
    if (!(eventType in EVENT_COLUMN)) return false
    const column = EVENT_COLUMN[eventType]
    const sql = getSql()
    const rows = (await sql`
      update review_email_attempts set
        last_event = ${eventType.replace(/^email\./, "")},
        last_event_at = ${occurredAt},
        delivered_at = case when ${column === "delivered_at"} then coalesce(delivered_at, ${occurredAt}) else delivered_at end,
        bounced_at = case when ${column === "bounced_at"} then coalesce(bounced_at, ${occurredAt}) else bounced_at end,
        complained_at = case when ${column === "complained_at"} then coalesce(complained_at, ${occurredAt}) else complained_at end,
        delayed_at = case when ${column === "delayed_at"} then coalesce(delayed_at, ${occurredAt}) else delayed_at end
      where provider_message_id = ${providerMessageId}
      returning id
    `) as { id: string }[]
    return rows.length > 0
  } catch {
    return false
  }
}

export type ReviewEmailAttempt = {
  id: string
  kind: ReviewEmailKind
  email: string
  outcome: EmailOutcome["status"]
  detail: string | null
  createdAt: string
  deliveredAt: string | null
  bouncedAt: string | null
  complainedAt: string | null
  delayedAt: string | null
  lastEvent: string | null
}

/** The honest one-line status an owner sees for one attempt. */
export function attemptStatus(a: Pick<ReviewEmailAttempt, "outcome" | "deliveredAt" | "bouncedAt" | "complainedAt" | "delayedAt" | "detail">): string {
  if (a.outcome === "rejected") return `Refused by the email provider: ${a.detail ?? "no reason given"}`
  if (a.outcome === "not_configured") return "Not sent: email is not configured on this deployment"
  if (a.outcome === "unknown") return `Unclear: the provider did not answer clearly (${a.detail ?? "no detail"}). It may still arrive.`
  if (a.bouncedAt) return "Accepted, then bounced (the provider reported it could not be delivered)"
  if (a.complainedAt) return "Delivered, then marked as spam by the recipient"
  if (a.deliveredAt) return "Delivered (the provider reported delivery to the receiving mail server)"
  if (a.delayedAt) return "Accepted; the provider reported a delivery delay"
  return "Accepted by the email provider; no delivery report yet"
}

/** a***@example.com: enough to recognise, not to copy. */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@")
  if (!domain) return "***"
  return `${user!.slice(0, 1)}***@${domain}`
}

export async function recentReviewEmailAttempts(limit = 25, email?: string): Promise<ReviewEmailAttempt[]> {
  if (!(await reviewEmailAttemptsReady())) return []
  const sql = getSql()
  const rows = (email
    ? await sql`select * from review_email_attempts where email = ${email.trim().toLowerCase()} order by created_at desc limit ${limit}`
    : await sql`select * from review_email_attempts order by created_at desc limit ${limit}`) as {
    id: string; kind: ReviewEmailKind; email: string; outcome: EmailOutcome["status"]; detail: string | null
    created_at: string | Date; delivered_at: string | Date | null; bounced_at: string | Date | null
    complained_at: string | Date | null; delayed_at: string | Date | null; last_event: string | null
  }[]
  const iso = (v: string | Date | null) => (v ? new Date(v).toISOString() : null)
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    email: r.email,
    outcome: r.outcome,
    detail: r.detail,
    createdAt: iso(r.created_at)!,
    deliveredAt: iso(r.delivered_at),
    bouncedAt: iso(r.bounced_at),
    complainedAt: iso(r.complained_at),
    delayedAt: iso(r.delayed_at),
    lastEvent: r.last_event,
  }))
}
