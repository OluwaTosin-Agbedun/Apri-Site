import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"
import { papermarkEmbedUrl } from "../src/lib/papermark-embed.ts"
import { verifyResendWebhook } from "../src/lib/resend-webhook.ts"

const read=(p)=>readFileSync(new URL(`../${p}`,import.meta.url),"utf8")

test("Papermark share links accept supported types and reject management URLs",()=>{
  assert.ok(papermarkEmbedUrl("https://papermark.com/view/abc"))
  assert.ok(papermarkEmbedUrl("https://papermark.com/view/abc/files"))
  assert.ok(papermarkEmbedUrl("https://papermark.com/data-room/abc"))
  assert.ok(papermarkEmbedUrl("https://docs.athenacentre.org/share/abc"))
  assert.equal(papermarkEmbedUrl("https://papermark.com/dashboard"),null)
  assert.equal(papermarkEmbedUrl("https://papermark.com/folders/00-masters"),null)
  const classifier=read("src/lib/papermark-link.ts")
  for(const label of ["Single document","Multi-file","Data Room","Unverified"]) assert.match(classifier,new RegExp(label))
})

test("Resend webhook verification rejects invalid signatures and accepts Svix signatures",()=>{
  const body=JSON.stringify({type:"email.delivered",data:{email_id:"safe-id"}})
  const id="evt_safe"; const timestamp="2000000000"; const raw=Buffer.from("test-secret").toString("base64")
  const signature=createHmac("sha256",Buffer.from(raw,"base64")).update(`${id}.${timestamp}.${body}`).digest("base64")
  assert.equal(verifyResendWebhook(body,{id,timestamp,signature:"v1,bad"},`whsec_${raw}`,2000000000),false)
  assert.equal(verifyResendWebhook(body,{id,timestamp,signature:`v1,${signature}`},`whsec_${raw}`,2000000000),true)
})

test("engagement migration is additive, indexed, idempotent and principal-scoped",()=>{
  const migration=read("db/migrations/20260827_client_engagement.sql")
  assert.match(migration,/create table if not exists client_engagement_events/)
  assert.match(migration,/add column if not exists library_link_updated_at/)
  assert.match(migration,/add column if not exists private_link_updated_at/)
  assert.match(migration,/create unique index if not exists client_engagement_webhook_event_key/)
  for(const index of ["subscriber","briefing","type","resend","time"]) assert.match(migration,new RegExp(`client_engagement_${index}_idx`))
  assert.match(migration,/references subscribers\(id\) on delete cascade/)
  assert.match(migration,/references briefing_requests\(id\) on delete cascade/)
  assert.doesNotMatch(migration,/drop table|drop column|delete from|truncate/i)
})

test("webhook processing is verified, idempotent and stores no token or private URL",()=>{
  const route=read("src/app/api/resend/webhook/route.ts")
  const events=read("src/lib/client-engagement.ts")
  assert.match(route,/verifyResendWebhook/)
  assert.match(route,/status:401/)
  assert.match(events,/on conflict \(webhook_event_id\).*do nothing/s)
  assert.doesNotMatch(events,/token|private_link_url|library_link_url/i)
})

test("admin navigation replaces Copies and dashboard has production publication actions",()=>{
  const shell=read("src/components/AdminShell.tsx")
  const dashboard=read("src/app/admin/page.tsx")
  assert.doesNotMatch(shell,/\/admin\/copies|label: 'Copies'/)
  assert.match(shell,/label: 'Engagement'/)
  assert.match(dashboard,/No publications have been published yet/)
  assert.match(dashboard,/Fetch from Papermark/)
  assert.match(dashboard,/Manage Publications/)
  assert.doesNotMatch(dashboard,/db:seed/)
})

test("private-link clicks re-read the authenticated principal instead of accepting a URL",()=>{
  const route=read("src/app/portal/open-private/route.ts")
  assert.match(route,/requirePortalPrincipal/)
  assert.match(route,/principal\.libraryLinkUrl/)
  assert.match(route,/principal\.privateLinkUrl/)
  assert.doesNotMatch(route,/searchParams|get\("url"\)/)
})

test("owner deletion cascades engagement separately for subscriber and briefing principals",()=>{
  const migration=read("db/migrations/20260827_client_engagement.sql")
  const subscribers=read("src/app/actions/subscribers.ts")
  const briefings=read("src/app/actions/briefings.ts")
  assert.match(migration,/subscriber_id uuid references subscribers\(id\) on delete cascade/)
  assert.match(migration,/briefing_request_id uuid references briefing_requests\(id\) on delete cascade/)
  assert.match(subscribers,/delete from subscribers/)
  assert.doesNotMatch(subscribers,/delete from briefing_requests/)
  assert.match(briefings,/delete from briefing_requests/)
  assert.doesNotMatch(briefings,/delete from subscribers/)
})
