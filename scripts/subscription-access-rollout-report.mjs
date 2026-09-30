#!/usr/bin/env node
import { neon } from "@neondatabase/serverless"

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL
if (!url) throw new Error("Set DATABASE_URL to generate the read-only rollout report.")
const sql = neon(url)
const rows = await sql`
  select s.id, coalesce(nullif(s.full_name,''),s.name) as subscriber, s.email, s.status,s.public_tier,s.seats,
    count(dl.id) filter(where dl.revoke_state='live')::int as current_links,
    coalesce(jsonb_agg(distinct jsonb_build_object('id',d.id,'title',d.title)) filter(where d.edition_date is null),'[]') as missing_editions,
    count(d.id) filter(where d.edition_date is not null and exists(select 1 from subscriber_subscription_periods p where p.subscriber_id=s.id and d.edition_date between p.starts_on and p.ends_on))::int as proposed_editions,
    coalesce(jsonb_agg(distinct jsonb_build_object('id',d.id,'title',d.title)) filter(where d.edition_date is not null and exists(select 1 from subscriber_subscription_periods p where p.subscriber_id=s.id and d.edition_date between p.starts_on and p.ends_on) and dl.id is null),'[]') as editions_to_add,
    coalesce(jsonb_agg(distinct jsonb_build_object('id',d.id,'title',d.title,'linkId',dl.papermark_link_id)) filter(where dl.revoke_state='live' and (d.edition_date is null or not exists(select 1 from subscriber_subscription_periods p where p.subscriber_id=s.id and d.edition_date between p.starts_on and p.ends_on))),'[]') as editions_to_remove,
    (select count(*)::int from papermark_dataroom_links rl where rl.subscriber_id=s.id and rl.revoke_state='live') as unrestricted_room_links,
    (select count(*)::int from subscriber_subscription_periods p where p.subscriber_id=s.id) as periods
  from subscribers s cross join documents d
  left join papermark_dataroom_documents dd on dd.publication_id=d.id
  left join papermark_subscriber_document_links dl on dl.subscriber_id=s.id and dl.papermark_document_id=dd.papermark_document_id and dl.revoke_state='live'
  where s.client_type='subscriber' and d.status='published' and d.visibility<>'OPEN'
  group by s.id order by subscriber`
console.log(JSON.stringify(rows.map((r)=>({...r,
  ambiguous:r.periods===0?"No trustworthy agreed period; Admin must add one":"",
  legacy_professional_review:r.public_tier==="Professional Team Access"&&Number(r.seats)>3?"Negotiated Professional arrangement exceeds the new-plan limit; do not remove users":"",
})),null,2))
