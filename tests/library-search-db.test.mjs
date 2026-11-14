/**
 * Subscriber library search, against the isolated test database and the real
 * loaders the portal uses (getDataRoomDocumentsForSubscriber and
 * getLibraryFor), followed by exactly what the portal page hands the search:
 * dataRoomSearchEntry / legacySearchEntry over the permitted list, then
 * searchLibrary.
 *
 * Readers whose terms began in January and in May, on the same plan, with
 * individual Allow and Block exceptions, and a reader on another plan. Search
 * must only ever narrow what the access policy already gives each reader, in
 * results and counts, on both library paths, and must leave the document
 * opening check exactly as it was.
 *
 * Invented data only. No Papermark, no email.
 */
import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { loadApp } from "../scripts/lib/load-app.mjs"
import { sql, makeTag } from "./helpers.mjs"
import {
  searchLibrary,
  dataRoomSearchEntry,
  legacySearchEntry,
  EMPTY_LIBRARY_FILTERS,
} from "../src/lib/library-search.ts"
import { PORTAL_SERIES, newestEdition } from "../src/lib/portal-library.ts"

process.env.DATABASE_URL = process.env.APRI_TEST_DATABASE_URL

const { getDataRoomDocumentsForSubscriber, getDataRoomDocumentForSubscriber } = await loadApp("lib/papermark-client-library.ts")
const { getLibraryFor } = await loadApp("lib/subscriber-dal.ts")

const tag = makeTag("libsearch")
const FAR = "2099-12-31"
const tiers = []
let owner

async function plan(suffix, { room = true } = {}) {
  const tier = `${tag}_${suffix}`
  tiers.push(tier)
  const dataroom = room ? `${tag}_room_${suffix}` : null
  if (dataroom) {
    await sql`insert into papermark_level_rooms (public_tier, papermark_dataroom_id, dataroom_name) values (${tier}, ${dataroom}, ${`Test room ${suffix}`})`
  }
  return { tier, dataroom }
}

/** An active paid seat on `tier` whose term runs from `start` (a calendar date) to 2099. */
async function subscriber(suffix, tier, start) {
  const [row] = await sql`
    insert into subscribers (name, full_name, email, level, public_tier, status, seats, term_start, term_end, organization)
    values (${`Reader ${suffix}`}, ${`Reader ${suffix}`}, ${`${tag}_${suffix}@example.invalid`}, 'L1', ${tier}, 'active', 1,
            ${start}::date, ${FAR}::date, 'Test Org')
    returning id
  `
  await sql`
    insert into subscriber_subscription_periods (subscriber_id, starts_on, ends_on, level, source)
    values (${row.id}::uuid, ${start}::date, ${FAR}::date, 'L1', 'test')
  `
  return row.id
}

/** A released paid edition for `tiers`, dated `date` (or undated), optionally in a Data Room. */
async function edition(key, { title, series, date, summary, tiers: forTiers, dataroom = null }) {
  const [row] = await sql`
    insert into documents (slug, title, series, visibility, status, is_published, edition_date, summary, paid_release_state)
    values (${`${tag}_${key}`}, ${title}, ${series}, 'L1', 'published', true, ${date}::date, ${summary}, 'released')
    returning id
  `
  for (const tier of forTiers) {
    await sql`insert into publication_plans (publication_id, public_tier, source) values (${row.id}::uuid, ${tier}, 'test')`
  }
  let documentRowId = null
  if (dataroom) {
    const [dd] = await sql`
      insert into papermark_dataroom_documents (papermark_dataroom_id, papermark_document_id, title, category, publication_id, version_key)
      values (${dataroom}, ${`${tag}_pm_${key}`}, ${`${title}.pdf`}, ${series}, ${row.id}::uuid, 'v1')
      returning id
    `
    documentRowId = dd.id
  }
  return { id: row.id, documentRowId, title }
}

async function exception(subscriberId, publicationId, decision) {
  await sql`
    insert into subscriber_publication_exceptions (subscriber_id, publication_id, decision, reason, administrator_id)
    values (${subscriberId}::uuid, ${publicationId}::uuid, ${decision}, 'Test decision', ${owner}::uuid)
  `
}

/** Exactly what the portal page builds for a Data Room reader. */
async function dataRoom(subscriberId) {
  const library = await getDataRoomDocumentsForSubscriber(subscriberId)
  assert.equal(library.state, "ready")
  const editions = library.documents.filter((d) => PORTAL_SERIES.includes(d.series))
  return { editions, entries: editions.map(dataRoomSearchEntry) }
}

/** And for a legacy reader. */
async function legacy(subscriberId) {
  const library = await getLibraryFor({ id: subscriberId, hasAccess: true, level: "L1" })
  assert.ok(Array.isArray(library))
  const editions = library.filter((d) => PORTAL_SERIES.includes(d.series))
  return { editions, entries: editions.map(legacySearchEntry) }
}

const find = (entries, filters = {}) => searchLibrary(entries, { ...EMPTY_LIBRARY_FILTERS, ...filters })
const titles = (result) => result.entries.map((e) => e.title).sort()

let JAN, MAY, MAY_ALLOW, JAN_BLOCK, OTHER
let LJAN, LMAY, LMAY_ALLOW, LJAN_BLOCK
const JAN_LINK = `https://docs.example.invalid/view/${tag}_jan_personal_link`
const LEGACY_LINK = `https://docs.example.invalid/view/${tag}_ljan_stamped_copy`
const pub = {}

before(async () => {
  const [admin] = await sql`
    insert into admins (email, name, password_hash, role)
    values (${`${tag}_owner@example.invalid`}, 'Test owner', 'not-a-password-hash', 'owner')
    returning id
  `
  owner = admin.id

  const room = await plan("room")
  const other = await plan("other")
  const legacyPlan = await plan("legacy", { room: false })

  JAN = await subscriber("jan", room.tier, "2026-01-01")
  MAY = await subscriber("may", room.tier, "2026-05-01")
  MAY_ALLOW = await subscriber("may-allow", room.tier, "2026-05-01")
  JAN_BLOCK = await subscriber("jan-block", room.tier, "2026-01-01")
  OTHER = await subscriber("other", other.tier, "2026-01-01")

  const inRoom = { tiers: [room.tier], dataroom: room.dataroom }
  pub.january = await edition("january", { ...inRoom, title: "January electricity outlook", series: "MIN", date: "2026-01-15", summary: "Tariff reform and grid investment." })
  pub.may = await edition("may", { ...inRoom, title: "May fiscal review", series: "AIU", date: "2026-05-20", summary: "Revenue measures and electricity subsidies." })
  pub.september = await edition("september", { ...inRoom, title: "September election monitor", series: "PLM", date: "2026-09-10", summary: "Governorship primaries." })
  pub.undated = await edition("undated", { ...inRoom, title: "Undated ports briefing", series: "AIU", date: null, summary: "Concession terms." })
  pub.confidential = await edition("confidential", { tiers: [other.tier], dataroom: other.dataroom, title: "Bravo confidential electricity memo", series: "MIN", date: "2026-06-01", summary: "Restricted to another plan." })

  await exception(MAY_ALLOW, pub.january.id, "allow")
  await exception(MAY_ALLOW, pub.undated.id, "allow")
  await exception(JAN_BLOCK, pub.may.id, "block")

  // Legacy (no Data Room) editions on their own plan.
  LJAN = await subscriber("ljan", legacyPlan.tier, "2026-01-01")
  LMAY = await subscriber("lmay", legacyPlan.tier, "2026-05-01")
  LMAY_ALLOW = await subscriber("lmay-allow", legacyPlan.tier, "2026-05-01")
  pub.lJanuary = await edition("l-january", { tiers: [legacyPlan.tier], title: "January legacy energy note", series: "MIN", date: "2026-01-20", summary: "Generation shortfall." })
  pub.lMay = await edition("l-may", { tiers: [legacyPlan.tier], title: "May legacy policy update", series: "PLM", date: "2026-05-02", summary: "Cabinet changes." })
  await exception(LMAY_ALLOW, pub.lJanuary.id, "allow")
  LJAN_BLOCK = await subscriber("ljan-block", legacyPlan.tier, "2026-01-01")
  await exception(LJAN_BLOCK, pub.lJanuary.id, "block")

  // Real links and reading activity, so the payload test has something to catch.
  await sql`
    insert into papermark_subscriber_document_links (subscriber_id, papermark_document_id, papermark_link_id, link_url, allow_download)
    values (${JAN}::uuid, ${`${tag}_pm_january`}, ${`${tag}_jan_link_id`}, ${JAN_LINK}, true)
  `
  await sql`insert into document_views (papermark_view_id, subscriber_id, publication_id, papermark_document_id, source)
    values (${`${tag}_view_jan`}, ${JAN}::uuid, ${pub.may.id}::uuid, ${`${tag}_pm_may`}, 'webhook')`
  await sql`insert into publication_access (subscriber_id, publication_id, link_url, papermark_link_id)
    values (${LJAN}::uuid, ${pub.lJanuary.id}::uuid, ${LEGACY_LINK}, ${`${tag}_ljan_copy_id`})`
  await sql`insert into document_views (papermark_view_id, subscriber_id, publication_id, source)
    values (${`${tag}_view_ljan`}, ${LJAN}::uuid, ${pub.lJanuary.id}::uuid, 'webhook')`
})

after(async () => {
  await sql`delete from document_views where papermark_view_id like ${`${tag}%`}`
  await sql`delete from papermark_subscriber_document_links where papermark_document_id like ${`${tag}%`}`
  await sql`delete from publication_access where subscriber_id in (select id from subscribers where email like ${`${tag}%`})`
  await sql`delete from subscriber_publication_exceptions where subscriber_id in (select id from subscribers where email like ${`${tag}%`})`
  await sql`delete from subscriber_subscription_periods where subscriber_id in (select id from subscribers where email like ${`${tag}%`})`
  await sql`delete from subscribers where email like ${`${tag}%`}`
  await sql`delete from papermark_dataroom_documents where papermark_dataroom_id like ${`${tag}%`}`
  await sql`delete from publication_plans where public_tier = any(${tiers}::text[])`
  await sql`delete from documents where slug like ${`${tag}%`}`
  await sql`delete from papermark_level_rooms where public_tier = any(${tiers}::text[])`
  await sql`delete from admins where id = ${owner}::uuid`
})

describe("Data Room library: search narrows only what the access policy permits", () => {
  it("January versus May: an edition before the term start is not searchable, whatever the keywords", async () => {
    const jan = await dataRoom(JAN)
    const may = await dataRoom(MAY)
    assert.deepEqual(titles(find(jan.entries, { query: "january" })), ["January electricity outlook"])
    assert.deepEqual(titles(find(may.entries, { query: "january" })), [])
    assert.deepEqual(titles(find(may.entries, { query: "electricity" })), ["May fiscal review"], "the description matches, the earlier edition does not")
    assert.deepEqual(titles(find(may.entries, { from: "2026-01-01", to: "2026-04-30" })), [])
    assert.equal(find(may.entries, { query: "january" }).entries.length, 0)
    assert.equal(may.entries.length, 2, "May sees May and September only")
  })

  it("an individual Allow makes an earlier (and an undated) edition searchable for that reader alone", async () => {
    const allowed = await dataRoom(MAY_ALLOW)
    assert.deepEqual(titles(find(allowed.entries, { query: "january" })), ["January electricity outlook"])
    // Undated: listed and searchable without dates, never inside a date range.
    assert.deepEqual(titles(find(allowed.entries, { query: "ports" })), ["Undated ports briefing"])
    assert.deepEqual(titles(find(allowed.entries, { query: "ports", from: "2026-01-01" })), [])
    assert.deepEqual(titles(find(allowed.entries, { series: "AIU" })), ["May fiscal review", "Undated ports briefing"])
    assert.deepEqual(titles(find(allowed.entries, { series: "AIU", to: "2026-12-31" })), ["May fiscal review"])
    // The plain May reader is unaffected by another reader's exception.
    assert.deepEqual(titles(find((await dataRoom(MAY)).entries, { query: "ports" })), [])
  })

  it("an individual Block keeps an in-term edition out of that reader's search", async () => {
    const blocked = await dataRoom(JAN_BLOCK)
    assert.deepEqual(titles(find(blocked.entries, { query: "fiscal" })), [])
    assert.deepEqual(titles(find(blocked.entries, { series: "AIU" })), [])
    assert.deepEqual(titles(find((await dataRoom(JAN)).entries, { query: "fiscal" })), ["May fiscal review"])
  })

  it("another plan's edition never appears in results or counts, even for a keyword it alone matches", async () => {
    for (const reader of [JAN, MAY, MAY_ALLOW, JAN_BLOCK]) {
      const { entries } = await dataRoom(reader)
      assert.deepEqual(titles(find(entries, { query: "bravo" })), [])
      assert.deepEqual(titles(find(entries, { query: "restricted" })), [])
      assert.ok(!entries.some((e) => e.id === pub.confidential.documentRowId || /Bravo/.test(e.title)))
    }
    const other = await dataRoom(OTHER)
    assert.deepEqual(titles(find(other.entries, { query: "bravo" })), ["Bravo confidential electricity memo"])
    assert.deepEqual(titles(find(other.entries, { query: "january" })), [])
  })

  it("keywords, type and an inclusive date range combine on real records", async () => {
    const { entries } = await dataRoom(JAN)
    assert.deepEqual(titles(find(entries, { query: "electricity", series: "MIN", from: "2026-01-15", to: "2026-01-15" })), ["January electricity outlook"])
    assert.deepEqual(titles(find(entries, { query: "electricity", from: "2026-01-16" })), ["May fiscal review"])
    assert.deepEqual(titles(find(entries, { query: "electricity", series: "PLM" })), [])
    assert.deepEqual(titles(find(entries, { from: "2026-05-20", to: "2026-09-10" })), ["May fiscal review", "September election monitor"])
    assert.deepEqual(titles(find(entries)), titles({ entries }), "cleared filters show the whole permitted library")
  })

  it("the browser receives only display fields for searching: no link, Papermark id or reader activity", async () => {
    const { entries, editions } = await dataRoom(JAN)
    // The reader really has a personal link (with downloads) and a recorded view.
    const january = editions.find((d) => d.displayTitle === "January electricity outlook")
    assert.ok(january, "January edition listed")
    assert.ok(january.delivery === "open" && (await sql`select 1 from papermark_subscriber_document_links where link_url = ${JAN_LINK}`).length, "and it really has a live personal link")
    for (const entry of entries) assert.deepEqual(Object.keys(entry).sort(), ["description", "editionDate", "id", "series", "title"])
    for (const d of editions) {
      const entry = entries.find((e) => e.id === d.id)
      assert.equal(entry.description, [d.summary, d.kicker].filter(Boolean).join(" "), "description is the card's own text")
      assert.equal(entry.title, d.displayTitle)
    }
    const payload = JSON.stringify(entries)
    for (const secret of [JAN_LINK, `${tag}_jan_link_id`, `${tag}_pm_`, "Bravo", "viewed", "downloaded", "true"]) {
      assert.ok(!payload.includes(secret), secret)
    }
  })

  it("search changes neither the single Latest choice nor the document-opening check", async () => {
    const may = await dataRoom(MAY)
    const latest = newestEdition(may.editions)
    find(may.entries, { series: "PLM", query: "election" })
    assert.equal(newestEdition(may.editions), latest)
    // Opening still asks the policy afresh: the January edition stays closed to May,
    // the Bravo edition to everyone outside its plan.
    assert.equal(await getDataRoomDocumentForSubscriber(MAY, pub.january.documentRowId), null)
    assert.equal(await getDataRoomDocumentForSubscriber(JAN, pub.confidential.documentRowId), null)
    assert.equal(await getDataRoomDocumentForSubscriber(JAN_BLOCK, pub.may.documentRowId), null)
    assert.ok(await getDataRoomDocumentForSubscriber(MAY_ALLOW, pub.january.documentRowId))
  })
})

describe("Legacy library: the same rules", () => {
  it("January versus May, and an individual Allow, decide what is searchable", async () => {
    assert.deepEqual(titles(find((await legacy(LJAN)).entries, { query: "january" })), ["January legacy energy note"])
    assert.deepEqual(titles(find((await legacy(LMAY)).entries, { query: "january" })), [])
    assert.deepEqual(titles(find((await legacy(LMAY_ALLOW)).entries, { query: "january" })), ["January legacy energy note"])
    assert.deepEqual(titles(find((await legacy(LMAY)).entries, { series: "PLM", from: "2026-05-02", to: "2026-05-02" })), ["May legacy policy update"])
  })

  it("an individual Block keeps a legacy edition out of that reader's search and counts", async () => {
    const plain = await legacy(LJAN)
    const blocked = await legacy(LJAN_BLOCK)
    assert.deepEqual(titles(find(plain.entries, { query: "january" })), ["January legacy energy note"])
    assert.deepEqual(titles(find(blocked.entries, { query: "january" })), [])
    assert.deepEqual(titles(find(blocked.entries, { series: "MIN" })), [])
    assert.equal(blocked.entries.length, plain.entries.length - 1)
  })

  it("legacy entries carry display fields only, and never another library's editions", async () => {
    const { entries, editions } = await legacy(LJAN)
    // The reader really holds a stamped copy and a recorded view.
    assert.ok(editions.some((d) => d.linkUrl === LEGACY_LINK && d.viewedBySubscriber), "the copy and view are real")
    for (const entry of entries) assert.deepEqual(Object.keys(entry).sort(), ["description", "editionDate", "id", "series", "title"])
    for (const d of editions) {
      assert.equal(entries.find((e) => e.id === d.id).description, [d.summary, d.code].filter(Boolean).join(" "))
    }
    const payload = JSON.stringify(entries)
    for (const secret of [LEGACY_LINK, `${tag}_ljan_copy_id`, "true"]) assert.ok(!payload.includes(secret), secret)
    assert.deepEqual(titles(find(entries, { query: "electricity" })), [], "the Data Room plan's editions are not in this library")
    assert.deepEqual(titles(find(entries, { query: "generation" })), ["January legacy energy note"], "descriptions are searched")
  })
})
