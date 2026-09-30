-- Page-level viewing evidence for the Admin Engagement monitor.
--
-- Papermark's per-view analytics (GET /v1/analytics/views/{id}) returns
-- page_durations -- one {page_number, duration_seconds} per page with recorded
-- time -- and no total page count or completion figure. A total page count
-- belongs to a document VERSION (GET /v1/documents/{id}/versions), and a view
-- carries no version, so the version a view was on is resolved from the
-- version list by creation time and recorded here.
--
-- What this stores:
--
--  * document_view_pages -- the pages of one viewing session with recorded
--    time, one row per page. Keyed (view_id, page_number), so a repeated
--    analytics snapshot of the same session updates its rows instead of
--    adding new ones. Coverage across sessions is the DISTINCT pages of these
--    rows for one reader, document and version -- never a sum or average of
--    per-session percentages.
--
--  * papermark_document_versions -- a cache of each Papermark document's
--    versions (number, page count, creation time), so the page total used for
--    a session is the one of the version it was on, and two versions of a PDF
--    are never combined.
--
--  * document_views: the view type Papermark reported (a Data Room view is
--    opening the room, not reading a document), the resolved version and its
--    page total, this session's distinct pages and furthest page (kept apart:
--    reaching page 20 is not reading 20 pages), and the enrichment state, so a
--    failed or rate-limited analytics call is retried instead of being marked
--    done, and a recent session is refreshed as reading continues.
--
-- Additive and idempotent. Nothing existing is changed or removed. Safe to run
-- while the site is live, before or after the code that uses it is deployed:
-- until it runs, the monitor shows "Progress unavailable" and the collector
-- keeps working as before.
--
--   psql "<connection string>" -v ON_ERROR_STOP=1 -f db/migrations/20261002_engagement_page_progress.sql

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. What each session was, and how far its analytics have been collected
-- ---------------------------------------------------------------------------

alter table document_views
  add column if not exists view_type text;

alter table document_views
  add column if not exists document_version_id text;

alter table document_views
  add column if not exists document_version_number integer;

-- The page total of the version this session was on. Null when it could not
-- be established reliably: the monitor then shows "Progress unavailable".
alter table document_views
  add column if not exists total_pages integer;

-- Distinct pages with recorded time in this session, and the highest such
-- page. Two separate facts: pages 1 and 20 of 20 is 2 pages viewed.
alter table document_views
  add column if not exists pages_viewed integer;

alter table document_views
  add column if not exists furthest_page integer;

-- complete | partial | unavailable | failed | rate_limited. Null: never tried.
alter table document_views
  add column if not exists enrichment_state text;

alter table document_views
  add column if not exists enrichment_attempts integer not null default 0;

-- A short, sanitized reason. Never a token, header or response body.
alter table document_views
  add column if not exists enrichment_error text;

-- When this session's analytics should next be fetched: soon for a recent
-- session (reading may continue), later after a failure, null once settled.
alter table document_views
  add column if not exists next_enrichment_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'document_views_page_progress_check'
                 and conrelid = 'document_views'::regclass) then
    alter table document_views add constraint document_views_page_progress_check check (
      (total_pages is null or total_pages > 0)
      and (pages_viewed is null or pages_viewed >= 0)
      and (furthest_page is null or furthest_page >= 1)
      and (pages_viewed is null or total_pages is null or pages_viewed <= total_pages)
      and (furthest_page is null or total_pages is null or furthest_page <= total_pages)
      and enrichment_attempts >= 0
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'document_views_enrichment_state_check'
                 and conrelid = 'document_views'::regclass) then
    alter table document_views add constraint document_views_enrichment_state_check check (
      enrichment_state is null
      or enrichment_state in ('complete', 'partial', 'unavailable', 'failed', 'rate_limited')
    );
  end if;
end $$;

-- The next batch to (re)fetch: never tried, or due again.
create index if not exists document_views_enrichment_due_idx
  on document_views (next_enrichment_at)
  where next_enrichment_at is not null;

-- ---------------------------------------------------------------------------
-- 2. The pages of each session
-- ---------------------------------------------------------------------------

create table if not exists document_view_pages (
  view_id           uuid           not null references document_views (id) on delete cascade,
  page_number       integer        not null,
  duration_seconds  numeric(12, 3) not null,
  first_seen_at     timestamptz    not null default now(),
  updated_at        timestamptz    not null default now(),
  constraint document_view_pages_page_check check (page_number >= 1),
  constraint document_view_pages_duration_check check (duration_seconds >= 0),
  primary key (view_id, page_number)
);

-- ---------------------------------------------------------------------------
-- 3. Papermark document versions and their page counts
-- ---------------------------------------------------------------------------

create table if not exists papermark_document_versions (
  papermark_document_id  text        not null,
  version_id             text        not null,
  version_number         integer,
  num_pages              integer,
  is_primary             boolean     not null default false,
  version_created_at     timestamptz,
  fetched_at             timestamptz not null default now(),
  constraint papermark_document_versions_pages_check check (num_pages is null or num_pages > 0),
  primary key (papermark_document_id, version_id)
);

create index if not exists papermark_document_versions_created_idx
  on papermark_document_versions (papermark_document_id, version_created_at desc);

-- ---------------------------------------------------------------------------
-- 4. Lookups the monitor makes by Papermark id
-- ---------------------------------------------------------------------------
--
-- A session is matched to its edition by its Papermark document, and a
-- download to its session; neither column was indexed.

create index if not exists document_views_document_idx
  on document_views (papermark_document_id)
  where papermark_document_id is not null;

create index if not exists document_download_events_view_idx
  on document_download_events (papermark_view_id)
  where papermark_view_id is not null;

create index if not exists document_download_events_document_idx
  on document_download_events (papermark_document_id)
  where papermark_document_id is not null;

commit;
