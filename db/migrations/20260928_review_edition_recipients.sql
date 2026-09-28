-- Per-edition Complimentary Review recipients.
--
-- Every Complimentary Review edition is its own Papermark document link, and
-- its URL is deliberately shown on the public pages. The link's Papermark
-- allow list is therefore the only thing deciding who can open that edition.
-- Until now every link was written from one shared APRI list, so approving a
-- single reader granted every published edition. This migration gives each
-- edition its own recipient list.
--
-- Additive and idempotent, in one transaction. It deliberately does NOT:
--
--   * write anything to Papermark (a migration cannot, and must not);
--   * seed any edition's list from the shared APRI list, which may not match
--     what is actually live in Papermark;
--   * change the access checks for any edition that is already published.
--
-- Instead every edition already published with a secure link is classified
-- 'shared_legacy': it keeps being checked against the shared list exactly as
-- before, until the owner explicitly adopts its live Papermark access in
-- Admin. Every other edition -- and every edition synced from now on --
-- starts in 'edition' mode with no recipients, which is fail-closed: no link
-- can be prepared for it until recipients are deliberately chosen.
--
-- Written without DO blocks or $$ bodies so it runs unchanged through
-- `psql -f`. Run the whole file in one session, with ON_ERROR_STOP:
--
--   psql "<connection string>" -v ON_ERROR_STOP=1 -f db/migrations/20260928_review_edition_recipients.sql
--
-- Safe to run while the site is live, before or after the code that uses it is
-- deployed: it only adds a table and columns, the running code names none of
-- them, and every insert the running code makes gets the fail-closed default.

begin;

-- The ALTERs below briefly lock review_publication_editions. If something else
-- holds that table, give up after five seconds -- the whole transaction rolls
-- back and nothing changes -- rather than queue behind it and stall the pages
-- that read it. Re-running is safe.
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. One row per address per edition, with history
-- ---------------------------------------------------------------------------
--
-- A removal sets revoked_at rather than deleting, so the record of who could
-- open an edition, when, and on whose authority survives the change. Addresses
-- are stored already normalised; the CHECK makes a mixed-case duplicate
-- impossible rather than merely unlikely.

create table if not exists review_edition_recipients (
  id          uuid        primary key default gen_random_uuid(),
  edition_id  uuid        not null references review_publication_editions (id) on delete restrict,
  email       text        not null,
  -- How the grant arose: read from the live Papermark link during adoption,
  -- chosen by the owner for the edition, or granted from a review request.
  source      text        not null,
  granted_by  uuid        references admins (id) on delete set null,
  granted_at  timestamptz not null default now(),
  revoked_by  uuid        references admins (id) on delete set null,
  revoked_at  timestamptz,
  constraint review_edition_recipients_email_check
    check (email = lower(btrim(email)) and length(email) between 3 and 254 and email like '%_@_%'),
  constraint review_edition_recipients_source_check
    check (source in ('adopted', 'owner', 'prospect_grant')),
  constraint review_edition_recipients_revocation_check
    check (revoked_at is null or revoked_at >= granted_at)
);

-- One active grant per address per edition. Revoked rows are history and are
-- outside the index, so an address can be removed and later re-granted.
create unique index if not exists review_edition_recipients_active_key
  on review_edition_recipients (edition_id, email)
  where revoked_at is null;

-- The prospect's library and the send-access check look one address up
-- across every edition.
create index if not exists review_edition_recipients_email_active_idx
  on review_edition_recipients (email)
  where revoked_at is null;

-- ---------------------------------------------------------------------------
-- 2. Each edition's access mode
-- ---------------------------------------------------------------------------
--
-- Added nullable first, with its CHECK declared on the column so a re-run
-- skips both together. NULL passes the CHECK, which is what lets existing rows
-- be classified below before the column becomes NOT NULL.

alter table review_publication_editions
  add column if not exists recipient_mode text
    constraint review_publication_editions_recipient_mode_check
    check (recipient_mode in ('shared_legacy', 'edition'));

-- The default is set before existing rows are classified, so a row inserted
-- by the running application at any point after this line is fail-closed.
alter table review_publication_editions
  alter column recipient_mode set default 'edition';

-- Classify each existing row exactly once. `where recipient_mode is null` is
-- what makes a re-run harmless: an edition the owner has since adopted is
-- never reset to shared_legacy.
update review_publication_editions
set recipient_mode = case
      when publication_state = 'published'
       and secure_link_id is not null
       and secure_link_url <> ''
      then 'shared_legacy'
      else 'edition'
    end
where recipient_mode is null;

alter table review_publication_editions
  alter column recipient_mode set not null;

-- ---------------------------------------------------------------------------
-- 3. What APRI last confirmed in Papermark for each edition
-- ---------------------------------------------------------------------------
--
-- The hash is of the normalised, sorted list that was last read back from
-- Papermark and found to match exactly. Comparing it with the hash of the
-- current rows tells Admin whether an edition is in sync without storing or
-- re-reading any address.

alter table review_publication_editions
  add column if not exists recipients_verified_hash text,
  add column if not exists recipients_verified_at   timestamptz,
  add column if not exists recipients_applied_at    timestamptz,
  add column if not exists recipients_adopted_at    timestamptz,
  add column if not exists recipients_adopted_by    uuid references admins (id) on delete set null;

commit;
