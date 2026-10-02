-- Rolls back 20261008_review_reader_library.sql.
-- Readers signed in to the remembered library are signed out; the review
-- request process, recipient lists and Papermark links are unaffected. Set
-- app_settings.review_entry_mode back to 'papermark' (or delete it) first, so
-- public cards link straight to Papermark again.
drop table if exists review_reader_events;
drop table if exists review_reader_sessions;
drop table if exists review_reader_tokens;
