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
// Dashboard summary
// ---------------------------------------------------------------------------

export type EngagementSummary = {
  activeSubscribers: number
  signedIn30d: number
  neverSignedIn: number
  portalVisitors30d: number
  portalOpens: number
  viewClicks: number
  papermarkViews: number
  downloadClicks: number
  papermarkDownloads: number
  emailsSent: number
  emailsDelivered: number
  emailsOpened: number
  emailsClicked: number
  emailFailures: number
}

export async function getEngagementSummary(): Promise<EngagementSummary> {
  const sql = getSql()
  const [row] = await sql`select
    (select count(*)::int from subscribers where client_type='subscriber' and lower(status)='active') as active_subscribers,
    (select count(distinct e.subscriber_id)::int from client_engagement_events e
      where e.event_type='signin_completed' and e.occurred_at > now() - interval '30 days') as signed_in_30d,
    (select count(*)::int from subscribers s
      where s.client_type='subscriber' and lower(s.status)='active'
        and not exists(select 1 from client_engagement_events e where e.subscriber_id=s.id and e.event_type='signin_completed')) as never_signed_in,
    (select count(distinct e.subscriber_id)::int from client_engagement_events e
      where e.event_type='portal_opened' and e.occurred_at > now() - interval '30 days') as portal_visitors_30d,
    (select count(*)::int from client_engagement_events where event_type='portal_opened') as portal_opens,
    (select count(*)::int from client_engagement_events where event_type in ('portal_opened','private_link_opened')) as view_clicks,
    (select count(*)::int from document_views) as papermark_views,
    (select count(*)::int from client_engagement_events where event_type='document_downloaded') as download_clicks,
    (select count(*)::int from document_views where downloaded=true) as papermark_downloads,
    (select count(*)::int from client_engagement_events where event_type='signin_email_sent') as emails_sent,
    (select count(*)::int from client_engagement_events where event_type='email_delivered') as emails_delivered,
    (select count(*)::int from client_engagement_events where event_type='email_opened') as emails_opened,
    (select count(*)::int from client_engagement_events where event_type='email_clicked') as emails_clicked,
    (select count(*)::int from client_engagement_events where event_type in ('email_failed','email_bounced')) as email_failures
  ` as Record<string,number>[]

  return {
    activeSubscribers: row?.active_subscribers ?? 0,
    signedIn30d: row?.signed_in_30d ?? 0,
    neverSignedIn: row?.never_signed_in ?? 0,
    portalVisitors30d: row?.portal_visitors_30d ?? 0,
    portalOpens: row?.portal_opens ?? 0,
    viewClicks: row?.view_clicks ?? 0,
    papermarkViews: row?.papermark_views ?? 0,
    downloadClicks: row?.download_clicks ?? 0,
    papermarkDownloads: row?.papermark_downloads ?? 0,
    emailsSent: row?.emails_sent ?? 0,
    emailsDelivered: row?.emails_delivered ?? 0,
    emailsOpened: row?.emails_opened ?? 0,
    emailsClicked: row?.emails_clicked ?? 0,
    emailFailures: row?.email_failures ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Subscriber engagement rows
// ---------------------------------------------------------------------------

export type SubscriberEngagementRow = {
  id: string
  name: string
  email: string
  publicTier: string
  status: string
  lastSignIn: string | null
  lastPortalVisit: string | null
  portalVisits30d: number
  docsViewed: number
  docsDownloaded: number
  emailsSent: number
  emailsDelivered: number
  emailFailures: number
  lastActivity: string | null
}

export async function getSubscriberEngagementRows(): Promise<SubscriberEngagementRow[]> {
  const sql = getSql()
  const rows = await sql`
    select s.id, coalesce(nullif(s.full_name,''),s.name) as name, s.email,
      s.public_tier, s.status,
      max(e.occurred_at) filter(where e.event_type='signin_completed') as last_signin,
      max(e.occurred_at) filter(where e.event_type='portal_opened') as last_portal_visit,
      count(*) filter(where e.event_type='portal_opened' and e.occurred_at > now()-interval '30 days')::int as portal_visits_30d,
      (select count(*)::int from document_views dv where dv.subscriber_id=s.id) as docs_viewed,
      (select count(*)::int from document_views dv where dv.subscriber_id=s.id and dv.downloaded=true) as docs_downloaded,
      count(*) filter(where e.event_type='signin_email_sent')::int as emails_sent,
      count(*) filter(where e.event_type='email_delivered')::int as emails_delivered,
      count(*) filter(where e.event_type in ('email_failed','email_bounced'))::int as email_failures,
      max(e.occurred_at) as last_activity
    from subscribers s
    left join client_engagement_events e on e.subscriber_id=s.id
    where s.client_type='subscriber'
    group by s.id
    order by last_activity desc nulls last, name
  ` as Record<string,unknown>[]

  return rows.map(r => ({
    id: String(r.id),
    name: String(r.name ?? ''),
    email: String(r.email ?? ''),
    publicTier: String(r.public_tier ?? ''),
    status: String(r.status ?? ''),
    lastSignIn: r.last_signin ? String(r.last_signin) : null,
    lastPortalVisit: r.last_portal_visit ? String(r.last_portal_visit) : null,
    portalVisits30d: Number(r.portal_visits_30d ?? 0),
    docsViewed: Number(r.docs_viewed ?? 0),
    docsDownloaded: Number(r.docs_downloaded ?? 0),
    emailsSent: Number(r.emails_sent ?? 0),
    emailsDelivered: Number(r.emails_delivered ?? 0),
    emailFailures: Number(r.email_failures ?? 0),
    lastActivity: r.last_activity ? String(r.last_activity) : null,
  }))
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

// ---------------------------------------------------------------------------
// Backward-compatible export (engagement-digest still imports it)
// ---------------------------------------------------------------------------

export async function getClientEngagementDashboard() {
  const summary = await getEngagementSummary()
  const rows = await getSubscriberEngagementRows()
  return { summary, rows }
}
