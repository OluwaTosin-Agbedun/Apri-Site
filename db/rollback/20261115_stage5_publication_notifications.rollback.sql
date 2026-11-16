-- Prefer an application rollback with these additive tables left in place.
-- This destructive rollback is allowed only before the feature has been used.
begin;
set local lock_timeout='5s';
do $$
begin
  if to_regclass('public.publication_notice_settings') is not null then
    if exists(select 1 from publication_notice_settings where enabled or baseline_at is not null)
      or exists(select 1 from publication_notice_events)
      or exists(select 1 from publication_notice_jobs)
      or exists(select 1 from publication_notice_preferences)
      or exists(select 1 from publication_notice_audit)
      or exists(select 1 from publication_notice_seen) then
      raise exception 'Publication alerts have been used. Pause sending and roll back the application; retain notification history and preferences.';
    end if;
  end if;
end $$;
drop trigger if exists publication_notice_capture on documents;
drop function if exists capture_publication_notice();
drop function if exists publication_notice_access_fence(uuid,uuid);
drop table if exists publication_notice_jobs;
drop table if exists publication_notice_events;
drop table if exists publication_notice_preferences;
drop table if exists publication_notice_seen;
drop table if exists publication_notice_audit;
drop table if exists publication_notice_settings;
-- paid_release_state and paid_release_changed_by belong to earlier features.
commit;
