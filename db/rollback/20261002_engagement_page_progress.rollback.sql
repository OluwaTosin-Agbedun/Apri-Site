-- Rolls back db/migrations/20261002_engagement_page_progress.sql.
--
-- Deploy the previous code first. Dropping these forgets the collected page
-- evidence and version cache; views, downloads and attributions are kept.

begin;
set local lock_timeout = '5s';
drop table if exists document_view_pages;
drop table if exists papermark_document_versions;
drop index if exists document_views_enrichment_due_idx;
alter table document_views drop constraint if exists document_views_page_progress_check;
alter table document_views drop constraint if exists document_views_enrichment_state_check;
alter table document_views
  drop column if exists view_type,
  drop column if exists document_version_id,
  drop column if exists document_version_number,
  drop column if exists total_pages,
  drop column if exists pages_viewed,
  drop column if exists furthest_page,
  drop column if exists enrichment_state,
  drop column if exists enrichment_attempts,
  drop column if exists enrichment_error,
  drop column if exists next_enrichment_at;
commit;
