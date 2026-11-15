-- Rollback for db/migrations/20261114_publication_catalogue.sql
--
-- NOT a migration: never run this as part of applying migrations. It exists
-- only to undo 20261114, and refuses whenever that would lose data or leave a
-- row the earlier schema cannot hold.
--
-- What it does:
--
--  * puts back the earlier documents.series rule (no OTHER) and the earlier
--    Complimentary Review rule (MIN, AIU, PLM only);
--  * drops publication_category_folders and publication_categories, and the
--    "folders seeded" marker in app_settings.
--  * leaves every publication, edition, plan, exception, recipient, Papermark
--    link and Data Room document as it is.
--
-- It refuses (and changes nothing) while any of these exist, naming which:
--
--  * a publication record whose series is OTHER;
--  * a Complimentary Review edition filed under AEO, QIB or OTHER;
--  * a folder mapping an owner added or re-pointed (anything not in the
--    default seed), or a category whose label, card label, position, active
--    flag or other names an owner changed.
--
-- Reset those by hand first (Admin -> Publication Categories and the edition
-- or record concerned), or restore the Neon branch taken before the migration.
-- After it runs, the site uses the built-in defaults in
-- src/lib/publication-catalogue.ts, as it did before the migration was applied.
-- A default mapping the owner removed is not a reason to refuse: removing it
-- again after a re-run is all it takes.
--
--   psql "<connection string>" -v ON_ERROR_STOP=1 -f db/rollback/20261114_publication_catalogue.rollback.sql

begin;

set local lock_timeout = '5s';

-- The catalogue tables are read with EXECUTE inside a separate IF: PL/pgSQL
-- plans a whole IF condition at once, so "to_regclass(...) is not null and
-- exists (select ... from the_table)" fails when the table is already gone.
-- That keeps this script safe to run a second time (it then changes nothing).
do $$
declare
  found boolean;
begin
  if exists (select 1 from documents where series = 'OTHER') then
    raise exception 'Refusing to roll back: a publication record has series OTHER, which the earlier schema cannot hold. Change its series first.';
  end if;

  if to_regclass('public.review_publication_editions') is not null then
    execute $q$select exists (select 1 from review_publication_editions where series in ('AEO', 'QIB', 'OTHER'))$q$ into found;
    if found then
      raise exception 'Refusing to roll back: a Complimentary Review edition is filed under AEO, QIB or OTHER. Re-file or remove it first.';
    end if;
  end if;

  if to_regclass('public.publication_category_folders') is not null then
    execute $q$
      select exists (
        select 1 from publication_category_folders f
        where (f.folder_slug, f.category_code) not in (values
          ('monthly-intelligence-notes', 'MIN'),
          ('monthly-intelligence-note', 'MIN'),
          ('athena-intelligence-updates', 'AIU'),
          ('political-landscape-monitor', 'PLM'),
          ('election-and-democratic-governance-monitor', 'AEO'),
          ('election-democratic-governance-monitor', 'AEO'),
          ('election-watch', 'AEO'),
          ('quarterly-intelligence-briefs', 'QIB'),
          ('other-assigned-publications', 'OTHER'))
      )$q$ into found;
    if found then
      raise exception 'Refusing to roll back: an owner added or changed a folder mapping. Remove it in Admin -> Publication Categories first.';
    end if;
  end if;

  if to_regclass('public.publication_categories') is not null then
    execute $q$
      select exists (
        select 1 from publication_categories c
        where (c.code, c.label, c.singular_label, c.sort_order, c.active, c.aliases) not in (values
          ('MIN', 'Monthly Intelligence Notes', 'Monthly Intelligence Note', 10, true, '{}'::text[]),
          ('AIU', 'Athena Intelligence Updates', 'Athena Intelligence Update', 20, true, '{}'::text[]),
          ('PLM', 'Political Landscape Monitor', 'Political Landscape Monitor', 30, true, '{}'::text[]),
          ('AEO', 'Election & Democratic Governance Monitor', 'Election & Democratic Governance Monitor', 40, true, '{"Election Observatory"}'::text[]),
          ('QIB', 'Quarterly Intelligence Briefs', 'Quarterly Intelligence Brief', 50, true, '{}'::text[]),
          ('OTHER', 'Other Assigned Publications', 'Other assigned publication', 60, true, '{}'::text[]),
          ('BP', 'Board Papers', 'Board Paper', 70, false, '{}'::text[]))
      )$q$ into found;
    if found then
      raise exception 'Refusing to roll back: an owner changed a category''s labels, position, active flag or other names. Put them back in Admin -> Publication Categories first.';
    end if;
  end if;
end $$;

alter table documents drop constraint if exists documents_series_check;
alter table documents add constraint documents_series_check
  check (series = '' or series in ('PLM', 'AEO', 'AIU', 'MIN', 'QIB', 'BP')) not valid;
alter table documents validate constraint documents_series_check;

alter table review_publication_editions drop constraint if exists review_publication_editions_series_check;
alter table review_publication_editions add constraint review_publication_editions_series_check
  check (series is null or series in ('MIN', 'AIU', 'PLM')) not valid;
alter table review_publication_editions validate constraint review_publication_editions_series_check;

drop table if exists publication_category_folders;
drop table if exists publication_categories;
delete from app_settings where key = 'publication_catalogue_folders_seeded';

commit;
