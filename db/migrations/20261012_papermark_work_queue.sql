-- Durable API pacing and retry work. Additive; makes no Papermark calls.
begin;
create table if not exists papermark_api_budgets (
  bucket text primary key,
  next_slot_at timestamptz not null default 'epoch',
  cooldown_until timestamptz not null default 'epoch',
  updated_at timestamptz not null default now()
);
create table if not exists review_reader_room_jobs (
  email text primary key check (email = lower(btrim(email)) and position('@' in email) > 1),
  generation bigint not null default 1,
  completed_generation bigint not null default 0,
  state text not null default 'pending' check (state in ('pending', 'running', 'complete', 'attention')),
  create_room boolean not null default false,
  priority int not null default 1,
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  last_error text,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists review_reader_room_jobs_due on review_reader_room_jobs (priority, next_attempt_at) where state in ('pending', 'running');
alter table review_reader_rooms add column if not exists lease_owner uuid;
alter table review_reader_rooms add column if not exists uncertain_creation text;
-- A same-generation verified read can be reused after an interrupted batch.
alter table papermark_subscriber_document_links add column if not exists verification_generation bigint;
alter table papermark_subscriber_document_links add column if not exists verification_result jsonb;
alter table papermark_subscriber_document_links add column if not exists last_verified_at timestamptz;
-- Existing failed/updating rooms are queued for review, not declared repaired.
insert into review_reader_room_jobs (email, create_room, priority)
select email, false, 0 from review_reader_rooms where state in ('failed', 'updating', 'closed')
on conflict (email) do nothing;
commit;
