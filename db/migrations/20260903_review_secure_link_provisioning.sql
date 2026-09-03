-- Phase 5.1: API-provisioned secure review links
--
-- The three review PDFs live inside the Papermark Complimentary Review Data
-- Room, so the owner cannot easily obtain per-document share links by hand.
-- These columns record what the Papermark API returned when a link was created
-- for a slot, so the app can verify a stored link still targets the intended
-- document rather than trusting a pasted URL.
--
-- All columns are nullable and additive. No existing row is deleted or
-- rewritten; a slot that already has a manually pasted secure_link_url keeps
-- it and simply has no link id until the owner verifies or recreates it.

-- The Papermark link id, needed to GET, PATCH or revoke exactly this link.
alter table complimentary_review_items
  add column if not exists secure_link_id text;

-- The Papermark document id the link was created against. Verification
-- compares this to the slot's current papermark_document_id, so a link left
-- over from a previous edition can never be mistaken for a current one.
alter table complimentary_review_items
  add column if not exists secure_link_document_id text;

-- When the API last confirmed the link targets that document. Null means
-- unverified: the public library treats such a slot as not ready.
alter table complimentary_review_items
  add column if not exists secure_link_verified_at timestamptz;

-- The same three facts for a pending new edition. A pending link is prepared
-- and verified before "Make current" is offered, and is only promoted into the
-- live columns on owner confirmation, so preparing it never changes the public
-- page.
alter table complimentary_review_items
  add column if not exists pending_secure_link_id text;
alter table complimentary_review_items
  add column if not exists pending_secure_link_url text;
alter table complimentary_review_items
  add column if not exists pending_secure_link_document_id text;
alter table complimentary_review_items
  add column if not exists pending_secure_link_verified_at timestamptz;

-- Look-ups by link id happen when reconciling or revoking a link. Partial so
-- the many rows with no link id stay out of the index.
create index if not exists cri_secure_link_id_idx
  on complimentary_review_items (secure_link_id)
  where secure_link_id is not null;
