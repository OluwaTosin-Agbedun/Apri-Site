-- Complimentary Review Library — Phase 1
--
-- A hidden library of selected publications available to prospective
-- subscribers via a single verified Papermark Data Room link.
-- Additive only: does not touch existing documents, Open editions,
-- subscriber access, watermarks, links or visibility.

-- Settings: enabled flag and the single Papermark URL
insert into app_settings (key, value)
values ('review_library_enabled', 'false')
on conflict (key) do nothing;

insert into app_settings (key, value)
values ('review_library_papermark_url', '')
on conflict (key) do nothing;

-- Review items: references existing publications by documents.id.
-- Each publication may appear at most once (unique constraint).
create table if not exists complimentary_review_items (
  id               uuid        primary key default gen_random_uuid(),
  publication_id   uuid        not null references documents (id) on delete cascade,
  display_order    integer     not null default 0,
  is_active        boolean     not null default true,
  publication_type text        not null default '',
  description      text        not null default '',
  frequency        text        not null default '',
  audience         text        not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists complimentary_review_items_publication_key
  on complimentary_review_items (publication_id);

create index if not exists complimentary_review_items_order_idx
  on complimentary_review_items (display_order, created_at);
