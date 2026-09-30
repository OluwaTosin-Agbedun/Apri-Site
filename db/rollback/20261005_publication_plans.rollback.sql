-- Rollback for 20261005_publication_plans.sql.
--
-- Removes the plan ticks and the automatic "kept from before" exceptions.
-- Run only after deploying code that no longer reads publication_plans. The
-- administrator column on exceptions stays nullable (tightening it again
-- would fail while automatic rows exist; they are deleted first here).

delete from subscriber_exception_events
where administrator_id is null
  and reason = 'Kept from before the plan-based rules: this subscriber already had this edition';
delete from subscriber_publication_exceptions
where administrator_id is null
  and reason = 'Kept from before the plan-based rules: this subscriber already had this edition';
drop table if exists publication_plans;
