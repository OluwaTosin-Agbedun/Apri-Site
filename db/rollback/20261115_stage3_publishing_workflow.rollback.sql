-- Prefer rolling back the application while preserving this additive history.
-- Destructive rollback is permitted only before anybody starts a workflow.
begin;
set local lock_timeout='5s';
do $$ begin
  if to_regclass('public.publication_workflows') is not null then
    if exists(select 1 from publication_workflows) or exists(select 1 from publication_families)
      or exists(select 1 from publication_workflow_events) then
      raise exception 'Publishing workflow has been used. Retain its immutable history and roll back the application instead.';
    end if;
  end if;
end $$;
drop trigger if exists review_paid_editorial_change on documents;
drop trigger if exists review_complimentary_editorial_change on review_publication_editions;
drop trigger if exists editorial_paid_access_state on documents;
drop trigger if exists editorial_review_access_state on review_publication_editions;
drop function if exists record_editorial_access_state();
drop function if exists advance_publication_family(uuid);
drop function if exists invalidate_publication_review();
drop function if exists assert_publication_editorial_approval(text,uuid,uuid,bigint);
drop function if exists assert_correction_inputs(text,uuid,uuid,text,text,jsonb,jsonb);
drop function if exists assert_notice_verification(uuid,uuid,bigint);
drop function if exists publication_audience_snapshot(text,uuid);
drop function if exists publication_content_hash(text,uuid);
drop function if exists publication_content_snapshot(text,uuid);
drop table if exists publication_legacy_notice_proofs;
drop table if exists publication_version_retirements;
drop table if exists publication_correction_access;
alter table if exists publication_families drop constraint if exists publication_families_current_fkey;
drop table if exists publication_workflow_events;
drop table if exists publication_workflows;
drop table if exists publication_families;
drop function if exists protect_publication_history();
commit;
