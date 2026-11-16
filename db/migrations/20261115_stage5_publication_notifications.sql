-- Durable publication notices. Disabled until an owner approves a baseline.
begin;
set local lock_timeout='5s';
-- These fields were historically supplied by 20261004 rather than the fresh
-- schema. No-op on upgraded databases; required before declaring the trigger.
alter table documents add column if not exists paid_release_state text;
alter table documents add column if not exists paid_release_changed_by uuid references admins(id) on delete set null;
create table if not exists publication_notice_settings (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  baseline_at timestamptz,
  approved_by uuid references admins(id) on delete set null,
  updated_at timestamptz not null default now(),
  worker_at timestamptz
);
insert into publication_notice_settings(singleton) values(true) on conflict do nothing;
create table if not exists publication_notice_seen (
  publication_id uuid primary key references documents(id) on delete cascade,
  baseline boolean not null default false,
  seen_at timestamptz not null default now()
);
create table if not exists publication_notice_events (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references documents(id) on delete cascade,
  revision_key text not null check(length(revision_key) between 1 and 100),
  kind text not null check(kind in ('publication','correction')),
  reason text not null default '',
  approved_by uuid references admins(id) on delete set null,
  state text not null default 'pending' check(state in ('pending','fanning','complete','cancelled')),
  cursor_id uuid,
  next_attempt_at timestamptz not null default (now()+interval '1 minute'),
  lease_token uuid,lease_until timestamptz,
  created_at timestamptz not null default now(),
  unique(publication_id,revision_key)
);
create index if not exists publication_notice_events_due on publication_notice_events(next_attempt_at) where state in ('pending','fanning');
create table if not exists publication_notice_jobs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references publication_notice_events(id) on delete cascade,
  subscriber_id uuid not null references subscribers(id) on delete cascade,
  state text not null default 'pending' check(state in ('pending','held','sending','accepted','failed','unknown','cancelled')),
  attempts integer not null default 0 check(attempts>=0),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,lease_until timestamptz,
  provider_message_id text,
  outcome text,
  detail text,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(event_id,subscriber_id)
);
create index if not exists publication_notice_jobs_due on publication_notice_jobs(next_attempt_at,attempts) where state in ('pending','held','failed');
create unique index if not exists publication_notice_jobs_provider on publication_notice_jobs(provider_message_id) where provider_message_id is not null;
create table if not exists publication_notice_preferences (
  subscriber_id uuid primary key references subscribers(id) on delete cascade,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
create table if not exists publication_notice_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references admins(id) on delete set null,
  action text not null,
  publication_id uuid references documents(id) on delete set null,
  reason text not null,
  created_at timestamptz not null default now()
);

-- A change detector, not a second entitlement policy. The application uses the
-- shared access policy; a final CAS refuses a send if any input changed while
-- those reads were in progress. It deliberately excludes view/activity counts.
create or replace function publication_notice_access_fence(seat uuid,pub uuid) returns text language plpgsql stable as $$
begin
  return (select md5(jsonb_build_object(
    'seat',(select jsonb_build_array(s.email,s.public_tier,s.level,s.status,s.client_type,s.term_start,s.term_end,s.papermark_dataroom_override,s.papermark_dataroom_id) from subscribers s where s.id=seat),
    'periods',(select jsonb_agg(to_jsonb(p) order by p.id) from subscriber_subscription_periods p where p.subscriber_id=seat),
    'exception',(select to_jsonb(x) from subscriber_publication_exceptions x where x.subscriber_id=seat and x.publication_id=pub),
    'plans',(select jsonb_agg(p.public_tier order by p.public_tier) from publication_plans p where p.publication_id=pub),
    'release',(select jsonb_build_array(d.status,d.visibility,d.paid_release_state,d.edition_date,d.papermark_document_id,d.title,to_jsonb(d)->>'portal_title_override',to_jsonb(d)->>'is_shared_copy',d.papermark_link) from documents d where d.id=pub),
    'room',(select jsonb_agg(to_jsonb(r) order by r.public_tier) from papermark_level_rooms r where r.public_tier=(select s.public_tier from subscribers s where s.id=seat)),
    'files',(select jsonb_agg(jsonb_build_array(d.id,d.papermark_document_id,d.papermark_dataroom_id,d.is_present,d.title) order by d.id) from papermark_dataroom_documents d where d.publication_id=pub),
    'links',(select jsonb_agg(jsonb_build_array(l.id,l.papermark_document_id,l.revoke_state,l.assigned_email,l.expires_at,l.verification_generation,l.last_verified_at,l.verification_result,l.papermark_link_id,l.link_url) order by l.id) from papermark_subscriber_document_links l where l.subscriber_id=seat),
    'legacy',(select jsonb_build_array(a.revoke_state,a.link_url) from publication_access a where a.subscriber_id=seat and a.publication_id=pub),
    'reconciliation',(select jsonb_build_array(r.generation,r.state) from subscriber_access_reconciliations r where r.subscriber_id=seat)
  )::text));
end $$;

-- Transactional capture only: never a provider call and never a grant. Syncing
-- drafts or editing metadata does not qualify. Re-offering the same edition
-- does not generate a second first-publication event.
create or replace function capture_publication_notice() returns trigger language plpgsql as $$
declare
  switched_on boolean;
  baseline_time timestamptz;
  captured uuid;
begin
  if new.visibility='OPEN' or new.status='archived' or not coalesce(
    new.paid_release_state='released' or (new.paid_release_state is null and new.status='published'),false) then return new; end if;
  select enabled,baseline_at into switched_on,baseline_time from publication_notice_settings where singleton=true for share;
  if not coalesce(switched_on,false) or baseline_time is null then return new; end if;
  insert into publication_notice_seen(publication_id) values(new.id) on conflict do nothing returning publication_id into captured;
  if captured is not null then
    insert into publication_notice_events(publication_id,revision_key,kind,reason,approved_by)
      values(new.id,'first','publication','First paid release after the approved baseline',new.paid_release_changed_by)
      on conflict(publication_id,revision_key) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists publication_notice_capture on documents;
create trigger publication_notice_capture after insert or update of paid_release_state,status,visibility on documents
  for each row execute function capture_publication_notice();
commit;
