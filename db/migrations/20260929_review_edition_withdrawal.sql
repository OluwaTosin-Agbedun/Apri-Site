-- Withdrawing a Complimentary Review edition, and choosing which edition each
-- series offers.
--
-- Requires db/migrations/20260928_review_edition_recipients.sql, and stops
-- (changing nothing) if it has not been applied.
--
-- What it adds:
--
--   * a 'withdrawn' publication state. A withdrawn edition keeps its row --
--     document identity, metadata, recipient history and audit trail -- but is
--     no longer published, so every public page, the prospect library and the
--     prospect grant and send choices leave it out by the filters they already
--     have;
--   * `complimentary_featured`: which edition, if any, each series offers on
--     the homepage. It is set explicitly, so being the latest edition no
--     longer offers an edition by itself, and a series can offer none. Every
--     edition that is published and latest today is featured, so the homepage
--     is unchanged by this migration;
--   * the withdrawal record on each edition: the link being revoked, whether
--     Papermark has confirmed it is gone, who asked and when;
--   * review_edition_events: an append-only history of withdrawals, features
--     and re-offers. Details never hold an address;
--   * the functions that make each change in one transaction.
--
-- It does not write to Papermark or touch any recipient, subscriber or Data
-- Room record. Safe to run while the site is live, before or after the code
-- that uses it is deployed, and safe to re-run.
--
--   psql "<connection string>" -v ON_ERROR_STOP=1 -f db/migrations/20260929_review_edition_withdrawal.sql

begin;

-- Give up rather than queue behind a lock and stall the pages that read the
-- editions table. The whole transaction rolls back; re-running is safe.
set local lock_timeout = '5s';

-- Stops here, changing nothing, if 20260928 has not been applied.
select recipient_mode from review_publication_editions limit 0;

-- ---------------------------------------------------------------------------
-- 1. A withdrawn edition is kept, but is no longer published
-- ---------------------------------------------------------------------------

alter table review_publication_editions
  drop constraint if exists review_publication_editions_publication_state_check;
alter table review_publication_editions
  add constraint review_publication_editions_publication_state_check
  check (publication_state in ('draft', 'published', 'ignored', 'withdrawn'));

-- ---------------------------------------------------------------------------
-- 2. Which edition each series offers
-- ---------------------------------------------------------------------------
--
-- Added nullable and filled once (`where ... is null`), so a re-run never
-- re-features an edition the owner has since stopped offering.

alter table review_publication_editions
  add column if not exists complimentary_featured boolean;

update review_publication_editions
set complimentary_featured = (publication_state = 'published' and is_latest)
where complimentary_featured is null;

alter table review_publication_editions
  alter column complimentary_featured set default false;
alter table review_publication_editions
  alter column complimentary_featured set not null;

alter table review_publication_editions
  drop constraint if exists review_editions_featured_is_published;
alter table review_publication_editions
  add constraint review_editions_featured_is_published
  check (not complimentary_featured or (publication_state = 'published' and series is not null));

-- At most one offered edition per series. Checked at the end of each
-- statement, so moving the offer from one edition to another in a single
-- statement cannot trip over itself half-way.
alter table review_publication_editions
  drop constraint if exists review_editions_one_featured_per_series;
alter table review_publication_editions
  add constraint review_editions_one_featured_per_series
  exclude using btree (series with =) where (complimentary_featured)
  deferrable initially deferred;

-- ---------------------------------------------------------------------------
-- 3. The withdrawal record
-- ---------------------------------------------------------------------------
--
-- withdrawal_state is the edition's current withdrawal, if any:
--   'revoking' -- hidden everywhere in APRI; its link is being revoked, and
--                 Papermark has not yet confirmed it no longer opens;
--   'revoked'  -- Papermark confirmed the link is gone. Only then is the
--                 withdrawal complete.
-- withdrawal_link_id keeps the revoked link's id after the edition's current
-- link fields are cleared, so it can never be re-offered with the same URL.

alter table review_publication_editions
  add column if not exists withdrawal_state        text,
  add column if not exists withdrawal_link_id      text,
  add column if not exists withdrawal_requested_at timestamptz,
  add column if not exists withdrawal_requested_by uuid references admins (id) on delete set null,
  add column if not exists withdrawn_at            timestamptz,
  add column if not exists withdrawn_by            uuid references admins (id) on delete set null,
  add column if not exists reoffered_at            timestamptz,
  add column if not exists reoffered_by            uuid references admins (id) on delete set null;

alter table review_publication_editions
  drop constraint if exists review_editions_withdrawal_state_check;
alter table review_publication_editions
  add constraint review_editions_withdrawal_state_check
  check (withdrawal_state is null or withdrawal_state in ('revoking', 'revoked'));

alter table review_publication_editions
  drop constraint if exists review_editions_withdrawal_consistency;
alter table review_publication_editions
  add constraint review_editions_withdrawal_consistency
  check (
    (publication_state = 'withdrawn') = (withdrawal_state is not null)
    and (withdrawal_state is null or withdrawal_link_id is not null)
    and (withdrawal_state is distinct from 'revoked'
         or (secure_link_id is null and withdrawn_at is not null))
  );

-- ---------------------------------------------------------------------------
-- 4. Edition history, append-only
-- ---------------------------------------------------------------------------

create table if not exists review_edition_events (
  id             uuid        primary key default gen_random_uuid(),
  edition_id     uuid        not null references review_publication_editions (id) on delete restrict,
  event_type     text        not null,
  detail         text        not null default '',
  actor_admin_id uuid        references admins (id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint review_edition_events_type_check check (event_type in (
    'withdrawal_started', 'withdrawal_unconfirmed', 'withdrawal_completed',
    'featured', 'unfeatured', 'reoffered'
  ))
);

create index if not exists review_edition_events_edition_idx
  on review_edition_events (edition_id, created_at desc);

create or replace function reject_review_edition_event_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'review_edition_events is append-only';
end;
$$;

drop trigger if exists review_edition_events_append_only on review_edition_events;
create trigger review_edition_events_append_only
  before update or delete on review_edition_events
  for each row execute function reject_review_edition_event_mutation();

-- ---------------------------------------------------------------------------
-- 5. Each change in one transaction
-- ---------------------------------------------------------------------------

-- Step 1 of a withdrawal: hide the edition everywhere and record which link is
-- being revoked, before Papermark is touched. Returns 'started', or 'resumed'
-- / 'already_withdrawn' for a retry, which changes nothing.
create or replace function begin_review_edition_withdrawal(
  p_edition uuid, p_link_id text, p_replacement uuid, p_admin uuid
) returns text language plpgsql as $$
declare
  target review_publication_editions%rowtype;
  repl   review_publication_editions%rowtype;
begin
  select * into target from review_publication_editions where id = p_edition for update;
  if not found then raise exception 'withdrawal: edition not found'; end if;
  perform pg_advisory_xact_lock(hashtext('review-edition:' || coalesce(target.series, '')));

  if target.publication_state = 'withdrawn' then
    if target.withdrawal_state = 'revoking' and target.withdrawal_link_id = p_link_id then
      return 'resumed';
    end if;
    if target.withdrawal_state = 'revoked' then
      return 'already_withdrawn';
    end if;
    raise exception 'withdrawal: a different withdrawal is already recorded for this edition';
  end if;
  if target.publication_state <> 'published' then
    raise exception 'withdrawal: only a published edition can be withdrawn';
  end if;
  if target.secure_link_id is null or target.secure_link_id <> p_link_id then
    raise exception 'withdrawal: the edition''s link changed since it was previewed';
  end if;

  if p_replacement is not null then
    if not target.complimentary_featured then
      raise exception 'withdrawal: a replacement applies only to the edition the series offers';
    end if;
    select * into repl from review_publication_editions where id = p_replacement for update;
    if not found
       or repl.id = target.id
       or repl.series is distinct from target.series
       or repl.publication_state <> 'published'
       or repl.secure_link_id is null
       or repl.secure_link_url = ''
       or repl.secure_link_verified_at is null
       or repl.secure_link_document_id is distinct from repl.papermark_document_id then
      raise exception 'withdrawal: the replacement is not a verified published edition of the same series';
    end if;
  end if;

  update review_publication_editions set
    publication_state       = 'withdrawn',
    is_latest               = false,
    complimentary_featured  = false,
    withdrawal_state        = 'revoking',
    withdrawal_link_id      = target.secure_link_id,
    withdrawal_requested_at = now(),
    withdrawal_requested_by = p_admin,
    withdrawn_at            = null,
    withdrawn_by            = null,
    updated_at              = now()
  where id = target.id;

  insert into review_edition_events (edition_id, event_type, detail, actor_admin_id)
  values (target.id, 'withdrawal_started',
          case when p_replacement is null
               then 'Hidden from every public page; its complimentary link is being revoked'
               else 'Hidden from every public page; its complimentary link is being revoked; another edition of the series is offered instead'
          end,
          p_admin);

  if p_replacement is not null then
    update review_publication_editions
    set complimentary_featured = true, updated_at = now()
    where id = p_replacement;
    insert into review_edition_events (edition_id, event_type, detail, actor_admin_id)
    values (p_replacement, 'featured', 'Offered in place of a withdrawn edition', p_admin);
  end if;

  return 'started';
end $$;

-- Step 3: record that Papermark confirmed the link no longer opens, and clear
-- the edition's current link so it cannot be reused. Call only after that
-- confirmation. Returns 'completed' or, for a retry, 'already_completed'.
create or replace function complete_review_edition_withdrawal(
  p_edition uuid, p_link_id text, p_admin uuid
) returns text language plpgsql as $$
declare
  target review_publication_editions%rowtype;
begin
  select * into target from review_publication_editions where id = p_edition for update;
  if not found then raise exception 'withdrawal: edition not found'; end if;

  if target.withdrawal_state = 'revoked' and target.withdrawal_link_id = p_link_id then
    return 'already_completed';
  end if;
  if target.publication_state <> 'withdrawn'
     or target.withdrawal_state is distinct from 'revoking'
     or target.withdrawal_link_id is distinct from p_link_id then
    raise exception 'withdrawal: no withdrawal of that link is in progress for this edition';
  end if;

  update review_publication_editions set
    withdrawal_state         = 'revoked',
    withdrawn_at             = now(),
    withdrawn_by             = p_admin,
    secure_link_id           = null,
    secure_link_url          = '',
    secure_link_document_id  = null,
    secure_link_verified_at  = null,
    recipients_verified_hash = null,
    recipients_verified_at   = null,
    updated_at               = now()
  where id = target.id;

  insert into review_edition_events (edition_id, event_type, detail, actor_admin_id)
  values (target.id, 'withdrawal_completed',
          'Papermark confirmed its complimentary link no longer opens', p_admin);
  return 'completed';
end $$;

-- Offer one verified published edition as its series' Complimentary Review
-- edition, in place of whichever edition was offered before.
create or replace function feature_review_publication_edition(
  p_edition uuid, p_admin uuid
) returns text language plpgsql as $$
declare
  target review_publication_editions%rowtype;
begin
  select * into target from review_publication_editions where id = p_edition for update;
  if not found then raise exception 'feature: edition not found'; end if;
  perform pg_advisory_xact_lock(hashtext('review-edition:' || coalesce(target.series, '')));

  if target.complimentary_featured then return 'already_featured'; end if;
  if target.publication_state <> 'published'
     or target.series is null
     or target.secure_link_id is null
     or target.secure_link_url = ''
     or target.secure_link_verified_at is null
     or target.secure_link_document_id is distinct from target.papermark_document_id then
    raise exception 'feature: only a verified published edition can be offered';
  end if;

  insert into review_edition_events (edition_id, event_type, detail, actor_admin_id)
  select id, 'unfeatured', 'Another edition of the series is offered instead', p_admin
  from review_publication_editions
  where series = target.series and complimentary_featured and id <> target.id;

  update review_publication_editions set complimentary_featured = false, updated_at = now()
  where series = target.series and complimentary_featured and id <> target.id;

  update review_publication_editions set complimentary_featured = true, updated_at = now()
  where id = target.id;

  insert into review_edition_events (edition_id, event_type, detail, actor_admin_id)
  values (target.id, 'featured', 'Offered as the series'' Complimentary Review edition', p_admin);
  return 'featured';
end $$;

-- Publishing as latest is the owner's explicit choice to offer that edition
-- too. A withdrawn edition cannot be published until it is re-offered, and
-- the one-argument form the currently deployed code calls behaves the same.
create or replace function promote_review_publication_edition(target_id uuid, p_admin uuid)
returns void language plpgsql as $$
declare
  target review_publication_editions%rowtype;
begin
  select * into target from review_publication_editions where id = target_id for update;
  if not found then raise exception 'Edition not found'; end if;
  perform pg_advisory_xact_lock(hashtext('review-edition:' || target.series));
  if target.publication_state = 'withdrawn' then
    raise exception 'Edition is withdrawn; re-offer it before publishing it again';
  end if;
  if target.secure_link_id is null
     or target.secure_link_url = ''
     or target.secure_link_verified_at is null
     or target.secure_link_document_id is distinct from target.papermark_document_id then
    raise exception 'Edition link is not verified for the exact document';
  end if;

  insert into review_edition_events (edition_id, event_type, detail, actor_admin_id)
  select id, 'unfeatured', 'A newer edition of the series was published as latest', p_admin
  from review_publication_editions
  where series = target.series and complimentary_featured and id <> target.id;

  update review_publication_editions set is_latest = false, updated_at = now()
  where series = target.series and is_latest and id <> target.id;
  update review_publication_editions set complimentary_featured = false, updated_at = now()
  where series = target.series and complimentary_featured and id <> target.id;
  update review_publication_editions
  set publication_state = 'published', is_latest = true, complimentary_featured = true, updated_at = now()
  where id = target.id;

  if not target.complimentary_featured then
    insert into review_edition_events (edition_id, event_type, detail, actor_admin_id)
    values (target.id, 'featured', 'Published as latest and offered as the series'' Complimentary Review edition', p_admin);
  end if;
end $$;

create or replace function promote_review_publication_edition(target_id uuid)
returns void language plpgsql as $$
begin
  perform promote_review_publication_edition(target_id, null::uuid);
end $$;

commit;
