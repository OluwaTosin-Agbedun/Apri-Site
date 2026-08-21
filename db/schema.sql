-- APRI schema. Safe to run repeatedly.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Administrators
-- ---------------------------------------------------------------------------
create table if not exists admins (
  id            uuid primary key default gen_random_uuid(),
  email         text        not null,
  name          text        not null,
  password_hash text        not null,
  role          text        not null default 'editor',
  is_active     boolean     not null default true,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz,
  constraint admins_role_check check (role in ('owner', 'editor'))
);

-- Case-insensitive uniqueness: Ada@x.com and ada@x.com must not be two accounts.
create unique index if not exists admins_email_lower_key on admins (lower(email));

-- ---------------------------------------------------------------------------
-- One-time setup latch
--
-- The /admin/setup screen is open only while this row is absent. It is written
-- once, when the first owner account is created, and never removed. Gating on
-- "are there zero admins?" would look equivalent but would silently reopen a
-- public account-creation route if every admin row were ever deleted.
-- ---------------------------------------------------------------------------
create table if not exists app_settings (
  key        text primary key,
  value      text        not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Publications
-- ---------------------------------------------------------------------------
create table if not exists documents (
  id             uuid primary key default gen_random_uuid(),
  slug           text        not null,
  section_label  text        not null default '',
  kicker         text        not null default '',
  title          text        not null,
  strapline      text        not null default '',
  product_line   text        not null default '',
  description    text        not null default '',
  frequency      text        not null default '',
  audience       text        not null default '',
  attribution    text        not null default '',
  cta_label      text        not null default 'Access Secure Note',
  cta_mode       text        not null default 'link',
  papermark_link text        not null default '',
  sort_order     integer     not null default 0,
  is_published   boolean     not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint documents_cta_mode_check check (cta_mode in ('link', 'request'))
);

create unique index if not exists documents_slug_key on documents (slug);
create index if not exists documents_sort_idx on documents (sort_order, created_at);

-- ---------------------------------------------------------------------------
-- Subscriber access requests
-- ---------------------------------------------------------------------------
create table if not exists subscribers (
  id           uuid primary key default gen_random_uuid(),
  name         text        not null default '',
  organization text        not null default '',
  email        text        not null,
  status       text        not null default 'Pending',
  created_at   timestamptz not null default now(),
  constraint subscribers_status_check check (status in ('Pending', 'Active', 'Declined'))
);

create index if not exists subscribers_created_idx on subscribers (created_at desc);

-- ---------------------------------------------------------------------------
-- Briefing requests (Services & Briefings page)
-- ---------------------------------------------------------------------------
create table if not exists briefing_requests (
  id            uuid primary key default gen_random_uuid(),
  name          text        not null,
  organization  text        not null,
  role_title    text        not null default '',
  email         text        not null,
  phone         text        not null default '',
  briefing_type text        not null default '',
  format        text        not null default '',
  timeline      text        not null default '',
  sector        text        not null default '',
  description   text        not null default '',
  audience_size text        not null default '',
  location      text        not null default '',
  status        text        not null default 'New',
  created_at    timestamptz not null default now(),
  constraint briefing_requests_status_check
    check (status in ('New', 'In Progress', 'Scheduled', 'Closed'))
);

create index if not exists briefing_requests_created_idx on briefing_requests (created_at desc);

-- ---------------------------------------------------------------------------
-- Login throttling
--
-- Stored in Postgres rather than in process memory on purpose: serverless
-- instances are short-lived and horizontally scaled, so an in-memory counter
-- resets constantly and an attacker can simply outlast it.
-- ---------------------------------------------------------------------------
create table if not exists login_attempts (
  id         bigserial primary key,
  email_key  text        not null,
  ip         text        not null default '',
  successful boolean     not null default false,
  created_at timestamptz not null default now()
);

create index if not exists login_attempts_lookup_idx
  on login_attempts (email_key, created_at desc);
create index if not exists login_attempts_ip_idx
  on login_attempts (ip, created_at desc);

-- ---------------------------------------------------------------------------
-- Papermark sync + publication lifecycle
--
-- Added as idempotent ALTERs so the schema file stays runnable against a
-- database that already holds data.
-- ---------------------------------------------------------------------------
alter table documents add column if not exists papermark_document_id text;
alter table documents add column if not exists status       text not null default 'draft';
alter table documents add column if not exists published_at timestamptz;
alter table documents add column if not exists synced_at    timestamptz;

alter table documents drop constraint if exists documents_status_check;
alter table documents add constraint documents_status_check
  check (status in ('draft', 'published', 'archived'));

-- The uniqueness that makes the sync idempotent: clicking "Fetch from
-- Papermark" repeatedly updates the same row instead of inserting duplicates.
-- Partial, so rows created by hand (with no Papermark id) are unaffected.
create unique index if not exists documents_papermark_id_key
  on documents (papermark_document_id)
  where papermark_document_id is not null;

create index if not exists documents_status_idx on documents (status, sort_order);

-- Auto-sync is recorded as a setting and ships disabled, per the brief.
insert into app_settings (key, value)
values ('papermark_auto_sync', 'false')
on conflict (key) do nothing;
