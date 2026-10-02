-- 20261009_review_reader_rooms.sql
--
-- One personal Papermark Data Room access path per approved Complimentary
-- Review reader, so one Papermark email code opens every edition assigned to
-- them. Additive and safe to re-run. Applying it changes nothing in Papermark:
-- a reader's room is created only when an owner prepares it in Admin.
--
--  * review_reader_rooms        per reader email: their Papermark viewer group (whose
--                               only member is that email), its one group link, and the
--                               exact set of room documents last confirmed visible.
--                               state: ready | updating | closed | failed.
--  * review_reader_room_events  what was done to each room and what Papermark confirmed.
--                               Never a link URL or a token.

create table if not exists review_reader_rooms (
  email                text primary key check (email = lower(btrim(email)) and position('@' in email) > 1),
  papermark_dataroom_id text not null,
  papermark_group_id   text,
  papermark_link_id    text,
  link_url             text,
  state                text not null default 'updating'
                         check (state in ('ready', 'updating', 'closed', 'failed')),
  -- Comma-separated room-document ids confirmed visible by read-back.
  verified_visible     text,
  verified_at          timestamptz,
  last_error           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index if not exists review_reader_rooms_group_key on review_reader_rooms (papermark_group_id) where papermark_group_id is not null;
create unique index if not exists review_reader_rooms_link_key on review_reader_rooms (papermark_link_id) where papermark_link_id is not null;

create table if not exists review_reader_room_events (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  event_type  text not null check (event_type in (
                'group_created', 'member_confirmed', 'permissions_confirmed', 'permissions_unconfirmed',
                'link_created', 'link_confirmed', 'link_closed', 'link_reopened', 'link_close_failed', 'failed')),
  detail      text,
  occurred_at timestamptz not null default now()
);
create index if not exists review_reader_room_events_email_idx on review_reader_room_events (email, occurred_at desc);
