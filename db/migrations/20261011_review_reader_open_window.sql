-- 20261011_review_reader_open_window.sql
--
-- The APRI-verified Complimentary Review library. Additive and safe to re-run.
--
-- Hosted Papermark cannot accept a reader APRI has verified, and cannot tell
-- APRI about a reader it has verified (no API, SSO or viewer token; its
-- verified session is per link, 23 hours, SameSite=Strict). So APRI performs
-- the one email check: a single-use code, then an APRI session of 24 hours on
-- that browser. Each reader's personal Papermark link admits only their
-- address and asks for no second code -- and is OPEN only while that reader
-- has an APRI session:
--
--  * link_open_until  when the reader's personal link closes, as confirmed by
--                     Papermark's read-back. It is moved to the end of the
--                     reader's latest APRI session when they open an edition,
--                     and closed (set in the past) when their last session
--                     ends, they sign out, or an owner signs them out.
--  * room_documents   which Papermark room document shows each review
--                     edition in that reader's room (edition id -> room
--                     document id), recorded only from a confirmed reconcile,
--                     so "Read" opens that one PDF directly.
--
-- Until this has run, the library keeps sending readers to each edition's own
-- Papermark link (Papermark asks for its code per edition), and no personal
-- link is changed.
do $$
begin
  if to_regclass('public.review_reader_rooms') is not null then
    alter table review_reader_rooms add column if not exists link_open_until timestamptz;
    alter table review_reader_rooms add column if not exists room_documents jsonb;
  end if;
end $$;
