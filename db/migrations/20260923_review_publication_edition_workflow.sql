-- Complete the versioned Review Library workflow without replacing any edition
-- or Papermark link created by the original versioning migration.
begin;

alter table review_publication_editions
  add column if not exists edition_label text not null default '',
  add column if not exists edition_sort_key text not null default '',
  add column if not exists papermark_filename text not null default '',
  add column if not exists num_pages integer,
  add column if not exists owner_edited_fields text[] not null default '{}';

alter table review_publication_editions drop constraint if exists review_publication_editions_series_check;
alter table review_publication_editions alter column series drop not null;
alter table review_publication_editions add constraint review_publication_editions_series_check
  check (series is null or series in ('MIN', 'AIU', 'PLM')) not valid;
alter table review_publication_editions validate constraint review_publication_editions_series_check;

alter table review_publication_editions drop constraint if exists review_publication_editions_publication_state_check;
alter table review_publication_editions add constraint review_publication_editions_publication_state_check
  check (publication_state in ('draft', 'published', 'ignored')) not valid;
alter table review_publication_editions validate constraint review_publication_editions_publication_state_check;

update review_publication_editions e set
  papermark_filename = coalesce(nullif(e.papermark_filename, ''), c.raw_filename),
  num_pages = coalesce(e.num_pages, c.num_pages),
  papermark_dataroom_id = coalesce(e.papermark_dataroom_id, c.papermark_dataroom_id),
  last_synced_at = coalesce(c.last_seen_at, e.last_synced_at)
from review_sync_candidates c
where c.papermark_document_id = e.papermark_document_id;

-- Month/issue labels are display values; sort keys deliberately avoid invented days.
update review_publication_editions set
  edition_label = case
    when series = 'MIN' and (title ilike '%september%2026%' or papermark_filename ilike '%september%2026%') then 'September 2026'
    when series = 'MIN' and (title ilike '%august%2026%' or papermark_filename ilike '%august%2026%') then 'August 2026'
    when series = 'AIU' and (title ilike '%issue%001%' or papermark_filename ilike '%issue%001%') then 'Issue 001 (2026)'
    when series = 'PLM' and (title ilike '%issue%01%' or papermark_filename ilike '%issue%01%') then 'Issue 01 · July 2026'
    else edition_label end,
  edition_sort_key = case
    when series = 'MIN' and (title ilike '%september%2026%' or papermark_filename ilike '%september%2026%') then '2026-09'
    when series = 'MIN' and (title ilike '%august%2026%' or papermark_filename ilike '%august%2026%') then '2026-08'
    when series = 'AIU' and (title ilike '%issue%001%' or papermark_filename ilike '%issue%001%') then '2026-001'
    when series = 'PLM' and (title ilike '%issue%01%' or papermark_filename ilike '%issue%01%') then '2026-07-01'
    else coalesce(nullif(edition_sort_key, ''), nullif(edition_order, ''), '') end
where edition_label = '' or edition_sort_key = '';

-- Fill only missing August card values. Existing identifiers, state, latest flag,
-- policy, verification time and URLs are intentionally absent from this update.
update review_publication_editions set
  title = case when title = '' or title = papermark_filename then 'Monthly Intelligence Note | August 2026' else title end,
  publication_type = case when publication_type = '' then 'Monthly Intelligence Note' else publication_type end,
  description = case when description = '' then 'A monthly assessment of Nigeria’s political, regulatory and political-economy operating environment, highlighting significant developments, implications and issues organisations should monitor when making strategic and operating decisions.' else description end,
  frequency = case when frequency = '' then 'Monthly' else frequency end,
  audience = case when audience = '' then 'APRI subscribers and prospective readers' else audience end
where series = 'MIN' and edition_label = 'August 2026';

create index if not exists review_publication_editions_public_order_idx
  on review_publication_editions (series, is_latest desc, edition_sort_key desc, created_at desc, id desc)
  where publication_state = 'published';

commit;
