-- Rolls back db/migrations/20260930_subscription_activation.sql.
--
-- Deploy the previous code first. Subscribers keep their records, status and
-- access; only the link to the request that created them is dropped.

begin;
set local lock_timeout = '5s';
alter table review_subscription_requests
  drop column if exists requester_confirmed_at,
  drop column if exists submitted_via;
drop index if exists subscribers_subscription_request_idx;
alter table subscribers drop column if exists subscription_request_id;
commit;
