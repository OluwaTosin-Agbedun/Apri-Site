-- Editorial review and controlled correction history. No existing record is
-- adopted, approved, released, reassigned or changed by this migration.
begin;
set local lock_timeout='5s';
create table if not exists publication_families (
  id uuid primary key default gen_random_uuid(),
  kind text not null check(kind in ('paid','review')),
  original_issue_date date not null,
  current_workflow_id uuid,
  created_by uuid references admins(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists publication_workflows (
  id uuid primary key default gen_random_uuid(),
  document_id uuid unique references documents(id) on delete restrict,
  review_edition_id uuid unique references review_publication_editions(id) on delete restrict,
  check((document_id is null)<>(review_edition_id is null)),
  state text not null default 'draft' check(state in ('draft','in_review','approved','published','withdrawn','archived')),
  revision bigint not null default 0 check(revision>=0),
  version_label text not null default '1',
  provenance text not null default '',
  author_editor text not null default '',
  covered_period_start date,
  covered_period_end date,
  information_cutoff date,
  reading_time_minutes integer check(reading_time_minutes between 1 and 600),
  check((covered_period_start is null)=(covered_period_end is null)),
  check(covered_period_end>=covered_period_start),
  family_id uuid references publication_families(id) on delete restrict,
  ordinal integer check(ordinal>0),
  unique(family_id,ordinal),
  submitted_by uuid references admins(id) on delete set null,
  submitted_at timestamptz,
  submitted_hash text,
  approved_by uuid references admins(id) on delete set null,
  approved_at timestamptz,
  approved_hash text,
  ever_published boolean not null default false,
  legacy_adoption boolean not null default false,
  first_released_at timestamptz,
  original_issue_date date,
  original_source_ids text[] not null default '{}',
  frozen_snapshot jsonb,
  notice_document_id text,
  notice_source_sha256 text check(notice_source_sha256 is null or notice_source_sha256~'^[a-f0-9]{64}$'),
  notice_sha256 text check(notice_sha256 is null or notice_sha256~'^[a-f0-9]{64}$'),
  notice_page_count integer check(notice_page_count>0),
  notice_current_url text,
  notice_prepared_by uuid references admins(id) on delete set null,
  notice_prepared_at timestamptz,
  notice_verified_by uuid references admins(id) on delete set null,
  notice_verified_at timestamptz,
  check(notice_verified_by is null or notice_verified_by<>notice_prepared_by),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
do $$ begin
  if not exists(select 1 from pg_constraint where conname='publication_families_current_fkey') then
    alter table publication_families add constraint publication_families_current_fkey
      foreign key(current_workflow_id) references publication_workflows(id) on delete restrict;
  end if;
end $$;
create table if not exists publication_workflow_events (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references publication_workflows(id) on delete restrict,
  action text not null,
  previous_state text,
  next_state text,
  revision bigint not null,
  actor_id uuid references admins(id) on delete restrict,
  actor_name text not null,
  reason text not null,
  snapshot jsonb,
  created_at timestamptz not null default now()
);
create index if not exists publication_workflow_history on publication_workflow_events(workflow_id,created_at,id);
create table if not exists publication_correction_access (
  workflow_id uuid primary key references publication_workflows(id) on delete restrict,
  source_workflow_id uuid not null references publication_workflows(id) on delete restrict,
  source_hash text not null,
  target_hash text not null,
  snapshot jsonb not null,
  inherited_by uuid references admins(id) on delete set null,
  inherited_at timestamptz not null default now()
);
create table if not exists publication_version_retirements (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references publication_workflows(id) on delete restrict,
  link_id text,
  identity_hash text not null,
  expected_document_ids text[] not null,
  kind text not null check(kind in ('paid_personal','legacy_copy','review_edition','review_rooms','manual')),
  subscriber_id uuid references subscribers(id) on delete set null,
  state text not null default 'pending' check(state in ('pending','running','confirmed','awaiting_manual','failed')),
  confirmation_method text check(confirmation_method in ('provider','two_person_manual')),
  confirmed_by uuid references admins(id) on delete set null,
  checked_by uuid references admins(id) on delete set null,
  check(checked_by is null or checked_by<>confirmed_by),
  confirmation_reason text,
  confirmed_at timestamptz,
  attempts integer not null default 0 check(attempts>=0),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  last_error text,
  unique(workflow_id,identity_hash)
);
alter table publication_version_retirements add column if not exists legacy_link_hash text;
create table if not exists publication_legacy_notice_proofs (
  workflow_id uuid not null references publication_workflows(id) on delete restrict,
  subscriber_id uuid not null references subscribers(id) on delete restrict,
  link_hash text not null,
  notice_hash text not null,
  prepared_by uuid not null references admins(id) on delete restrict,
  prepared_at timestamptz not null default now(),
  checked_by uuid references admins(id) on delete restrict,
  checked_at timestamptz,
  reason text not null,
  check(checked_by is null or checked_by<>prepared_by),
  primary key(workflow_id,subscriber_id)
);
create index if not exists publication_retirements_due on publication_version_retirements(next_attempt_at) where state in ('pending','running');

create or replace function publication_content_snapshot(subject text,record_id uuid) returns jsonb language plpgsql stable as $$
declare result jsonb;
begin
  if subject='paid' then
    select jsonb_build_object(
      'title',d.title,'series',d.series,'issueDate',to_char(d.edition_date,'YYYY-MM-DD'),
      'description',d.description,'teaser',d.summary,'visibility',d.visibility,
      'author',to_jsonb(d)->>'author_editor','coveredStart',to_jsonb(d)->>'covered_period_start',
      'coveredEnd',to_jsonb(d)->>'covered_period_end','cutoff',to_jsonb(d)->>'information_cutoff',
      'minutes',to_jsonb(d)->>'reading_time_minutes',
      'sources',(select coalesce(jsonb_agg(x.id order by x.id),'[]'::jsonb) from (
        select d.papermark_document_id as id where coalesce(d.papermark_document_id,'')<>''
        union select dd.papermark_document_id from papermark_dataroom_documents dd where dd.publication_id=d.id and dd.is_present=true
      )x),
      'sourceVersions',(select coalesce(jsonb_agg(jsonb_build_array(dd.papermark_document_id,dd.version_key) order by dd.id),'[]'::jsonb) from papermark_dataroom_documents dd where dd.publication_id=d.id and dd.is_present),
      'tags',(select coalesce(jsonb_agg(a.tag_id order by a.tag_id),'[]'::jsonb) from publication_tag_assignments a where a.publication_id=d.id)
    ) into result from documents d where d.id=record_id;
  elsif subject='review' then
    select jsonb_build_object('title',e.title,'series',e.series,'issueDate',to_char(e.edition_date,'YYYY-MM-DD'),
      'description',e.description,'sources',jsonb_build_array(e.papermark_document_id),'sourceVersion',e.sync_version_key,
      'author',w.author_editor,'coveredStart',to_char(w.covered_period_start,'YYYY-MM-DD'),
      'coveredEnd',to_char(w.covered_period_end,'YYYY-MM-DD'),'cutoff',to_char(w.information_cutoff,'YYYY-MM-DD'),
      'minutes',w.reading_time_minutes)
      into result from review_publication_editions e left join publication_workflows w on w.review_edition_id=e.id where e.id=record_id;
  else return null;
  end if;
  if result is null then return null; end if;
  return result||coalesce((select jsonb_build_object('version',w.version_label,'provenance',w.provenance)
    from publication_workflows w where (subject='paid' and w.document_id=record_id) or (subject='review' and w.review_edition_id=record_id)),'{}'::jsonb);
end $$;
create or replace function publication_content_hash(subject text,record_id uuid) returns text language sql stable as $$
  select md5(publication_content_snapshot(subject,record_id)::text)
$$;

-- Audiences are copied only by an explicit owner action. A later change to
-- either list invalidates that inheritance and holds correction release.
create or replace function publication_audience_snapshot(subject text,record_id uuid) returns jsonb language plpgsql stable as $$
begin
  if subject='paid' then
    return jsonb_build_object(
      'visibility',(select visibility from documents where id=record_id),
      'plans',(select coalesce(jsonb_agg(public_tier order by public_tier),'[]'::jsonb) from publication_plans where publication_id=record_id),
      'exceptions',(select coalesce(jsonb_agg(jsonb_build_object('subscriber',subscriber_id,'decision',decision,'reason',reason) order by subscriber_id),'[]'::jsonb) from subscriber_publication_exceptions where publication_id=record_id)
    );
  elsif subject='review' then
    return jsonb_build_object('emails',case when (select recipient_mode from review_publication_editions where id=record_id)='shared_legacy'
      then (select coalesce(jsonb_agg(email order by email),'[]'::jsonb) from (select distinct lower(btrim(x)) as email from app_settings a,regexp_split_to_table(a.value,E'[\\n\\r,;\\t]+')x where a.key='review_approved_recipients' and position('@' in x)>1) addresses)
      else (select coalesce(jsonb_agg(email order by email),'[]'::jsonb) from review_edition_recipients where edition_id=record_id and revoked_at is null) end);
  end if;
  return null;
end $$;

-- Transaction preconditions abort all later writes if a preview was stale.
create or replace function assert_correction_inputs(subject text,source_id uuid,target_id uuid,source_hash text,target_hash text,source_audience jsonb,target_audience jsonb) returns void language plpgsql as $$
declare prior publication_workflows; target publication_workflows;
begin
  select * into prior from publication_workflows where (subject='paid' and document_id=source_id) or (subject='review' and review_edition_id=source_id) for update;
  select * into target from publication_workflows where (subject='paid' and document_id=target_id) or (subject='review' and review_edition_id=target_id) for update;
  if prior.id is null or not prior.ever_published or target.id is null or target.ever_published then raise exception 'Correction needs a released source and an unreleased draft'; end if;
  if target.family_id is not null and (target.family_id is distinct from prior.family_id or target.ordinal<>prior.ordinal+1) then raise exception 'This draft already belongs to another correction'; end if;
  if publication_content_hash(subject,source_id) is distinct from source_hash or publication_content_hash(subject,target_id) is distinct from target_hash
    or publication_audience_snapshot(subject,source_id) is distinct from source_audience or publication_audience_snapshot(subject,target_id) is distinct from target_audience then
    raise exception 'The correction preview changed; reload and preview again';
  end if;
  if publication_content_snapshot(subject,source_id)->>'issueDate' is distinct from publication_content_snapshot(subject,target_id)->>'issueDate'
    or publication_content_snapshot(subject,source_id)->>'series' is distinct from publication_content_snapshot(subject,target_id)->>'series' then
    raise exception 'A correction must retain the original date and category';
  end if;
end $$;
create or replace function assert_notice_verification(workflow uuid,actor uuid,expected_revision bigint) returns void language plpgsql as $$
declare w publication_workflows;
begin
  select * into w from publication_workflows where id=workflow for update;
  if w.id is null or w.revision is distinct from expected_revision or w.notice_document_id is null or w.notice_prepared_by is null or w.notice_sha256 is null or w.notice_source_sha256 is null
    or w.notice_page_count is null or w.notice_current_url is null or w.notice_prepared_by=actor or w.notice_verified_at is not null
    or not exists(select 1 from admins where id=actor and is_active and role='owner')
    or not exists(select 1 from admins where id=w.notice_prepared_by and is_active and role='owner') then
    raise exception 'A different active owner must verify this unchanged notice proof';
  end if;
end $$;

-- Called after locking the publication row in the SAME transaction as release.
-- This is not a UI hint: stale approval, wrong role or an unreviewed first
-- release aborts the transaction before any audience/release change commits.
create or replace function assert_publication_editorial_approval(subject text,record_id uuid,actor uuid,expected_revision bigint) returns void language plpgsql as $$
declare w publication_workflows; prior publication_workflows; inherited publication_correction_access; live boolean;
begin
  select * into w from publication_workflows where (subject='paid' and document_id=record_id) or (subject='review' and review_edition_id=record_id) for update;
  if w.id is null then
    if subject='paid' then select status='published' or coalesce(paid_release_state='released',false) into live from documents where id=record_id;
    else select publication_state='published' into live from review_publication_editions where id=record_id; end if;
    if coalesce(live,false) then return; end if;
    raise exception 'Editorial review is required before a first release';
  end if;
  if not exists(select 1 from admins where id=actor and is_active=true and role='owner') then raise exception 'Only an owner can release an approved publication'; end if;
  if w.revision is distinct from expected_revision then raise exception 'Editorial review changed; reload before release'; end if;
  if w.state='published' and w.ever_published then return; end if;
  if w.family_id is not null and w.ordinal>1 then
    perform id from publication_families where id=w.family_id for update;
    select * into prior from publication_workflows where family_id=w.family_id and ordinal=w.ordinal-1 for update;
    select * into inherited from publication_correction_access where workflow_id=w.id;
    if prior.id is null or not prior.ever_published or prior.notice_verified_at is null then
      raise exception 'The earlier PDF needs a verified embedded superseded notice before correction release';
    end if;
    if not exists(select 1 from publication_version_retirements where workflow_id=prior.id and kind='manual' and state='confirmed')
      or exists(select 1 from publication_version_retirements where workflow_id=prior.id and state<>'confirmed') then
      raise exception 'Earlier raw links are not yet confirmed retired; finish the correction checklist';
    end if;
    if inherited.workflow_id is null or inherited.source_workflow_id<>prior.id
       or inherited.source_hash<>md5(publication_audience_snapshot(subject,coalesce(prior.document_id,prior.review_edition_id))::text)
       or inherited.target_hash<>md5(publication_audience_snapshot(subject,record_id)::text) then
      raise exception 'Reader inheritance changed; preview and approve the exact assignment copy again';
    end if;
    if subject='paid' and not exists(select 1 from papermark_dataroom_documents where publication_id=prior.document_id and papermark_document_id=prior.notice_document_id and is_present) then
      -- Legacy copies are manually replaced and independently checked instead.
      if exists(select 1 from papermark_dataroom_documents where publication_id=prior.document_id and is_present) then
        raise exception 'The earlier notice copy is not present in the paid library';
      end if;
    end if;
    if subject='review' and not exists(select 1 from review_publication_editions where id=prior.review_edition_id
      and papermark_document_id=prior.notice_document_id and secure_link_document_id=prior.notice_document_id
      and secure_link_verified_at is not null and secure_link_url<>'') then
      raise exception 'Prepare and verify secure access to the earlier notice copy first';
    end if;
  end if;
  if prior.id is not null and subject='paid' and exists(select 1 from papermark_subscriber_document_links where papermark_document_id=any(prior.original_source_ids) and revoke_state='live') then
    raise exception 'An earlier personal raw link is still recorded live; resume retirement checks';
  end if;
  if w.state<>'approved' or w.approved_hash is distinct from publication_content_hash(subject,record_id) then
    raise exception 'An unchanged owner-approved review is required before release';
  end if;
end $$;

create or replace function invalidate_publication_review() returns trigger language plpgsql as $$
declare w publication_workflows;
begin
  select * into w from publication_workflows where (tg_table_name='documents' and document_id=new.id) or (tg_table_name='review_publication_editions' and review_edition_id=new.id) for update;
  if w.id is null then return new; end if;
  if w.ever_published and new.edition_date is distinct from old.edition_date then
    raise exception 'A released issue date cannot change; create a separately identified correction';
  end if;
  if w.ever_published and new.papermark_document_id is distinct from old.papermark_document_id
    and not (w.notice_verified_at is not null and new.papermark_document_id=w.notice_document_id) then
    raise exception 'The released PDF source cannot be replaced in place; create a correction or an approved notice copy';
  end if;
  if w.state in ('in_review','approved') and
    (to_jsonb(new)-array['updated_at','status','is_published','published_at','paid_release_state','paid_release_reason','paid_release_changed_at','paid_release_changed_by'])
      is distinct from (to_jsonb(old)-array['updated_at','status','is_published','published_at','paid_release_state','paid_release_reason','paid_release_changed_at','paid_release_changed_by']) then
    update publication_workflows set state='draft',revision=revision+1,approved_hash=null,approved_by=null,approved_at=null,submitted_hash=null,updated_at=now() where id=w.id;
    insert into publication_workflow_events(workflow_id,action,previous_state,next_state,revision,actor_name,reason)
      values(w.id,'content_changed',w.state,'draft',w.revision+1,'Publication data change','Content changed before release; editorial approval was cleared');
  end if;
  return new;
end $$;
drop trigger if exists review_paid_editorial_change on documents;
create trigger review_paid_editorial_change before update of title,series,edition_date,description,summary,papermark_document_id,author_editor,covered_period_start,covered_period_end,information_cutoff,reading_time_minutes on documents
  for each row execute function invalidate_publication_review();
drop trigger if exists review_complimentary_editorial_change on review_publication_editions;
create trigger review_complimentary_editorial_change before update of title,series,edition_date,description,papermark_document_id on review_publication_editions
  for each row execute function invalidate_publication_review();

-- Advance only after the normal release action actually published this row.
-- A correction inherits its predecessor's homepage/latest placement within
-- this family. Unrelated issues and deliberate homepage offers stay separate.
create or replace function advance_publication_family(workflow uuid) returns void language plpgsql as $$
declare w publication_workflows; current_ordinal integer; prior review_publication_editions;
begin
  select * into w from publication_workflows where id=workflow;
  if w.family_id is null or w.state<>'published' or not w.ever_published then return; end if;
  perform id from publication_families where id=w.family_id for update;
  select ordinal into current_ordinal from publication_workflows where id=(select current_workflow_id from publication_families where id=w.family_id);
  if coalesce(current_ordinal,0)>w.ordinal then return; end if;
  if w.review_edition_id is not null then
    select e.* into prior from review_publication_editions e join publication_workflows p on p.review_edition_id=e.id where p.family_id=w.family_id and p.ordinal=w.ordinal-1;
    if prior.id is not null then
      update review_publication_editions set is_latest=false,complimentary_featured=false where id=prior.id;
      update review_publication_editions set is_latest=is_latest or prior.is_latest,complimentary_featured=complimentary_featured or prior.complimentary_featured where id=w.review_edition_id and publication_state='published';
    end if;
  end if;
  update publication_families set current_workflow_id=w.id where id=w.family_id;
  if w.document_id is not null and w.ordinal>1 and to_regclass('public.publication_notice_events') is not null then
    update publication_notice_jobs j set state='cancelled',detail='A newer approved version replaced this unsent announcement',updated_at=now()
      from publication_notice_events e where j.event_id=e.id and j.state in ('pending','held','failed')
        and e.publication_id in(select document_id from publication_workflows where family_id=w.family_id and ordinal<w.ordinal);
    update publication_notice_events set state='cancelled',lease_token=null,lease_until=null
      where state in ('pending','fanning') and publication_id in(select document_id from publication_workflows where family_id=w.family_id and ordinal<w.ordinal);
    update publication_notice_events set kind='correction',reason='Approved correction: version '||w.version_label,approved_by=w.approved_by
      where publication_id=w.document_id and revision_key='first' and kind='publication';
  end if;
end $$;

-- Mirror real archive/withdraw/re-offer outcomes; never release from a trigger.
create or replace function record_editorial_access_state() returns trigger language plpgsql as $$
declare w publication_workflows; next_state text;
begin
  select * into w from publication_workflows where (tg_table_name='documents' and document_id=new.id) or (tg_table_name='review_publication_editions' and review_edition_id=new.id) for update;
  if w.id is null then return new; end if;
  if tg_table_name='documents' then
    if new.status='archived' then next_state:='archived';
    elsif old.status='archived' and new.status='draft' then next_state:='draft'; end if;
  else
    if new.publication_state='withdrawn' then next_state:='withdrawn';
    elsif old.publication_state='withdrawn' and new.publication_state='draft' then next_state:='draft'; end if;
  end if;
  if next_state is not null and next_state<>w.state then
    update publication_workflows set state=next_state,approved_hash=null,approved_at=null,approved_by=null,submitted_hash=null,revision=revision+1,updated_at=now() where id=w.id;
    insert into publication_workflow_events(workflow_id,action,previous_state,next_state,revision,actor_name,reason) values(w.id,'access_state_changed',w.state,next_state,w.revision+1,'Publication access control','Mirrors the recorded archive, withdrawal or re-offer outcome; not an editorial approval');
  end if;
  return new;
end $$;
drop trigger if exists editorial_paid_access_state on documents;
create trigger editorial_paid_access_state after update of status on documents for each row execute function record_editorial_access_state();
drop trigger if exists editorial_review_access_state on review_publication_editions;
create trigger editorial_review_access_state after update of publication_state on review_publication_editions for each row execute function record_editorial_access_state();

-- A record of what was actually released is append-only. An administrator
-- may prepare a separately identified notice copy; the master ids/date and
-- frozen publication snapshot are never overwritten by that operation.
create or replace function protect_publication_history() returns trigger language plpgsql as $$
begin
  if tg_table_name='publication_workflow_events' then
    raise exception 'Publication history is append-only';
  end if;
  if tg_op='DELETE' and old.ever_published then raise exception 'A released version cannot be deleted'; end if;
  if tg_op='UPDATE' and old.frozen_snapshot is not null then
    if new.frozen_snapshot is distinct from old.frozen_snapshot
       or new.original_source_ids is distinct from old.original_source_ids
       or new.original_issue_date is distinct from old.original_issue_date then
      raise exception 'The released snapshot, source and original issue date are immutable; create a correction';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists immutable_publication_history on publication_workflow_events;
create trigger immutable_publication_history before update or delete on publication_workflow_events for each row execute function protect_publication_history();
drop trigger if exists immutable_publication_snapshot on publication_workflows;
create trigger immutable_publication_snapshot before update or delete on publication_workflows for each row execute function protect_publication_history();
commit;
