/**
 * The Engagement monitor end to end against the isolated test database, with a
 * mock Papermark on loopback: logins and portal visits, every reader listed,
 * per-edition page coverage from real collection, versions kept apart,
 * confirmed downloads only, duplicate polling and webhooks, rate limits and
 * permission refusals, and paid/complimentary isolation.
 *
 * Invented data only (example.invalid addresses, made-up Papermark ids).
 * Nothing reaches a real Papermark, Resend or database.
 */
import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { createServer } from "node:http"
import { createHmac, createHash } from "node:crypto"
import { fileURLToPath, pathToFileURL } from "node:url"
import { existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { sql, makeTag, makeSeat, makeEdition, cleanup } from "./helpers.mjs"

const SRC = fileURLToPath(new URL("../src/", import.meta.url))
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true }
    // Next's entry points are CommonJS files without an exports map entry for bare ESM.
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
// Mock Papermark: per-view analytics and document versions only.
// ---------------------------------------------------------------------------
const analytics = new Map()
const versions = new Map()
let mode = "normal"
const papermark = createServer((req, res) => {
  const send = (status, body, headers = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers })
    res.end(JSON.stringify(body))
  }
  const url = new URL(req.url, "http://mock")
  const view = url.pathname.match(/^\/v1\/analytics\/views\/([^/]+)$/)
  const docVersions = url.pathname.match(/^\/v1\/documents\/([^/]+)\/versions$/)
  if (view) {
    if (mode === "rate_limited") return send(429, { error: { code: "rate_limit_exceeded" } }, { "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 90) })
    if (mode === "forbidden") return send(403, { error: { code: "forbidden" } })
    const body = analytics.get(decodeURIComponent(view[1]))
    return body ? send(200, body) : send(404, { error: { code: "not_found" } })
  }
  if (docVersions) {
    const body = versions.get(decodeURIComponent(docVersions[1]))
    return body ? send(200, body) : send(404, { error: { code: "not_found" } })
  }
  send(404, { error: { code: "not_found" } })
})
await new Promise((ok) => papermark.listen(0, "127.0.0.1", ok))
process.env.PAPERMARK_API_BASE = `http://127.0.0.1:${papermark.address().port}`
process.env.PAPERMARK_API_TOKEN = "test-token-not-a-secret"
process.env.PAPERMARK_WEBHOOK_SECRET = "test-webhook-secret-not-real"
process.env.DATABASE_URL = process.env.APRI_TEST_DATABASE_URL

const { enrichViewPages, CAPABILITY_KEY } = await import("../src/lib/page-progress-collector.ts")
const monitor = await import("../src/lib/reader-monitoring.ts")
const { signInWithToken } = await import("../src/lib/magic-link.ts")
const webhook = await import("../src/app/api/papermark/webhook/route.ts")

const tag = makeTag("monitor")
const id = (name) => `${tag}_${name}`
const email = (name) => `${tag}_${name}@example.invalid`
const days = (n) => new Date(Date.now() - n * 86_400_000).toISOString()
const created = { editions: [], prospects: [], views: [] }

let A, B, C, D, pub
let editionE, editionW

async function view(name, fields) {
  const [row] = await sql`
    insert into document_views (
      papermark_view_id, subscriber_id, publication_id, papermark_link_id, papermark_document_id,
      viewer_email, reader_type, attribution_method, viewed_at, source
    ) values (
      ${id(name)}, ${fields.subscriberId ?? null}, ${fields.publicationId ?? null}, ${fields.linkId ?? null},
      ${fields.documentId ?? null}, ${fields.email ?? null}, ${fields.readerType}, ${fields.method ?? null},
      ${fields.viewedAt}::timestamptz, 'poll'
    ) returning id
  `
  if (fields.viewType) await sql`update document_views set view_type = ${fields.viewType} where id = ${row.id}::uuid`
  created.views.push(id(name))
  return row.id
}

async function event(subscriberId, type, at, webhookEventId = null) {
  await sql`
    insert into client_engagement_events (subscriber_id, event_type, occurred_at, webhook_event_id)
    values (${subscriberId}::uuid, ${type}, ${at}::timestamptz, ${webhookEventId})
  `
}

before(async () => {
  A = await makeSeat(tag, { suffix: "a" })
  B = await makeSeat(tag, { suffix: "b" })
  C = await makeSeat(tag, { suffix: "c" })
  D = await makeSeat(tag, { suffix: "d" })
  pub = await makeEdition(tag, { suffix: "p", series: "MIN", papermarkDocumentId: id("doc-P") })

  // A signed in 10 days ago and returned on a saved session yesterday.
  await event(A.id, "signin_email_sent", days(11))
  await event(A.id, "signin_completed", days(10))
  await event(A.id, "portal_opened", days(1))
  await event(A.id, "email_clicked", days(0.5))
  // A portal download button click: not a confirmed Papermark download.
  await event(A.id, "document_downloaded", days(2))
  // C only ever received and clicked an email.
  await event(C.id, "signin_email_sent", days(3))
  await event(C.id, "email_clicked", days(3))

  // Paid sessions for A on doc-P: two on version 1, one on version 2, one Data Room view.
  await view("a1", { subscriberId: A.id, publicationId: pub.id, documentId: id("doc-P"), readerType: "subscriber", method: "dataroom-link", viewedAt: days(5), email: A.email })
  await view("a2", { subscriberId: A.id, publicationId: pub.id, documentId: id("doc-P"), readerType: "subscriber", method: "dataroom-link", viewedAt: days(4), email: A.email })
  await view("a4", { subscriberId: A.id, publicationId: pub.id, documentId: id("doc-P"), readerType: "subscriber", method: "dataroom-link", viewedAt: days(1), email: A.email })
  await view("a3", { subscriberId: A.id, readerType: "subscriber", method: "dataroom-link", viewedAt: days(3), email: A.email, viewType: "DATAROOM_VIEW" })
  // A session on a document with no version list: its page total is unknown.
  await view("q1", { subscriberId: A.id, documentId: id("doc-Q"), readerType: "subscriber", method: "subscriber-document-link", viewedAt: days(2), email: A.email })
  await sql`
    insert into document_download_events (source_event_id, papermark_view_id, papermark_document_id, subscriber_id, publication_id, reader_type, downloaded_at, collection_source)
    values (${`view:${id("a2")}`}, ${id("a2")}, ${id("doc-P")}, ${A.id}::uuid, ${pub.id}::uuid, 'subscriber', ${days(4)}::timestamptz, 'poll')
  `

  analytics.set(id("a1"), { view_id: id("a1"), page_durations: [{ page_number: 1, duration_seconds: 30 }, { page_number: 20, duration_seconds: 5 }], total_duration_seconds: 35 })
  analytics.set(id("a2"), { view_id: id("a2"), page_durations: [{ page_number: 1, duration_seconds: 10 }, { page_number: 2, duration_seconds: 12 }], total_duration_seconds: 22 })
  analytics.set(id("a4"), { view_id: id("a4"), page_durations: [{ page_number: 1, duration_seconds: 5 }], total_duration_seconds: 5 })
  analytics.set(id("q1"), { view_id: id("q1"), page_durations: [{ page_number: 3, duration_seconds: 4 }], total_duration_seconds: null })
  versions.set(id("doc-P"), {
    data: [
      { id: id("ver2"), object: "document_version", version_number: 2, is_primary: true, num_pages: 24, created: days(2) },
      { id: id("ver1"), object: "document_version", version_number: 1, is_primary: false, num_pages: 20, created: days(30) },
    ],
  })

  // Complimentary Review: an edition with three recipients, and a withdrawn one.
  const [e] = await sql`
    insert into review_publication_editions (series, title, papermark_document_id, secure_link_id, publication_state)
    values ('AIU', ${`Review edition ${tag}`}, ${id("doc-E")}, ${id("link-E")}, 'published') returning id
  `
  editionE = e.id
  const [w] = await sql`
    insert into review_publication_editions (series, title, papermark_document_id, secure_link_id, publication_state,
      withdrawal_state, withdrawal_link_id, withdrawn_at)
    values ('PLM', ${`Withdrawn edition ${tag}`}, ${id("doc-W")}, null, 'withdrawn', 'revoked', ${id("link-W-old")}, now())
    returning id
  `
  editionW = w.id
  created.editions.push(editionE, editionW)
  for (const who of ["x", "y"]) {
    await sql`insert into review_edition_recipients (edition_id, email, source) values (${editionE}::uuid, ${email(who)}, 'owner')`
  }
  await sql`insert into review_edition_recipients (edition_id, email, source, revoked_at) values (${editionE}::uuid, ${email("z")}, 'owner', now())`
  const [p] = await sql`
    insert into review_prospects (full_name, email, role_profession, user_type, self_reported_source, attributed_source, verified_at)
    values ('Test Reader Y', ${email("y")}, 'Analyst', 'Individual professional', 'LinkedIn', 'LinkedIn', now())
    returning id
  `
  created.prospects.push(p.id)
  // Y reads the current edition and, before it was withdrawn, the other one.
  await view("y1", { linkId: id("link-E"), documentId: id("doc-E"), readerType: "complimentary_review", method: "review-edition-link", viewedAt: days(2), email: email("y") })
  await view("y2", { linkId: id("link-W-old"), documentId: id("doc-W"), readerType: "complimentary_review", method: "review-edition-link", viewedAt: days(20), email: email("y") })
  // B is a subscriber whose email is also a review reader's: a paid session under B.
  await sql`update subscribers set email = ${email("y")} where id = ${B.id}::uuid`
})

after(async () => {
  papermark.close()
  await sql`delete from review_edition_recipients where edition_id = any(${created.editions}::uuid[])`
  await sql`delete from document_views where papermark_view_id like ${`${tag}%`}`
  await sql`delete from document_download_events where source_event_id like ${`view:${tag}%`}`
  await sql`delete from papermark_document_versions where papermark_document_id like ${`${tag}%`}`
  await sql`delete from review_publication_editions where id = any(${created.editions}::uuid[])`
  if (created.prospects.length) await sql`delete from review_prospects where id = any(${created.prospects}::uuid[])`.catch(() => {})
  await sql`delete from client_engagement_events where subscriber_id in (select id from subscribers where email like ${`${tag}%`})`
  await sql`delete from app_settings where key = ${CAPABILITY_KEY}`
  await cleanup(tag)
})

const ALL = { q: "", level: "", status: "", series: "", range: null }

describe("logins and portal visits", () => {
  it("a login is a successful sign-in record only; a later portal visit on a saved session is separate", async () => {
    const detail = await monitor.getSubscriberMonitorDetail(A.id, { range: null, series: "" })
    // The sign-in 10 days ago -- not the email click half a day ago, nor the visit yesterday.
    assert.ok(Math.abs(Date.parse(detail.subscriber.lastLoginAt) - Date.parse(days(10))) < 5 * 60_000)
    assert.ok(Math.abs(Date.parse(detail.subscriber.lastPortalVisitAt) - Date.parse(days(1))) < 5 * 60_000)
    assert.ok(Date.parse(detail.subscriber.lastPortalVisitAt) > Date.parse(detail.subscriber.lastLoginAt))
  })

  it("an email sent, opened or clicked, or a failed or expired link, is never a login", async () => {
    // A token that does not exist, and an expired one: both fail, neither logs in.
    const bogus = await signInWithToken("x".repeat(43))
    assert.equal(bogus.ok, false)
    await sql`insert into auth_tokens (subscriber_id, token_hash, expires_at) values (${C.id}::uuid, ${"0".repeat(64)}, now() - interval '1 hour')`
    const rows = await monitor.listSubscriberReaders(ALL)
    const c = rows.find((r) => r.id === C.id)
    assert.equal(c.lastLoginAt, null, "No login recorded, not a date borrowed from other activity")
    assert.equal(c.lastPortalVisitAt, null)
  })
})

describe("every reader is listed", () => {
  it("includes subscribers with no recorded activity", async () => {
    const rows = await monitor.listSubscriberReaders(ALL)
    const d = rows.find((r) => r.id === D.id)
    assert.ok(d, "D has no activity and is still listed")
    assert.equal(d.sessions, 0)
    assert.equal(d.lastViewedAt, null)
  })

  it("counts a reader's sessions and editions, leaving out the Data Room room view", async () => {
    const rows = await monitor.listSubscriberReaders(ALL)
    const a = rows.find((r) => r.id === A.id)
    assert.equal(a.sessions, 4, "a1, a2, a4 and q1")
    assert.equal(a.editions, 2, "doc-P and doc-Q")
    assert.ok(a.lastViewedAt)
    const min = await monitor.listSubscriberReaders({ ...ALL, series: "MIN" })
    assert.equal(min.find((r) => r.id === A.id).sessions, 3, "only the MIN edition's sessions")
  })

  it("includes approved review recipients with no views, removed approvals as history, and names where given", async () => {
    const rows = await monitor.listReviewReaders(ALL)
    const x = rows.find((r) => r.email === email("x"))
    const y = rows.find((r) => r.email === email("y"))
    const z = rows.find((r) => r.email === email("z"))
    assert.ok(x && x.sessions === 0 && x.assignments.some((a) => a.state === "active"))
    assert.equal(x.name, null, "email is the fallback identity")
    assert.equal(y.name, "Test Reader Y")
    assert.ok(z.assignments.every((a) => a.state === "removed"))
  })
})

describe("page-level collection", () => {
  it("stores each session's pages and the exact version's page total", async () => {
    const summary = await enrichViewPages({ limit: 500, startedAt: Date.now(), budgetMs: 25_000 })
    assert.ok(summary.enriched >= 4)
    const rows = await sql`
      select papermark_view_id, document_version_number, total_pages, pages_viewed, furthest_page, enrichment_state
      from document_views where papermark_view_id = any(${[id("a1"), id("a2"), id("a4"), id("q1")]}::text[])
    `
    const by = Object.fromEntries(rows.map((r) => [r.papermark_view_id, r]))
    assert.deepEqual([by[id("a1")].document_version_number, by[id("a1")].total_pages, by[id("a1")].pages_viewed, by[id("a1")].furthest_page], [1, 20, 2, 20])
    assert.deepEqual([by[id("a4")].document_version_number, by[id("a4")].total_pages], [2, 24])
    assert.equal(by[id("q1")].total_pages, null, "no version list, no page total")
    assert.equal(by[id("q1")].enrichment_state, "partial")
  })

  it("upserts a repeated snapshot without duplicating pages, keeping the later progress", async () => {
    analytics.set(id("a1"), { view_id: id("a1"), page_durations: [{ page_number: 1, duration_seconds: 40 }, { page_number: 20, duration_seconds: 5 }, { page_number: 3, duration_seconds: 2 }], total_duration_seconds: 47 })
    await sql`update document_views set next_enrichment_at = now() - interval '1 minute' where papermark_view_id = ${id("a1")}`
    await enrichViewPages({ limit: 500, startedAt: Date.now(), budgetMs: 25_000 })
    const pages = await sql`
      select page_number, duration_seconds from document_view_pages
      where view_id = (select id from document_views where papermark_view_id = ${id("a1")}) order by page_number
    `
    assert.deepEqual(pages.map((p) => [p.page_number, Number(p.duration_seconds)]), [[1, 40], [3, 2], [20, 5]])
    const [row] = await sql`select pages_viewed, duration_seconds from document_views where papermark_view_id = ${id("a1")}`
    assert.equal(row.pages_viewed, 3)
    assert.equal(row.duration_seconds, 47)
  })

  it("a duplicate webhook for the same view changes nothing", async () => {
    const body = JSON.stringify({
      id: `evt_${tag}_dup`,
      event: "link.viewed",
      createdAt: new Date().toISOString(),
      data: { view: { viewId: id("a2"), viewedAt: days(4), email: A.email }, link: { id: null, documentId: id("doc-P") } },
    })
    const signature = createHmac("sha256", process.env.PAPERMARK_WEBHOOK_SECRET).update(body).digest("hex")
    for (let i = 0; i < 2; i++) {
      const res = await webhook.POST(new Request("http://localhost/api/papermark/webhook", { method: "POST", body, headers: { "x-papermark-signature": signature } }))
      assert.equal(res.status, 200)
    }
    const [{ n }] = await sql`select count(*)::int as n from document_views where papermark_view_id = ${id("a2")}`
    assert.equal(n, 1)
  })

  it("reads Papermark's nested link.viewed payload, which was dropped before", async () => {
    const body = JSON.stringify({
      id: `evt_${tag}_nested`,
      event: "link.viewed",
      createdAt: new Date().toISOString(),
      data: { view: { viewId: id("hook1"), viewedAt: new Date().toISOString(), email: email("y") }, link: { id: id("link-E"), documentId: id("doc-E") } },
    })
    const signature = createHmac("sha256", process.env.PAPERMARK_WEBHOOK_SECRET).update(body).digest("hex")
    const res = await webhook.POST(new Request("http://localhost/api/papermark/webhook", { method: "POST", body, headers: { "x-papermark-signature": signature } }))
    assert.equal(res.status, 200)
    const [row] = await sql`select reader_type, papermark_link_id, attribution_method from document_views where papermark_view_id = ${id("hook1")}`
    assert.deepEqual([row.reader_type, row.papermark_link_id, row.attribution_method], ["complimentary_review", id("link-E"), "review-edition-link"])
    created.views.push(id("hook1"))
  })
})

describe("one subscriber's publication activity", () => {
  it("is one row per edition and version, cumulative coverage deduplicated across sessions", async () => {
    const detail = await monitor.getSubscriberMonitorDetail(A.id, { range: null, series: "" })
    const p = detail.editions.filter((e) => e.editionKey === `pm:${id("doc-P")}`)
    assert.equal(p.length, 2, "version 1 and version 2 are separate rows")
    const v1 = p.find((e) => e.versionNumber === 1)
    const v2 = p.find((e) => e.versionNumber === 2)
    assert.equal(v1.sessions, 2)
    assert.equal(v1.coverage.pagesViewed, 4, "pages 1, 2, 3 and 20 of 20 across two sessions")
    assert.equal(v1.coverage.percent, 20)
    assert.equal(v1.coverage.furthestPage, 20)
    assert.equal(v2.coverage.pagesViewed, 1)
    assert.equal(v2.coverage.totalPages, 24)
  })

  it("leaves a Data Room room-view out of reading sessions", async () => {
    const detail = await monitor.getSubscriberMonitorDetail(A.id, { range: null, series: "" })
    const all = detail.editions.flatMap((e) => e.sessionDetails)
    assert.equal(all.length, 4, "a1, a2, a4 and q1; not the room view a3")
  })

  it("shows progress unavailable, not zero, when the page total is unknown", async () => {
    const detail = await monitor.getSubscriberMonitorDetail(A.id, { range: null, series: "" })
    const q = detail.editions.find((e) => e.editionKey === `pm:${id("doc-Q")}`)
    assert.equal(q.coverage.available, false)
    assert.equal(q.viewingSeconds, 4)
  })

  it("counts confirmed Papermark downloads only, never a portal button click", async () => {
    const detail = await monitor.getSubscriberMonitorDetail(A.id, { range: null, series: "" })
    const v1 = detail.editions.find((e) => e.versionNumber === 1)
    const v2 = detail.editions.find((e) => e.versionNumber === 2)
    assert.equal(v1.downloads.count, 1)
    assert.equal(v1.downloads.downloaded, true)
    assert.equal(v2.downloads.downloaded, false)
  })

  it("a selected period narrows the sessions, and a series filter narrows the editions", async () => {
    const lastTwoDays = { fromIso: days(1.5), toIso: new Date(Date.now() + 60_000).toISOString(), from: "", to: "" }
    const period = await monitor.getSubscriberMonitorDetail(A.id, { range: lastTwoDays, series: "" })
    assert.deepEqual(period.editions.map((e) => e.versionNumber), [2])
    const min = await monitor.getSubscriberMonitorDetail(A.id, { range: null, series: "MIN" })
    assert.ok(min.editions.every((e) => e.editionKey === `pm:${id("doc-P")}`))
  })
})

describe("paid and complimentary contexts stay apart", () => {
  it("one email that is both a subscriber and a review reader shows only its own context in each tab", async () => {
    const subs = await monitor.listSubscriberReaders(ALL)
    const b = subs.find((r) => r.id === B.id)
    assert.equal(b.email, email("y"))
    assert.equal(b.sessions, 0, "the review reads are not the subscriber's")
    const review = await monitor.listReviewReaders(ALL)
    const y = review.find((r) => r.email === email("y"))
    assert.ok(y.sessions >= 2)
    assert.ok(y.editions.every((e) => !e.editionKey.startsWith("pm:" + id("doc-P"))))
  })

  it("keeps a withdrawn edition's history under that edition", async () => {
    const review = await monitor.listReviewReaders(ALL)
    const y = review.find((r) => r.email === email("y"))
    const withdrawn = y.editions.find((e) => e.editionKey === `edition:${editionW}`)
    assert.ok(withdrawn, "the read on the link it had before withdrawal still counts")
    assert.match(withdrawn.title, /\(withdrawn\)/)
    assert.ok(y.editions.some((e) => e.editionKey === `edition:${editionE}`))
  })
})

describe("provider limits are reported, not hidden", () => {
  it("a rate limit stops the batch and schedules the retry, without marking the session done", async () => {
    await view("r1", { subscriberId: D.id, documentId: id("doc-P"), readerType: "subscriber", method: "dataroom-link", viewedAt: new Date().toISOString(), email: D.email })
    mode = "rate_limited"
    const summary = await enrichViewPages({ limit: 500, startedAt: Date.now(), budgetMs: 10_000 })
    mode = "normal"
    assert.equal(summary.rateLimited, true)
    const [row] = await sql`
      select count(*)::int as n from document_views
      where enrichment_state = 'rate_limited' and next_enrichment_at > now() and last_enriched_at is null
    `
    assert.ok(row.n >= 1)
  })

  it("a permission refusal is recorded for Diagnostics, and cleared once analytics answer again", async () => {
    // The preceding test intentionally persisted a 90-second provider cooldown.
    // Simulate its reset before testing a distinct 403 permission failure.
    await sql`update papermark_api_budgets set cooldown_until = 'epoch', next_slot_at = 'epoch'
      where bucket like ${`${createHash("sha256").update("test-token-not-a-secret").digest("hex")}%`}`
    await view("f1", { subscriberId: D.id, documentId: id("doc-P"), readerType: "subscriber", method: "dataroom-link", viewedAt: days(0.1), email: D.email })
    mode = "forbidden"
    const refused = await enrichViewPages({ limit: 500, startedAt: Date.now(), budgetMs: 10_000 })
    mode = "normal"
    assert.match(refused.notPermitted, /analytics\.read/)
    const status = await monitor.getMonitorStatus()
    assert.match(status.capability.message, /refused/)

    analytics.set(id("f1"), { view_id: id("f1"), page_durations: [{ page_number: 1, duration_seconds: 3 }], total_duration_seconds: 3 })
    await sql`update document_views set next_enrichment_at = now() - interval '1 minute' where papermark_view_id = ${id("f1")}`
    const ok = await enrichViewPages({ limit: 500, startedAt: Date.now(), budgetMs: 10_000 })
    assert.ok(ok.enriched >= 1)
    assert.equal((await monitor.getMonitorStatus()).capability, null)
  })
})
