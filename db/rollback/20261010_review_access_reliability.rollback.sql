-- Rolls back 20261010_review_access_reliability.sql. Review emails keep
-- sending; only the owner-only record of their outcomes is removed. Reader
-- rooms keep working; routing falls back to the confirmed state alone.
drop table if exists review_email_attempts;
do $$
begin
  if to_regclass('public.review_reader_rooms') is not null then
    alter table review_reader_rooms drop column if exists lease_until;
    alter table review_reader_rooms drop column if exists verified_editions;
  end if;
end $$;
