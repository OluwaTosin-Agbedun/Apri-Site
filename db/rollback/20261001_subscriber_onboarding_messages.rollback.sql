-- Rolls back db/migrations/20261001_subscriber_onboarding_messages.sql.
--
-- Deploy the previous code first. Dropping the table forgets which onboarding
-- emails were accepted; subscribers keep their records and access.

begin;
set local lock_timeout = '5s';
drop table if exists subscriber_email_claims;
drop table if exists subscriber_onboarding_messages;
commit;
