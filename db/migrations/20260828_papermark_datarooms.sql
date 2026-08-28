-- Papermark Data Rooms
--
-- Additive, idempotent and data-preserving. Nothing is dropped, renamed or
-- rewritten: the existing papermark_folder_id columns, private_link_url and
-- papermark_client_documents all stay exactly as they are, and keep working, so
-- a client who has not been moved to a Data Room is unaffected by this running.
--
-- Safe to run more than once.

-- ---------------------------------------------------------------------------
-- Which Data Room a client is assigned to
--
-- The permanent Papermark id, not the name. A room can be renamed in Papermark
-- at any time, and an assignment that followed the name would silently point at
-- the wrong content the day somebody tidied up.
-- ---------------------------------------------------------------------------

alter table subscribers        add column if not exists papermark_dataroom_id text;
alter table briefing_requests  add column if not exists papermark_dataroom_id text;

-- ---------------------------------------------------------------------------
-- Named seat holders
--
-- A subscription stores a seat count, which is enough to bill and not enough to
-- issue links: every person who reads a document has their own name printed
-- across it, so every seat needs a name and an address before a link exists for
-- them. Individual Access needs no row here -- the subscriber is the seat.
-- ---------------------------------------------------------------------------

create table if not exists subscriber_seats (
  id            uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references subscribers (id) on delete cascade,
  full_name     text not null,
  email         text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists subscriber_seats_email_key
  on subscriber_seats (subscriber_id, lower(email));
create index if not exists subscriber_seats_subscriber_idx
  on subscriber_seats (subscriber_id);

-- ---------------------------------------------------------------------------
-- One unique Data Room link per person
--
-- Exactly one of subscriber_id, seat_id or briefing_request_id is set. A link
-- belongs to one named person and is never handed to a second: the watermark
-- printed across every page names whoever it was issued to, so sharing a link
-- would put one person's name in front of another.
-- ---------------------------------------------------------------------------

create table if not exists papermark_dataroom_links (
  id                     uuid primary key default gen_random_uuid(),
  subscriber_id          uuid references subscribers (id) on delete cascade,
  seat_id                uuid references subscriber_seats (id) on delete cascade,
  briefing_request_id    uuid references briefing_requests (id) on delete cascade,

  papermark_dataroom_id  text not null,
  papermark_link_id      text not null,
  link_url               text not null,

  -- What the link was created with, so the admin can see it without asking
  -- Papermark, and so a drift between the two is visible.
  assigned_name          text not null default '',
  assigned_email         text not null default '',
  watermark_enabled      boolean not null default true,
  watermark_text         text not null default '',
  allow_download         boolean not null default true,
  screenshot_protection  boolean not null default true,
  expires_at             timestamptz,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  revoked_at             timestamptz,
  revoke_state           text not null default 'live',

  last_synced_at         timestamptz,
  last_sync_error        text,

  -- Papermark analytics, refreshed on demand. Null means "not available",
  -- which is shown as such rather than as a zero.
  analytics_checked_at   timestamptz,
  total_views            integer,
  unique_viewers         integer,
  total_duration_seconds numeric,
  last_activity_at       timestamptz,

  constraint papermark_dataroom_links_one_principal check (
    (subscriber_id is not null)::int
    + (seat_id is not null)::int
    + (briefing_request_id is not null)::int = 1
  ),
  constraint papermark_dataroom_links_revoke_state check (
    revoke_state in ('live', 'revoked', 'manual')
  )
);

-- A Papermark link is never attached to two people.
create unique index if not exists papermark_dataroom_links_link_key
  on papermark_dataroom_links (papermark_link_id);

-- One live link per person per room.
create unique index if not exists papermark_dataroom_links_subscriber_key
  on papermark_dataroom_links (subscriber_id, papermark_dataroom_id)
  where subscriber_id is not null and revoke_state = 'live';
create unique index if not exists papermark_dataroom_links_seat_key
  on papermark_dataroom_links (seat_id, papermark_dataroom_id)
  where seat_id is not null and revoke_state = 'live';
create unique index if not exists papermark_dataroom_links_briefing_key
  on papermark_dataroom_links (briefing_request_id, papermark_dataroom_id)
  where briefing_request_id is not null and revoke_state = 'live';

create index if not exists papermark_dataroom_links_room_idx
  on papermark_dataroom_links (papermark_dataroom_id);

-- ---------------------------------------------------------------------------
-- What is in each room
--
-- APRI's own snapshot. It is never authoritative over Papermark and never
-- writes back: a document that disappears from a room is marked absent here and
-- is not deleted from Papermark. Keeping the row rather than removing it is
-- what lets a document that comes back be recognised as the same one.
-- ---------------------------------------------------------------------------

create table if not exists papermark_dataroom_documents (
  id                     uuid primary key default gen_random_uuid(),
  papermark_dataroom_id  text not null,
  papermark_document_id  text not null,
  -- The attachment id: the same document can be attached to several rooms.
  dataroom_document_id   text,

  title                  text not null,
  category               text not null default '',
  folder_id              text,
  num_pages              integer,
  content_type           text,

  papermark_created_at   timestamptz,
  papermark_updated_at   timestamptz,

  first_seen_at          timestamptz not null default now(),
  last_seen_at           timestamptz not null default now(),
  is_present             boolean not null default true,
  removed_at             timestamptz,

  -- Bumped whenever the document's own details change, so a notification can
  -- be sent once per version rather than once per sync.
  version_key            text not null default '1',

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create unique index if not exists papermark_dataroom_documents_key
  on papermark_dataroom_documents (papermark_dataroom_id, papermark_document_id);
create index if not exists papermark_dataroom_documents_room_idx
  on papermark_dataroom_documents (papermark_dataroom_id, is_present, papermark_created_at desc);

-- ---------------------------------------------------------------------------
-- Room-level synchronisation state
-- ---------------------------------------------------------------------------

create table if not exists papermark_datarooms (
  papermark_dataroom_id text primary key,
  name                  text not null default '',
  kind                  text not null default 'subscriber',
  document_count        integer not null default 0,
  last_synced_at        timestamptz,
  last_sync_error       text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint papermark_datarooms_kind check (kind in ('subscriber', 'briefing'))
);

-- ---------------------------------------------------------------------------
-- Webhook idempotency
--
-- Papermark retries. A repeated delivery must not create a second event or a
-- second email, so the delivery's own identifier is stored and a conflict is
-- simply ignored.
-- ---------------------------------------------------------------------------

create table if not exists papermark_webhook_events (
  id            uuid primary key default gen_random_uuid(),
  event_id      text not null,
  event_type    text not null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  outcome       text not null default 'received'
);

create unique index if not exists papermark_webhook_events_key
  on papermark_webhook_events (event_id);

-- ---------------------------------------------------------------------------
-- Notification ledger
--
-- One row per recipient per document version. The unique index is what makes
-- "never twice for the same document" true even when two syncs, a webhook and
-- a manual refresh all notice the same new document at once.
-- ---------------------------------------------------------------------------

create table if not exists papermark_document_notifications (
  id                    uuid primary key default gen_random_uuid(),
  subscriber_id         uuid references subscribers (id) on delete cascade,
  seat_id               uuid references subscriber_seats (id) on delete cascade,
  briefing_request_id   uuid references briefing_requests (id) on delete cascade,
  dataroom_document_id  uuid not null references papermark_dataroom_documents (id) on delete cascade,
  version_key           text not null default '1',
  sent_at               timestamptz not null default now(),
  resend_email_id       text,

  constraint papermark_document_notifications_one_principal check (
    (subscriber_id is not null)::int
    + (seat_id is not null)::int
    + (briefing_request_id is not null)::int = 1
  )
);

create unique index if not exists papermark_document_notifications_subscriber_key
  on papermark_document_notifications (subscriber_id, dataroom_document_id, version_key)
  where subscriber_id is not null;
create unique index if not exists papermark_document_notifications_seat_key
  on papermark_document_notifications (seat_id, dataroom_document_id, version_key)
  where seat_id is not null;
create unique index if not exists papermark_document_notifications_briefing_key
  on papermark_document_notifications (briefing_request_id, dataroom_document_id, version_key)
  where briefing_request_id is not null;

-- ---------------------------------------------------------------------------
-- Access level to Data Room
--
-- The mapping that makes this scale. Picking a room per subscriber is fine for
-- five subscribers and unworkable for five hundred, so a room is chosen once
-- per subscription level and every subscriber on that level gets their own
-- unique link into the same room. One row per level, enforced by the primary
-- key, so a level cannot quietly acquire two defaults.
-- ---------------------------------------------------------------------------

create table if not exists papermark_level_rooms (
  public_tier           text primary key,
  papermark_dataroom_id text not null,
  dataroom_name         text not null default '',
  configured_by         uuid references admins (id) on delete set null,
  configured_by_name    text not null default '',
  last_synced_at        timestamptz,
  last_sync_error       text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- An exceptional subscriber can be pinned to a different room. Null means
-- "use the mapping for my level", which is the case for almost everybody.
alter table subscribers
  add column if not exists papermark_dataroom_override text;

-- ---------------------------------------------------------------------------
-- Assignment history
--
-- A level change moves a subscriber between rooms, and the old assignment is
-- kept rather than overwritten: the question of who could read what, and when,
-- outlives the entitlement itself.
-- ---------------------------------------------------------------------------

create table if not exists papermark_assignment_audit (
  id                    uuid primary key default gen_random_uuid(),
  subscriber_id         uuid references subscribers (id) on delete cascade,
  seat_id               uuid references subscriber_seats (id) on delete cascade,
  briefing_request_id   uuid references briefing_requests (id) on delete cascade,
  previous_dataroom_id  text,
  new_dataroom_id       text,
  previous_link_id      text,
  new_link_id           text,
  reason                text not null default '',
  changed_by            uuid references admins (id) on delete set null,
  changed_by_name       text not null default '',
  occurred_at           timestamptz not null default now()
);

create index if not exists papermark_assignment_audit_subscriber_idx
  on papermark_assignment_audit (subscriber_id, occurred_at desc);
create index if not exists papermark_assignment_audit_briefing_idx
  on papermark_assignment_audit (briefing_request_id, occurred_at desc);
