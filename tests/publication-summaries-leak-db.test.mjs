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
import { sql, makeTag } from "./helpers.mjs"

process.env.DATABASE_URL = process.env.APRI_TEST_DATABASE_URL
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

const tag = makeTag("publeak")
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

let owner, editor, plan, reader
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
  reader = await fx.subscriber("reader", plan.tier)
  ed.approved = await fx.edition("approved", { title: "Levy note", series: "MIN", date: "2026-10-05", forTiers: [plan.tier], dataroom: plan.dataroom, summary: "Public one-line teaser for the levy note." })
  ed.draft = await fx.edition("draft", { title: "Draft-summary note", series: "AIU", date: "2026-10-06", forTiers: [plan.tier], dataroom: plan.dataroom, summary: "Public one-line teaser for the second note." })
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
  await fx.cleanup()
})

describe("notification emails carry no protected summary", () => {
  it("the new-edition alert released for a reader's copy has the public teaser, never the summary or a draft", async () => {
    for (const edition of [ed.approved, ed.draft]) {
      await sql`insert into alert_holds (subscriber_id, publication_id) values (${reader}::uuid, ${edition.id}::uuid) on conflict do nothing`
      await sql`insert into publication_access (subscriber_id, publication_id, link_url) values (${reader}::uuid, ${edition.id}::uuid, ${`https://docs.example.invalid/view/${tag}-${edition.slug}`}) on conflict do nothing`
    }
    const before = provider.length
    assert.equal(await releaseHeldAlert(reader, ed.approved.id), true)
    assert.equal(await releaseHeldAlert(reader, ed.draft.id), true)
    const messages = provider.slice(before)
    assert.equal(messages.length, 2)
    assert.match(messages[0].html, /Public one-line teaser for the levy note\./)
    assert.match(messages[1].html, /Public one-line teaser for the second note\./)
    for (const message of messages) {
      const all = `${message.subject}\n${message.html}\n${message.text}`
      for (const word of WORDS) assert.equal(all.includes(word), false, word)
    }
  })

  it("the Data Room new-document email carries neither", async () => {
    // A live personal link for the approved edition's file, so the reader may be told about it.
    await sql`
      insert into papermark_subscriber_document_links (subscriber_id, papermark_document_id, papermark_link_id, link_url)
      values (${reader}::uuid, ${ed.approved.papermarkDocumentId}, ${`${tag}_link_1`}, ${`https://docs.example.invalid/view/${tag}-link-1`})`
    const before = provider.length
    const result = await notifyNewDataRoomDocuments(plan.dataroom)
    assert.ok(result.sent >= 1, JSON.stringify(result))
    const messages = provider.slice(before)
    assert.ok(messages.length >= 1)
    for (const message of messages) {
      const all = `${message.subject}\n${message.html}\n${message.text}`
      for (const word of WORDS) assert.equal(all.includes(word), false, word)
    }
  })

  it("nothing left this machine (the provider is a local stand-in)", () => {
    assert.deepEqual(outbound, [])
  })
})
