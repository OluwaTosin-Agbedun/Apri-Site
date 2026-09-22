-- Versioned Complimentary Review publication library.
--
-- This migration is intentionally additive: complimentary_review_items remains
-- in place as a compatibility source while the application moves to editions.
-- Run the complete file in one PostgreSQL session so the backfill and indexes
-- commit together.

begin;

create table if not exists review_publication_editions (
  id                         uuid primary key default gen_random_uuid(),
  series                     text not null check (series in ('MIN', 'AIU', 'PLM')),
  title                      text not null default '',
  edition_date               date,
  edition_order              text not null default '',
  papermark_document_id      text not null,
  papermark_dataroom_id      text,
  secure_link_id             text,
  secure_link_url            text not null default '',
  secure_link_document_id    text,
  secure_link_verified_at    timestamptz,
  publication_type           text not null default '',
  description                text not null default '',
  frequency                  text not null default '',
  audience                   text not null default '',
  publication_state          text not null default 'draft'
    check (publication_state in ('draft', 'published')),
  is_latest                  boolean not null default false,
  sync_candidate_id          uuid references review_sync_candidates(id) on delete set null,
  sync_version_key           text not null default '',
  first_seen_at              timestamptz,
  last_synced_at             timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
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

-- Preserve the production row UUIDs and every existing exact-document link.
-- ON CONFLICT makes a repeated deployment harmless and never overwrites live
-- identifiers or URLs.
insert into review_publication_editions (
  id, series, title, edition_order, papermark_document_id,
  papermark_dataroom_id, secure_link_id, secure_link_url,
  secure_link_document_id, secure_link_verified_at, publication_type,
  description, frequency, audience, publication_state, is_latest,
  last_synced_at, created_at, updated_at
)
select ri.id, ri.slot_key, d.title, coalesce(d.edition_date::text, ''),
       ri.papermark_document_id, ri.papermark_dataroom_id,
       ri.secure_link_id, ri.secure_link_url, ri.secure_link_document_id,
       ri.secure_link_verified_at, ri.publication_type, ri.description,
       ri.frequency, ri.audience, 'published', true, ri.last_synced_at,
       ri.created_at, ri.updated_at
from complimentary_review_items ri
join documents d on d.id = ri.publication_id
where ri.slot_key in ('MIN', 'AIU', 'PLM')
  and nullif(ri.papermark_document_id, '') is not null
on conflict (papermark_document_id) do nothing;

-- Backfill every discovered historical/pending document, including the real
-- August MIN identifiers already recorded by sync. No document/link id is
-- guessed. A candidate matching a live row is linked to it; all others remain
-- reviewable drafts and therefore cannot become public accidentally.
insert into review_publication_editions (
  series, title, edition_date, edition_order, papermark_document_id,
  papermark_dataroom_id, sync_candidate_id, sync_version_key,
  first_seen_at, last_synced_at, publication_state, is_latest
)
select c.detected_series,
       coalesce(nullif(c.clean_title, ''), c.raw_filename),
       case when c.detected_edition_date ~ '^\d{4}-\d{2}-\d{2}$'
            then c.detected_edition_date::date else null end,
       coalesce(c.detected_edition_date, c.version_key, ''),
       c.papermark_document_id, c.papermark_dataroom_id, c.id,
       c.version_key, c.first_seen_at, c.last_seen_at, 'draft', false
from review_sync_candidates c
where c.detected_series in ('MIN', 'AIU', 'PLM')
on conflict (papermark_document_id) do nothing;

update review_publication_editions e
set sync_candidate_id = c.id,
    sync_version_key = c.version_key,
    first_seen_at = c.first_seen_at,
    last_synced_at = c.last_seen_at
from review_sync_candidates c
where e.papermark_document_id = c.papermark_document_id
  and e.sync_candidate_id is null;

-- The August document is intentionally not given a guessed or reused URL by
-- SQL. Its existing synced document id is now a draft edition; Admin's
-- "Recover existing August PDF" workflow creates and API-verifies a fresh
-- policy-compliant link before atomically publishing it as non-latest.
insert into app_settings (key, value)
values ('review_august_min_recovery_status', 'required')
on conflict (key) do nothing;

-- The lock serialises promotions for a series. Validation and both updates are
-- one database transaction, so a failed candidate leaves the former latest
-- edition completely unchanged.
create or replace function promote_review_publication_edition(target_id uuid)
returns void language plpgsql as $$
declare target review_publication_editions%rowtype;
begin
  select * into target from review_publication_editions
  where id = target_id for update;
  if not found then raise exception 'Edition not found'; end if;
  perform pg_advisory_xact_lock(hashtext('review-edition:' || target.series));
  if target.secure_link_id is null
     or target.secure_link_url = ''
     or target.secure_link_verified_at is null
     or target.secure_link_document_id is distinct from target.papermark_document_id then
    raise exception 'Edition link is not verified for the exact document';
  end if;
  update review_publication_editions set is_latest = false, updated_at = now()
  where series = target.series and is_latest and id <> target.id;
  update review_publication_editions
  set publication_state = 'published', is_latest = true, updated_at = now()
  where id = target.id;
end $$;

commit;
