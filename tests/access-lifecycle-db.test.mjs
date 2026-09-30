/**
 * The subscriber access lifecycle end to end, against the real database and
 * a mock Papermark HTTP server: reconciliation, the portal library and viewer,
 * exceptions, expiry, level changes, concurrency, refusals and retries.
 *
 * The Papermark here is a local mock. Nothing in this file is a live
 * Papermark verification. Invented data only.
 */
import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import { existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { createServer } from "node:http"
import { sql, makeTag, cleanup } from "./helpers.mjs"

const SRC = fileURLToPath(new URL("../src/", import.meta.url))
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true }
    if (/^next\/[a-z-]+$/.test(specifier)) return next(`${specifier}.js`, context)
    let base = null
    if (specifier.startsWith("@/")) base = join(SRC, specifier.slice(2))
    else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.includes("/src/")) {
      base = join(dirname(fileURLToPath(context.parentURL)), specifier)
    }
    if (base && !/\.[cm]?[jt]sx?$/.test(base)) {
      for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
        if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true }
      }
    }
    return next(specifier, context)
  },
})

// ---------------------------------------------------------------------------
// Mock Papermark: /v1/links only, with fault switches.
// ---------------------------------------------------------------------------
const links = new Map()
const calls = []
const faults = { createStatus: null, readStatus: null, onCreate: null }
let minted = 0
const papermark = createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" })
    res.end(body === undefined ? "" : JSON.stringify(body))
  }
  let raw = ""
  for await (const chunk of req) raw += chunk
  const body = raw ? JSON.parse(raw) : {}
  const url = new URL(req.url, "http://mock")
  const one = url.pathname.match(/^\/v1\/links\/([^/]+)$/)
  calls.push({ method: req.method, id: one ? decodeURIComponent(one[1]) : null, body })
  if (req.method === "POST" && url.pathname === "/v1/links") {
    if (faults.createStatus) return send(faults.createStatus, { error: { message: "refused" } })
    const id = `pl_mock_${++minted}`
    const link = {
      id,
      url: `https://docs.example.invalid/view/${id}`,
      document_id: body.document_id ?? null,
      dataroom_id: body.dataroom_id ?? null,
      target_type: body.document_id ? "document" : "dataroom",
      expires_at: body.expires_at ?? null,
      allow_download: body.allow_download,
      enable_watermark: body.enable_watermark,
      watermark_config: body.watermark_config,
      enable_screenshot_protection: body.enable_screenshot_protection,
      live: true,
    }
    links.set(id, link)
    if (faults.onCreate) await faults.onCreate(link)
    return send(200, link)
  }
  if (one) {
    const link = links.get(decodeURIComponent(one[1]))
    if (req.method === "GET") {
      if (faults.readStatus) return send(faults.readStatus, { error: { message: "unavailable" } })
      return link?.live ? send(200, link) : send(404, { error: { code: "not_found" } })
    }
    if (req.method === "PATCH") {
      if (!link?.live) return send(404, { error: { code: "not_found" } })
      Object.assign(link, body)
      return send(200, link)
    }
    if (req.method === "DELETE") {
      if (link) link.live = false
      return send(204)
    }
  }
  send(404, { error: { code: "not_found" } })
})
await new Promise((ok) => papermark.listen(0, "127.0.0.1", ok))
process.env.PAPERMARK_API_BASE = `http://127.0.0.1:${papermark.address().port}`
process.env.PAPERMARK_API_TOKEN = "test-token-not-a-secret"
process.env.DATABASE_URL = process.env.APRI_TEST_DATABASE_URL

const recon = await import("../src/lib/subscriber-access-reconciliation.ts")
const library = await import("../src/lib/papermark-client-library.ts")
const policyDal = await import("../src/lib/access-policy-dal.ts")
const lifecycle = await import("../src/lib/dataroom-lifecycle.ts")
const principal = await import("../src/lib/subscriber-principal.ts")
const subscriberDal = await import("../src/lib/subscriber-dal.ts")

const tag = makeTag("lifecycle")
const ROOM1 = `${tag}_room1`
const ROOM2 = `${tag}_room2`
const TIER1 = `${tag}_T1`
const TIER2 = `${tag}_T2`

// Dates relative to today in Lagos, so fixtures never expire.
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
const day = (offset) => {
  const d = new Date(`${today}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}

let adminId
const pubs = {}
const rows = {}

async function publication(key, { editionDate, visibility = "L1", status = "draft", release = null, series = "MIN", plans = [] }) {
  const [row] = await sql`
    insert into documents (slug, title, series, visibility, status, is_published, edition_date, summary, cta_label, paid_release_state)
    values (${`${tag}_ed_${key}`}, ${`Edition ${key}`}, ${series}, ${visibility}, ${status}, ${status === "published"},
            ${editionDate}::date, 'test', 'Read', ${release})
    returning id`
  pubs[key] = row.id
  for (const plan of plans) await sql`insert into publication_plans (publication_id, public_tier, source) values (${row.id}::uuid, ${plan}, 'room')`
  return row.id
}
async function roomDocument(room, key, publicationKey) {
  const [row] = await sql`
    insert into papermark_dataroom_documents (papermark_dataroom_id, papermark_document_id, title, category, num_pages, publication_id, version_key)
    values (${room}, ${`${tag}_doc_${key}`}, ${`Edition ${key}.pdf`}, 'MIN', 10, ${publicationKey ? pubs[publicationKey] : null}::uuid, 'v1')
    returning id`
  rows[key] = row.id
  return row.id
}
async function seat(key, { tier = TIER1, level = "L1", status = "active", termStart = day(-30), termEnd = day(60), periods = [[day(-30), day(60), "L1"]], organization = "Test Org" } = {}) {
  const [row] = await sql`
    insert into subscribers (full_name, name, email, level, public_tier, status, seats, term_start, term_end, organization, client_type)
    values (${`Seat ${key}`}, ${`Seat ${key}`}, ${`${tag}_${key}@example.invalid`}, ${level}, ${tier}, ${status}, 1,
            ${termStart}::date, ${termEnd}::date, ${organization}, 'subscriber')
    returning id`
  for (const [s, e, l] of periods) {
    await sql`insert into subscriber_subscription_periods (subscriber_id, starts_on, ends_on, level, source) values (${row.id}::uuid, ${s}::date, ${e}::date, ${l}, 'test')`
  }
  return { id: row.id, email: `${tag}_${key}@example.invalid` }
}
/** A personal link issued earlier: live in the mock and recorded in the database. */
async function existingLink(subscriber, docKey) {
  const id = `pl_prior_${docKey}_${subscriber.id.slice(0, 8)}`
  links.set(id, {
    id, url: `https://docs.example.invalid/view/${id}`, document_id: `${tag}_doc_${docKey}`, dataroom_id: null, target_type: "document",
    expires_at: `${day(60)}T23:59:59.999Z`, allow_download: true, enable_watermark: true,
    watermark_config: { text: `APRI Subscriber Edition · ${subscriber.email} · {{date}}` }, enable_screenshot_protection: true, live: true,
  })
  await sql`
    insert into papermark_subscriber_document_links (subscriber_id, papermark_document_id, papermark_link_id, link_url, assigned_name, assigned_email, watermark_text, allow_download, screenshot_protection, expires_at)
    values (${subscriber.id}::uuid, ${`${tag}_doc_${docKey}`}, ${id}, ${`https://docs.example.invalid/view/${id}`}, 'Seat', ${subscriber.email}, 'x', true, true, ${`${day(60)}T23:59:59.999Z`}::timestamptz)`
  return id
}
const liveLinks = async (subscriberId) =>
  (await sql`select papermark_document_id, papermark_link_id from papermark_subscriber_document_links where subscriber_id = ${subscriberId}::uuid and revoke_state = 'live' order by papermark_document_id`)
const reconcile = async (id, trigger = "admin_repair") => {
  await recon.queueSubscriberAccessReconciliation(id, trigger)
  return recon.reconcileSubscriberAccess(id, { trigger })
}

before(async () => {
  const [admin] = await sql`insert into admins (email, name, password_hash, role) values (${`${tag}_admin@example.invalid`}, 'Test Admin', 'not-a-hash', 'owner') returning id`
  adminId = admin.id
  await sql`insert into papermark_level_rooms (public_tier, papermark_dataroom_id, dataroom_name) values (${TIER1}, ${ROOM1}, 'Room one'), (${TIER2}, ${ROOM2}, 'Room two')`
  // Room one: five editions whose records are drafts -- previously available through the Data Room.
  for (const [i, offset] of [[1, -20], [2, -15], [3, -10], [4, -5], [5, -2]]) {
    await publication(`d${i}`, { editionDate: day(offset), plans: [TIER1] })
    await roomDocument(ROOM1, `d${i}`, `d${i}`)
  }
  // Room two: released editions, one dated before a late starter's period.
  await publication("r1", { editionDate: day(-10), release: "released", plans: [TIER2] })
  await publication("r2", { editionDate: day(-3), release: "released", plans: [TIER2] })
  await publication("early", { editionDate: day(-45), release: "released", plans: [TIER2] })
  await roomDocument(ROOM2, "r1", "r1")
  await roomDocument(ROOM2, "r2", "r2")
  await roomDocument(ROOM2, "early", "early")
})

after(async () => {
  await sql`delete from papermark_dataroom_documents where papermark_dataroom_id in (${ROOM1}, ${ROOM2})`
  await sql`delete from papermark_level_rooms where public_tier in (${TIER1}, ${TIER2})`
  await sql`delete from subscriber_exception_events where subscriber_id in (select id from subscribers where email like ${`${tag}%`})`
  await sql`delete from subscriber_publication_exceptions where subscriber_id in (select id from subscribers where email like ${`${tag}%`})`
  await sql`delete from publication_release_events where publication_id in (select id from documents where slug like ${`${tag}%`})`
  await cleanup(tag)
  await sql`delete from admins where id = ${adminId}::uuid`
  papermark.close()
})

describe("existing subscribers are preserved", () => {
  it("a subscriber with five stored links keeps all five while the records are undecided drafts, and can open them", async () => {
    const s = await seat("five")
    for (let i = 1; i <= 5; i++) await existingLink(s, `d${i}`)
    const result = await reconcile(s.id)
    assert.equal(result.state, "complete", result.message)
    assert.equal(result.outcome, "ready_with_unresolved")
    assert.equal(result.counts.revoked, 0, "missing release decisions never revoke access")
    assert.equal((await liveLinks(s.id)).length, 5)
    const lib = await library.getDataRoomDocumentsForSubscriber(s.id)
    assert.equal(lib.state, "ready")
    assert.equal(lib.documents.length, 5)
    assert.ok(lib.documents.every((d) => d.delivery === "preserved"))
    const opened = await library.getDataRoomDocumentForSubscriber(s.id, rows.d1)
    assert.match(opened.documentLinkUrl, /^https:\/\/docs\.example\.invalid\/view\/pl_prior_d1_/)
  })

  it("a subscriber with no links and undecided records is told access is being prepared, not that it ended", async () => {
    const s = await seat("zero")
    const result = await reconcile(s.id)
    assert.equal(result.state, "complete", result.message)
    assert.equal(result.counts.created, 0, "nothing is issued for an undecided record")
    const lib = await library.getDataRoomDocumentsForSubscriber(s.id)
    assert.equal(lib.state, "ready")
    assert.equal(lib.documents.length, 0)
    assert.equal(lib.awaitingDetails, 5, "the portal knows documents are awaiting preparation")
    const me = await principal.loadSessionSubscriber(s.id)
    assert.equal(me.hasAccess, true, "the subscription itself is current")
  })

  it("a missing reconciliation row is created, not reported as a missing Data Room", async () => {
    const s = await seat("norow")
    await sql`delete from subscriber_access_reconciliations where subscriber_id = ${s.id}::uuid`
    const result = await recon.reconcileSubscriberAccess(s.id, { trigger: "admin_repair" })
    assert.notEqual(result.message, "No assigned Data Room to reconcile.")
    assert.equal(result.state, "complete", result.message)
    assert.equal((await sql`select count(*)::int as n from subscriber_access_reconciliations where subscriber_id = ${s.id}::uuid`)[0].n, 1)
  })
})

describe("released editions, exact links and the retired room link", () => {
  it("issues verified links for covered editions, retires the unrestricted room link, and the portal still lists and opens them", async () => {
    const s = await seat("room", { tier: TIER2, periods: [[day(-30), day(60), "L1"]] })
    // An unrestricted room link issued under the old flow.
    links.set("pl_room_old", { id: "pl_room_old", url: "https://docs.example.invalid/view/pl_room_old", dataroom_id: ROOM2, target_type: "dataroom", live: true })
    await sql`
      insert into papermark_dataroom_links (subscriber_id, papermark_dataroom_id, papermark_link_id, link_url, assigned_name, assigned_email, revoke_state)
      values (${s.id}::uuid, ${ROOM2}, 'pl_room_old', 'https://docs.example.invalid/view/pl_room_old', 'Seat', ${s.email}, 'live')`
    const result = await reconcile(s.id)
    assert.equal(result.state, "complete", result.message)
    assert.equal(result.outcome, "ready")
    assert.equal(result.counts.created, 2, "r1 and r2; the early edition is before the paid period")
    assert.equal(result.counts.roomLinksRetired, 1)
    assert.equal(links.get("pl_room_old").live, false, "withdrawn in Papermark")
    assert.equal((await sql`select count(*)::int as n from papermark_dataroom_links where subscriber_id = ${s.id}::uuid and revoke_state = 'live'`)[0].n, 0)
    const lib = await library.getDataRoomDocumentsForSubscriber(s.id)
    assert.equal(lib.state, "ready")
    assert.deepEqual(lib.documents.map((d) => d.delivery).sort(), ["open", "open"])
    const opened = await library.getDataRoomDocumentForSubscriber(s.id, rows.r1)
    assert.match(opened.documentLinkUrl, /^https:\/\/docs\.example\.invalid\/view\/pl_mock_/)
    assert.equal(await library.getDataRoomDocumentForSubscriber(s.id, rows.early), null, "an excluded edition does not open")
    // A second run changes nothing: idempotent.
    const before = calls.filter((c) => c.method === "POST").length
    const again = await reconcile(s.id)
    assert.equal(again.counts.created, 0)
    assert.equal(calls.filter((c) => c.method === "POST").length, before, "no duplicate Papermark links")
  })

  it("Allow issues an edition dated before the period; Block withdraws it; Automatic returns to the rule", async () => {
    const s = await seat("exceptions", { tier: TIER2, periods: [[day(-30), day(60), "L1"]] })
    await reconcile(s.id)
    await sql`insert into subscriber_publication_exceptions (subscriber_id, publication_id, decision, reason, administrator_id) values (${s.id}::uuid, ${pubs.early}::uuid, 'allow', 'Agreed back issue', ${adminId}::uuid)`
    await reconcile(s.id, "admin_change")
    assert.ok((await liveLinks(s.id)).some((l) => l.papermark_document_id === `${tag}_doc_early`), "allowed back issue issued")
    await sql`update subscriber_publication_exceptions set decision = 'block' where subscriber_id = ${s.id}::uuid and publication_id = ${pubs.early}::uuid`
    const blocked = await reconcile(s.id, "admin_change")
    assert.ok(blocked.counts.revoked >= 1)
    assert.ok(!(await liveLinks(s.id)).some((l) => l.papermark_document_id === `${tag}_doc_early`), "blocked edition withdrawn")
    await sql`delete from subscriber_publication_exceptions where subscriber_id = ${s.id}::uuid and publication_id = ${pubs.early}::uuid`
    await reconcile(s.id, "admin_change")
    assert.ok(!(await liveLinks(s.id)).some((l) => l.papermark_document_id === `${tag}_doc_early`), "Automatic: before the period, so not issued")
    assert.equal((await liveLinks(s.id)).length, 2)
  })

  it("a released draft record is issued; withholding it withdraws the links", async () => {
    const s = await seat("release")
    await sql`update documents set paid_release_state = 'released' where id = ${pubs.d3}::uuid`
    try {
      await reconcile(s.id)
      assert.ok((await liveLinks(s.id)).some((l) => l.papermark_document_id === `${tag}_doc_d3`))
      await sql`update documents set paid_release_state = 'withheld' where id = ${pubs.d3}::uuid`
      await reconcile(s.id, "release")
      assert.ok(!(await liveLinks(s.id)).some((l) => l.papermark_document_id === `${tag}_doc_d3`))
    } finally {
      await sql`update documents set paid_release_state = null where id = ${pubs.d3}::uuid`
    }
  })
})

describe("enforcement stays in force", () => {
  it("an ended term and a suspension withdraw links", async () => {
    const ended = await seat("ended", { tier: TIER2, termStart: day(-90), termEnd: day(-1), periods: [[day(-90), day(-1), "L1"]] })
    const suspended = await seat("suspended", { tier: TIER2, status: "suspended" })
    const a = await existingLink(ended, "r1")
    const b = await existingLink(suspended, "r1")
    await reconcile(ended.id)
    await reconcile(suspended.id)
    assert.equal((await liveLinks(ended.id)).length, 0)
    assert.equal((await liveLinks(suspended.id)).length, 0)
    assert.equal(links.get(a).live, false)
    assert.equal(links.get(b).live, false)
  })

  it("a level change moves the subscriber to the new room: old-room links withdrawn, new ones issued", async () => {
    const s = await seat("level", { tier: TIER1 })
    await sql`update documents set paid_release_state = 'released' where id = ${pubs.d5}::uuid`
    try {
      await reconcile(s.id)
      assert.ok((await liveLinks(s.id)).some((l) => l.papermark_document_id === `${tag}_doc_d5`))
      await sql`update subscribers set public_tier = ${TIER2} where id = ${s.id}::uuid`
      const moved = await lifecycle.reassignDataRoomOnLevelChange({ subscriberId: s.id, oldPublicTier: TIER1, newPublicTier: TIER2, changedById: adminId, changedByName: "Test Admin" })
      assert.equal(moved.action, "reassigned")
      const ids = (await liveLinks(s.id)).map((l) => l.papermark_document_id)
      assert.ok(!ids.includes(`${tag}_doc_d5`), "the old room's link is withdrawn")
      assert.ok(ids.includes(`${tag}_doc_r1`) && ids.includes(`${tag}_doc_r2`), "the new room's covered editions are issued")
    } finally {
      await sql`update documents set paid_release_state = null where id = ${pubs.d5}::uuid`
    }
  })
})

describe("concurrency, refusals and retries", () => {
  it("two runs at once never create duplicate links", async () => {
    const s = await seat("parallel", { tier: TIER2 })
    const posts = () => calls.filter((c) => c.method === "POST" && c.body.document_id?.startsWith(`${tag}_doc_r`)).length
    const before = posts()
    const [one, two] = await Promise.all([recon.reconcileSubscriberAccess(s.id, { trigger: "sync" }), recon.reconcileSubscriberAccess(s.id, { trigger: "admin_repair" })])
    assert.ok([one.state, two.state].includes("busy") || (one.state === "complete" && two.state === "complete"))
    assert.equal((await liveLinks(s.id)).length, 2)
    assert.ok(posts() - before <= 2, "each document minted at most once")
  })

  it("a change made while a run is in flight is never overtaken: a Block arriving mid-run leaves no link", async () => {
    const s = await seat("fenced", { tier: TIER2 })
    let struck = false
    faults.onCreate = async (link) => {
      if (struck || link.document_id !== `${tag}_doc_r1`) return
      struck = true
      // An administrator blocks r1 while its link is being minted.
      await sql`insert into subscriber_publication_exceptions (subscriber_id, publication_id, decision, reason, administrator_id) values (${s.id}::uuid, ${pubs.r1}::uuid, 'block', 'Mid-run block', ${adminId}::uuid)`
      await recon.queueSubscriberAccessReconciliation(s.id, "admin_change")
    }
    try {
      const result = await recon.reconcileSubscriberAccess(s.id, { trigger: "sync" })
      assert.equal(result.state, "complete", result.message)
    } finally {
      faults.onCreate = null
    }
    assert.ok(struck)
    assert.ok(!(await liveLinks(s.id)).some((l) => l.papermark_document_id === `${tag}_doc_r1`), "the stale decision was not recorded")
    const mintedForR1 = [...links.values()].filter((l) => l.document_id === `${tag}_doc_r1` && l.watermark_config?.text?.includes(s.email))
    assert.ok(mintedForR1.every((l) => !l.live), "the link minted under the old decision was withdrawn")
  })

  it("a Papermark refusal leaves the subscriber not ready, schedules a retry, and a retry completes", async () => {
    const s = await seat("refused", { tier: TIER2 })
    faults.createStatus = 500
    let first
    try {
      first = await reconcile(s.id)
    } finally {
      faults.createStatus = null
    }
    assert.equal(first.state, "failed")
    assert.equal(first.outcome, "partial")
    const [row] = await sql`select attempts, next_attempt_at from subscriber_access_reconciliations where subscriber_id = ${s.id}::uuid`
    assert.equal(row.attempts, 1)
    assert.ok(row.next_attempt_at, "a retry is scheduled")
    const retry = await reconcile(s.id)
    assert.equal(retry.state, "complete", retry.message)
    assert.equal((await liveLinks(s.id)).length, 2)
  })

  it("when Papermark cannot be read, stored links are reported unconfirmed and never revoked", async () => {
    const s = await seat("unreadable", { tier: TIER2 })
    await reconcile(s.id)
    faults.readStatus = 503
    let result
    try {
      result = await reconcile(s.id)
    } finally {
      faults.readStatus = null
    }
    assert.equal(result.state, "failed")
    assert.equal(result.counts.revoked, 0)
    assert.equal((await liveLinks(s.id)).length, 2, "an unreadable Papermark never costs a subscriber access")
  })
})

describe("isolation", () => {
  it("one subscriber cannot open another room's document, and a run touches only its own links", async () => {
    const a = await seat("isoA", { tier: TIER1 })
    const b = await seat("isoB", { tier: TIER2 })
    const aLink = await existingLink(a, "d2")
    assert.equal(await library.getDataRoomDocumentForSubscriber(b.id, rows.d2), null)
    const deletesBefore = calls.filter((c) => c.method === "DELETE").map((c) => c.id)
    await reconcile(b.id)
    const deletes = calls.filter((c) => c.method === "DELETE").map((c) => c.id).slice(deletesBefore.length)
    assert.ok(!deletes.includes(aLink))
    assert.equal(links.get(aLink).live, true)
  })

  it("each person on a Professional subscription gets links of their own", async () => {
    const one = await seat("pro1", { tier: TIER2, organization: `${tag} Firm` })
    const two = await seat("pro2", { tier: TIER2, organization: `${tag} Firm` })
    await reconcile(one.id)
    await reconcile(two.id)
    const l1 = await liveLinks(one.id)
    const l2 = await liveLinks(two.id)
    assert.equal(l1.length, 2)
    assert.equal(l2.length, 2)
    assert.equal(new Set([...l1, ...l2].map((l) => l.papermark_link_id)).size, 4, "no link is shared between people")
    for (const l of l1) assert.ok(links.get(l.papermark_link_id).watermark_config.text.includes(one.email))
  })
})

describe("plans decide who sees an edition, wherever the file sits", () => {
  it("an edition ticked for a second plan reaches that plan's subscribers from the first plan's room", async () => {
    const s = await seat("sharedPlan", { tier: TIER2 })
    await sql`update documents set paid_release_state = 'released' where id = ${pubs.d4}::uuid`
    await sql`insert into publication_plans (publication_id, public_tier, source) values (${pubs.d4}::uuid, ${TIER2}, 'admin')`
    try {
      await reconcile(s.id)
      assert.ok((await liveLinks(s.id)).some((l) => l.papermark_document_id === `${tag}_doc_d4`), "issued although the file is only in the other plan's room")
      await sql`delete from publication_plans where publication_id = ${pubs.d4}::uuid and public_tier = ${TIER2}`
      await reconcile(s.id, "release")
      assert.ok(!(await liveLinks(s.id)).some((l) => l.papermark_document_id === `${tag}_doc_d4`), "unticking the plan removes it")
    } finally {
      await sql`update documents set paid_release_state = null where id = ${pubs.d4}::uuid`
      await sql`delete from publication_plans where publication_id = ${pubs.d4}::uuid and public_tier = ${TIER2}`
    }
  })

  it("another plan's undecided editions never hold back this subscriber", async () => {
    const s = await seat("otherPlans", { tier: TIER2 })
    const result = await reconcile(s.id)
    assert.equal(result.outcome, "ready", "room one's undecided drafts are for another plan, not waiting for this one")
  })
})

describe("the legacy library uses the same policy", () => {
  it("lists a released covered edition with the subscriber's own copy, keeps an undecided one they already hold, hides a withheld one", async () => {
    const s = await seat("legacy", { tier: `${tag}_no_room` })
    const legacyPlan = `${tag}_no_room`
    const released = await publication("legacyReleased", { editionDate: day(-5), release: "released", plans: [legacyPlan] })
    const undecided = await publication("legacyDraft", { editionDate: day(-6), plans: [legacyPlan] })
    const withheld = await publication("legacyWithheld", { editionDate: day(-7), release: "withheld", plans: [legacyPlan] })
    for (const [pub, n] of [[released, 1], [undecided, 2], [withheld, 3]]) {
      await sql`insert into publication_access (subscriber_id, publication_id, link_url, papermark_link_id, revoke_state)
                values (${s.id}::uuid, ${pub}::uuid, ${`https://docs.example.invalid/view/legacy_${n}_${s.id.slice(0, 6)}`}, ${`legacy_${n}_${s.id.slice(0, 6)}`}, 'live')`
    }
    const me = await principal.loadSessionSubscriber(s.id)
    const items = await subscriberDal.getLibraryFor(me)
    const ids = items.map((i) => i.id)
    assert.ok(ids.includes(released))
    assert.ok(ids.includes(undecided), "kept open while undecided")
    assert.ok(!ids.includes(withheld))
    assert.equal((await recon.reconcileSubscriberAccess(s.id)).state, "not_applicable")
  })
})

describe("counts for Admin", () => {
  it("separates expected, linked, missing, excluded and unresolved", async () => {
    const s = await seat("counts", { tier: TIER2 })
    const access = await policyDal.loadSubscriberAccess(s.id)
    const c = policyDal.accessCounts(access.documents)
    assert.deepEqual({ expected: c.expected, linked: c.linked, missing: c.missing, excluded: c.excluded, unresolved: c.unresolved }, { expected: 2, linked: 0, missing: 2, excluded: 1, unresolved: 0 })
  })
})

describe("activation", () => {
  it("prepares and verifies a pending seat's library before making it active, recording the agreed term as a paid period", async () => {
    const { activateSubscriberRecord } = await import("../src/lib/subscriber-activation.ts")
    const s = await seat("activate", { tier: TIER2, status: "pending", termStart: null, termEnd: day(60), periods: [] })
    const result = await activateSubscriberRecord({ subscriberId: s.id, admin: { id: adminId, name: "Test Admin" } })
    assert.equal(result.state, "activated", result.message)
    const [row] = await sql`select status, to_char(term_start, 'YYYY-MM-DD') as term_start from subscribers where id = ${s.id}::uuid`
    assert.equal(row.status, "active")
    assert.equal(row.term_start, today)
    const periods = await sql`select source from subscriber_subscription_periods where subscriber_id = ${s.id}::uuid`
    assert.deepEqual(periods.map((p) => p.source), ["activation-agreed-term"])
    // Starting today: the editions already in the room are dated before the term.
    assert.equal((await liveLinks(s.id)).length, 0)
    const lib = await library.getDataRoomDocumentsForSubscriber(s.id)
    assert.equal(lib.state, "ready")
    assert.equal(lib.awaitingDetails, 0, "nothing is undecided: this is a legitimately empty library")
    assert.equal((await sql`select count(*)::int as n from papermark_dataroom_links where subscriber_id = ${s.id}::uuid`)[0].n, 0, "no unrestricted room link is created")
  })
})

describe("the recovery preview and rollout report", () => {
  it("include every subscriber, flag undecided editions already delivered, and never print a link", async () => {
    const report = await import("../src/lib/access-report.ts")
    const s = await seat("reportNoPeriods", { tier: TIER1, periods: [] })
    const inventory = await report.subscriberInventory({ ids: [s.id] })
    assert.equal(inventory.length, 1, "a subscriber with no paid periods is still listed")
    assert.ok(inventory[0].notes.some((n) => /No paid periods/.test(n)))
    assert.ok(!JSON.stringify(inventory).includes("pl_"), "no link id appears")
    const readiness = await report.publicationReadiness()
    const d1 = readiness.find((r) => r.publicationId === pubs.d1)
    assert.ok(d1.backfillCandidate, "a draft already issued to a paid subscriber is proposed for release")
    const r1 = readiness.find((r) => r.publicationId === pubs.r1)
    assert.equal(r1.backfillCandidate, false, "an explicitly released record is not")
    assert.ok(!JSON.stringify(readiness).includes("pl_"))
    assert.equal(report.monthNamedInTitle("PLM July 2026 Board Pack.pdf"), 7)
    assert.equal(report.monthNamedInTitle("Market outlook.pdf"), null)
  })
})
