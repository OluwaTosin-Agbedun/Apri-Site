-- One authoritative publication catalogue (Admin -> Publication Categories).
--
-- Additive and idempotent: safe to re-run. It
--  * creates publication_categories (labels, order, active flag, aliases for
--    each stored code) and publication_category_folders (which Papermark Data
--    Room folder files a document into which category), seeded from the
--    defaults in src/lib/publication-catalogue.ts;
--  * lets documents.series also be OTHER (an explicit "Other Assigned
--    Publications" decision), and lets a Complimentary Review edition be filed
--    under any catalogue code except BP.
--
-- It changes no existing row: no series is guessed or backfilled, no grant,
-- plan, exception, recipient or Papermark setting is touched. Re-running it
-- keeps every owner edit, and never re-adds a folder mapping an owner removed
-- (the folder seed runs once, recorded in app_settings).
--
-- Rollback: db/rollback/20261114_publication_catalogue.rollback.sql (refuses
-- while anything depends on it).
begin;

-- Fail fast rather than queue every read of documents behind a long-running
-- transaction while the series checks are swapped.
set local lock_timeout = '5s';

create table if not exists publication_categories (
  code           text primary key
                 check (code in ('MIN', 'AIU', 'PLM', 'AEO', 'QIB', 'OTHER', 'BP')),
  label          text not null check (char_length(btrim(label)) between 1 and 80),
  singular_label text not null check (char_length(btrim(singular_label)) between 1 and 80),
  sort_order     integer not null check (sort_order between 0 and 9999),
  active         boolean not null default true,
  aliases        text[] not null default '{}' check (cardinality(aliases) <= 10),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists publication_category_folders (
  folder_slug   text primary key
                check (char_length(folder_slug) <= 120 and folder_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  category_code text not null references publication_categories (code) on update restrict on delete restrict,
  created_at    timestamptz not null default now()
);

create index if not exists publication_category_folders_code_idx
  on publication_category_folders (category_code);

-- Codes are never deleted; existing rows (owner edits) are kept as they are.
insert into publication_categories (code, label, singular_label, sort_order, active, aliases) values
  ('MIN', 'Monthly Intelligence Notes', 'Monthly Intelligence Note', 10, true, '{}'),
  ('AIU', 'Athena Intelligence Updates', 'Athena Intelligence Update', 20, true, '{}'),
  ('PLM', 'Political Landscape Monitor', 'Political Landscape Monitor', 30, true, '{}'),
  ('AEO', 'Election & Democratic Governance Monitor', 'Election & Democratic Governance Monitor', 40, true, '{"Election Observatory"}'),
  ('QIB', 'Quarterly Intelligence Briefs', 'Quarterly Intelligence Brief', 50, true, '{}'),
  ('OTHER', 'Other Assigned Publications', 'Other assigned publication', 60, true, '{}'),
  ('BP', 'Board Papers', 'Board Paper', 70, false, '{}')
on conflict (code) do nothing;

-- The default folder mappings, once. Board Intelligence Updates is deliberately
-- not mapped: an owner decides where it belongs. Papermark spells "&" as "and"
-- in folder paths, so the AEO folder is mapped in both forms.
insert into publication_category_folders (folder_slug, category_code)
select v.folder_slug, v.category_code
from (values
  ('monthly-intelligence-notes', 'MIN'),
  ('monthly-intelligence-note', 'MIN'),
  ('athena-intelligence-updates', 'AIU'),
  ('political-landscape-monitor', 'PLM'),
  ('election-and-democratic-governance-monitor', 'AEO'),
  ('election-democratic-governance-monitor', 'AEO'),
  ('election-watch', 'AEO'),
  ('quarterly-intelligence-briefs', 'QIB'),
  ('other-assigned-publications', 'OTHER')
) as v (folder_slug, category_code)
where not exists (select 1 from app_settings where key = 'publication_catalogue_folders_seeded')
on conflict (folder_slug) do nothing;

insert into app_settings (key, value)
values ('publication_catalogue_folders_seeded', 'true')
on conflict (key) do nothing;

-- documents.series may also be OTHER. Existing values all satisfy the wider rule.
alter table documents drop constraint if exists documents_series_check;
alter table documents add constraint documents_series_check
  check (series = '' or series in ('MIN', 'AIU', 'PLM', 'AEO', 'QIB', 'OTHER', 'BP')) not valid;
alter table documents validate constraint documents_series_check;

-- A Complimentary Review edition may be filed under any catalogue code but BP.
-- The one-offered-edition-per-series exclusion is unchanged.
alter table review_publication_editions drop constraint if exists review_publication_editions_series_check;
alter table review_publication_editions add constraint review_publication_editions_series_check
  check (series is null or series in ('MIN', 'AIU', 'PLM', 'AEO', 'QIB', 'OTHER')) not valid;
alter table review_publication_editions validate constraint review_publication_editions_series_check;

commit;
