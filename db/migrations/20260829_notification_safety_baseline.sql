-- Follow-up migration: notification-safety baseline guard.
--
-- The engagement-dashboard migration (20260828) was applied before the
-- notification_eligible column existed. This migration adds it and marks
-- every document already in the table as ineligible, so the first cron
-- run after redeployment does not treat the entire library as new and
-- email every active subscriber.
--
-- Idempotent: safe to run more than once. The DO block checks whether
-- the column exists before adding it, and the baseline UPDATE only runs
-- on the first execution (when the column is first created). A repeated
-- run is a no-op.

do $$
declare col_exists boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_name = 'papermark_dataroom_documents'
      and column_name = 'notification_eligible'
  ) into col_exists;

  if not col_exists then
    alter table papermark_dataroom_documents
      add column notification_eligible boolean not null default true;

    update papermark_dataroom_documents set notification_eligible = false;
  end if;
end $$;
