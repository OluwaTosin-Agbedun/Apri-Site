-- Additive edition-date entitlement history and per-person exceptions.
create table if not exists subscriber_subscription_periods (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references subscribers(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  level text not null check (level in ('L1','L2','L3','L4')),
  source text not null default 'admin',
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  unique (subscriber_id, starts_on, ends_on, level)
);
create index if not exists subscriber_periods_lookup_idx on subscriber_subscription_periods(subscriber_id, starts_on, ends_on);

-- Trustworthy backfill only: both agreed dates and a recognised level must exist.
insert into subscriber_subscription_periods(subscriber_id, starts_on, ends_on, level, source)
select id, term_start, term_end, level, 'legacy-current-term'
from subscribers
where term_start is not null and term_end is not null and level in ('L1','L2','L3','L4')
on conflict do nothing;

create table if not exists subscriber_publication_exceptions (
  subscriber_id uuid not null references subscribers(id) on delete cascade,
  publication_id uuid not null references documents(id) on delete cascade,
  decision text not null check (decision in ('allow','block')),
  reason text not null check (length(trim(reason)) > 0),
  administrator_id uuid not null references admins(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (subscriber_id, publication_id)
);

create table if not exists subscriber_access_reconciliations (
  subscriber_id uuid primary key references subscribers(id) on delete cascade,
  generation bigint not null default 1,
  state text not null default 'pending' check (state in ('pending','complete','failed')),
  detail text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);
