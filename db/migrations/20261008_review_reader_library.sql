-- 20261008_review_reader_library.sql
--
-- One remembered Complimentary Review Library for approved readers, separate
-- from paid subscriber sign-in. Additive and safe to re-run.
--
-- A reader verifies their email once on APRI (a link or an 8-digit code, as
-- for subscribers) and returns in the same browser without verifying again.
-- What they see is decided on every request by the existing per-edition
-- recipient lists and each edition's state -- never by the cookie -- so a
-- withdrawal or a removed recipient takes effect at once.
--
--  * review_reader_tokens    one-time sign-in links/codes, by email; only hashes stored.
--  * review_reader_sessions  one row per signed-in browser; sign-out ends it server-side.
--  * review_reader_events    library visits and edition opens, by reader email and edition,
--                            for Engagement. No link or token is ever stored here.
--
-- Nothing existing is changed: recipient lists, review_prospects, review_tokens,
-- Papermark links and the /review request process are untouched.

create table if not exists review_reader_tokens (
  id            uuid primary key default gen_random_uuid(),
  email         text not null check (email = lower(btrim(email)) and position('@' in email) > 1),
  token_hash    text not null,
  code_hash     text,
  code_attempts integer not null default 0,
  binding_hash  text,
  expires_at    timestamptz not null,
  consumed_at   timestamptz,
  created_at    timestamptz not null default now()
);
create unique index if not exists review_reader_tokens_hash_key on review_reader_tokens (token_hash);
create index if not exists review_reader_tokens_email_idx on review_reader_tokens (email, created_at desc);

create table if not exists review_reader_sessions (
  id            uuid primary key default gen_random_uuid(),
  email         text not null check (email = lower(btrim(email))),
  method        text not null check (method in ('link', 'code', 'access_link')),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  revoked_at    timestamptz,
  revoke_reason text check (revoke_reason is null or revoke_reason in ('signed_out', 'admin_revoked')),
  check ((revoked_at is null) = (revoke_reason is null))
);
create index if not exists review_reader_sessions_email_idx on review_reader_sessions (email, created_at desc);

create table if not exists review_reader_events (
  id          uuid primary key default gen_random_uuid(),
  email       text not null check (email = lower(btrim(email))),
  edition_id  uuid references review_publication_editions (id) on delete set null,
  event_type  text not null check (event_type in ('signed_in', 'library_opened', 'edition_opened')),
  occurred_at timestamptz not null default now()
);
create index if not exists review_reader_events_email_idx on review_reader_events (email, occurred_at desc);
create index if not exists review_reader_events_edition_idx on review_reader_events (edition_id, occurred_at desc);
