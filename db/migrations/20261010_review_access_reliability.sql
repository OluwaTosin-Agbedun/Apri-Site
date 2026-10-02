-- 20261010_review_access_reliability.sql
--
-- An owner-only record of every Complimentary Review email APRI tries to send,
-- and what the email provider (Resend) then reported. Additive and safe to
-- re-run.
--
-- Why: review emails were sent without keeping the provider's answer, so a
-- rejected send still told the reader "on its way", and nobody could tell a
-- refused email from one that was delivered.
--
--  * outcome is what the provider said when APRI handed it the email:
--      accepted      the provider took it (NOT proof of inbox delivery)
--      rejected      the provider refused it (detail says why, safely)
--      unknown       no clear answer (timeout); it may still arrive
--      not_configured  no provider key in this deployment; nothing was sent
--  * delivered_at / bounced_at / complained_at / delayed_at come only from the
--    provider's signed webhook events. "Delivered" is shown only from these.
--
-- Never stores a token, a code, a link or an email body. Shown only to
-- owners in Admin -> Review Library -> Advanced.

create table if not exists review_email_attempts (
  id                  uuid primary key default gen_random_uuid(),
  kind                text not null check (kind in (
                        'review_verification', 'review_manager_notice', 'review_access',
                        'library_sign_in', 'subscription_confirmation', 'subscription_messages')),
  email               text not null check (email = lower(btrim(email))),
  outcome             text not null check (outcome in ('accepted', 'rejected', 'unknown', 'not_configured')),
  provider_message_id text,
  detail              text,
  created_at          timestamptz not null default now(),
  delivered_at        timestamptz,
  delayed_at          timestamptz,
  bounced_at          timestamptz,
  complained_at       timestamptz,
  last_event          text,
  last_event_at       timestamptz
);
create index if not exists review_email_attempts_created_idx on review_email_attempts (created_at desc);
create index if not exists review_email_attempts_email_idx on review_email_attempts (email, created_at desc);
create unique index if not exists review_email_attempts_message_key
  on review_email_attempts (provider_message_id) where provider_message_id is not null;

-- Personal reader rooms (20261009): two columns that make routing safe.
--  * verified_editions  the review edition ids last confirmed visible in the room.
--                       A reader is sent to their room only while this equals
--                       the editions currently assigned to them; any change is
--                       reconciled with Papermark first.
--  * lease_until        one reconcile per reader at a time, so two overlapping
--                       updates cannot create a second group or link.
do $$
begin
  if to_regclass('public.review_reader_rooms') is not null then
    alter table review_reader_rooms add column if not exists verified_editions text;
    alter table review_reader_rooms add column if not exists lease_until timestamptz;
  end if;
end $$;
