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

alter table documents drop constraint if exists documents_series_check;
alter table documents add constraint documents_series_check
  check (series = '' or series in ('PLM', 'AEO', 'AIU', 'MIN', 'QIB', 'BP'));

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
);
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
