/**
 * Protected summaries never reach a notification email: neither the approved
 * text nor a draft is in the body of the new-edition alert released when a
 * reader's copy lands (src/lib/alerts.ts releaseHeldAlert) or of the Data
 * Room new-document email (src/lib/dataroom-notifications.ts). Both carry the
 * public one-line teaser (or nothing) exactly as before.
 *
 * The email provider is a stand-in that answers Resend's /emails endpoint on
 * this machine and keeps every message it is handed: nothing is sent, and no
 * request leaves this machine. The key below is invented.
 *
 * Against the isolated test database. Invented data only.
 */
import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { fixtures, signIn, act } from "./publication-metadata-harness.mjs"
import { neon, neonConfig } from "@neondatabase/serverless"
import { startTestDatabase } from "./support/test-database.mjs"
const database = await startTestDatabase()
neonConfig.fetchEndpoint = () => database.endpoint
const sql = neon(database.databaseUrl)

process.env.DATABASE_URL = database.databaseUrl
process.env.RESEND_API_KEY = "re_test_invented_not_a_key"
process.env.DATAROOM_NEW_DOCUMENT_EMAILS = "enabled"

const provider = []
const outbound = []
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url
  const host = new URL(url).hostname
  if (host === "api.resend.com") {
    const body = JSON.parse(init?.body ?? "{}")
    provider.push({ to: [body.to].flat(), subject: body.subject ?? "", html: body.html ?? "", text: body.text ?? "" })
    return new Response(JSON.stringify({ id: `msg_${provider.length}` }), { status: 200, headers: { "content-type": "application/json" } })
  }
  if (host !== "127.0.0.1") outbound.push(url)
  return realFetch(input, init)
}

const { submitPublicationSummary } = await import("../src/app/actions/publication-summaries.ts")
const session = await import("../src/lib/session.ts")
const store = await import("../src/lib/publication-summaries.ts")
const { releaseHeldAlert } = await import("../src/lib/alerts.ts")
const { notifyNewDataRoomDocuments } = await import("../src/lib/dataroom-notifications.ts")
const notices = await import("../src/lib/publication-notifications.ts")

const tag = "publeak_stage5"
const fx = fixtures(sql, tag)

const APPROVED = {
  whatChanged: "Approved wording tourmaline: the levy was gazetted.",
  whyItMatters: "Approved consequence garnet.",
  implications: "Approved scenarios peridot.",
  watchNext: "Approved signal spinel.",
  sourceDate: "2026-10-02",
  uncertainty: "Approved doubt beryl.",
}
const DRAFT = {
  whatChanged: "Draft wording xylophone.",
  whyItMatters: "Draft consequence marimba.",
  implications: "Draft scenario glockenspiel.",
  watchNext: "Draft signal celesta.",
  sourceDate: "",
  uncertainty: "Draft doubt vibraphone.",
}
const WORDS = [APPROVED, DRAFT].flatMap((t) => [t.whatChanged, t.whyItMatters, t.implications, t.watchNext, t.uncertainty])
const form = (text) => ({ whatChanged: text.whatChanged, whyItMatters: text.whyItMatters, implications: text.implications, watchNext: text.watchNext, sourceDate: text.sourceDate ?? "", uncertainty: text.uncertainty })

let owner, editor, plan, legacy, reader, roomReader
const ed = {}

async function summary(adminId, role, id, intent, text) {
  await signIn(session, adminId, role)
  const revision = (await store.readStoredSummary(sql, id))?.revision ?? 0
  return act(submitPublicationSummary, { intent, revision: String(revision), ...form(text) }, id)
}

before(async () => {
  owner = await fx.admin("owner")
  editor = await fx.admin("editor")
  plan = await fx.plan("room")
  legacy = await fx.plan("legacy", { room: false })
  reader = await fx.subscriber("reader", legacy.tier)
  roomReader = await fx.subscriber("roomreader", plan.tier)
  ed.approved = await fx.edition("approved", { title: "Levy note", series: "MIN", date: "2026-10-05", forTiers: [plan.tier, legacy.tier], dataroom: plan.dataroom, summary: "Public one-line teaser for the levy note." })
  ed.draft = await fx.edition("draft", { title: "Draft-summary note", series: "AIU", date: "2026-10-06", forTiers: [plan.tier, legacy.tier], dataroom: plan.dataroom, summary: "Public one-line teaser for the second note." })
  await sql`update documents set visibility = 'L1' where id = any(${[ed.approved.id, ed.draft.id]}::uuid[])`
  assert.equal((await summary(editor, "editor", ed.approved.id, "draft", APPROVED)).ok, true)
  assert.equal((await summary(owner, "owner", ed.approved.id, "approve", APPROVED)).ok, true)
  assert.equal((await summary(editor, "editor", ed.draft.id, "draft", DRAFT)).ok, true)
})

after(async () => {
  globalThis.__browser = "none"
  delete process.env.RESEND_API_KEY
  delete process.env.DATAROOM_NEW_DOCUMENT_EMAILS
  await sql`delete from papermark_document_notifications where subscriber_id = ${reader}::uuid`
  await sql`delete from client_engagement_events where subscriber_id = ${reader}::uuid`
  await sql`delete from alert_holds where subscriber_id = ${reader}::uuid`
  globalThis.fetch = realFetch
  await database.stop()
})

describe("notification emails carry no protected summary", () => {
  it("a held legacy alert enters the durable queue and releases only after provider acceptance", async () => {
    await notices.setPublicationNotices(owner, true, "Controlled isolated email privacy test", sql)
    for (const edition of [ed.approved, ed.draft]) {
      await sql`insert into alert_holds (subscriber_id, publication_id) values (${reader}::uuid, ${edition.id}::uuid) on conflict do nothing`
      await sql`insert into publication_access (subscriber_id, publication_id, link_url) values (${reader}::uuid, ${edition.id}::uuid, ${`https://docs.example.invalid/view/${tag}-${edition.slug}`}) on conflict do nothing`
    }
    const before = provider.length
    assert.equal(await releaseHeldAlert(reader, ed.approved.id), false, "queueing is not provider acceptance")
    assert.equal(await releaseHeldAlert(reader, ed.draft.id), false)
    assert.equal(provider.length, before, "reader preparation never sends inline")
    await sql`update publication_notice_events set next_attempt_at=now()`
    // One resumable event per fanout run; both events must be collected.
    await notices.fanoutNotices(sql); await notices.fanoutNotices(sql)
    const result=await notices.drainPublicationNotices({sql,paceMs:0})
    assert.equal(result.accepted, 2)
    const messages=provider.slice(before)
    assert.equal(messages.length,2)
    assert.ok(messages.some(m=>m.html.includes("Public one-line teaser for the levy note.")))
    assert.ok(messages.some(m=>m.html.includes("Public one-line teaser for the second note.")))
    assert.equal((await sql`select count(*)::int as n from alert_holds where subscriber_id=${reader}::uuid and released_at is not null`)[0].n,2)
    for (const message of messages) {
      const all=`${message.subject}\n${message.html}\n${message.text}`
      for (const word of WORDS) assert.equal(all.includes(word),false,word)
      assert.match(all,/https:\/\/apri\.athenacentre\.org\/portal/)
      assert.doesNotMatch(all,/docs\.example|papermark|token=/i)
    }
  })
  it("the Data Room queue waits for saved personal-link confirmation, then sends no protected text", async () => {
    await sql`insert into subscriber_access_reconciliations(subscriber_id,state,generation) values(${roomReader}::uuid,'complete',1)`
    await sql`insert into papermark_subscriber_document_links (subscriber_id,papermark_document_id,papermark_link_id,link_url,assigned_email,verification_generation,last_verified_at,verification_result)
      values (${roomReader}::uuid,${ed.approved.papermarkDocumentId},${`${tag}_link_1`},'https://docs.example.invalid/view/private-reader-copy',${`${tag}_roomreader@example.invalid`},1,now(),'{"state":"found"}'::jsonb)`
    const before=provider.length
    const checked=await notifyNewDataRoomDocuments(plan.dataroom)
    assert.equal(checked.sent,0)
    assert.equal(provider.length,before,"sync never sends directly")
    await sql`update publication_notice_jobs set next_attempt_at=now() where subscriber_id=${roomReader}::uuid`
    const result=await notices.drainPublicationNotices({sql,paceMs:0})
    assert.equal(result.accepted,1)
    const messages=provider.slice(before)
    assert.equal(messages.length,1)
    for(const word of WORDS)assert.equal(messages[0].html.includes(word),false,word)
    assert.match(messages[0].html,/Public one-line teaser for the levy note/)
    assert.doesNotMatch(messages[0].html,/docs\.example|private-reader-copy/)
  })
  it("nothing left this machine (the provider is a local stand-in)",()=>assert.deepEqual(outbound,[]))
})
