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

alter table subscribers add column if not exists subscription_level text not null default '';

-- Coverage areas: newline-separated list editable from the CMS document form.
alter table documents add column if not exists coverage_areas text not null default '';

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

-- Seed coverage areas for existing publications (idempotent: skips if already set).
update documents set coverage_areas = E'Political Events & Developments\nRegulatory & Policy Shifts\nElectoral & Institutional Dynamics\nSecurity & Stability Risks\nStrategic & Operating-Risk Implications'
where slug = 'athena-intelligence-update' and coverage_areas = '';

update documents set coverage_areas = E'Political Power & Coalition Dynamics\nGovernment & Regulatory Watch\nPolicy Implementation & Compliance Tracker\nSector Exposure Assessments\nState-Level Political & Operating Risk\nForward-Looking Assessments & Scenario Analysis'
where slug = 'nigeria-political-regulatory-environment' and coverage_areas = '';

update documents set coverage_areas = E'90–180 Day Political Outlook\nRegulatory Pipeline & Compliance Risks\nPolitical Economy Trends\nElectoral & Transition Scenarios\nSector-Specific Impact Assessments\nStrategic Risk Matrix'
where slug = 'nigeria-political-regulatory-outlook' and coverage_areas = '';

update documents set coverage_areas = E'Election Calendar & Key Dates\nParty & Coalition Dynamics\nElectoral Commission Watch\nLegal & Constitutional Developments\nDemocratic Institution Assessment\nState-Level Political Mapping'
where slug = 'political-landscape-monitor' and coverage_areas = '';

-- ===========================================================================
-- Subscriber portal
--
-- Internal access levels L1..L4 are never shown to visitors. The public
-- /access page keeps its five tier names; `level` is the private mapping used
-- to decide what a signed-in subscriber may read.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- subscribers: paid-seat fields
--
-- One row is one named person. An organisation buying several seats gets
-- several rows, each with its own email and its own watermarked link. There is
-- deliberately no shared organisational login.
-- ---------------------------------------------------------------------------
alter table subscribers add column if not exists full_name        text;
alter table subscribers add column if not exists role_title       text not null default '';
alter table subscribers add column if not exists phone            text not null default '';
alter table subscribers add column if not exists level            text;
alter table subscribers add column if not exists public_tier      text not null default '';
alter table subscribers add column if not exists seats            integer not null default 1;
alter table subscribers add column if not exists term_start       date;
alter table subscribers add column if not exists term_end         date;
alter table subscribers add column if not exists invoice_ref      text not null default '';
alter table subscribers add column if not exists library_link_url text;
alter table subscribers add column if not exists papermark_link_id text;
alter table subscribers add column if not exists last_viewed_at   timestamptz;
alter table subscribers add column if not exists updated_at       timestamptz not null default now();
alter table subscribers add column if not exists note             text not null default '';

-- full_name backfills from the original `name` column so no enquiry is lost.
update subscribers set full_name = name where full_name is null;

-- Widen status to the portal lifecycle while preserving the existing values
-- the enquiry form already writes ('Pending' / 'Active' / 'Declined').
alter table subscribers drop constraint if exists subscribers_status_check;
alter table subscribers add constraint subscribers_status_check
  check (status in (
    'Pending', 'Active', 'Declined',
    'pending', 'active', 'lapsed', 'suspended'
  ));

alter table subscribers drop constraint if exists subscribers_level_check;
alter table subscribers add constraint subscribers_level_check
  check (level is null or level in ('L1', 'L2', 'L3', 'L4'));

alter table subscribers drop constraint if exists subscribers_seats_check;
alter table subscribers add constraint subscribers_seats_check
  check (seats >= 1);

-- One seat per email address. Case-insensitive so Ada@x.com and ada@x.com
-- cannot become two seats for the same person.
create unique index if not exists subscribers_email_lower_key
  on subscribers (lower(email));

create index if not exists subscribers_level_status_idx
  on subscribers (status, level);

-- ---------------------------------------------------------------------------
-- documents: series, edition and visibility
--
-- `visibility` is the gate. OPEN means any visitor may read it from the public
-- publications page; L1..L4 mean it belongs to a paid library and is only ever
-- reachable behind sign-in.
-- ---------------------------------------------------------------------------
alter table documents add column if not exists code          text;
alter table documents add column if not exists series        text not null default '';
alter table documents add column if not exists summary       text not null default '';
alter table documents add column if not exists edition_date  date;
alter table documents add column if not exists visibility    text not null default 'L2';
alter table documents add column if not exists open_link_url text;
alter table documents add column if not exists page_count    integer;

-- The publication catalogue's codes (src/lib/publication-catalogue.ts); OTHER
-- since 20261114_publication_catalogue.sql.
alter table documents drop constraint if exists documents_series_check;
alter table documents add constraint documents_series_check
  check (series = '' or series in ('MIN', 'AIU', 'PLM', 'AEO', 'QIB', 'OTHER', 'BP'));

alter table documents drop constraint if exists documents_visibility_check;
alter table documents add constraint documents_visibility_check
  check (visibility in ('OPEN', 'L1', 'L2', 'L3', 'L4'));

-- Partial, so the many rows with no code yet do not collide on null.
create unique index if not exists documents_code_key
  on documents (code)
  where code is not null;

create index if not exists documents_visibility_idx
  on documents (status, visibility, edition_date desc);

-- Seed series and visibility for the four existing publications. Idempotent:
-- only fills rows that have not been classified yet.
update documents set series = 'AIU', visibility = 'L2'
where slug = 'athena-intelligence-update' and series = '';

update documents set series = 'MIN', visibility = 'L2'
where slug = 'nigeria-political-regulatory-environment' and series = '';

update documents set series = 'QIB', visibility = 'L3'
where slug = 'nigeria-political-regulatory-outlook' and series = '';

update documents set series = 'PLM', visibility = 'L1'
where slug = 'political-landscape-monitor' and series = '';

-- summary backfills from description so portal rows are never blank.
update documents set summary = description
where summary = '' and description <> '';

-- ---------------------------------------------------------------------------
-- publication_access: per-subscriber link override
--
-- Used for board papers and anything that needs its own dedicated watermarked
-- link rather than the subscriber's general library link.
-- ---------------------------------------------------------------------------
create table if not exists publication_access (
  id                uuid primary key default gen_random_uuid(),
  subscriber_id     uuid        not null references subscribers (id) on delete cascade,
  publication_id    uuid        not null references documents (id) on delete cascade,
  link_url          text        not null default '',
  papermark_link_id text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint publication_access_unique unique (subscriber_id, publication_id)
);

create index if not exists publication_access_subscriber_idx
  on publication_access (subscriber_id);

-- ---------------------------------------------------------------------------
-- auth_tokens: single-use magic-link tokens
--
-- Only the hash is stored, so a database read cannot be replayed as a sign-in.
-- consumed_at latches the single use; expires_at bounds the window.
-- ---------------------------------------------------------------------------
create table if not exists auth_tokens (
  id            uuid primary key default gen_random_uuid(),
  subscriber_id uuid        not null references subscribers (id) on delete cascade,
  token_hash    text        not null,
  expires_at    timestamptz not null,
  consumed_at   timestamptz,
  created_at    timestamptz not null default now()
);

create unique index if not exists auth_tokens_hash_key on auth_tokens (token_hash);
create index if not exists auth_tokens_subscriber_idx
  on auth_tokens (subscriber_id, created_at desc);

-- ---------------------------------------------------------------------------
-- document_views: what the Papermark webhook records
--
-- Written by the webhook receiver once PAPERMARK_WEBHOOK_SECRET is configured.
-- Holds no personal data beyond the subscriber reference already in the system.
-- ---------------------------------------------------------------------------
create table if not exists document_views (
  id             uuid primary key default gen_random_uuid(),
  subscriber_id  uuid references subscribers (id) on delete set null,
  publication_id uuid references documents (id) on delete set null,
  papermark_view_id text,
  viewed_at      timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

create unique index if not exists document_views_papermark_key
  on document_views (papermark_view_id)
  where papermark_view_id is not null;

create index if not exists document_views_subscriber_idx
  on document_views (subscriber_id, viewed_at desc);

-- ---------------------------------------------------------------------------
-- Engagement tracking: richer view records
--
-- Extends document_views rather than adding a second table. The columns below
-- carry what Papermark's View object actually reports, plus which of the two
-- collectors wrote the row.
--
-- papermark_view_id becomes NOT NULL because it is the idempotency key: a row
-- without one could be inserted twice by a webhook retry and would silently
-- inflate a subscriber's open count, which is the one number this whole
-- feature exists to get right.
-- ---------------------------------------------------------------------------
alter table document_views add column if not exists papermark_link_id text;
alter table document_views add column if not exists viewer_email      text;
alter table document_views add column if not exists duration_seconds  integer;
alter table document_views add column if not exists completion_pct    numeric(5,2);
alter table document_views add column if not exists downloaded        boolean not null default false;
alter table document_views add column if not exists source            text not null default 'webhook';

-- Safe on an empty table, and a no-op once already applied. Any row lacking an
-- id would be un-deduplicable, so there is nothing to preserve.
delete from document_views where papermark_view_id is null;

alter table document_views alter column papermark_view_id set not null;

alter table document_views drop constraint if exists document_views_source_check;
alter table document_views add constraint document_views_source_check
  check (source in ('webhook', 'poll'));

alter table document_views drop constraint if exists document_views_completion_check;
alter table document_views add constraint document_views_completion_check
  check (completion_pct is null or (completion_pct >= 0 and completion_pct <= 100));

alter table document_views drop constraint if exists document_views_duration_check;
alter table document_views add constraint document_views_duration_check
  check (duration_seconds is null or duration_seconds >= 0);

-- Now that the column is NOT NULL the partial index can become a plain one,
-- which is what `on conflict (papermark_view_id)` needs to bind to.
drop index if exists document_views_papermark_key;
create unique index if not exists document_views_view_id_key
  on document_views (papermark_view_id);

create index if not exists document_views_publication_idx
  on document_views (publication_id);
create index if not exists document_views_link_idx
  on document_views (papermark_link_id);
create index if not exists document_views_unmatched_idx
  on document_views (viewed_at desc)
  where subscriber_id is null;

-- How many recent editions to test for the engagement flag. Editable in the
-- admin; stored as a setting so it survives a redeploy.
insert into app_settings (key, value)
values ('engagement_window', '2')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Per-subscriber stamped copies
--
-- Each subscriber's name is stamped into the PDF before upload, so there is one
-- Papermark document and one link per subscriber per publication, allow-listed
-- to that one address. publication_access is therefore the primary route to a
-- document, not an override.
--
-- A publication may instead be marked as a shared, unstamped copy -- the one
-- case where a single link serves everyone. Default false, because a document
-- reaching the wrong reader with someone else's name on it is the failure this
-- whole arrangement exists to prevent.
-- ---------------------------------------------------------------------------
alter table documents add column if not exists is_shared_copy boolean not null default false;

-- Revocation state. Rows are never deleted: the record of what someone had
-- access to outlives their access to it. Revoking clears the link, not the row.
alter table publication_access add column if not exists revoked_at  timestamptz;
alter table publication_access add column if not exists revoke_state text not null default 'live';

alter table publication_access drop constraint if exists publication_access_revoke_check;
alter table publication_access add constraint publication_access_revoke_check
  check (revoke_state in ('live', 'revoked', 'manual_required'));

create index if not exists publication_access_live_idx
  on publication_access (subscriber_id, publication_id)
  where revoke_state = 'live';
create index if not exists publication_access_manual_idx
  on publication_access (revoke_state)
  where revoke_state = 'manual_required';

-- ---------------------------------------------------------------------------
-- Copy-gap alerts
--
-- A gap is computed, never stored -- the queue must read as empty when all is
-- well, and a stored row would linger after it was filled. What is stored is
-- only whether we have already emailed about a given gap, so the daily run
-- reports it once rather than every night.
-- ---------------------------------------------------------------------------
create table if not exists copy_gap_alerts (
  subscriber_id  uuid        not null references subscribers (id) on delete cascade,
  publication_id uuid        not null references documents (id) on delete cascade,
  alerted_at     timestamptz not null default now(),
  primary key (subscriber_id, publication_id)
);

-- ---------------------------------------------------------------------------
-- The open lane, kept structurally separate
--
-- A publication is either open to everyone or gated behind a level, never both.
-- `visibility` already holds one value, so the two cannot be set at once -- but
-- an open_link_url left on a level-gated publication would be a public address
-- for a paid document sitting one refactor away from being rendered.
--
-- The constraint is what makes "a paid publication never falls back to an open
-- link" structural rather than a matter of code discipline: for a non-OPEN row
-- there is no open link to fall back to.
-- ---------------------------------------------------------------------------
update documents set open_link_url = null where visibility <> 'OPEN';

alter table documents drop constraint if exists documents_open_link_lane_check;
alter table documents add constraint documents_open_link_lane_check
  check (open_link_url is null or visibility = 'OPEN');

-- A shared unstamped copy is a paid-lane concept; an OPEN publication is
-- already unstamped and public, so the two flags must not combine.
alter table documents drop constraint if exists documents_shared_copy_lane_check;
alter table documents add constraint documents_shared_copy_lane_check
  check (is_shared_copy = false or visibility <> 'OPEN');

-- ---------------------------------------------------------------------------
-- Copy identity
--
-- Each stamped copy carries a short code in its footer that resolves back to
-- exactly one access row. seat_no gives each subscriber a stable short number,
-- so the code does not change if their name is corrected.
-- ---------------------------------------------------------------------------
create sequence if not exists subscriber_seat_no_seq;

alter table subscribers add column if not exists seat_no integer;
update subscribers set seat_no = nextval('subscriber_seat_no_seq') where seat_no is null;
alter table subscribers alter column seat_no set default nextval('subscriber_seat_no_seq');

create unique index if not exists subscribers_seat_no_key on subscribers (seat_no);

alter table publication_access add column if not exists copy_id text;
create unique index if not exists publication_access_copy_id_key
  on publication_access (copy_id)
  where copy_id is not null;

-- ---------------------------------------------------------------------------
-- Held alerts
--
-- A subscriber with no stamped copy must not be emailed about an edition they
-- cannot open. They are held rather than skipped, and released the moment their
-- copy lands -- skipping would mean they simply never heard about it.
-- ---------------------------------------------------------------------------
create table if not exists alert_holds (
  subscriber_id  uuid        not null references subscribers (id) on delete cascade,
  publication_id uuid        not null references documents (id) on delete cascade,
  held_at        timestamptz not null default now(),
  released_at    timestamptz,
  primary key (subscriber_id, publication_id)
);

create index if not exists alert_holds_pending_idx
  on alert_holds (held_at)
  where released_at is null;

-- ---------------------------------------------------------------------------
-- Three things sold, kept apart in the data
--
-- APRI sells subscriptions (the level-gated library), commissioned briefings
-- (an engagement, sometimes delivering a board paper, no library), and open
-- publications (read at the Papermark gate, no person record at all).
--
-- Entitlement is granted by level, and only a subscriber holds one. An
-- engagement client is a person record with no level: they can still receive a
-- named document, because publication_access grants one person one document
-- independently of level, but they get no library.
--
-- Email remains unique across the whole table. Someone who subscribes and also
-- commissions a briefing is one row with engagement records against it, never
-- two rows.
-- ---------------------------------------------------------------------------
alter table subscribers add column if not exists client_type text not null default 'subscriber';

alter table subscribers drop constraint if exists subscribers_client_type_check;
alter table subscribers add constraint subscribers_client_type_check
  check (client_type in ('subscriber', 'engagement'));

-- An engagement must never hold a level -- that is what stops the copies queue
-- demanding stamped editions for a briefing client.
--
-- A subscriber must hold one to be active. Pending and declined enquiries have
-- no level yet: the administrator sets it when payment lands, and
-- activateSubscriber already refuses to activate without one. Requiring a level
-- unconditionally would make it impossible to record an enquiry at all.
alter table subscribers drop constraint if exists subscribers_level_by_type_check;
alter table subscribers add constraint subscribers_level_by_type_check
  check (
    (client_type = 'engagement' and level is null)
    or (client_type = 'subscriber'
        and (level is not null or lower(status) <> 'active'))
  );

create index if not exists subscribers_client_type_idx
  on subscribers (client_type, status)
  where client_type = 'subscriber';

-- ---------------------------------------------------------------------------
-- Open-edition leads
--
-- Readers of open publications verify an email at the Papermark gate but hold
-- no person record. Their addresses are kept here and nowhere else: a separate
-- table, never joined into subscribers, so a lead can never be mistaken for
-- someone who has paid us.
-- ---------------------------------------------------------------------------
create table if not exists open_edition_leads (
  id             uuid        primary key default gen_random_uuid(),
  email          text        not null,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  view_count     integer     not null default 1,
  last_publication_id uuid references documents (id) on delete set null
);

create unique index if not exists open_edition_leads_email_key
  on open_edition_leads (lower(email));
create index if not exists open_edition_leads_recent_idx
  on open_edition_leads (last_seen_at desc);

-- ---------------------------------------------------------------------------
-- How far back entitlement reaches
--
-- Activating someone with a backdated term_start otherwise makes the copies
-- queue demand every edition published since that date, all at once. The
-- boundary caps it: entitlement reaches back this many months from today, and
-- no further, whatever the term start says.
-- ---------------------------------------------------------------------------
insert into app_settings (key, value)
values ('entitlement_reach_months', '12')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Level change history
--
-- A level change moves money and moves access, so it is recorded rather than
-- inferred. Kept even if the subscriber row is later removed, because the
-- question "who widened this person's access, and when" outlives the person's
-- subscription.
-- ---------------------------------------------------------------------------
create table if not exists level_changes (
  id            uuid        primary key default gen_random_uuid(),
  subscriber_id uuid        references subscribers (id) on delete set null,
  subscriber_email text     not null default '',
  old_level     text,
  new_level     text,
  direction     text        not null,
  changed_by    uuid        references admins (id) on delete set null,
  changed_by_name text      not null default '',
  created_at    timestamptz not null default now(),
  constraint level_changes_direction_check
    check (direction in ('upgrade', 'downgrade', 'set', 'cleared'))
);

create index if not exists level_changes_subscriber_idx
  on level_changes (subscriber_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Link verification findings
--
-- Our security model rests on every subscriber link permitting exactly one
-- address. The Papermark dashboard renders the allow-list in a textarea that
-- hides everything past the first line, so a person cannot reliably confirm it.
-- The API returns the list as an array, so the system checks instead.
--
-- A mismatch is a finding, not a warning. Note what is deliberately absent:
-- there is no column for the offending address. Recording it would copy an
-- address that should not be on the link into a second place, and the finding
-- is actionable without it -- the link and the publication are named.
-- ---------------------------------------------------------------------------
create table if not exists link_findings (
  id             uuid        primary key default gen_random_uuid(),
  access_id      uuid        references publication_access (id) on delete cascade,
  subscriber_id  uuid        references subscribers (id) on delete set null,
  publication_id uuid        references documents (id) on delete set null,
  papermark_link_id text     not null default '',
  kind           text        not null,
  detail         text        not null default '',
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  resolved_at    timestamptz,
  alerted_at     timestamptz,
  constraint link_findings_kind_check check (kind in (
    'link-missing',
    'allow-list-empty',
    'allow-list-multiple',
    'allow-list-mismatch',
    'allow-list-wildcard',
    'downloads-enabled',
    'email-verification-off'
  ))
);

-- ---------------------------------------------------------------------------
-- Terms acceptance
--
-- Recorded, not merely required. An acceptance nobody wrote down is not
-- evidence of anything -- if a subscriber later asks what they agreed to and
-- when, the answer has to exist.
-- ---------------------------------------------------------------------------
alter table subscribers add column if not exists terms_accepted_at timestamptz;
alter table briefing_requests add column if not exists terms_accepted_at timestamptz;

-- Briefing clients remain briefing requests throughout their lifecycle. They
-- are never copied into subscribers merely to obtain portal access.
alter table briefing_requests add column if not exists private_link_url text;
alter table briefing_requests add column if not exists updated_at timestamptz not null default now();
alter table briefing_requests add column if not exists activated_at timestamptz;
alter table briefing_requests add column if not exists last_viewed_at timestamptz;

alter table briefing_requests drop constraint if exists briefing_requests_status_check;
alter table briefing_requests add constraint briefing_requests_status_check
  check (status in ('New', 'In Progress', 'Scheduled', 'Active', 'Closed'));

-- A magic link belongs to exactly one portal principal. Existing subscriber
-- tokens remain valid; new briefing tokens point directly at briefing_requests.
alter table auth_tokens alter column subscriber_id drop not null;
alter table auth_tokens add column if not exists briefing_request_id uuid;
alter table auth_tokens drop constraint if exists auth_tokens_briefing_request_id_fkey;
alter table auth_tokens add constraint auth_tokens_briefing_request_id_fkey
  foreign key (briefing_request_id) references briefing_requests (id)
  on delete cascade not valid;
alter table auth_tokens validate constraint auth_tokens_briefing_request_id_fkey;
alter table auth_tokens drop constraint if exists auth_tokens_one_principal_check;
alter table auth_tokens add constraint auth_tokens_one_principal_check check (
  (subscriber_id is not null and briefing_request_id is null)
  or (subscriber_id is null and briefing_request_id is not null)
) not valid;
alter table auth_tokens validate constraint auth_tokens_one_principal_check;
create index if not exists auth_tokens_briefing_idx
  on auth_tokens (briefing_request_id, created_at desc);

-- Subscriber and briefing engagement events. Raw tokens and private URLs are
-- deliberately absent; webhook retries are idempotent by provider event id.
alter table subscribers add column if not exists library_link_updated_at timestamptz;

create table if not exists subscriber_subscription_periods (
  id uuid primary key default gen_random_uuid(), subscriber_id uuid not null references subscribers(id) on delete cascade,
  starts_on date not null, ends_on date not null, level text not null check (level in ('L1','L2','L3','L4')),
  source text not null default 'admin', created_at timestamptz not null default now(),
  check (ends_on >= starts_on), unique (subscriber_id, starts_on, ends_on, level)
);
create index if not exists subscriber_periods_lookup_idx on subscriber_subscription_periods(subscriber_id, starts_on, ends_on);
create table if not exists subscriber_publication_exceptions (
  subscriber_id uuid not null references subscribers(id) on delete cascade, publication_id uuid not null references documents(id) on delete cascade,
  decision text not null check (decision in ('allow','block')), reason text not null check (length(trim(reason)) > 0),
  administrator_id uuid not null references admins(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (subscriber_id, publication_id)
);
create table if not exists subscriber_access_reconciliations (
  subscriber_id uuid primary key references subscribers(id) on delete cascade, generation bigint not null default 1,
  state text not null default 'pending' check (state in ('pending','complete','failed')), detail text,
  requested_at timestamptz not null default now(), completed_at timestamptz
);
alter table briefing_requests add column if not exists private_link_updated_at timestamptz;
create table if not exists client_engagement_events (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid references subscribers(id) on delete cascade,
  briefing_request_id uuid references briefing_requests(id) on delete cascade,
  event_type text not null check (event_type in (
    'signin_email_sent','email_delivered','email_opened','email_clicked',
    'email_bounced','email_failed','signin_completed','portal_opened',
    'private_link_opened'
  )),
  resend_email_id text,
  webhook_event_id text,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint client_engagement_one_principal_check check (
    (subscriber_id is not null and briefing_request_id is null) or
    (subscriber_id is null and briefing_request_id is not null)
  )
);
create unique index if not exists client_engagement_webhook_event_key
  on client_engagement_events (webhook_event_id) where webhook_event_id is not null;
create index if not exists client_engagement_subscriber_idx
  on client_engagement_events (subscriber_id, occurred_at desc);
create index if not exists client_engagement_briefing_idx
  on client_engagement_events (briefing_request_id, occurred_at desc);
create index if not exists client_engagement_type_idx
  on client_engagement_events (event_type, occurred_at desc);
create index if not exists client_engagement_resend_idx
  on client_engagement_events (resend_email_id) where resend_email_id is not null;
create index if not exists client_engagement_time_idx
  on client_engagement_events (occurred_at desc);
create index if not exists auth_tokens_briefing_idx
  on auth_tokens (briefing_request_id, created_at desc);
create unique index if not exists link_findings_open_key
  on link_findings (access_id, kind)
  where resolved_at is null;
create index if not exists link_findings_open_idx
  on link_findings (last_seen_at desc)
  where resolved_at is null;

-- Per-client Papermark folder selection and safely email-gated synced links.
alter table subscribers add column if not exists papermark_folder_id text;
alter table briefing_requests add column if not exists papermark_folder_id text;
create table if not exists papermark_client_documents (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid references subscribers(id) on delete cascade,
  briefing_request_id uuid references briefing_requests(id) on delete cascade,
  papermark_document_id text not null,
  papermark_link_id text,
  title text not null,
  share_url text not null,
  synced_at timestamptz not null default now(),
  constraint papermark_client_documents_one_principal check (
    (subscriber_id is not null and briefing_request_id is null) or
    (subscriber_id is null and briefing_request_id is not null)
  )
);
create unique index if not exists papermark_client_documents_subscriber_doc_key on papermark_client_documents(subscriber_id,papermark_document_id) where subscriber_id is not null;
create unique index if not exists papermark_client_documents_briefing_doc_key on papermark_client_documents(briefing_request_id,papermark_document_id) where briefing_request_id is not null;
create index if not exists papermark_client_documents_subscriber_idx on papermark_client_documents(subscriber_id,synced_at desc);
create index if not exists papermark_client_documents_briefing_idx on papermark_client_documents(briefing_request_id,synced_at desc);
create unique index if not exists subscribers_active_papermark_folder_key on subscribers(papermark_folder_id) where papermark_folder_id is not null and lower(status)='active';
create unique index if not exists briefing_active_papermark_folder_key on briefing_requests(papermark_folder_id) where papermark_folder_id is not null and lower(status)='active';

-- ---------------------------------------------------------------------------
-- Complimentary Review Library
-- ---------------------------------------------------------------------------
insert into app_settings (key, value)
values ('review_library_enabled', 'false')
on conflict (key) do nothing;

insert into app_settings (key, value)
values ('review_library_papermark_url', '')
on conflict (key) do nothing;

create table if not exists complimentary_review_items (
  id               uuid        primary key default gen_random_uuid(),
  publication_id   uuid        not null references documents (id) on delete cascade,
  display_order    integer     not null default 0,
  is_active        boolean     not null default true,
  publication_type text        not null default '',
  description      text        not null default '',
  frequency        text        not null default '',
  audience         text        not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists complimentary_review_items_publication_key
  on complimentary_review_items (publication_id);

create index if not exists complimentary_review_items_order_idx
  on complimentary_review_items (display_order, created_at);

-- Versioned Complimentary Review editions. The legacy fixed-slot table is
-- retained during rollout and is backfilled by the versioned migration.
create table if not exists review_publication_editions (
  id uuid primary key default gen_random_uuid(),
  series text not null check (series in ('MIN', 'AIU', 'PLM')),
  title text not null default '',
  edition_date date,
  edition_order text not null default '',
  papermark_document_id text not null,
  papermark_dataroom_id text,
  secure_link_id text,
  secure_link_url text not null default '',
  secure_link_document_id text,
  secure_link_verified_at timestamptz,
  publication_type text not null default '',
  description text not null default '',
  frequency text not null default '',
  audience text not null default '',
  publication_state text not null default 'draft'
    check (publication_state in ('draft', 'published')),
  is_latest boolean not null default false,
  sync_candidate_id uuid,
  sync_version_key text not null default '',
  first_seen_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not is_latest or publication_state = 'published')
);

create unique index if not exists review_publication_editions_document_key
  on review_publication_editions (papermark_document_id);
create unique index if not exists review_publication_editions_latest_series_key
  on review_publication_editions (series) where is_latest;
create index if not exists review_publication_editions_archive_order_idx
  on review_publication_editions
  (series, edition_date desc nulls last, edition_order desc, created_at desc, id desc)
  where publication_state = 'published';

-- ---------------------------------------------------------------------------
-- Publication catalogue (mirrors db/migrations/20261114_publication_catalogue.sql)
--
-- Owner-edited labels, order and active flag for each stored code, and which
-- Papermark folder files a document into which category. The defaults live in
-- src/lib/publication-catalogue.ts. A category never grants access.
-- ---------------------------------------------------------------------------
create table if not exists publication_categories (
  code           text primary key
                 check (code in ('MIN', 'AIU', 'PLM', 'AEO', 'QIB', 'OTHER', 'BP')),
  label          text not null check (char_length(btrim(label)) between 1 and 80),
  singular_label text not null check (char_length(btrim(singular_label)) between 1 and 80),
  sort_order     integer not null check (sort_order between 0 and 9999),
  active         boolean not null default true,
  aliases        text[] not null default '{}' check (cardinality(aliases) <= 10),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists publication_category_folders (
  folder_slug   text primary key
                check (char_length(folder_slug) <= 120 and folder_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  category_code text not null references publication_categories (code) on update restrict on delete restrict,
  created_at    timestamptz not null default now()
);

create index if not exists publication_category_folders_code_idx
  on publication_category_folders (category_code);

insert into publication_categories (code, label, singular_label, sort_order, active, aliases) values
  ('MIN', 'Monthly Intelligence Notes', 'Monthly Intelligence Note', 10, true, '{}'),
  ('AIU', 'Athena Intelligence Updates', 'Athena Intelligence Update', 20, true, '{}'),
  ('PLM', 'Political Landscape Monitor', 'Political Landscape Monitor', 30, true, '{}'),
  ('AEO', 'Election & Democratic Governance Monitor', 'Election & Democratic Governance Monitor', 40, true, '{"Election Observatory"}'),
  ('QIB', 'Quarterly Intelligence Briefs', 'Quarterly Intelligence Brief', 50, true, '{}'),
  ('OTHER', 'Other Assigned Publications', 'Other assigned publication', 60, true, '{}'),
  ('BP', 'Board Papers', 'Board Paper', 70, false, '{}')
on conflict (code) do nothing;

insert into publication_category_folders (folder_slug, category_code)
select v.folder_slug, v.category_code
from (values
  ('monthly-intelligence-notes', 'MIN'),
  ('monthly-intelligence-note', 'MIN'),
  ('athena-intelligence-updates', 'AIU'),
  ('political-landscape-monitor', 'PLM'),
  ('election-and-democratic-governance-monitor', 'AEO'),
  ('election-democratic-governance-monitor', 'AEO'),
  ('election-watch', 'AEO'),
  ('quarterly-intelligence-briefs', 'QIB'),
  ('other-assigned-publications', 'OTHER')
) as v (folder_slug, category_code)
where not exists (select 1 from app_settings where key = 'publication_catalogue_folders_seeded')
on conflict (folder_slug) do nothing;

insert into app_settings (key, value)
values ('publication_catalogue_folders_seeded', 'true')
on conflict (key) do nothing;

alter table review_publication_editions drop constraint if exists review_publication_editions_series_check;
alter table review_publication_editions add constraint review_publication_editions_series_check
  check (series is null or series in ('MIN', 'AIU', 'PLM', 'AEO', 'QIB', 'OTHER'));

-- ---------------------------------------------------------------------------
-- Publication editorial metadata, controlled tags and approved protected
-- summaries (mirrors db/migrations/20261114_publication_editorial_metadata.sql)
--
-- Optional metadata an editor enters on the publication record (never
-- computed or guessed); the subject/sector/geography vocabulary and each
-- publication's tags (an assigned tag is retired, never deleted); one
-- structured protected summary per publication, shown to entitled subscribers
-- only while an owner's approved copy equals the saved text. Papermark sync
-- never writes any of these. coverage_areas is a different, public field.
-- ---------------------------------------------------------------------------
alter table documents add column if not exists author_editor        text;
alter table documents add column if not exists covered_period_start date;
alter table documents add column if not exists covered_period_end   date;
alter table documents add column if not exists information_cutoff   date;
alter table documents add column if not exists reading_time_minutes integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'documents_author_editor_check'
                 and conrelid = 'documents'::regclass) then
    alter table documents add constraint documents_author_editor_check
      check (author_editor is null or char_length(btrim(author_editor)) between 1 and 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'documents_covered_period_check'
                 and conrelid = 'documents'::regclass) then
    alter table documents add constraint documents_covered_period_check
      check ((covered_period_start is null and covered_period_end is null)
          or (covered_period_start is not null and covered_period_end is not null
              and covered_period_end >= covered_period_start));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'documents_reading_time_check'
                 and conrelid = 'documents'::regclass) then
    alter table documents add constraint documents_reading_time_check
      check (reading_time_minutes is null or reading_time_minutes between 1 and 600);
  end if;
end $$;

create table if not exists publication_tags (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('subject', 'sector', 'geography')),
  label       text not null check (char_length(label) between 1 and 80 and label = btrim(label)),
  active      boolean not null default true,
  created_by  uuid references admins (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_by  uuid references admins (id) on delete set null,
  updated_at  timestamptz not null default now(),
  retired_by  uuid references admins (id) on delete set null,
  retired_at  timestamptz
);

create unique index if not exists publication_tags_kind_label_key
  on publication_tags (kind, lower(label));

create table if not exists publication_tag_assignments (
  publication_id uuid not null references documents (id) on delete cascade,
  tag_id         uuid not null references publication_tags (id) on update restrict on delete restrict,
  assigned_by    uuid references admins (id) on delete set null,
  assigned_at    timestamptz not null default now(),
  primary key (publication_id, tag_id)
);

create index if not exists publication_tag_assignments_tag_idx
  on publication_tag_assignments (tag_id);

create table if not exists publication_summaries (
  publication_id          uuid primary key references documents (id) on delete cascade,
  what_changed            text not null default '' check (char_length(what_changed) <= 4000),
  why_it_matters          text not null default '' check (char_length(why_it_matters) <= 4000),
  implications            text not null default '' check (char_length(implications) <= 4000),
  watch_next              text not null default '' check (char_length(watch_next) <= 4000),
  source_date             date,
  uncertainty             text not null default '' check (char_length(uncertainty) <= 2000),
  revision                bigint not null default 1 check (revision >= 1),
  updated_by              uuid references admins (id) on delete set null,
  updated_at              timestamptz not null default now(),
  approved_fields         jsonb,
  approved_revision       bigint,
  approved_by             uuid references admins (id) on delete set null,
  approved_at             timestamptz,
  approval_removed_reason text check (approval_removed_reason in ('edited', 'withdrawn')),
  approval_removed_by     uuid references admins (id) on delete set null,
  approval_removed_at     timestamptz,
  created_at              timestamptz not null default now(),
  constraint publication_summaries_approval_check
    check ((approved_fields is null) = (approved_at is null))
);


-- Stage 4: operations and staff security
-- Additive Stage 4 controls. No emails, provider calls, grant changes or cleanup.
begin;
set local lock_timeout = '5s';

create table if not exists admin_security (
  admin_id uuid primary key references admins(id) on delete cascade,
  session_version bigint not null default 0 check (session_version >= 0),
  totp_ciphertext text,
  last_totp_step bigint,
  recovery_hashes text[] not null default '{}',
  challenge_window_started timestamptz not null default now(),
  challenge_issues integer not null default 0,
  factor_window_started timestamptz not null default now(),
  factor_attempts integer not null default 0,
  updated_at timestamptz not null default now()
);
create table if not exists admin_security_policy (
  singleton boolean primary key default true check (singleton),
  require_mfa boolean not null default false,
  updated_by uuid references admins(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into admin_security_policy(singleton) values(true) on conflict do nothing;
insert into app_settings(key,value) values('staff_security_schema_v1','ready') on conflict(key) do nothing;

create table if not exists admin_auth_challenges (
  token_hash text primary key,
  admin_id uuid not null references admins(id) on delete cascade,
  kind text not null check(kind in ('verify','enroll')),
  session_version bigint not null,
  enrollment_ciphertext text,
  attempts integer not null default 0 check(attempts between 0 and 5),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);
create index if not exists admin_auth_challenges_admin_recent on admin_auth_challenges(admin_id, created_at desc);

create table if not exists admin_security_events (
  id uuid primary key default gen_random_uuid(),
  actor_admin_id uuid references admins(id) on delete set null,
  target_admin_id uuid references admins(id) on delete set null,
  event_type text not null check(length(event_type) between 1 and 80),
  created_at timestamptz not null default now()
);
create index if not exists admin_security_events_recent on admin_security_events(created_at desc);

-- Minimal verified webhook evidence. No addresses, subjects, bodies, codes or URLs.
create table if not exists email_delivery_inbox (
  event_id text primary key check(length(event_id) between 1 and 200),
  provider_message_id text not null check(length(provider_message_id) between 1 and 200),
  event_type text not null check(event_type in ('email.sent','email.delivered','email.opened','email.clicked','email.bounced','email.failed','email.complained','email.delivery_delayed','email.suppressed')),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  applied_at timestamptz,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  last_error_code text
);
create index if not exists email_delivery_inbox_due on email_delivery_inbox(next_attempt_at) where applied_at is null;
create index if not exists email_delivery_inbox_message on email_delivery_inbox(provider_message_id, occurred_at desc);

create table if not exists operations_settings (
  singleton boolean primary key default true check(singleton),
  incident_owner_id uuid references admins(id) on delete set null,
  deputy_id uuid references admins(id) on delete set null,
  alerts_email_enabled boolean not null default false,
  poll_stale_hours integer not null default 30 check(poll_stale_hours between 1 and 168),
  queue_stale_hours integer not null default 6 check(queue_stale_hours between 1 and 168),
  last_checked_at timestamptz,
  check_lease_token uuid,
  check_lease_until timestamptz,
  updated_by uuid references admins(id) on delete set null,
  updated_at timestamptz not null default now(),
  check(incident_owner_id is null or deputy_id is null or incident_owner_id <> deputy_id)
);
insert into operations_settings(singleton) values(true) on conflict do nothing;

create table if not exists operations_alerts (
  alert_key text primary key,
  severity text not null check(severity in ('attention','critical')),
  message text not null,
  opened_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by uuid references admins(id) on delete set null,
  notification_state text not null default 'disabled' check(notification_state in ('disabled','pending','sending','accepted','failed','unknown')),
  notification_generation integer not null default 1,
  notification_claim_token uuid,
  notification_claim_until timestamptz,
  notification_attempts integer not null default 0,
  next_notification_at timestamptz not null default now(),
  provider_message_id text,
  notified_at timestamptz,
  last_notification_error text
);

create table if not exists operations_checkpoints (
  id uuid primary key default gen_random_uuid(),
  kind text not null check(kind in ('backup','restore','incident_exercise')),
  result text not null check(result in ('pass','fail')),
  evidence_ref text not null check(length(evidence_ref) between 1 and 160),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  recorded_by uuid references admins(id) on delete set null
);

-- No policy is seeded and no automatic deletion is enabled.
create table if not exists privacy_retention_policies (
  bucket text primary key check(bucket in ('login_attempts','subscriber_tokens','review_tokens','staff_challenges','applied_email_events')),
  days integer not null check(days between 7 and 3650),
  reason text not null check(length(reason) between 10 and 300),
  approved_by uuid not null references admins(id),
  approved_at timestamptz not null default now()
);
create table if not exists privacy_cleanup_events (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  cutoff timestamptz not null,
  deleted_count integer not null check(deleted_count >= 0),
  actor_admin_id uuid references admins(id) on delete set null,
  created_at timestamptz not null default now()
);
commit;


-- Stage 5: publication notice outbox
-- Durable publication notices. Disabled until an owner approves a baseline.
begin;
set local lock_timeout='5s';
-- These fields were historically supplied by 20261004 rather than the fresh
-- schema. No-op on upgraded databases; required before declaring the trigger.
alter table documents add column if not exists paid_release_state text;
alter table documents add column if not exists paid_release_changed_by uuid references admins(id) on delete set null;
create table if not exists publication_notice_settings (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  baseline_at timestamptz,
  approved_by uuid references admins(id) on delete set null,
  updated_at timestamptz not null default now(),
  worker_at timestamptz
);
insert into publication_notice_settings(singleton) values(true) on conflict do nothing;
create table if not exists publication_notice_seen (
  publication_id uuid primary key references documents(id) on delete cascade,
  baseline boolean not null default false,
  seen_at timestamptz not null default now()
);
create table if not exists publication_notice_events (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references documents(id) on delete cascade,
  revision_key text not null check(length(revision_key) between 1 and 100),
  kind text not null check(kind in ('publication','correction')),
  reason text not null default '',
  approved_by uuid references admins(id) on delete set null,
  state text not null default 'pending' check(state in ('pending','fanning','complete','cancelled')),
  cursor_id uuid,
  next_attempt_at timestamptz not null default (now()+interval '1 minute'),
  lease_token uuid,lease_until timestamptz,
  created_at timestamptz not null default now(),
  unique(publication_id,revision_key)
);
create index if not exists publication_notice_events_due on publication_notice_events(next_attempt_at) where state in ('pending','fanning');
create table if not exists publication_notice_jobs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references publication_notice_events(id) on delete cascade,
  subscriber_id uuid not null references subscribers(id) on delete cascade,
  state text not null default 'pending' check(state in ('pending','held','sending','accepted','failed','unknown','cancelled')),
  attempts integer not null default 0 check(attempts>=0),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,lease_until timestamptz,
  provider_message_id text,
  outcome text,
  detail text,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(event_id,subscriber_id)
);
create index if not exists publication_notice_jobs_due on publication_notice_jobs(next_attempt_at,attempts) where state in ('pending','held','failed');
create unique index if not exists publication_notice_jobs_provider on publication_notice_jobs(provider_message_id) where provider_message_id is not null;
create table if not exists publication_notice_preferences (
  subscriber_id uuid primary key references subscribers(id) on delete cascade,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
create table if not exists publication_notice_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references admins(id) on delete set null,
  action text not null,
  publication_id uuid references documents(id) on delete set null,
  reason text not null,
  created_at timestamptz not null default now()
);

-- A change detector, not a second entitlement policy. The application uses the
-- shared access policy; a final CAS refuses a send if any input changed while
-- those reads were in progress. It deliberately excludes view/activity counts.
create or replace function publication_notice_access_fence(seat uuid,pub uuid) returns text language plpgsql stable as $$
begin
  return (select md5(jsonb_build_object(
    'seat',(select jsonb_build_array(s.email,s.public_tier,s.level,s.status,s.client_type,s.term_start,s.term_end,s.papermark_dataroom_override,s.papermark_dataroom_id) from subscribers s where s.id=seat),
    'periods',(select jsonb_agg(to_jsonb(p) order by p.id) from subscriber_subscription_periods p where p.subscriber_id=seat),
    'exception',(select to_jsonb(x) from subscriber_publication_exceptions x where x.subscriber_id=seat and x.publication_id=pub),
    'plans',(select jsonb_agg(p.public_tier order by p.public_tier) from publication_plans p where p.publication_id=pub),
    'release',(select jsonb_build_array(d.status,d.visibility,d.paid_release_state,d.edition_date,d.papermark_document_id,d.title,to_jsonb(d)->>'portal_title_override',to_jsonb(d)->>'is_shared_copy',d.papermark_link) from documents d where d.id=pub),
    'room',(select jsonb_agg(to_jsonb(r) order by r.public_tier) from papermark_level_rooms r where r.public_tier=(select s.public_tier from subscribers s where s.id=seat)),
    'files',(select jsonb_agg(jsonb_build_array(d.id,d.papermark_document_id,d.papermark_dataroom_id,d.is_present,d.title) order by d.id) from papermark_dataroom_documents d where d.publication_id=pub),
    'links',(select jsonb_agg(jsonb_build_array(l.id,l.papermark_document_id,l.revoke_state,l.assigned_email,l.expires_at,l.verification_generation,l.last_verified_at,l.verification_result,l.papermark_link_id,l.link_url) order by l.id) from papermark_subscriber_document_links l where l.subscriber_id=seat),
    'legacy',(select jsonb_build_array(a.revoke_state,a.link_url) from publication_access a where a.subscriber_id=seat and a.publication_id=pub),
    'reconciliation',(select jsonb_build_array(r.generation,r.state) from subscriber_access_reconciliations r where r.subscriber_id=seat)
  )::text));
end $$;

-- Transactional capture only: never a provider call and never a grant. Syncing
-- drafts or editing metadata does not qualify. Re-offering the same edition
-- does not generate a second first-publication event.
create or replace function capture_publication_notice() returns trigger language plpgsql as $$
declare
  switched_on boolean;
  baseline_time timestamptz;
  captured uuid;
begin
  if new.visibility='OPEN' or new.status='archived' or not coalesce(
    new.paid_release_state='released' or (new.paid_release_state is null and new.status='published'),false) then return new; end if;
  select enabled,baseline_at into switched_on,baseline_time from publication_notice_settings where singleton=true for share;
  if not coalesce(switched_on,false) or baseline_time is null then return new; end if;
  insert into publication_notice_seen(publication_id) values(new.id) on conflict do nothing returning publication_id into captured;
  if captured is not null then
    insert into publication_notice_events(publication_id,revision_key,kind,reason,approved_by)
      values(new.id,'first','publication','First paid release after the approved baseline',new.paid_release_changed_by)
      on conflict(publication_id,revision_key) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists publication_notice_capture on documents;
create trigger publication_notice_capture after insert or update of paid_release_state,status,visibility on documents
  for each row execute function capture_publication_notice();
commit;


-- Stage 3: editorial review and version history
-- Editorial review and controlled correction history. No existing record is
-- adopted, approved, released, reassigned or changed by this migration.
begin;
set local lock_timeout='5s';
create table if not exists publication_families (
  id uuid primary key default gen_random_uuid(),
  kind text not null check(kind in ('paid','review')),
  original_issue_date date not null,
  current_workflow_id uuid,
  created_by uuid references admins(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists publication_workflows (
  id uuid primary key default gen_random_uuid(),
  document_id uuid unique references documents(id) on delete restrict,
  review_edition_id uuid unique references review_publication_editions(id) on delete restrict,
  check((document_id is null)<>(review_edition_id is null)),
  state text not null default 'draft' check(state in ('draft','in_review','approved','published','withdrawn','archived')),
  revision bigint not null default 0 check(revision>=0),
  version_label text not null default '1',
  provenance text not null default '',
  author_editor text not null default '',
  covered_period_start date,
  covered_period_end date,
  information_cutoff date,
  reading_time_minutes integer check(reading_time_minutes between 1 and 600),
  check((covered_period_start is null)=(covered_period_end is null)),
  check(covered_period_end>=covered_period_start),
  family_id uuid references publication_families(id) on delete restrict,
  ordinal integer check(ordinal>0),
  unique(family_id,ordinal),
  submitted_by uuid references admins(id) on delete set null,
  submitted_at timestamptz,
  submitted_hash text,
  approved_by uuid references admins(id) on delete set null,
  approved_at timestamptz,
  approved_hash text,
  ever_published boolean not null default false,
  legacy_adoption boolean not null default false,
  first_released_at timestamptz,
  original_issue_date date,
  original_source_ids text[] not null default '{}',
  frozen_snapshot jsonb,
  notice_document_id text,
  notice_source_sha256 text check(notice_source_sha256 is null or notice_source_sha256~'^[a-f0-9]{64}$'),
  notice_sha256 text check(notice_sha256 is null or notice_sha256~'^[a-f0-9]{64}$'),
  notice_page_count integer check(notice_page_count>0),
  notice_current_url text,
  notice_prepared_by uuid references admins(id) on delete set null,
  notice_prepared_at timestamptz,
  notice_verified_by uuid references admins(id) on delete set null,
  notice_verified_at timestamptz,
  check(notice_verified_by is null or notice_verified_by<>notice_prepared_by),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
do $$ begin
  if not exists(select 1 from pg_constraint where conname='publication_families_current_fkey') then
    alter table publication_families add constraint publication_families_current_fkey
      foreign key(current_workflow_id) references publication_workflows(id) on delete restrict;
  end if;
end $$;
create table if not exists publication_workflow_events (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references publication_workflows(id) on delete restrict,
  action text not null,
  previous_state text,
  next_state text,
  revision bigint not null,
  actor_id uuid references admins(id) on delete restrict,
  actor_name text not null,
  reason text not null,
  snapshot jsonb,
  created_at timestamptz not null default now()
);
create index if not exists publication_workflow_history on publication_workflow_events(workflow_id,created_at,id);
create table if not exists publication_correction_access (
  workflow_id uuid primary key references publication_workflows(id) on delete restrict,
  source_workflow_id uuid not null references publication_workflows(id) on delete restrict,
  source_hash text not null,
  target_hash text not null,
  snapshot jsonb not null,
  inherited_by uuid references admins(id) on delete set null,
  inherited_at timestamptz not null default now()
);
create table if not exists publication_version_retirements (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references publication_workflows(id) on delete restrict,
  link_id text,
  identity_hash text not null,
  expected_document_ids text[] not null,
  kind text not null check(kind in ('paid_personal','legacy_copy','review_edition','review_rooms','manual')),
  subscriber_id uuid references subscribers(id) on delete set null,
  state text not null default 'pending' check(state in ('pending','running','confirmed','awaiting_manual','failed')),
  confirmation_method text check(confirmation_method in ('provider','two_person_manual')),
  confirmed_by uuid references admins(id) on delete set null,
  checked_by uuid references admins(id) on delete set null,
  check(checked_by is null or checked_by<>confirmed_by),
  confirmation_reason text,
  confirmed_at timestamptz,
  attempts integer not null default 0 check(attempts>=0),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  last_error text,
  unique(workflow_id,identity_hash)
);
alter table publication_version_retirements add column if not exists legacy_link_hash text;
create table if not exists publication_legacy_notice_proofs (
  workflow_id uuid not null references publication_workflows(id) on delete restrict,
  subscriber_id uuid not null references subscribers(id) on delete restrict,
  link_hash text not null,
  notice_hash text not null,
  prepared_by uuid not null references admins(id) on delete restrict,
  prepared_at timestamptz not null default now(),
  checked_by uuid references admins(id) on delete restrict,
  checked_at timestamptz,
  reason text not null,
  check(checked_by is null or checked_by<>prepared_by),
  primary key(workflow_id,subscriber_id)
);
create index if not exists publication_retirements_due on publication_version_retirements(next_attempt_at) where state in ('pending','running');

create or replace function publication_content_snapshot(subject text,record_id uuid) returns jsonb language plpgsql stable as $$
declare result jsonb;
begin
  if subject='paid' then
    select jsonb_build_object(
      'title',d.title,'series',d.series,'issueDate',to_char(d.edition_date,'YYYY-MM-DD'),
      'description',d.description,'teaser',d.summary,'visibility',d.visibility,
      'author',to_jsonb(d)->>'author_editor','coveredStart',to_jsonb(d)->>'covered_period_start',
      'coveredEnd',to_jsonb(d)->>'covered_period_end','cutoff',to_jsonb(d)->>'information_cutoff',
      'minutes',to_jsonb(d)->>'reading_time_minutes',
      'sources',(select coalesce(jsonb_agg(x.id order by x.id),'[]'::jsonb) from (
        select d.papermark_document_id as id where coalesce(d.papermark_document_id,'')<>''
        union select dd.papermark_document_id from papermark_dataroom_documents dd where dd.publication_id=d.id and dd.is_present=true
      )x),
      'sourceVersions',(select coalesce(jsonb_agg(jsonb_build_array(dd.papermark_document_id,dd.version_key) order by dd.id),'[]'::jsonb) from papermark_dataroom_documents dd where dd.publication_id=d.id and dd.is_present),
      'tags',(select coalesce(jsonb_agg(a.tag_id order by a.tag_id),'[]'::jsonb) from publication_tag_assignments a where a.publication_id=d.id)
    ) into result from documents d where d.id=record_id;
  elsif subject='review' then
    select jsonb_build_object('title',e.title,'series',e.series,'issueDate',to_char(e.edition_date,'YYYY-MM-DD'),
      'description',e.description,'sources',jsonb_build_array(e.papermark_document_id),'sourceVersion',e.sync_version_key,
      'author',w.author_editor,'coveredStart',to_char(w.covered_period_start,'YYYY-MM-DD'),
      'coveredEnd',to_char(w.covered_period_end,'YYYY-MM-DD'),'cutoff',to_char(w.information_cutoff,'YYYY-MM-DD'),
      'minutes',w.reading_time_minutes)
      into result from review_publication_editions e left join publication_workflows w on w.review_edition_id=e.id where e.id=record_id;
  else return null;
  end if;
  if result is null then return null; end if;
  return result||coalesce((select jsonb_build_object('version',w.version_label,'provenance',w.provenance)
    from publication_workflows w where (subject='paid' and w.document_id=record_id) or (subject='review' and w.review_edition_id=record_id)),'{}'::jsonb);
end $$;
create or replace function publication_content_hash(subject text,record_id uuid) returns text language sql stable as $$
  select md5(publication_content_snapshot(subject,record_id)::text)
$$;

-- Audiences are copied only by an explicit owner action. A later change to
-- either list invalidates that inheritance and holds correction release.
create or replace function publication_audience_snapshot(subject text,record_id uuid) returns jsonb language plpgsql stable as $$
begin
  if subject='paid' then
    return jsonb_build_object(
      'visibility',(select visibility from documents where id=record_id),
      'plans',(select coalesce(jsonb_agg(public_tier order by public_tier),'[]'::jsonb) from publication_plans where publication_id=record_id),
      'exceptions',(select coalesce(jsonb_agg(jsonb_build_object('subscriber',subscriber_id,'decision',decision,'reason',reason) order by subscriber_id),'[]'::jsonb) from subscriber_publication_exceptions where publication_id=record_id)
    );
  elsif subject='review' then
    return jsonb_build_object('emails',case when (select recipient_mode from review_publication_editions where id=record_id)='shared_legacy'
      then (select coalesce(jsonb_agg(email order by email),'[]'::jsonb) from (select distinct lower(btrim(x)) as email from app_settings a,regexp_split_to_table(a.value,E'[\\n\\r,;\\t]+')x where a.key='review_approved_recipients' and position('@' in x)>1) addresses)
      else (select coalesce(jsonb_agg(email order by email),'[]'::jsonb) from review_edition_recipients where edition_id=record_id and revoked_at is null) end);
  end if;
  return null;
end $$;

-- Transaction preconditions abort all later writes if a preview was stale.
create or replace function assert_correction_inputs(subject text,source_id uuid,target_id uuid,source_hash text,target_hash text,source_audience jsonb,target_audience jsonb) returns void language plpgsql as $$
declare prior publication_workflows; target publication_workflows;
begin
  select * into prior from publication_workflows where (subject='paid' and document_id=source_id) or (subject='review' and review_edition_id=source_id) for update;
  select * into target from publication_workflows where (subject='paid' and document_id=target_id) or (subject='review' and review_edition_id=target_id) for update;
  if prior.id is null or not prior.ever_published or target.id is null or target.ever_published then raise exception 'Correction needs a released source and an unreleased draft'; end if;
  if target.family_id is not null and (target.family_id is distinct from prior.family_id or target.ordinal<>prior.ordinal+1) then raise exception 'This draft already belongs to another correction'; end if;
  if publication_content_hash(subject,source_id) is distinct from source_hash or publication_content_hash(subject,target_id) is distinct from target_hash
    or publication_audience_snapshot(subject,source_id) is distinct from source_audience or publication_audience_snapshot(subject,target_id) is distinct from target_audience then
    raise exception 'The correction preview changed; reload and preview again';
  end if;
  if publication_content_snapshot(subject,source_id)->>'issueDate' is distinct from publication_content_snapshot(subject,target_id)->>'issueDate'
    or publication_content_snapshot(subject,source_id)->>'series' is distinct from publication_content_snapshot(subject,target_id)->>'series' then
    raise exception 'A correction must retain the original date and category';
  end if;
end $$;
create or replace function assert_notice_verification(workflow uuid,actor uuid,expected_revision bigint) returns void language plpgsql as $$
declare w publication_workflows;
begin
  select * into w from publication_workflows where id=workflow for update;
  if w.id is null or w.revision is distinct from expected_revision or w.notice_document_id is null or w.notice_prepared_by is null or w.notice_sha256 is null or w.notice_source_sha256 is null
    or w.notice_page_count is null or w.notice_current_url is null or w.notice_prepared_by=actor or w.notice_verified_at is not null
    or not exists(select 1 from admins where id=actor and is_active and role='owner')
    or not exists(select 1 from admins where id=w.notice_prepared_by and is_active and role='owner') then
    raise exception 'A different active owner must verify this unchanged notice proof';
  end if;
end $$;

-- Called after locking the publication row in the SAME transaction as release.
-- This is not a UI hint: stale approval, wrong role or an unreviewed first
-- release aborts the transaction before any audience/release change commits.
create or replace function assert_publication_editorial_approval(subject text,record_id uuid,actor uuid,expected_revision bigint) returns void language plpgsql as $$
declare w publication_workflows; prior publication_workflows; inherited publication_correction_access; live boolean;
begin
  select * into w from publication_workflows where (subject='paid' and document_id=record_id) or (subject='review' and review_edition_id=record_id) for update;
  if w.id is null then
    if subject='paid' then select status='published' or coalesce(paid_release_state='released',false) into live from documents where id=record_id;
    else select publication_state='published' into live from review_publication_editions where id=record_id; end if;
    if coalesce(live,false) then return; end if;
    raise exception 'Editorial review is required before a first release';
  end if;
  if not exists(select 1 from admins where id=actor and is_active=true and role='owner') then raise exception 'Only an owner can release an approved publication'; end if;
  if w.revision is distinct from expected_revision then raise exception 'Editorial review changed; reload before release'; end if;
  if w.state='published' and w.ever_published then return; end if;
  if w.family_id is not null and w.ordinal>1 then
    perform id from publication_families where id=w.family_id for update;
    select * into prior from publication_workflows where family_id=w.family_id and ordinal=w.ordinal-1 for update;
    select * into inherited from publication_correction_access where workflow_id=w.id;
    if prior.id is null or not prior.ever_published or prior.notice_verified_at is null then
      raise exception 'The earlier PDF needs a verified embedded superseded notice before correction release';
    end if;
    if not exists(select 1 from publication_version_retirements where workflow_id=prior.id and kind='manual' and state='confirmed')
      or exists(select 1 from publication_version_retirements where workflow_id=prior.id and state<>'confirmed') then
      raise exception 'Earlier raw links are not yet confirmed retired; finish the correction checklist';
    end if;
    if inherited.workflow_id is null or inherited.source_workflow_id<>prior.id
       or inherited.source_hash<>md5(publication_audience_snapshot(subject,coalesce(prior.document_id,prior.review_edition_id))::text)
       or inherited.target_hash<>md5(publication_audience_snapshot(subject,record_id)::text) then
      raise exception 'Reader inheritance changed; preview and approve the exact assignment copy again';
    end if;
    if subject='paid' and not exists(select 1 from papermark_dataroom_documents where publication_id=prior.document_id and papermark_document_id=prior.notice_document_id and is_present) then
      -- Legacy copies are manually replaced and independently checked instead.
      if exists(select 1 from papermark_dataroom_documents where publication_id=prior.document_id and is_present) then
        raise exception 'The earlier notice copy is not present in the paid library';
      end if;
    end if;
    if subject='review' and not exists(select 1 from review_publication_editions where id=prior.review_edition_id
      and papermark_document_id=prior.notice_document_id and secure_link_document_id=prior.notice_document_id
      and secure_link_verified_at is not null and secure_link_url<>'') then
      raise exception 'Prepare and verify secure access to the earlier notice copy first';
    end if;
  end if;
  if prior.id is not null and subject='paid' and exists(select 1 from papermark_subscriber_document_links where papermark_document_id=any(prior.original_source_ids) and revoke_state='live') then
    raise exception 'An earlier personal raw link is still recorded live; resume retirement checks';
  end if;
  if w.state<>'approved' or w.approved_hash is distinct from publication_content_hash(subject,record_id) then
    raise exception 'An unchanged owner-approved review is required before release';
  end if;
end $$;

create or replace function invalidate_publication_review() returns trigger language plpgsql as $$
declare w publication_workflows;
begin
  select * into w from publication_workflows where (tg_table_name='documents' and document_id=new.id) or (tg_table_name='review_publication_editions' and review_edition_id=new.id) for update;
  if w.id is null then return new; end if;
  if w.ever_published and new.edition_date is distinct from old.edition_date then
    raise exception 'A released issue date cannot change; create a separately identified correction';
  end if;
  if w.ever_published and new.papermark_document_id is distinct from old.papermark_document_id
    and not (w.notice_verified_at is not null and new.papermark_document_id=w.notice_document_id) then
    raise exception 'The released PDF source cannot be replaced in place; create a correction or an approved notice copy';
  end if;
  if w.state in ('in_review','approved') and
    (to_jsonb(new)-array['updated_at','status','is_published','published_at','paid_release_state','paid_release_reason','paid_release_changed_at','paid_release_changed_by'])
      is distinct from (to_jsonb(old)-array['updated_at','status','is_published','published_at','paid_release_state','paid_release_reason','paid_release_changed_at','paid_release_changed_by']) then
    update publication_workflows set state='draft',revision=revision+1,approved_hash=null,approved_by=null,approved_at=null,submitted_hash=null,updated_at=now() where id=w.id;
    insert into publication_workflow_events(workflow_id,action,previous_state,next_state,revision,actor_name,reason)
      values(w.id,'content_changed',w.state,'draft',w.revision+1,'Publication data change','Content changed before release; editorial approval was cleared');
  end if;
  return new;
end $$;
drop trigger if exists review_paid_editorial_change on documents;
create trigger review_paid_editorial_change before update of title,series,edition_date,description,summary,papermark_document_id,author_editor,covered_period_start,covered_period_end,information_cutoff,reading_time_minutes on documents
  for each row execute function invalidate_publication_review();
drop trigger if exists review_complimentary_editorial_change on review_publication_editions;
create trigger review_complimentary_editorial_change before update of title,series,edition_date,description,papermark_document_id on review_publication_editions
  for each row execute function invalidate_publication_review();

-- Advance only after the normal release action actually published this row.
-- A correction inherits its predecessor's homepage/latest placement within
-- this family. Unrelated issues and deliberate homepage offers stay separate.
create or replace function advance_publication_family(workflow uuid) returns void language plpgsql as $$
declare w publication_workflows; current_ordinal integer; prior review_publication_editions;
begin
  select * into w from publication_workflows where id=workflow;
  if w.family_id is null or w.state<>'published' or not w.ever_published then return; end if;
  perform id from publication_families where id=w.family_id for update;
  select ordinal into current_ordinal from publication_workflows where id=(select current_workflow_id from publication_families where id=w.family_id);
  if coalesce(current_ordinal,0)>w.ordinal then return; end if;
  if w.review_edition_id is not null then
    select e.* into prior from review_publication_editions e join publication_workflows p on p.review_edition_id=e.id where p.family_id=w.family_id and p.ordinal=w.ordinal-1;
    if prior.id is not null then
      update review_publication_editions set is_latest=false,complimentary_featured=false where id=prior.id;
      update review_publication_editions set is_latest=is_latest or prior.is_latest,complimentary_featured=complimentary_featured or prior.complimentary_featured where id=w.review_edition_id and publication_state='published';
    end if;
  end if;
  update publication_families set current_workflow_id=w.id where id=w.family_id;
  if w.document_id is not null and w.ordinal>1 and to_regclass('public.publication_notice_events') is not null then
    update publication_notice_jobs j set state='cancelled',detail='A newer approved version replaced this unsent announcement',updated_at=now()
      from publication_notice_events e where j.event_id=e.id and j.state in ('pending','held','failed')
        and e.publication_id in(select document_id from publication_workflows where family_id=w.family_id and ordinal<w.ordinal);
    update publication_notice_events set state='cancelled',lease_token=null,lease_until=null
      where state in ('pending','fanning') and publication_id in(select document_id from publication_workflows where family_id=w.family_id and ordinal<w.ordinal);
    update publication_notice_events set kind='correction',reason='Approved correction: version '||w.version_label,approved_by=w.approved_by
      where publication_id=w.document_id and revision_key='first' and kind='publication';
  end if;
end $$;

-- Mirror real archive/withdraw/re-offer outcomes; never release from a trigger.
create or replace function record_editorial_access_state() returns trigger language plpgsql as $$
declare w publication_workflows; next_state text;
begin
  select * into w from publication_workflows where (tg_table_name='documents' and document_id=new.id) or (tg_table_name='review_publication_editions' and review_edition_id=new.id) for update;
  if w.id is null then return new; end if;
  if tg_table_name='documents' then
    if new.status='archived' then next_state:='archived';
    elsif old.status='archived' and new.status='draft' then next_state:='draft'; end if;
  else
    if new.publication_state='withdrawn' then next_state:='withdrawn';
    elsif old.publication_state='withdrawn' and new.publication_state='draft' then next_state:='draft'; end if;
  end if;
  if next_state is not null and next_state<>w.state then
    update publication_workflows set state=next_state,approved_hash=null,approved_at=null,approved_by=null,submitted_hash=null,revision=revision+1,updated_at=now() where id=w.id;
    insert into publication_workflow_events(workflow_id,action,previous_state,next_state,revision,actor_name,reason) values(w.id,'access_state_changed',w.state,next_state,w.revision+1,'Publication access control','Mirrors the recorded archive, withdrawal or re-offer outcome; not an editorial approval');
  end if;
  return new;
end $$;
drop trigger if exists editorial_paid_access_state on documents;
create trigger editorial_paid_access_state after update of status on documents for each row execute function record_editorial_access_state();
drop trigger if exists editorial_review_access_state on review_publication_editions;
create trigger editorial_review_access_state after update of publication_state on review_publication_editions for each row execute function record_editorial_access_state();

-- A record of what was actually released is append-only. An administrator
-- may prepare a separately identified notice copy; the master ids/date and
-- frozen publication snapshot are never overwritten by that operation.
create or replace function protect_publication_history() returns trigger language plpgsql as $$
begin
  if tg_table_name='publication_workflow_events' then
    raise exception 'Publication history is append-only';
  end if;
  if tg_op='DELETE' and old.ever_published then raise exception 'A released version cannot be deleted'; end if;
  if tg_op='UPDATE' and old.frozen_snapshot is not null then
    if new.frozen_snapshot is distinct from old.frozen_snapshot
       or new.original_source_ids is distinct from old.original_source_ids
       or new.original_issue_date is distinct from old.original_issue_date then
      raise exception 'The released snapshot, source and original issue date are immutable; create a correction';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists immutable_publication_history on publication_workflow_events;
create trigger immutable_publication_history before update or delete on publication_workflow_events for each row execute function protect_publication_history();
drop trigger if exists immutable_publication_snapshot on publication_workflows;
create trigger immutable_publication_snapshot before update or delete on publication_workflows for each row execute function protect_publication_history();
commit;
