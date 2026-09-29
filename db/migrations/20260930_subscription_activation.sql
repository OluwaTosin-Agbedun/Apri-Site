-- Individual and Professional subscription requests: link each activated
-- subscriber to the request that paid for them.
--
-- Activating a request creates one subscriber record per named person. This
-- column is how those records are told apart from every other subscriber:
--
--   * a retry recognises the people it already created instead of stopping
--     at them as "an existing active subscriber", and never creates a second
--     record, link or welcome email for anyone;
--   * activating one of them from the Subscribers page is held to the same
--     gate -- a signed agreement and a confirmed payment -- as activating
--     the request;
--   * lead source and UTM attribution follow the request's prospect through
--     to the subscriber.
--
-- Additive and idempotent. Existing subscribers are untouched: the column
-- starts empty for every row, and nothing reads it for a subscriber that did
-- not come from a request. Safe to run while the site is live; activating a
-- request is refused, with a message saying so, until it has run.
--
--   psql "<connection string>" -v ON_ERROR_STOP=1 -f db/migrations/20260930_subscription_activation.sql

begin;

set local lock_timeout = '5s';

alter table subscribers
  add column if not exists subscription_request_id uuid
    references review_subscription_requests (id) on delete restrict;

create index if not exists subscribers_subscription_request_idx
  on subscribers (subscription_request_id)
  where subscription_request_id is not null;

-- Where a request came from, and when its requester confirmed it.
--
-- Until now every request came from the Review Library, from a session that
-- only a verified prospect can hold, so existing rows default to
-- 'review_library'. A request made from the public Subscription Access page
-- has no such session: anyone could type any email into it. It counts as the
-- requester's only once they open the confirmation link sent to that address,
-- which is what requester_confirmed_at records; activation requires it.

alter table review_subscription_requests
  add column if not exists submitted_via text not null default 'review_library'
    constraint review_subscription_submitted_via_check
    check (submitted_via in ('review_library', 'access_page')),
  add column if not exists requester_confirmed_at timestamptz;

commit;
