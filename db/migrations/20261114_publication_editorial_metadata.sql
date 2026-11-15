-- Publication editorial metadata, controlled tags and approved protected
-- summaries (Admin -> Documents -> a publication record, and Admin ->
-- Publication Tags).
--
-- Additive and idempotent: safe to re-run. Apply it after
-- 20261114_publication_catalogue.sql (filename order). It
--  * adds five optional columns to documents (the publication record), each
--    entered by an editor and never computed or guessed:
--      author_editor           who wrote or edited the edition (free text);
--      covered_period_start,
--      covered_period_end      the period the edition covers (both or neither,
--                              end on or after start);
--      information_cutoff      the date the edition's information runs to;
--      reading_time_minutes    the reading time an editor states (1 to 600);
--    documents.coverage_areas (the public detail page's bullet list) is a
--    different thing and is left exactly as it is;
--  * creates publication_tags, the controlled vocabulary of subjects, sectors
--    and geography (one label per kind, compared without regard to case), and
--    publication_tag_assignments, which tags each publication carries. A tag
--    that is assigned cannot be deleted (on delete restrict): it is retired;
--  * creates publication_summaries, one structured protected summary per
--    publication (What changed, Why it matters, Implications and relevant
--    risks/scenarios, What to watch next, an optional source date and an
--    optional uncertainty note), with a revision number for compare-and-set
--    saves and an exact copy of the text an owner approved. Subscribers see
--    only an approved copy that still equals the saved text.
--
-- It changes no existing row and backfills nothing: every publication starts
-- with no new metadata, no tags and no summary, exactly what readers saw
-- before. No grant, plan, exception, recipient, Papermark link or setting is
-- touched. Papermark synchronisation never writes these columns or tables.
--
-- Until it is applied the site works as before; the publication editor says
-- which fields need it.
--
-- Rollback: db/rollback/20261114_publication_editorial_metadata.rollback.sql
-- (refuses while any saved metadata, tag or summary exists).
--
--   psql "<connection string>" -v ON_ERROR_STOP=1 -f db/migrations/20261114_publication_editorial_metadata.sql
begin;

-- Fail fast rather than queue every read of documents behind a long-running
-- transaction while the columns are added. If it fails on a lock, re-run it.
set local lock_timeout = '5s';

alter table documents add column if not exists author_editor        text;
alter table documents add column if not exists covered_period_start date;
alter table documents add column if not exists covered_period_end   date;
alter table documents add column if not exists information_cutoff   date;
alter table documents add column if not exists reading_time_minutes integer;

-- Constraints are added once (a re-run leaves them as they are).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'documents_author_editor_check'
                 and conrelid = 'documents'::regclass) then
    alter table documents add constraint documents_author_editor_check
      check (author_editor is null or char_length(btrim(author_editor)) between 1 and 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'documents_covered_period_check'
                 and conrelid = 'documents'::regclass) then
    alter table documents add constraint documents_covered_period_check
      check ((covered_period_start is null and covered_period_end is null)
          or (covered_period_start is not null and covered_period_end is not null
              and covered_period_end >= covered_period_start));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'documents_reading_time_check'
                 and conrelid = 'documents'::regclass) then
    alter table documents add constraint documents_reading_time_check
      check (reading_time_minutes is null or reading_time_minutes between 1 and 600);
  end if;
end $$;

create table if not exists publication_tags (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('subject', 'sector', 'geography')),
  label       text not null check (char_length(label) between 1 and 80 and label = btrim(label)),
  active      boolean not null default true,
  created_by  uuid references admins (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_by  uuid references admins (id) on delete set null,
  updated_at  timestamptz not null default now(),
  retired_by  uuid references admins (id) on delete set null,
  retired_at  timestamptz
);

create unique index if not exists publication_tags_kind_label_key
  on publication_tags (kind, lower(label));

create table if not exists publication_tag_assignments (
  publication_id uuid not null references documents (id) on delete cascade,
  tag_id         uuid not null references publication_tags (id) on update restrict on delete restrict,
  assigned_by    uuid references admins (id) on delete set null,
  assigned_at    timestamptz not null default now(),
  primary key (publication_id, tag_id)
);

create index if not exists publication_tag_assignments_tag_idx
  on publication_tag_assignments (tag_id);

create table if not exists publication_summaries (
  publication_id          uuid primary key references documents (id) on delete cascade,
  what_changed            text not null default '' check (char_length(what_changed) <= 4000),
  why_it_matters          text not null default '' check (char_length(why_it_matters) <= 4000),
  implications            text not null default '' check (char_length(implications) <= 4000),
  watch_next              text not null default '' check (char_length(watch_next) <= 4000),
  source_date             date,
  uncertainty             text not null default '' check (char_length(uncertainty) <= 2000),
  revision                bigint not null default 1 check (revision >= 1),
  updated_by              uuid references admins (id) on delete set null,
  updated_at              timestamptz not null default now(),
  approved_fields         jsonb,
  approved_revision       bigint,
  approved_by             uuid references admins (id) on delete set null,
  approved_at             timestamptz,
  approval_removed_reason text check (approval_removed_reason in ('edited', 'withdrawn')),
  approval_removed_by     uuid references admins (id) on delete set null,
  approval_removed_at     timestamptz,
  created_at              timestamptz not null default now(),
  constraint publication_summaries_approval_check
    check ((approved_fields is null) = (approved_at is null))
);

commit;
