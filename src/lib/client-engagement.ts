import "server-only"
import { getSql } from "./db"

export type ClientPrincipal = { type: "subscriber" | "briefing"; id: string }
export type EngagementEventType =
  | "signin_email_sent" | "email_delivered" | "email_opened" | "email_clicked"
  | "email_bounced" | "email_failed" | "signin_completed" | "portal_opened"
  | "private_link_opened" | "document_downloaded" | "publication_notification_sent"

export async function recordClientEvent(
  principal: ClientPrincipal,
  eventType: EngagementEventType,
  options: { resendEmailId?: string; webhookEventId?: string; occurredAt?: Date; dedupeMinutes?: number } = {},
): Promise<void> {
  const sql = getSql()
  const subscriberId = principal.type === "subscriber" ? principal.id : null
  const briefingId = principal.type === "briefing" ? principal.id : null
  if (options.dedupeMinutes) {
    const recent = await sql`select 1 from client_engagement_events
      where subscriber_id is not distinct from ${subscriberId}::uuid
        and briefing_request_id is not distinct from ${briefingId}::uuid
        and event_type=${eventType}
        and occurred_at > now() - (${options.dedupeMinutes} || ' minutes')::interval limit 1`
    if (recent[0]) return
  }
  await sql`insert into client_engagement_events
    (subscriber_id,briefing_request_id,event_type,resend_email_id,webhook_event_id,occurred_at)
    values (${subscriberId},${briefingId},${eventType},${options.resendEmailId ?? null},
      ${options.webhookEventId ?? null},${options.occurredAt ?? new Date()})
    on conflict (webhook_event_id) where webhook_event_id is not null do nothing`
}

export async function principalForResendEmail(resendEmailId: string): Promise<ClientPrincipal | null> {
  const sql = getSql()
  const rows = (await sql`select subscriber_id,briefing_request_id from client_engagement_events
    where resend_email_id=${resendEmailId}
      and event_type in ('signin_email_sent','publication_notification_sent')
    order by occurred_at desc limit 1`) as {subscriber_id:string|null;briefing_request_id:string|null}[]
  const row = rows[0]
  return row?.subscriber_id ? {type:"subscriber",id:row.subscriber_id}
    : row?.briefing_request_id ? {type:"briefing",id:row.briefing_request_id} : null
}

// ---------------------------------------------------------------------------
// Dashboard summary -- corrected in Phase 6
// ---------------------------------------------------------------------------
//
// The figures this file used to produce were wrong in four specific ways, and
// they are named here because the shapes they returned are gone and anyone
// looking for them should know why:
//
//  1. `viewClicks` counted `portal_opened` alongside `private_link_opened`, so
//     signing in to the portal registered as clicking through to a document.
//     Opening the library is not opening a publication.
//  2. `papermarkViews` was `count(*) from document_views`, a row count. Two
//     collectors writing the same view, or one reader returning ten times, read
//     as ten "views" with no way to see one reader behind them.
//  3. Lifetime and 30-day figures sat in the same object -- `signedIn30d` beside
//     a lifetime `portalOpens` -- so no two numbers could be compared.
//  4. Nothing distinguished a paying subscriber from a briefing client or a
//     Complimentary Review prospect, so an unpaid reader raised the same
//     counter as a subscriber.
//
// The replacements live in `@/lib/engagement-analytics`, which takes an explicit
// `DateWindow` and applies it to every query, counts distinct Papermark ids
// rather than rows, and separates readers by type. The definitions themselves
// are in `@/lib/engagement-metrics` so they can be tested directly.
//
// Nothing is re-exported from here under the old names on purpose: a caller
// reaching for `getEngagementSummary()` and silently receiving differently
// scoped numbers would be worse than a compile error.

/**
 * The subscriber-facing engagement figures used by the weekly digest and the
 * per-subscriber detail page.
 *
 * Kept deliberately small and explicitly windowed. `windowDays` is required,
 * so a caller cannot accidentally get a lifetime total where they expected a
 * recent one.
 */
export type SubscriberActivity = {
  subscriberId: string
  /** Distinct publications with a confirmed Papermark view in the window. */
  documentsOpened: number
  /** Distinct Papermark view ids in the window. Not a row count. */
  viewSessions: number
  /** Confirmed download events in the window, including repeats. */
  downloadEvents: number
  lastViewedAt: string | null
}

export async function getSubscriberActivity(
  subscriberId: string,
  windowDays: number,
): Promise<SubscriberActivity> {
  const sql = getSql()

  const rows = (await sql`
    select
      count(distinct dv.publication_id)::int    as documents_opened,
      count(distinct dv.papermark_view_id)::int as view_sessions,
      max(dv.viewed_at)                         as last_viewed_at,
      (
        select count(distinct de.source_event_id)::int
        from document_download_events de
        where de.subscriber_id = ${subscriberId}::uuid
          and de.downloaded_at > now() - (${windowDays} || ' days')::interval
      ) as download_events
    from document_views dv
    where dv.subscriber_id = ${subscriberId}::uuid
      and dv.viewed_at > now() - (${windowDays} || ' days')::interval
  `) as Record<string, unknown>[]

  const r = rows[0] ?? {}
  return {
    subscriberId,
    documentsOpened: Number(r.documents_opened ?? 0),
    viewSessions: Number(r.view_sessions ?? 0),
    downloadEvents: Number(r.download_events ?? 0),
    lastViewedAt: r.last_viewed_at ? String(r.last_viewed_at) : null,
  }
}

// ---------------------------------------------------------------------------
// Subscriber detail timeline
// ---------------------------------------------------------------------------

export type EngagementTimelineEntry = {
  id: string
  eventType: string
  occurredAt: string
  resendEmailId: string | null
  metadata: Record<string, unknown>
}

export async function getSubscriberTimeline(subscriberId: string): Promise<EngagementTimelineEntry[]> {
  const sql = getSql()
  const rows = await sql`
    select id, event_type, occurred_at, resend_email_id, metadata
    from client_engagement_events
    where subscriber_id = ${subscriberId}::uuid
    order by occurred_at desc
    limit 200
  ` as Record<string,unknown>[]

  return rows.map(r => ({
    id: String(r.id),
    eventType: String(r.event_type),
    occurredAt: String(r.occurred_at),
    resendEmailId: r.resend_email_id ? String(r.resend_email_id) : null,
    metadata: (r.metadata && typeof r.metadata === 'object' ? r.metadata : {}) as Record<string, unknown>,
  }))
}

export type SubscriberDetail = {
  id: string
  name: string
  email: string
  publicTier: string
  status: string
  level: string | null
  termStart: string | null
  termEnd: string | null
  createdAt: string | null
}

export async function getSubscriberForEngagement(subscriberId: string): Promise<SubscriberDetail | null> {
  const sql = getSql()
  const rows = await sql`
    select id, coalesce(nullif(full_name,''),name) as name, email, public_tier,
      status, level, term_start, term_end, created_at
    from subscribers where id=${subscriberId}::uuid and client_type='subscriber' limit 1
  ` as Record<string,unknown>[]
  const r = rows[0]
  if (!r) return null
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    email: String(r.email ?? ''),
    publicTier: String(r.public_tier ?? ''),
    status: String(r.status ?? ''),
    level: r.level ? String(r.level) : null,
    termStart: r.term_start ? String(r.term_start) : null,
    termEnd: r.term_end ? String(r.term_end) : null,
    createdAt: r.created_at ? String(r.created_at) : null,
  }
}
