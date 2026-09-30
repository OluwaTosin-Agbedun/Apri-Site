-- Rollback for 20261004_paid_release_and_access_health.sql.
--
-- Removes only what that migration added. Run it only after deploying code
-- that no longer reads these columns and tables: the release decisions,
-- period corrections and exception history recorded since are lost.

drop index if exists subscriber_access_reconciliations_due_idx;
alter table subscriber_access_reconciliations drop constraint if exists subscriber_access_reconciliations_outcome_check;
alter table subscriber_access_reconciliations
  drop column if exists outcome,
  drop column if exists expected,
  drop column if exists verified,
  drop column if exists missing,
  drop column if exists excluded,
  drop column if exists unresolved,
  drop column if exists failed,
  drop column if exists summary,
  drop column if exists trigger,
  drop column if exists attempts,
  drop column if exists next_attempt_at,
  drop column if exists last_verified_at,
  drop column if exists lease_token,
  drop column if exists lease_expires_at,
  drop column if exists updated_at;

drop table if exists subscriber_exception_events;
drop table if exists subscriber_period_events;

alter table subscriber_subscription_periods
  drop column if exists voided_at,
  drop column if exists voided_by,
  drop column if exists void_reason,
  drop column if exists created_by,
  drop column if exists note;

drop table if exists publication_release_events;
alter table documents drop constraint if exists documents_paid_release_state_check;
alter table documents
  drop column if exists paid_release_state,
  drop column if exists paid_release_changed_at,
  drop column if exists paid_release_changed_by,
  drop column if exists paid_release_reason;
