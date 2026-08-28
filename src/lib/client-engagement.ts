import "server-only"
import { getSql } from "./db"

export type ClientPrincipal = { type: "subscriber" | "briefing"; id: string }
export type EngagementEventType =
  | "signin_email_sent" | "email_delivered" | "email_opened" | "email_clicked"
  | "email_bounced" | "email_failed" | "signin_completed" | "portal_opened"
  | "private_link_opened"

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
    where resend_email_id=${resendEmailId} and event_type='signin_email_sent'
    order by occurred_at desc limit 1`) as {subscriber_id:string|null;briefing_request_id:string|null}[]
  const row = rows[0]
  return row?.subscriber_id ? {type:"subscriber",id:row.subscriber_id}
    : row?.briefing_request_id ? {type:"briefing",id:row.briefing_request_id} : null
}

export async function getClientEngagementDashboard() {
  const sql = getSql()
  const [summary] = await sql`select
    (select count(*)::int from subscribers where client_type='subscriber' and lower(status)='active') active_subscribers,
    (select count(*)::int from briefing_requests where lower(status)='active') active_briefings,
    count(distinct coalesce(subscriber_id::text,briefing_request_id::text)) filter
      (where event_type='portal_opened' and occurred_at>now()-interval '30 days')::int visitors_30d,
    count(*) filter (where event_type='email_delivered')::int delivered,
    count(*) filter (where event_type='email_clicked')::int clicked,
    count(*) filter (where event_type in ('email_failed','email_bounced'))::int failed
    from client_engagement_events`
  const rows = await sql`select * from (
    select s.id,'Subscriber' client_type,coalesce(nullif(s.full_name,''),s.name) name,s.email,s.status,
      max(e.occurred_at) last_activity,
      max(e.occurred_at) filter(where e.event_type='portal_opened') last_portal_visit,
      count(*) filter(where e.event_type='portal_opened')::int portal_visits,
      count(*) filter(where e.event_type='signin_completed')::int signins,
      count(*) filter(where e.event_type in ('email_failed','email_bounced'))::int failures
    from subscribers s left join client_engagement_events e on e.subscriber_id=s.id
    where s.client_type='subscriber' group by s.id
    union all
    select b.id,'Briefing' client_type,b.name,b.email,b.status,max(e.occurred_at),
      max(e.occurred_at) filter(where e.event_type='portal_opened'),
      count(*) filter(where e.event_type='portal_opened')::int,
      count(*) filter(where e.event_type='signin_completed')::int,
      count(*) filter(where e.event_type in ('email_failed','email_bounced'))::int
    from briefing_requests b left join client_engagement_events e on e.briefing_request_id=b.id group by b.id
  ) clients order by last_activity desc nulls last,name`
  return {summary,rows}
}
