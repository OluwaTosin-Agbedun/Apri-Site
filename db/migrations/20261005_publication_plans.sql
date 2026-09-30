-- Plan-based publication access: each edition says which plans receive it.
--
-- Additive and idempotent. Run after 20261004_paid_release_and_access_health.sql.
-- No subscriber, term, level or link is changed, and nobody loses anything:
--
--  1. Plan ticks are filled in from the Data Rooms each edition is in today:
--     an edition in the room mapped to Individual Access is ticked for
--     Individual Access, and so on. A paid record in no room is ticked for
--     every plan its old level reached, so the legacy library is unchanged.
--  2. Every edition a subscriber can open today but the new rule would not
--     give them (dated outside their term, not ticked for their plan, or
--     undated) is kept for them as an individual "also give" exception,
--     marked as kept from before the change. An administrator can remove it.

create table if not exists publication_plans (
  publication_id uuid not null references documents(id) on delete cascade,
  public_tier text not null,
  -- 'room': ticked because the edition is in that plan's Data Room; 'admin': ticked by hand; 'level': from the old level.
  source text not null default 'admin',
  created_at timestamptz not null default now(),
  primary key (publication_id, public_tier)
);
create index if not exists publication_plans_tier_idx on publication_plans (public_tier);

-- 1a. From the rooms.
insert into publication_plans (publication_id, public_tier, source)
select distinct dd.publication_id, lr.public_tier, 'room'
from papermark_dataroom_documents dd
join papermark_level_rooms lr on lr.papermark_dataroom_id = dd.papermark_dataroom_id
join documents d on d.id = dd.publication_id and d.visibility <> 'OPEN'
where dd.is_present = true
on conflict do nothing;

-- 1b. Paid records in no room: from their old level (a plan reaches its own level and below).
insert into publication_plans (publication_id, public_tier, source)
select d.id, t.tier, 'level'
from documents d
cross join (values
  ('Individual Access', 1), ('Professional Team Access', 1), ('Political Monitor', 2),
  ('Executive Intelligence', 3), ('Board Briefing', 4)
) as t(tier, rank)
where d.visibility in ('L1', 'L2', 'L3', 'L4')
  and t.rank >= substring(d.visibility from 2)::int
  and not exists (select 1 from papermark_dataroom_documents dd where dd.publication_id = d.id and dd.is_present = true)
  and not exists (select 1 from publication_plans pp where pp.publication_id = d.id)
on conflict do nothing;

-- 2. Keep what subscribers hold today. An automatic exception has no administrator.
alter table subscriber_publication_exceptions alter column administrator_id drop not null;

insert into subscriber_publication_exceptions (subscriber_id, publication_id, decision, reason, administrator_id)
select distinct dl.subscriber_id, dd.publication_id, 'allow',
       'Kept from before the plan-based rules: this subscriber already had this edition', null::uuid
from papermark_subscriber_document_links dl
join papermark_dataroom_documents dd on dd.papermark_document_id = dl.papermark_document_id and dd.publication_id is not null
join subscribers s on s.id = dl.subscriber_id and s.client_type = 'subscriber'
join documents d on d.id = dd.publication_id
where dl.revoke_state = 'live'
  and not (
    d.edition_date is not null
    and exists (select 1 from publication_plans pp where pp.publication_id = d.id and pp.public_tier = s.public_tier)
    and (
      (s.term_start is not null and s.term_end is not null and d.edition_date between s.term_start and s.term_end)
      or exists (
        select 1 from subscriber_subscription_periods p
        where p.subscriber_id = s.id and (to_jsonb(p) ->> 'voided_at') is null
          and d.edition_date between p.starts_on and p.ends_on
      )
    )
  )
on conflict (subscriber_id, publication_id) do nothing;

insert into subscriber_exception_events (subscriber_id, publication_id, decision, reason, administrator_id)
select x.subscriber_id, x.publication_id, 'allow', x.reason, null
from subscriber_publication_exceptions x
where x.administrator_id is null
  and x.reason = 'Kept from before the plan-based rules: this subscriber already had this edition'
  and not exists (
    select 1 from subscriber_exception_events e
    where e.subscriber_id = x.subscriber_id and e.publication_id = x.publication_id and e.reason = x.reason
  );
