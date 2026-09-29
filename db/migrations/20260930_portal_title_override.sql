-- Paid portal titles: an explicit override flag.
--
-- The subscriber portal shows each Data Room document under its synced
-- Papermark name. An administrator can keep a publication's own editorial
-- title instead -- but only by saying so: sync generates an editorial title
-- from the filename, and that generated title must never outlive a rename in
-- Papermark. This flag is how "say so" is recorded.
--
-- Additive and idempotent. Every existing publication starts with the flag
-- off, which is exactly the behaviour the code has before this migration runs:
-- Papermark names everywhere. Safe to run while the site is live, before or
-- after the code that reads it is deployed.
--
--   psql "<connection string>" -v ON_ERROR_STOP=1 -f db/migrations/20260930_portal_title_override.sql

begin;

set local lock_timeout = '5s';

alter table documents
  add column if not exists portal_title_override boolean not null default false;

commit;
