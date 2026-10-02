-- Rolls back 20261009_review_reader_rooms.sql.
--
-- First set the public cards back to Papermark links (Admin -> Review
-- Library), and close or delete the reader groups and links in Papermark
-- (they are listed in review_reader_rooms) -- dropping these tables does NOT
-- remove anything from Papermark.
drop table if exists review_reader_room_events;
drop table if exists review_reader_rooms;
