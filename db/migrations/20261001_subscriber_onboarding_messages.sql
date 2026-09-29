-- The two onboarding emails a newly activated subscriber receives -- the
-- welcome, then the separate secure-access email -- tracked one row per
-- message per subscriber.
--
-- Why a table: the result of handing an email to the provider has to be
-- recorded durably and claimed atomically, so that a double-click, two admins
-- activating at once, or a crash after the provider accepted a message but
-- before APRI recorded it can never send a message twice or report one as sent
-- that was not. `unique (subscriber_id, kind)` is what makes one welcome and
-- one secure-access email per person; the conditional update that moves a row
-- to 'sending' is the claim only one caller can win.
--
-- States: pending (not yet attempted), sending (claimed; an attempt is in
-- flight), accepted (the provider accepted it; provider_message_id is its id --
-- accepted is not delivered: delivery is recorded by the Resend webhook),
-- failed (refused or not configured; safe to retry), unknown (the provider did
-- not settle it; it may be in the inbox, so it is never retried automatically).
--
-- subscriber_email_claims is the claim for an explicit "Resend sign-in link":
-- one row per subscriber and purpose, taken by an upsert only one caller can
-- win within the window, so a double-click or two admins cannot send two links
-- or revoke each other's.
--
-- Additive and idempotent. Existing subscribers get no rows, and so no
-- retrospective emails. Run it BEFORE deploying the code that uses it. Until it
-- runs, a new activation is refused (nothing is changed) with a message naming
-- this file, so nobody is activated without tracked onboarding; subscribers
-- already active keep their access and can still be sent a sign-in link.
--
--   psql "<connection string>" -v ON_ERROR_STOP=1 -f db/migrations/20261001_subscriber_onboarding_messages.sql

begin;

set local lock_timeout = '5s';

create table if not exists subscriber_onboarding_messages (
  id                   uuid        primary key default gen_random_uuid(),
  subscriber_id        uuid        not null references subscribers (id) on delete cascade,
  kind                 text        not null,
  state                text        not null default 'pending',
  attempts             integer     not null default 0,
  provider_message_id  text,
  last_error           text,
  claimed_at           timestamptz,
  accepted_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint subscriber_onboarding_messages_kind_check
    check (kind in ('welcome', 'secure_access')),
  constraint subscriber_onboarding_messages_state_check
    check (state in ('pending', 'sending', 'accepted', 'failed', 'unknown')),
  constraint subscriber_onboarding_messages_attempts_check
    check (attempts >= 0),
  -- Accepted means the provider gave a message id; nothing else does.
  constraint subscriber_onboarding_messages_accepted_check
    check ((state = 'accepted') = (accepted_at is not null and provider_message_id is not null)),
  constraint subscriber_onboarding_messages_one_per_kind
    unique (subscriber_id, kind)
);

-- The Resend webhook finds a message by the provider's id to record delivery.
create index if not exists subscriber_onboarding_messages_provider_idx
  on subscriber_onboarding_messages (provider_message_id)
  where provider_message_id is not null;

create table if not exists subscriber_email_claims (
  subscriber_id  uuid        not null references subscribers (id) on delete cascade,
  purpose        text        not null,
  claimed_at     timestamptz not null default now(),
  constraint subscriber_email_claims_purpose_check
    check (purpose in ('signin_resend')),
  primary key (subscriber_id, purpose)
);

commit;
