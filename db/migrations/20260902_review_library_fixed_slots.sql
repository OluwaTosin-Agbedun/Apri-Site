-- Phase 5: Fixed review slots with per-document secure links
-- Each of the three review slots (MIN, AIU, PLM) gets its own Papermark
-- document-level link URL, stored separately from subscriber link tables.

-- slot_key identifies which fixed slot a row represents
alter table complimentary_review_items
  add column if not exists slot_key text not null default '';

-- secure_link_url: the Papermark document-level URL for this slot's PDF
alter table complimentary_review_items
  add column if not exists secure_link_url text not null default '';

-- pending version tracking: when sync detects a newer edition, it is stored
-- here until the owner confirms "Make current"
alter table complimentary_review_items
  add column if not exists pending_papermark_document_id text;
alter table complimentary_review_items
  add column if not exists pending_clean_title text;
alter table complimentary_review_items
  add column if not exists pending_version_key text;
alter table complimentary_review_items
  add column if not exists pending_detected_at timestamptz;

-- each slot_key must be unique (only one MIN, one AIU, one PLM)
create unique index if not exists cri_slot_key_idx
  on complimentary_review_items (slot_key) where slot_key <> '';
