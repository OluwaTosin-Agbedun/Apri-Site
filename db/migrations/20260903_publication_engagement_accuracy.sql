-- Phase 6: accurate publication engagement
--
-- Additive and idempotent, and run as ONE transaction so a failure part-way
-- through cannot leave a table half-migrated or, worse, without a constraint
-- it had before. No existing row is deleted or rewritten, and no column is
-- dropped or retyped.
--
-- Timestamps are all timestamptz and are stored in UTC. Africa/Lagos is a
-- display concern, applied in the application, never in storage.
--
-- Indexes: every one below is here because a specific implemented query needs
-- it. Three earlier candidates were exact duplicates of indexes already in
-- schema.sql (document_views on (subscriber_id, viewed_at desc), on
-- (papermark_link_id), and a unique on papermark_webhook_events (event_id)),
-- and six more indexed columns that no query filters on. All nine are gone: an
-- unused index costs write throughput and storage and buys nothing.

begin;

-- ---------------------------------------------------------------------------
-- 1. publication_access_events -- clicks on an APRI publication card
-- ---------------------------------------------------------------------------
--
-- A click is an APRI-side intent signal. It is NOT a view: only Papermark can
-- confirm that a document was actually opened, so these rows are counted and
-- reported separately and must never be added to view sessions.
--
-- The secure Papermark URL is deliberately not stored. The row records which
-- publication was clicked, not the credential that opens it.
--
-- The CHECK is declared inline rather than as a drop-and-add. On a first run
-- it arrives with the table; on a re-run `if not exists` leaves the table, and
-- its constraint, untouched. A drop-and-add would briefly remove a working
-- constraint in order to recreate it identically, which is a window of risk
-- bought for nothing.

create table if not exists publication_access_events (
  id                     uuid        primary key default gen_random_uuid(),

  -- Client-generated idempotency key. A retried or double-fired beacon
  -- collapses onto the same row rather than inflating the click count.
  event_id               text        not null,

  -- First-party random cookie value. Not an identifier of a person, and never
  -- an IP address -- raw IPs are not stored anywhere in this schema.
  visitor_id             text        not null default '',

  publication_id         uuid        references documents (id) on delete set null,

  -- 'MIN' | 'AIU' | 'PLM' for a Complimentary Review card, else null.
  slot_key               text,

  -- Resolved server-side from the publication or slot. The browser never
  -- supplies these.
  papermark_document_id  text,
  papermark_link_id      text,

  event_type             text        not null
    constraint publication_access_events_type_check check (event_type in (
      'review_access_clicked',
      'publication_details_clicked',
      'subscriber_document_view_clicked',
      'subscriber_document_download_clicked'
    )),

  -- The APRI path the click happened on, e.g. '/publications'.
  origin_path            text        not null default '',

  occurred_at            timestamptz not null default now(),
  received_at            timestamptz not null default now(),
  created_at             timestamptz not null default now()
);

-- Idempotency for `on conflict (event_id) do nothing`.
create unique index if not exists publication_access_events_event_id_key
  on publication_access_events (event_id);

-- Every dashboard figure is bounded by the selected window, and two of them
-- (access_clicks, unique_clickers) filter on nothing else. This is the index
-- those scans use.
create index if not exists publication_access_events_date_idx
  on publication_access_events (occurred_at desc);

-- Per-publication click counts in the Publications tab.
create index if not exists publication_access_events_pub_date_idx
  on publication_access_events (publication_id, occurred_at desc);

-- Review-slot click counts, which join on slot_key rather than publication_id.
create index if not exists publication_access_events_slot_date_idx
  on publication_access_events (slot_key, occurred_at desc);

-- ---------------------------------------------------------------------------
-- 2. document_download_events -- one row per confirmed Papermark download
-- ---------------------------------------------------------------------------
--
-- Separate from document_views because `document_views.downloaded` is a
-- boolean: it can record that a reader downloaded at least once, and cannot
-- record that they downloaded four times. Repeat downloads are exactly the
-- signal that distinguishes a reader who filed a briefing from one who glanced
-- at it, so they need rows of their own.

create table if not exists document_download_events (
  id                     uuid        primary key default gen_random_uuid(),

  -- Papermark's webhook event id, or the poll's derived key. Unique, so a
  -- download delivered by both webhook and poll is stored once.
  source_event_id        text        not null,

  papermark_view_id      text,
  papermark_link_id      text,
  papermark_document_id  text,

  subscriber_id          uuid        references subscribers (id) on delete set null,
  briefing_request_id    uuid        references briefing_requests (id) on delete set null,
  publication_id         uuid        references documents (id) on delete set null,

  -- Lower-cased and trimmed on write. The address Papermark verified, which for
  -- a Complimentary Review reader is the only identity we have.
  viewer_email           text,

  reader_type            text        not null default 'unknown'
    constraint document_download_events_reader_type_check
    check (reader_type in ('subscriber', 'briefing', 'complimentary_review', 'unknown')),

  downloaded_at          timestamptz not null default now(),

  -- 'webhook' | 'poll'. Preserved so the admin can tell which collector saw it.
  collection_source      text        not null default 'webhook'
    constraint document_download_events_collection_source_check
    check (collection_source in ('webhook', 'poll')),

  created_at             timestamptz not null default now()
);

-- Idempotency for `on conflict (source_event_id)`, which is what makes the
-- same download delivered by webhook and poll a single row.
create unique index if not exists document_download_events_source_event_key
  on document_download_events (source_event_id);

-- Window-only scans: download_events and unique_downloaders in the Overview,
-- and the scoped_downloads CTE that the Publications and Readers tabs build on.
create index if not exists document_download_events_date_idx
  on document_download_events (downloaded_at desc);

-- Per-publication download counts in the Publications tab.
create index if not exists document_download_events_pub_date_idx
  on document_download_events (publication_id, downloaded_at desc);

-- Per-subscriber download counts in the Readers tab.
create index if not exists document_download_events_subscriber_date_idx
  on document_download_events (subscriber_id, downloaded_at desc);

-- Prospect downloads, which have no subscriber id and are keyed by address.
-- Indexed on lower(...) because that is how the queries compare it: a plain
-- b-tree on the raw column cannot serve `lower(viewer_email) = ...`, so the
-- obvious index would have been built and never used.
create index if not exists document_download_events_email_date_idx
  on document_download_events (lower(viewer_email), downloaded_at desc);

-- ---------------------------------------------------------------------------
-- 3. document_views -- additive columns only
-- ---------------------------------------------------------------------------
--
-- All nullable with no backfill. A null reader_type means "not yet
-- classified", which is honest; defaulting it to 'subscriber' would invent paid
-- readers, and defaulting to 'unknown' would hide rows the owner-run repair can
-- still resolve.

alter table document_views
  add column if not exists papermark_document_id text;

alter table document_views
  add column if not exists briefing_request_id uuid references briefing_requests (id) on delete set null;

alter table document_views
  add column if not exists reader_type text;

-- Which resolver rule matched, for the unmatched-views diagnostics.
alter table document_views
  add column if not exists attribution_method text;

-- When duration/page data was last fetched. Null means never enriched, which is
-- how a later poll knows to resume rather than starting over.
alter table document_views
  add column if not exists last_enriched_at timestamptz;

-- This table already holds live data, so the constraint is added only when it
-- is genuinely absent. The earlier drop-and-add would have removed a working
-- constraint from a populated table and then re-added it identically -- and if
-- the re-add had failed, the table would have been left unprotected.
--
-- Legacy rows are preserved: reader_type is a new column, so every existing row
-- holds NULL, and NULL is explicitly permitted.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'document_views_reader_type_check'
      and conrelid = 'document_views'::regclass
  ) then
    alter table document_views
      add constraint document_views_reader_type_check
      check (reader_type is null or reader_type in (
        'subscriber', 'briefing', 'complimentary_review', 'unknown'
      ));
  end if;
end $$;

-- Window-only scans: view_sessions in the Overview and the scoped_views CTE.
-- schema.sql has a (viewed_at desc) index but it is PARTIAL, restricted to
-- `subscriber_id is null`, so it serves the unmatched queue and not these.
create index if not exists document_views_date_idx
  on document_views (viewed_at desc);

-- Per-publication view counts. Extends the existing single-column
-- document_views_publication_idx with the date, which every query now filters on.
create index if not exists document_views_pub_date_idx
  on document_views (publication_id, viewed_at desc);

-- Prospect readers, keyed by verified address. On lower(...) for the same
-- reason as the download table above.
create index if not exists document_views_email_date_idx
  on document_views (lower(viewer_email), viewed_at desc);

-- The Complimentary Review reader count filters on reader_type plus the window.
create index if not exists document_views_reader_type_date_idx
  on document_views (reader_type, viewed_at desc);

-- Finds the next batch needing duration/page data, so enrichment resumes across
-- runs. Partial, because once a view is enriched it never appears here again --
-- which keeps this index small even as the table grows.
create index if not exists document_views_enrichment_idx
  on document_views (viewed_at desc)
  where last_enriched_at is null;

-- ---------------------------------------------------------------------------
-- 4. papermark_webhook_events -- sanitized failure diagnostics
-- ---------------------------------------------------------------------------
--
-- The route must not mark a failed event processed. These columns let it record
-- the failure and the retry count without ever storing a token, a signature or
-- a raw request header.
--
-- No unique index on event_id is created here: papermark_webhook_events_key
-- already provides it, from the 20260828 migration.

alter table papermark_webhook_events
  add column if not exists attempts integer not null default 0;

-- A short, sanitized reason. Never a token, header or request body.
alter table papermark_webhook_events
  add column if not exists last_error text;

alter table papermark_webhook_events
  add column if not exists failed_at timestamptz;

-- The Diagnostics tab counts events with outcome = 'failed'.
create index if not exists papermark_webhook_events_outcome_idx
  on papermark_webhook_events (outcome, received_at desc);

-- ---------------------------------------------------------------------------
-- 5. Diagnostics markers
-- ---------------------------------------------------------------------------
--
-- "Data since" must be an honest first-reliable-timestamp, not the epoch. It is
-- stamped once, on the first real event after deploy, and never fabricated
-- backwards.

insert into app_settings (key, value)
values ('engagement_click_tracking_since', '')
on conflict (key) do nothing;

insert into app_settings (key, value)
values ('papermark_last_webhook_at', '')
on conflict (key) do nothing;

insert into app_settings (key, value)
values ('papermark_last_poll', '')
on conflict (key) do nothing;

-- The approved Complimentary Review recipient list. Stored as one setting so no
-- new table is needed. Empty means no recipient is approved, and link
-- provisioning fails closed rather than minting an unrestricted link.
insert into app_settings (key, value)
values ('review_approved_recipients', '')
on conflict (key) do nothing;

commit;
