-- Apply to Neon before deploying briefing portal code. Idempotent and data-preserving.
begin;
alter table briefing_requests add column if not exists private_link_url text;
alter table briefing_requests add column if not exists updated_at timestamptz not null default now();
alter table briefing_requests add column if not exists activated_at timestamptz;
alter table briefing_requests add column if not exists last_viewed_at timestamptz;
alter table briefing_requests drop constraint if exists briefing_requests_status_check;
alter table briefing_requests add constraint briefing_requests_status_check
  check (status in ('New','In Progress','Scheduled','Active','Closed'));
alter table auth_tokens alter column subscriber_id drop not null;
alter table auth_tokens add column if not exists briefing_request_id uuid;
-- Recreate the named FK separately so a partially applied deployment where the
-- column exists but its FK does not is repaired on the next run.
alter table auth_tokens drop constraint if exists auth_tokens_briefing_request_id_fkey;
alter table auth_tokens add constraint auth_tokens_briefing_request_id_fkey
  foreign key (briefing_request_id) references briefing_requests(id)
  on delete cascade not valid;
alter table auth_tokens validate constraint auth_tokens_briefing_request_id_fkey;
alter table auth_tokens add column if not exists briefing_request_id uuid
  references briefing_requests(id) on delete cascade;
alter table auth_tokens drop constraint if exists auth_tokens_one_principal_check;
alter table auth_tokens add constraint auth_tokens_one_principal_check check (
  (subscriber_id is not null and briefing_request_id is null) or
  (subscriber_id is null and briefing_request_id is not null)
) not valid;
alter table auth_tokens validate constraint auth_tokens_one_principal_check;
create index if not exists auth_tokens_briefing_idx
  on auth_tokens(briefing_request_id, created_at desc);
commit;
