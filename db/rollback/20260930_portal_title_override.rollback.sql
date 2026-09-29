-- Rolls back db/migrations/20260930_portal_title_override.sql.
--
-- Deploy the previous code first. Dropping the column forgets which editorial
-- titles were marked as overrides; the portal then shows Papermark names for
-- every document, which is also what the code does before the migration.

begin;
set local lock_timeout = '5s';
alter table documents drop column if exists portal_title_override;
commit;
