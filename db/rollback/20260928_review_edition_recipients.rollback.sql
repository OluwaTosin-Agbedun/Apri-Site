-- Rollback for db/migrations/20260928_review_edition_recipients.sql
--
-- NOT a migration: never run this as part of applying migrations. It exists
-- for one situation only -- the per-edition migration has been applied and
-- must be undone -- and it is written to refuse whenever that would lose data.
--
-- What it does:
--
--  * Drops review_edition_recipients and the six columns the migration added
--    to review_publication_editions. Nothing else.
--  * Leaves Papermark alone. Every link keeps whatever allow list it has now,
--    so no reader gains or loses access by running this.
--
-- What to know before running it:
--
--  * It refuses (and changes nothing) if any edition has been adopted or has
--    recipients of its own, because those rows are APRI's only record of who
--    was granted what. If you are past that point, restore the Neon branch
--    taken before the migration instead (see the production procedure).
--  * The deployed code copes with the columns being absent, but each server
--    instance remembers a migration it has already seen. Redeploy the current
--    deployment in Vercel straight after running this so every instance
--    re-checks.
--
-- Run with:
--
--   psql "<connection string>" -v ON_ERROR_STOP=1 -f db/rollback/20260928_review_edition_recipients.rollback.sql

begin;

set local lock_timeout = '5s';

do $$
begin
  if to_regclass('review_edition_recipients') is not null
     and exists (select 1 from review_edition_recipients) then
    raise exception 'Refusing to roll back: review_edition_recipients holds per-edition grants. Restore the pre-migration Neon branch instead.';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = current_schema()
      and table_name = 'review_publication_editions'
      and column_name = 'recipients_adopted_at'
  ) and exists (
    select 1 from review_publication_editions where recipients_adopted_at is not null
  ) then
    raise exception 'Refusing to roll back: at least one edition has been adopted. Restore the pre-migration Neon branch instead.';
  end if;
end $$;

drop table if exists review_edition_recipients;

alter table review_publication_editions
  drop column if exists recipients_adopted_by,
  drop column if exists recipients_adopted_at,
  drop column if exists recipients_applied_at,
  drop column if exists recipients_verified_at,
  drop column if exists recipients_verified_hash,
  drop column if exists recipient_mode;

commit;
