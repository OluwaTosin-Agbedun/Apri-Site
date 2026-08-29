-- Per-subscriber per-document Papermark share links.
--
-- The Data Room link gives a subscriber access to an entire room, but
-- Papermark's viewer does not support deep-linking to one document inside a
-- room via query parameters. A `?documentId=` appended to a Data Room share
-- URL is not a documented mechanism and produces a broken viewer.
--
-- This table stores one Papermark document-target share link per subscriber per
-- underlying Papermark document. The link is created via `POST /v1/links` with
-- `document_id` (not `dataroom_id`), which gives Papermark a real target and
-- produces a working embed, viewer and download.
--
-- Idempotent: safe to run more than once.

create table if not exists papermark_subscriber_document_links (
  id                     uuid primary key default gen_random_uuid(),
  subscriber_id          uuid not null references subscribers (id) on delete cascade,
  papermark_document_id  text not null,
  papermark_link_id      text not null,
  link_url               text not null,

  assigned_name          text not null default '',
  assigned_email         text not null default '',
  watermark_enabled      boolean not null default true,
  watermark_text         text not null default '',
  allow_download         boolean not null default true,
  screenshot_protection  boolean not null default true,
  expires_at             timestamptz,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  revoked_at             timestamptz,
  revoke_state           text not null default 'live',

  constraint papermark_sub_doc_links_revoke_check
    check (revoke_state in ('live', 'revoked'))
);

-- One live link per subscriber per document.
create unique index if not exists papermark_sub_doc_links_live_key
  on papermark_subscriber_document_links (subscriber_id, papermark_document_id)
  where revoke_state = 'live';

-- A Papermark link is never attached to two records.
create unique index if not exists papermark_sub_doc_links_pm_key
  on papermark_subscriber_document_links (papermark_link_id);

-- Bulk operations by subscriber (revoke-all, expiry update).
create index if not exists papermark_sub_doc_links_subscriber_idx
  on papermark_subscriber_document_links (subscriber_id)
  where revoke_state = 'live';

-- Store folder_path alongside folder_id so category classification can use the
-- human-readable folder name from Papermark rather than relying on series codes
-- in filenames.
alter table papermark_dataroom_documents
  add column if not exists folder_path text;
