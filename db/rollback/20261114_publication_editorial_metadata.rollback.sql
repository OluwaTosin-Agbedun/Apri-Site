-- Rollback for db/migrations/20261114_publication_editorial_metadata.sql
--
-- NOT a migration: never run this as part of applying migrations. It exists
-- only to undo 20261114_publication_editorial_metadata, and refuses whenever
-- that would discard anything an editor or owner saved.
--
-- Deploy the previous code first. What it does:
--
--  * drops publication_summaries, publication_tag_assignments and
--    publication_tags;
--  * drops documents.author_editor, covered_period_start, covered_period_end,
--    information_cutoff and reading_time_minutes, and their checks;
--  * leaves every publication record's other fields, and every edition, plan,
--    exception, recipient, Papermark link and Data Room document, as it is.
--
-- It refuses (and changes nothing) while any of these exist, naming which:
--
--  * a saved protected summary (draft or approved) in publication_summaries;
--  * a tag in the vocabulary, or a tag assigned to a publication;
--  * a publication record with an author/editor, covered period, information
--    cut-off or reading time.
--
-- Export and review them first, for example
--   select * from publication_summaries;
--   select t.kind, t.label, t.active, count(a.*) from publication_tags t
--     left join publication_tag_assignments a on a.tag_id = t.id group by 1, 2, 3;
--   select id, slug, author_editor, covered_period_start, covered_period_end,
--          information_cutoff, reading_time_minutes from documents
--    where author_editor is not null or covered_period_start is not null
--       or information_cutoff is not null or reading_time_minutes is not null;
-- then clear them deliberately, or restore the Neon branch taken before the
-- migration. After it runs, the subscriber library shows no metadata, tags or
-- summaries, exactly as before the migration was applied.
--
--   psql "<connection string>" -v ON_ERROR_STOP=1 -f db/rollback/20261114_publication_editorial_metadata.rollback.sql

begin;

set local lock_timeout = '5s';

-- Each check reads a table or column only once it is known to exist (nested
-- IFs and dynamic SQL: PL/pgSQL plans a whole IF condition at once), so the
-- rollback can be re-run after it has succeeded, and changes nothing then.
do $$
declare
  saved boolean;
  col text;
begin
  if to_regclass('public.publication_summaries') is not null then
    execute 'select exists (select 1 from publication_summaries)' into saved;
    if saved then
      raise exception 'Refusing to roll back: saved protected summaries exist (publication_summaries). Export and review them before removing this migration.';
    end if;
  end if;

  if to_regclass('public.publication_tag_assignments') is not null then
    execute 'select exists (select 1 from publication_tag_assignments)' into saved;
    if saved then
      raise exception 'Refusing to roll back: publications carry tags (publication_tag_assignments). Export and review them before removing this migration.';
    end if;
  end if;

  if to_regclass('public.publication_tags') is not null then
    execute 'select exists (select 1 from publication_tags)' into saved;
    if saved then
      raise exception 'Refusing to roll back: the tag vocabulary is not empty (publication_tags). Export and review it before removing this migration.';
    end if;
  end if;

  for col in
    select c.column_name::text from information_schema.columns c
    where c.table_schema = current_schema() and c.table_name = 'documents'
      and c.column_name in ('author_editor', 'covered_period_start', 'covered_period_end', 'information_cutoff', 'reading_time_minutes')
  loop
    execute format('select exists (select 1 from documents where %I is not null)', col) into saved;
    if saved then
      raise exception 'Refusing to roll back: publication records hold an author/editor, covered period, information cut-off or reading time (documents.%). Export and review them before removing this migration.', col;
    end if;
  end loop;
end $$;

drop table if exists publication_summaries;
drop table if exists publication_tag_assignments;
drop table if exists publication_tags;

alter table documents drop constraint if exists documents_author_editor_check;
alter table documents drop constraint if exists documents_covered_period_check;
alter table documents drop constraint if exists documents_reading_time_check;

alter table documents drop column if exists author_editor;
alter table documents drop column if exists covered_period_start;
alter table documents drop column if exists covered_period_end;
alter table documents drop column if exists information_cutoff;
alter table documents drop column if exists reading_time_minutes;

commit;
