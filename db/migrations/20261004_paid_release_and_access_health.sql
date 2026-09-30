-- Paid release, audited paid periods and exceptions, and access health.
--
-- Additive and idempotent: safe to run more than once. Nothing existing is
-- changed or removed, no subscription term is altered and no access is
-- granted: every existing publication record starts with no explicit release
-- decision (NULL), and the application reads a published record as released,
-- an archived one as withheld and a draft as undecided until an administrator
-- decides. Run after 20261003_subscription_edition_entitlements.sql.

-- 1. Release to paid subscribers, separate from editorial status and from
--    Complimentary Review publication or withdrawal.
alter table documents add column if not exists paid_release_state text;
alter table documents add column if not exists paid_release_changed_at timestamptz;
alter table documents add column if not exists paid_release_changed_by uuid references admins(id) on delete set null;
alter table documents add column if not exists paid_release_reason text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'documents_paid_release_state_check') then
    alter table documents add constraint documents_paid_release_state_check
      check (paid_release_state is null or paid_release_state in ('released', 'withheld'));
  end if;
end $$;

create table if not exists publication_release_events (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references documents(id) on delete cascade,
  state text not null check (state in ('released', 'withheld', 'undecided')),
  reason text not null check (length(trim(reason)) > 0),
  administrator_id uuid references admins(id) on delete set null,
  source text not null default 'admin',
  created_at timestamptz not null default now()
);
create index if not exists publication_release_events_publication_idx
  on publication_release_events (publication_id, created_at desc);

-- 2. Paid periods: a mistaken period is voided (it then grants nothing) and
--    kept, so genuine renewals and unpaid gaps stay visible in the history.
alter table subscriber_subscription_periods add column if not exists voided_at timestamptz;
alter table subscriber_subscription_periods add column if not exists voided_by uuid references admins(id) on delete set null;
alter table subscriber_subscription_periods add column if not exists void_reason text;
alter table subscriber_subscription_periods add column if not exists created_by uuid references admins(id) on delete set null;
alter table subscriber_subscription_periods add column if not exists note text;

create table if not exists subscriber_period_events (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references subscribers(id) on delete cascade,
  period_id uuid references subscriber_subscription_periods(id) on delete set null,
  action text not null check (action in ('added', 'voided', 'restored')),
  starts_on date not null,
  ends_on date not null,
  level text not null,
  reason text not null check (length(trim(reason)) > 0),
  administrator_id uuid references admins(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists subscriber_period_events_subscriber_idx
  on subscriber_period_events (subscriber_id, created_at desc);

-- 3. Individual exceptions: Automatic deletes the exception row, so every
--    decision -- including the return to Automatic -- is kept here.
create table if not exists subscriber_exception_events (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references subscribers(id) on delete cascade,
  publication_id uuid not null references documents(id) on delete cascade,
  decision text not null check (decision in ('allow', 'block', 'automatic')),
  reason text not null check (length(trim(reason)) > 0),
  administrator_id uuid references admins(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists subscriber_exception_events_subscriber_idx
  on subscriber_exception_events (subscriber_id, created_at desc);

-- 4. Reconciliation: one run at a time per subscriber (a lease), and what the
--    last run found. Counts and titles only; never a link or a URL.
alter table subscriber_access_reconciliations add column if not exists outcome text;
alter table subscriber_access_reconciliations add column if not exists expected integer;
alter table subscriber_access_reconciliations add column if not exists verified integer;
alter table subscriber_access_reconciliations add column if not exists missing integer;
alter table subscriber_access_reconciliations add column if not exists excluded integer;
alter table subscriber_access_reconciliations add column if not exists unresolved integer;
alter table subscriber_access_reconciliations add column if not exists failed integer;
alter table subscriber_access_reconciliations add column if not exists summary jsonb;
alter table subscriber_access_reconciliations add column if not exists trigger text;
alter table subscriber_access_reconciliations add column if not exists attempts integer not null default 0;
alter table subscriber_access_reconciliations add column if not exists next_attempt_at timestamptz;
alter table subscriber_access_reconciliations add column if not exists last_verified_at timestamptz;
alter table subscriber_access_reconciliations add column if not exists lease_token uuid;
alter table subscriber_access_reconciliations add column if not exists lease_expires_at timestamptz;
alter table subscriber_access_reconciliations add column if not exists updated_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'subscriber_access_reconciliations_outcome_check') then
    alter table subscriber_access_reconciliations add constraint subscriber_access_reconciliations_outcome_check
      check (outcome is null or outcome in ('ready', 'ready_with_unresolved', 'no_eligible', 'partial', 'failed', 'not_applicable', 'superseded'));
  end if;
end $$;
create index if not exists subscriber_access_reconciliations_due_idx
  on subscriber_access_reconciliations (next_attempt_at)
  where next_attempt_at is not null;
