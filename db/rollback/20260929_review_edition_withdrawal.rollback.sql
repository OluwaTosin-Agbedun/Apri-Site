-- Rollback for db/migrations/20260929_review_edition_withdrawal.sql
--
-- NOT a migration: never run this as part of applying migrations. It exists
-- only to undo 20260929, and refuses whenever that would lose a withdrawal.
--
-- What it does:
--
--  * restores the publication states to draft / published / ignored;
--  * drops the featured choice, the withdrawal columns, review_edition_events
--    and the functions 20260929 added, and restores the earlier
--    promote_review_publication_edition;
--  * leaves Papermark, recipients, subscribers and Data Rooms alone.
--
-- What to know before running it:
--
--  * It refuses if any edition has ever been withdrawn: the earlier schema
--    cannot represent that, and the record of the revoked link would be lost.
--    Restore the Neon branch taken before the migration instead.
--  * Which edition each series offers is lost; the homepage goes back to
--    offering each series' latest published edition. The feature and
--    unfeature history in review_edition_events is lost with the table.
--  * Redeploy the current deployment in Vercel straight after running this,
--    so every server instance re-checks the schema.
--
--   psql "<connection string>" -v ON_ERROR_STOP=1 -f db/rollback/20260929_review_edition_withdrawal.rollback.sql

begin;

set local lock_timeout = '5s';

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = current_schema()
      and table_name = 'review_publication_editions'
      and column_name = 'withdrawal_link_id'
  ) and exists (
    select 1 from review_publication_editions
    where publication_state = 'withdrawn' or withdrawal_link_id is not null
  ) then
    raise exception 'Refusing to roll back: an edition has been withdrawn. Restore the pre-migration Neon branch instead.';
  end if;
end $$;

drop function if exists begin_review_edition_withdrawal(uuid, text, uuid, uuid);
drop function if exists complete_review_edition_withdrawal(uuid, text, uuid);
drop function if exists feature_review_publication_edition(uuid, uuid);
drop function if exists promote_review_publication_edition(uuid, uuid);

-- The promote function exactly as 20260922 defined it.
create or replace function promote_review_publication_edition(target_id uuid)
returns void language plpgsql as $$
declare target review_publication_editions%rowtype;
begin
  select * into target from review_publication_editions
  where id = target_id for update;
  if not found then raise exception 'Edition not found'; end if;
  perform pg_advisory_xact_lock(hashtext('review-edition:' || target.series));
  if target.secure_link_id is null
     or target.secure_link_url = ''
     or target.secure_link_verified_at is null
     or target.secure_link_document_id is distinct from target.papermark_document_id then
    raise exception 'Edition link is not verified for the exact document';
  end if;
  update review_publication_editions set is_latest = false, updated_at = now()
  where series = target.series and is_latest and id <> target.id;
  update review_publication_editions
  set publication_state = 'published', is_latest = true, updated_at = now()
  where id = target.id;
end $$;

drop table if exists review_edition_events;
drop function if exists reject_review_edition_event_mutation();

alter table review_publication_editions
  drop constraint if exists review_editions_withdrawal_consistency,
  drop constraint if exists review_editions_withdrawal_state_check,
  drop constraint if exists review_editions_one_featured_per_series,
  drop constraint if exists review_editions_featured_is_published;

alter table review_publication_editions
  drop column if exists reoffered_by,
  drop column if exists reoffered_at,
  drop column if exists withdrawn_by,
  drop column if exists withdrawn_at,
  drop column if exists withdrawal_requested_by,
  drop column if exists withdrawal_requested_at,
  drop column if exists withdrawal_link_id,
  drop column if exists withdrawal_state,
  drop column if exists complimentary_featured;

alter table review_publication_editions
  drop constraint if exists review_publication_editions_publication_state_check;
alter table review_publication_editions
  add constraint review_publication_editions_publication_state_check
  check (publication_state in ('draft', 'published', 'ignored'));

commit;
