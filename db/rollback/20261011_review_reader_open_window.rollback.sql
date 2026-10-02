-- Rolls back 20261011_review_reader_open_window.sql. The library goes back to
-- each edition's own Papermark link (a Papermark code per edition). Close any
-- personal reader links in Papermark first: without these columns APRI no
-- longer tracks when they close.
do $$
begin
  if to_regclass('public.review_reader_rooms') is not null then
    alter table review_reader_rooms drop column if exists room_documents;
    alter table review_reader_rooms drop column if exists link_open_until;
  end if;
end $$;
