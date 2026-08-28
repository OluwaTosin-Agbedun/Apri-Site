-- Engagement for subscriber and briefing principals. Additive and rerunnable.
begin;
alter table subscribers add column if not exists library_link_updated_at timestamptz;
alter table briefing_requests add column if not exists private_link_updated_at timestamptz;
create table if not exists client_engagement_events (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid references subscribers(id) on delete cascade,
  briefing_request_id uuid references briefing_requests(id) on delete cascade,
  event_type text not null check (event_type in (
    'signin_email_sent','email_delivered','email_opened','email_clicked',
    'email_bounced','email_failed','signin_completed','portal_opened',
    'private_link_opened'
  )),
  resend_email_id text,
  webhook_event_id text,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint client_engagement_one_principal_check check (
    (subscriber_id is not null and briefing_request_id is null) or
    (subscriber_id is null and briefing_request_id is not null)
  )
);
create unique index if not exists client_engagement_webhook_event_key
  on client_engagement_events(webhook_event_id) where webhook_event_id is not null;
create index if not exists client_engagement_subscriber_idx
  on client_engagement_events(subscriber_id, occurred_at desc);
create index if not exists client_engagement_briefing_idx
  on client_engagement_events(briefing_request_id, occurred_at desc);
create index if not exists client_engagement_type_idx
  on client_engagement_events(event_type, occurred_at desc);
create index if not exists client_engagement_resend_idx
  on client_engagement_events(resend_email_id) where resend_email_id is not null;
create index if not exists client_engagement_time_idx
  on client_engagement_events(occurred_at desc);
commit;
