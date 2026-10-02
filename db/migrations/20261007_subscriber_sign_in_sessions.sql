-- 20261007_subscriber_sign_in_sessions.sql
--
-- Subscriber sign-in that lands in the browser the subscriber actually uses,
-- and sessions the server can end. Additive and safe to re-run.
--
-- Root cause this supports fixing: a session was created in whichever browser
-- opened the emailed link -- often an email app's built-in browser -- so the
-- subscriber's own browser never held one and asked for email on every return.
--
--  * auth_tokens.code_hash      keyed hash of the 8-digit code printed in the
--                               same email; typed on the sign-in page, it signs
--                               in the browser it is typed into.
--  * auth_tokens.code_attempts  wrong-code count; the code stops working at 5.
--  * auth_tokens.binding_hash   hash of a short-lived cookie set on the browser
--                               that asked, so that browser's own click on the
--                               link signs in at once and any other browser (or
--                               a mail scanner) must confirm first.
--  * subscriber_sessions        one row per signed-in browser. Signing out,
--                               or Admin's "Sign out of all browsers", ends it
--                               server-side, even if a copy of the cookie remains.
--  * subscribers.sessions_revoked_at  ends cookies issued before this release
--                               (which carry no session id) when Admin signs a
--                               subscriber out of all browsers.
--
-- No existing row is changed. Existing signed-in browsers stay signed in.

alter table auth_tokens add column if not exists code_hash text;
alter table auth_tokens add column if not exists code_attempts integer not null default 0;
alter table auth_tokens add column if not exists binding_hash text;

create table if not exists subscriber_sessions (
  id            uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references subscribers (id) on delete cascade,
  method        text not null check (method in ('link', 'code')),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  revoked_at    timestamptz,
  revoke_reason text check (revoke_reason is null or revoke_reason in ('signed_out', 'admin_revoked')),
  check ((revoked_at is null) = (revoke_reason is null))
);

create index if not exists subscriber_sessions_subscriber_idx
  on subscriber_sessions (subscriber_id, created_at desc);

alter table subscribers add column if not exists sessions_revoked_at timestamptz;
