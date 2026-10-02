-- Rolls back 20261007_subscriber_sign_in_sessions.sql.
-- Every browser signed in after the release is signed out (their session rows
-- go); cookies issued before it keep working. Codes in unused emails stop
-- working; their links still work.
drop table if exists subscriber_sessions;
alter table subscribers drop column if exists sessions_revoked_at;
alter table auth_tokens drop column if exists binding_hash;
alter table auth_tokens drop column if exists code_attempts;
alter table auth_tokens drop column if exists code_hash;
