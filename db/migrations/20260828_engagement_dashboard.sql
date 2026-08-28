-- Engagement dashboard: extend event types and add notification baseline.
-- Additive, idempotent and safe to rerun.

begin;

-- 1. Add document_downloaded and publication_notification_sent to the event type
--    check constraint.
do $$
begin
  alter table client_engagement_events
    drop constraint if exists client_engagement_events_event_type_check;
  alter table client_engagement_events
    add constraint client_engagement_events_event_type_check
    check (event_type in (
      'signin_email_sent','email_delivered','email_opened','email_clicked',
      'email_bounced','email_failed','signin_completed','portal_opened',
      'private_link_opened','document_downloaded','publication_notification_sent'
    ));
end $$;

-- 2. Baseline guard for Data Room document notifications.
--
--    Every document that already exists is marked notification_eligible = false,
--    so the first cron run after deployment does not treat the entire library as
--    new and email every active subscriber.
--
--    New documents inserted after this migration default to true and are the only
--    ones that can trigger automatic notifications.
alter table papermark_dataroom_documents
  add column if not exists notification_eligible boolean not null default true;

update papermark_dataroom_documents set notification_eligible = false
  where notification_eligible = true;

commit;
