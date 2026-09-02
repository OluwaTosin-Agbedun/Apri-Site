-- Complimentary Review Library — Phase 3: Data Room synchronisation
--
-- Adds the review_sync_candidates table to record every document seen in
-- the Complimentary Review Data Room, plus tracking columns on the
-- existing complimentary_review_items table for Papermark mapping and
-- owner-edit preservation.
--
-- Additive only. Does not touch paid-subscriber Data Room tables,
-- subscriber links, watermarks, or permissions.

-- Settings: the Papermark Data Room ID (separate from the public URL)
insert into app_settings (key, value)
values ('review_library_papermark_dataroom_id', '')
on conflict (key) do nothing;

insert into app_settings (key, value)
values ('review_library_last_sync_at', '')
on conflict (key) do nothing;

insert into app_settings (key, value)
values ('review_library_last_sync_result', '')
on conflict (key) do nothing;

-- Candidates: every document discovered in the Complimentary Review Data Room.
-- Each row is one Papermark document. Repeated syncs upsert by papermark_document_id.
create table if not exists review_sync_candidates (
  id                      uuid        primary key default gen_random_uuid(),
  papermark_document_id   text        not null,
  papermark_dataroom_id   text        not null,
  raw_filename            text        not null default '',
  clean_title             text        not null default '',
  num_pages               integer,
  folder_path             text,
  papermark_created_at    timestamptz,
  papermark_updated_at    timestamptz,
  detected_series         text        not null default '',
  detected_edition_date   text,
  version_key             text        not null default '',
  sync_status             text        not null default 'pending',
  first_seen_at           timestamptz not null default now(),
  last_seen_at            timestamptz not null default now(),
  is_present              boolean     not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create unique index if not exists review_sync_candidates_pmk_doc_key
  on review_sync_candidates (papermark_document_id);

create index if not exists review_sync_candidates_series_idx
  on review_sync_candidates (detected_series, sync_status);

-- Tracking columns on existing review items for Papermark mapping
alter table complimentary_review_items
  add column if not exists papermark_document_id text;

alter table complimentary_review_items
  add column if not exists papermark_dataroom_id text;

alter table complimentary_review_items
  add column if not exists last_synced_at timestamptz;

alter table complimentary_review_items
  add column if not exists owner_edited_fields text[] not null default '{}';
