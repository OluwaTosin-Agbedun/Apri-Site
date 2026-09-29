/**
 * The Admin Engagement figures read every record -- Complimentary Review and
 * subscriber portal alike -- proved by running the real server code (the
 * resolver, the link list the poll walks, and the dashboard queries) against
 * the isolated test database.
 *
 * All data is invented (example.invalid addresses, made-up Papermark ids) and
 * removed afterwards. Nothing reaches Papermark, Resend or a real database.
 */
import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import { existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { sql, makeTag, makeSeat, cleanup } from "./helpers.mjs"

// Load the server modules as the app does: '@/...' paths, extensionless
// imports, and 'server-only' (a no-op outside a client bundle).
const SRC = fileURLToPath(new URL("../src/", import.meta.url))
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true }
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
process.env.DATABASE_URL = process.env.APRI_TEST_DATABASE_URL

const { recordView, attribute } = await import("../src/lib/view-attribution.ts")
const { knownLinkIds } = await import("../src/lib/papermark-collector.ts")
const analytics = await import("../src/lib/engagement-analytics.ts")
const { resolveWindow, orderFromCursor } = await import("../src/lib/engagement-metrics.ts")

const tag = makeTag("engrec")
const id = (name) => `${tag}_${name}`
const window = () => resolveWindow({ preset: "30d" })
const created = { editions: [], clientDocs: [], admins: [], clicks: [] }

let seat
let lapsed
let edition

async function view(name, { linkId, documentId, email, ago = 1 }) {
  return recordView({
    papermarkViewId: id(name),
    papermarkLinkId: linkId,
    papermarkDocumentId: documentId,
    viewerEmail: email,
    viewedAt: new Date(Date.now() - ago * 86_400_000).toISOString(),
    durationSeconds: null,
    completionPct: null,
    downloaded: false,
    source: "poll",
  })
}

before(async () => {
  seat = await makeSeat(tag, { suffix: "reader", level: "L2" })
  lapsed = await makeSeat(tag, { suffix: "lapsed", level: "L2", termStartDaysAgo: 400, termEndDaysAhead: -5 })

  const [e] = await sql`
    insert into review_publication_editions (series, title, papermark_document_id, secure_link_id, publication_state)
    values ('MIN', ${`Test edition ${tag}`}, ${id("doc-edition")}, ${id("link-edition")}, 'published')
    returning id
  `
  edition = e.id
  created.editions.push(edition)

  const [cd] = await sql`
    insert into papermark_client_documents (subscriber_id, papermark_document_id, papermark_link_id, title, share_url)
    values (${seat.id}::uuid, ${id("doc-folder")}, ${id("link-folder")}, 'Folder document', 'https://example.invalid/folder')
    returning id
  `
  created.clientDocs.push(cd.id)

  const [a] = await sql`
    insert into admins (email, name, password_hash, role)
    values (${`${tag}_admin@example.invalid`}, 'Test Admin', 'not-a-real-hash', 'editor')
    returning id
  `
  created.admins.push(a.id)
})

after(async () => {
  await sql`delete from document_views where papermark_view_id like ${`${tag}%`}`
  await sql`delete from publication_access_events where event_id like ${`${tag}%`}`
  if (created.clientDocs.length) await sql`delete from papermark_client_documents where id = any(${created.clientDocs}::uuid[])`
  if (created.editions.length) await sql`delete from review_publication_editions where id = any(${created.editions}::uuid[])`
  if (created.admins.length) await sql`delete from admins where id = any(${created.admins}::uuid[])`
  await cleanup(tag)
})

describe("the poll's link list", () => {
  it("includes review edition links and legacy client-folder links", async () => {
    const known = await knownLinkIds()
    assert.ok(known.has(id("link-edition")), "a review edition's link is polled")
    assert.ok(known.has(id("link-folder")), "a legacy portal folder link is polled")
  })

  it("rotates from where the last run stopped, so no link is starved", () => {
    assert.deepEqual(orderFromCursor(["c", "a", "b", "a"], null), ["a", "b", "c"])
    assert.deepEqual(orderFromCursor(["a", "b", "c"], "a"), ["b", "c", "a"])
    assert.deepEqual(orderFromCursor(["a", "b", "c"], "c"), ["a", "b", "c"])
    assert.deepEqual(orderFromCursor(["a", "b", "c"], "bb"), ["c", "a", "b"])
  })
})

describe("attribution", () => {
  it("credits a read on a review edition link to the Complimentary Review, never to a subscriber", async () => {
    const { attribution } = await view("prospect-1", {
      linkId: id("link-edition"),
      documentId: id("doc-edition"),
      email: `${tag}_prospect@example.invalid`,
    })
    assert.equal(attribution.readerType, "complimentary_review")
    assert.equal(attribution.matchedBy, "review-edition-link")
    assert.equal(attribution.subscriberId, null)
    assert.equal(attribution.slotKey, "MIN")
    const [row] = await sql`select reader_type, subscriber_id from document_views where papermark_view_id = ${id("prospect-1")}`
    assert.deepEqual([row.reader_type, row.subscriber_id], ["complimentary_review", null])
  })

  it("credits a read on a legacy portal folder link to its subscriber", async () => {
    const { attribution } = await view("folder-1", {
      linkId: id("link-folder"),
      documentId: id("doc-folder"),
      email: seat.email,
    })
    assert.equal(attribution.subscriberId, seat.id)
    assert.equal(attribution.readerType, "subscriber")
    assert.equal(attribution.matchedBy, "client-folder-link")
  })

  it("upgrades a read stored as unknown once its link is recognised", async () => {
    await sql`
      insert into document_views (papermark_view_id, papermark_link_id, papermark_document_id, viewer_email, reader_type, viewed_at, source)
      values (${id("late-1")}, ${id("link-edition")}, ${id("doc-edition")}, ${`${tag}_late@example.invalid`}, 'unknown', now() - interval '2 days', 'poll')
    `
    await view("late-1", { linkId: id("link-edition"), documentId: id("doc-edition"), email: `${tag}_late@example.invalid`, ago: 2 })
    const [row] = await sql`select reader_type from document_views where papermark_view_id = ${id("late-1")}`
    assert.equal(row.reader_type, "complimentary_review")
  })

  it("leaves a read on a link APRI does not know unmatched rather than guessed", async () => {
    const result = await attribute({
      papermarkViewId: id("stranger"),
      papermarkLinkId: id("link-nobody"),
      papermarkDocumentId: null,
      viewerEmail: `${tag}_stranger@example.invalid`,
      viewedAt: null,
      durationSeconds: null,
      completionPct: null,
      downloaded: false,
      source: "poll",
    })
    assert.equal(result.readerType, "unknown")
    assert.equal(result.subscriberId, null)
  })
})

describe("the dashboard tabs", () => {
  before(async () => {
    // A second prospect read and one by an administrator, who must not count.
    await view("prospect-2", { linkId: id("link-edition"), documentId: id("doc-edition"), email: `${tag}_prospect2@example.invalid` })
    await view("admin-1", { linkId: id("link-edition"), documentId: id("doc-edition"), email: `${tag}_admin@example.invalid` })
    await sql`
      insert into publication_access_events (event_id, visitor_id, slot_key, papermark_document_id, papermark_link_id, event_type, occurred_at)
      values (${id("click-1")}, 'visitor-a', 'MIN', ${id("doc-edition")}, ${id("link-edition")}, 'review_access_clicked', now() - interval '1 day')
    `
  })

  it("Publications lists the review edition with its own reads and clicks, excluding administrators", async () => {
    const rows = await analytics.getPublicationRows(window())
    const row = rows.find((r) => r.publicationId === edition)
    assert.ok(row, "the edition is listed")
    assert.equal(row.audience, "complimentary_review")
    assert.equal(row.slotKey, "MIN")
    assert.equal(row.uniqueReaders, 3, "two prospects and the late reader; the administrator is excluded")
    assert.equal(row.viewSessions, 3)
    assert.equal(row.accessClicks, 1)
    assert.equal(row.eligibleSubscribers, null)
  })

  it("Readers lists every prospect and the subscriber, newest first, without the administrator", async () => {
    const rows = await analytics.getReaderRows(window())
    const emails = rows.map((r) => r.email)
    assert.ok(emails.includes(`${tag}_prospect@example.invalid`))
    assert.ok(emails.includes(`${tag}_prospect2@example.invalid`))
    assert.ok(!emails.includes(`${tag}_admin@example.invalid`))
    const prospect = rows.find((r) => r.email === `${tag}_prospect@example.invalid`)
    assert.equal(prospect.readerType, "complimentary_review")
    assert.equal(prospect.documentsOpened, 1, "a review edition counts as a document opened")
    const subscriber = rows.find((r) => r.subscriberId === seat.id)
    assert.ok(subscriber, "the subscriber's folder read is listed")
    const times = rows.map((r) => (r.lastActivity ? Date.parse(r.lastActivity) : 0))
    assert.deepEqual(times, [...times].sort((a, b) => b - a))
  })

  it("Overview runs over every record type and includes the review reads", async () => {
    // Other test files add rows concurrently, so exact totals are not stable
    // here; the in-term rule itself is checked against the query source in
    // engagement-pipeline.test.mjs.
    const metrics = await analytics.getOverviewMetrics(window())
    assert.ok(metrics.viewSessions >= 4, "the three review reads and the folder read")
    assert.ok(metrics.uniqueProspectReaders >= 3)
    assert.ok(metrics.accessClicks >= 1)
    assert.equal(typeof metrics.activeSubscribers, "number")
    assert.ok(lapsed.id, "a lapsed seat exists alongside")
  })

  it("Diagnostics runs and does not report review edition or folder links as unknown", async () => {
    const d = await analytics.getDiagnostics()
    assert.equal(typeof d.unknownLinkIds, "number")
    const [{ n }] = await sql`
      select count(*)::int as n from document_views
      where papermark_view_id like ${`${tag}%`} and papermark_link_id = ${id("link-nobody")}
    `
    assert.equal(n, 0)
    assert.equal(typeof d.repairableRows, "number")
  })
})
