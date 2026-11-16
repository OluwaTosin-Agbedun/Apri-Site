/**
 * The publication catalogue against the isolated test database and the real
 * loaders: both subscriber library paths (Data Room and legacy) with editions
 * in all six categories plus ones awaiting a category, Complimentary Review
 * readers assigned different categories, the homepage offer rule, and the
 * owner-only Admin -> Publication Categories actions.
 *
 * What a reader may open is still decided only by the access policy (paid) or
 * by each edition's own recipients (review): a category only places a card.
 *
 * Readers on one plan whose terms run January-March and May onwards (a gap in
 * April), a May-only reader, individual Allow and Block, another plan's
 * editions. Invented data only. No Papermark, no email.
 */
import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { registerHooks, createRequire } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import { existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { randomBytes } from "node:crypto"
import { sql, makeTag } from "./helpers.mjs"
import { searchLibrary, EMPTY_LIBRARY_FILTERS } from "../src/lib/library-search.ts"
import { newestEdition, dataRoomLibraryView, legacyLibraryView } from "../src/lib/portal-library.ts"
import { UNASSIGNED_KEY, DEFAULT_FOLDER_MAPPINGS } from "../src/lib/publication-catalogue.ts"

// next/headers as a cookie jar (one browser at a time), next/cache as a no-op
// outside a request, and next/server's after() collected rather than run.
globalThis.__jars = new Map()
globalThis.__browser = "none"
const HEADERS = `
const jar = () => { const j = globalThis.__jars; if (!j.has(globalThis.__browser)) j.set(globalThis.__browser, new Map()); return j.get(globalThis.__browser) }
export async function cookies() {
  return {
    get: (name) => (jar().has(name) ? { name, value: jar().get(name).value } : undefined),
    set: (name, value, options = {}) => { if (options.maxAge === 0) jar().delete(name); else jar().set(name, { value, options }) },
    delete: (name) => { jar().delete(name) },
  }
}
export async function headers() { return new Headers() }
`
const CACHE = `export function revalidatePath() {} export function revalidateTag() {} export function unstable_cache(fn) { return fn }`
const NEXT_SERVER = pathToFileURL(createRequire(import.meta.url).resolve("next/server.js")).href
const SERVER = `export * from ${JSON.stringify(NEXT_SERVER)}
export function after(task) { (globalThis.__afterTasks ??= []).push(task) }`
const SRC = fileURLToPath(new URL("../src/", import.meta.url))
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true }
    if (specifier === "next/headers") return { url: `data:text/javascript,${encodeURIComponent(HEADERS)}`, shortCircuit: true }
    if (specifier === "next/cache") return { url: `data:text/javascript,${encodeURIComponent(CACHE)}`, shortCircuit: true }
    if (specifier === "next/server" && !context.parentURL?.includes("/node_modules/")) {
      return { url: `data:text/javascript,${encodeURIComponent(SERVER)}`, shortCircuit: true }
    }
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

process.env.DATABASE_URL = process.env.APRI_TEST_DATABASE_URL
process.env.SESSION_SECRET = randomBytes(32).toString("hex")

const { getDataRoomDocumentsForSubscriber, getDataRoomDocumentForSubscriber } = await import("../src/lib/papermark-client-library.ts")
const { getLibraryFor } = await import("../src/lib/subscriber-dal.ts")
const { getPublicationCatalogue, unassignedOverview, catalogueUsage } = await import("../src/lib/publication-catalogue-dal.ts")
const pubs = await import("../src/lib/publications.ts")
const reader = await import("../src/lib/review-reader.ts")
const session = await import("../src/lib/session.ts")
const categories = await import("../src/app/actions/publication-categories.ts")
const openRoute = await import("../src/app/review/library/open/[id]/route.ts")

const tag = makeTag("catalogue")
const FAR = "2099-12-31"
const tiers = []
const ids = {}
let owner, editor

async function plan(suffix, { room = true } = {}) {
  const tier = `${tag}_${suffix}`
  tiers.push(tier)
  const dataroom = room ? `${tag}_room_${suffix}` : null
  if (dataroom) await sql`insert into papermark_level_rooms (public_tier, papermark_dataroom_id, dataroom_name) values (${tier}, ${dataroom}, ${`Test room ${suffix}`})`
  return { tier, dataroom }
}

/** An active paid seat whose current term starts on `start`, with paid periods [from, to][]. */
async function subscriber(suffix, tier, start, periods = [[start, FAR]]) {
  const [row] = await sql`
    insert into subscribers (name, full_name, email, level, public_tier, status, seats, term_start, term_end, organization)
    values (${`Reader ${suffix}`}, ${`Reader ${suffix}`}, ${`${tag}_${suffix}@example.invalid`}, 'L1', ${tier}, 'active', 1, ${start}::date, ${FAR}::date, 'Test Org')
    returning id`
  for (const [from, to] of periods) {
    await sql`insert into subscriber_subscription_periods (subscriber_id, starts_on, ends_on, level, source) values (${row.id}::uuid, ${from}::date, ${to}::date, 'L1', 'test')`
  }
  return row.id
}

/** A released paid edition for `forTiers`, optionally filed in a Data Room folder. */
async function edition(key, { title, series = "", date, forTiers, dataroom = null, folder = null }) {
  const [row] = await sql`
    insert into documents (slug, title, series, visibility, status, is_published, edition_date, summary, paid_release_state)
    values (${`${tag}_${key}`}, ${title}, ${series}, 'L1', 'published', true, ${date}::date, ${`Summary of ${title}.`}, 'released')
    returning id`
  for (const tier of forTiers) await sql`insert into publication_plans (publication_id, public_tier, source) values (${row.id}::uuid, ${tier}, 'test')`
  let documentRowId = null
  if (dataroom) {
    // The stored "category" is deliberately misleading (the old substring
    // classifier's answer): it must play no part any more.
    const [dd] = await sql`
      insert into papermark_dataroom_documents (papermark_dataroom_id, papermark_document_id, title, category, folder_path, publication_id, version_key)
      values (${dataroom}, ${`${tag}_pm_${key}`}, ${`${title}.pdf`}, 'MIN', ${folder}, ${row.id}::uuid, 'v1')
      returning id`
    documentRowId = dd.id
  }
  ids[key] = { id: row.id, documentRowId, title }
  return ids[key]
}

const exception = (subscriberId, key, decision) => sql`
  insert into subscriber_publication_exceptions (subscriber_id, publication_id, decision, reason, administrator_id)
  values (${subscriberId}::uuid, ${ids[key].id}::uuid, ${decision}, 'Test decision', ${owner}::uuid)`

const R = {}
const L = {}

before(async () => {
  const [o] = await sql`insert into admins (email, name, password_hash, role) values (${`${tag}_owner@example.invalid`}, 'Test owner', 'not-a-hash', 'owner') returning id`
  const [e] = await sql`insert into admins (email, name, password_hash, role) values (${`${tag}_editor@example.invalid`}, 'Test editor', 'not-a-hash', 'editor') returning id`
  owner = o.id
  editor = e.id

  const room = await plan("room")
  const other = await plan("other")
  const legacyPlan = await plan("legacy", { room: false })
  const inRoom = { forTiers: [room.tier], dataroom: room.dataroom }

  // One edition in each category, some placed by their record's series, some
  // only by the folder they are filed in, and two awaiting a category.
  await edition("min_jan", { ...inRoom, title: "January monthly note", series: "MIN", date: "2026-01-20" })
  await edition("qib_apr", { ...inRoom, title: "April quarterly brief", series: "QIB", date: "2026-04-15" })
  await edition("aiu_may", { ...inRoom, title: "May intelligence update", series: "AIU", date: "2026-05-10" })
  await edition("plm_jun", { ...inRoom, title: "June landscape monitor", series: "PLM", date: "2026-06-01" })
  await edition("aeo_jul", { ...inRoom, title: "July election monitor", date: "2026-07-01", folder: "/election-and-democratic-governance-monitor" })
  await edition("qib_aug", { ...inRoom, title: "August quarterly brief", date: "2026-08-01", folder: "/quarterly-intelligence-briefs" })
  await edition("other_sep", { ...inRoom, title: "September assigned paper", date: "2026-09-01", folder: "/other-assigned-publications" })
  await edition("board_oct", { ...inRoom, title: "October board update", date: "2026-10-01", folder: "/board-intelligence-updates" })
  await edition("admin_nov", { ...inRoom, title: "MIN-2026-11 admin notes", date: "2026-11-01", folder: "/Admin" })
  await edition("other_plan", { forTiers: [other.tier], dataroom: other.dataroom, title: "Restricted quarterly brief", series: "QIB", date: "2026-06-15" })

  R.gap = await subscriber("gap", room.tier, "2026-05-01", [["2026-01-01", "2026-03-31"], ["2026-05-01", FAR]])
  R.may = await subscriber("may", room.tier, "2026-05-01")
  R.allow = await subscriber("allow", room.tier, "2026-05-01")
  R.block = await subscriber("block", room.tier, "2026-05-01", [["2026-01-01", "2026-03-31"], ["2026-05-01", FAR]])
  R.other = await subscriber("other", other.tier, "2026-01-01")
  await exception(R.allow, "qib_apr", "allow")
  await exception(R.block, "aeo_jul", "block")

  // The legacy library (no Data Room): records only, placed by their series.
  const inLegacy = { forTiers: [legacyPlan.tier] }
  await edition("l_min", { ...inLegacy, title: "Legacy monthly note", series: "MIN", date: "2026-02-01" })
  await edition("l_aiu", { ...inLegacy, title: "Legacy update", series: "AIU", date: "2026-05-05" })
  await edition("l_plm", { ...inLegacy, title: "Legacy monitor", series: "PLM", date: "2026-05-06" })
  await edition("l_aeo", { ...inLegacy, title: "Legacy election monitor", series: "AEO", date: "2026-05-07" })
  await edition("l_qib_apr", { ...inLegacy, title: "Legacy April brief", series: "QIB", date: "2026-04-10" })
  await edition("l_qib", { ...inLegacy, title: "Legacy quarterly brief", series: "QIB", date: "2026-05-08" })
  await edition("l_other", { ...inLegacy, title: "Legacy assigned paper", series: "OTHER", date: "2026-05-09" })
  await edition("l_none", { ...inLegacy, title: "Legacy unfiled paper", series: "", date: "2026-06-30" })
  L.gap = await subscriber("lgap", legacyPlan.tier, "2026-05-01", [["2026-01-01", "2026-03-31"], ["2026-05-01", FAR]])
  L.may = await subscriber("lmay", legacyPlan.tier, "2026-05-01")
  L.allow = await subscriber("lallow", legacyPlan.tier, "2026-05-01")
  L.block = await subscriber("lblock", legacyPlan.tier, "2026-05-01")
  await exception(L.allow, "l_qib_apr", "allow")
  await exception(L.block, "l_other", "block")
})

after(async () => {
  await sql`delete from subscriber_publication_exceptions where subscriber_id in (select id from subscribers where email like ${`${tag}%`})`
  await sql`delete from subscriber_subscription_periods where subscriber_id in (select id from subscribers where email like ${`${tag}%`})`
  await sql`delete from subscribers where email like ${`${tag}%`}`
  await sql`delete from papermark_dataroom_documents where papermark_dataroom_id like ${`${tag}%`}`
  await sql`delete from publication_plans where public_tier = any(${tiers}::text[])`
  await sql`delete from documents where slug like ${`${tag}%`}`
  await sql`delete from papermark_level_rooms where public_tier = any(${tiers}::text[])`
  await sql`delete from admins where id in (${owner}::uuid, ${editor}::uuid)`
})

/**
 * What the portal page builds for a Data Room reader: the same loader and the
 * same helper (dataRoomLibraryView) src/app/portal/page.tsx calls, so what is
 * asserted here is what is rendered.
 */
async function dataRoom(subscriberId) {
  const library = await getDataRoomDocumentsForSubscriber(subscriberId)
  assert.equal(library.state, "ready")
  const view = dataRoomLibraryView(library.documents, library.categories)
  assertConsistent(view)
  return { documents: library.documents, ...view }
}

/** The legacy path, exactly as the page builds it (legacyLibraryView over the owner's catalogue). */
async function legacy(subscriberId) {
  const library = await getLibraryFor({ id: subscriberId, hasAccess: true, level: "L1" })
  assert.ok(Array.isArray(library))
  const { categories } = await getPublicationCatalogue()
  const view = legacyLibraryView(library, categories)
  assertConsistent(view)
  return { documents: library, ...view }
}

/** Every listed edition is in exactly one section, and its search record is filed under that section. */
function assertConsistent(view) {
  const listed = view.sections.flatMap((s) => s.items.map((item) => [item.id, s.key]))
  assert.equal(listed.length, view.entries.length, "every search record is a listed card, and the reverse")
  for (const [id, key] of listed) assert.equal(view.entries.find((e) => e.id === id)?.series, key, id)
}

const titlesOf = (list) => list.map((d) => d.displayTitle ?? d.title).sort()
const sectionMap = (sections) => Object.fromEntries(sections.map((s) => [s.key, s.items.map((d) => d.displayTitle ?? d.title)]))
const find = (entries, filters, types) => searchLibrary(entries, { ...EMPTY_LIBRARY_FILTERS, ...filters }, types?.map((t) => t.value))

describe("Data Room library: every category, decided by the access policy", () => {
  it("a January-to-March and May-onwards reader sees all six categories and the awaiting section, but nothing from the April gap", async () => {
    const lib = await dataRoom(R.gap)
    const s = sectionMap(lib.sections)
    assert.deepEqual(Object.keys(s), ["MIN", "AIU", "PLM", "AEO", "QIB", "OTHER", UNASSIGNED_KEY], "catalogue order; awaiting a category last")
    assert.deepEqual(s.MIN, ["January monthly note"])
    assert.deepEqual(s.AIU, ["May intelligence update"])
    assert.deepEqual(s.PLM, ["June landscape monitor"])
    assert.deepEqual(s.AEO, ["July election monitor"], "placed by its mapped folder")
    assert.deepEqual(s.QIB, ["August quarterly brief"], "QIB is no longer hidden; the April brief falls in the gap")
    assert.deepEqual(s.OTHER, ["September assigned paper"], "Other only through the explicitly mapped folder")
    assert.deepEqual(s[UNASSIGNED_KEY], ["MIN-2026-11 admin notes", "October board update"], "an Admin folder is not MIN, and the board folder is not guessed")
    assert.ok(!lib.documents.some((d) => d.title.startsWith("Restricted")), "another plan's edition never appears")
  })

  it("cards carry the catalogue's singular labels, and a document with no category reads 'Publication'", async () => {
    const { documents } = await dataRoom(R.gap)
    const label = (t) => documents.find((d) => d.displayTitle === t).categoryLabel
    assert.equal(label("August quarterly brief"), "Quarterly Intelligence Brief")
    assert.equal(label("July election monitor"), "Election & Democratic Governance Monitor")
    assert.equal(label("September assigned paper"), "Other assigned publication")
    assert.equal(label("October board update"), "Publication")
  })

  it("a May-only reader: no January or April edition; MIN stays as an empty section; search types only from what they may see", async () => {
    const lib = await dataRoom(R.may)
    const s = sectionMap(lib.sections)
    assert.deepEqual(s.MIN, [], "an empty active category is still shown (with the 'none available' line)")
    assert.deepEqual(s.QIB, ["August quarterly brief"])
    assert.deepEqual(lib.types.map((t) => t.value), ["AIU", "PLM", "AEO", "QIB", "OTHER", UNASSIGNED_KEY], "MIN is not offered as a type: nothing permitted is in it")
    assert.match(find(lib.entries, { series: "MIN" }, lib.types).error, /publication type/)
    assert.deepEqual(find(lib.entries, { series: "QIB" }, lib.types).entries.map((e) => e.title), ["August quarterly brief"])
    assert.deepEqual(find(lib.entries, { series: UNASSIGNED_KEY }, lib.types).entries.map((e) => e.title).sort(), ["MIN-2026-11 admin notes", "October board update"])
    assert.equal(lib.documents.length, 7)
  })

  it("an individual Allow adds the April brief for that reader alone; a Block removes the July monitor for that reader alone", async () => {
    const allowed = await dataRoom(R.allow)
    assert.deepEqual(sectionMap(allowed.sections).QIB, ["August quarterly brief", "April quarterly brief"], "newest first")
    assert.equal(find(allowed.entries, { series: "QIB" }, allowed.types).entries.length, 2)
    const blocked = await dataRoom(R.block)
    assert.deepEqual(sectionMap(blocked.sections).AEO, [])
    assert.ok(!blocked.types.some((t) => t.value === "AEO"))
    assert.deepEqual(sectionMap((await dataRoom(R.gap)).sections).AEO, ["July election monitor"], "the other reader keeps it")
  })

  it("another plan's reader sees only their own plan's edition", async () => {
    const lib = await dataRoom(R.other)
    assert.deepEqual(titlesOf(lib.documents), ["Restricted quarterly brief"])
    assert.deepEqual(lib.types.map((t) => t.value), ["QIB"])
  })

  it("the single Latest is the newest edition across every category, and filtering never changes it", async () => {
    const lib = await dataRoom(R.may)
    assert.equal(lib.latest.displayTitle, "MIN-2026-11 admin notes", "even one awaiting a category")
    assert.equal(lib.latest, newestEdition(lib.documents), "the page's Latest is the newest permitted edition")
    find(lib.entries, { series: "QIB", query: "brief" }, lib.types)
    assert.equal(newestEdition(lib.documents), lib.latest)
  })

  it("opening a document asks the policy afresh, in every category", async () => {
    assert.ok(await getDataRoomDocumentForSubscriber(R.may, ids.qib_aug.documentRowId), "a folder-placed QIB edition opens")
    assert.ok(await getDataRoomDocumentForSubscriber(R.may, ids.board_oct.documentRowId), "so does one awaiting a category")
    assert.equal(await getDataRoomDocumentForSubscriber(R.may, ids.qib_apr.documentRowId), null, "outside the term")
    assert.equal(await getDataRoomDocumentForSubscriber(R.gap, ids.qib_apr.documentRowId), null, "inside the gap between paid periods")
    assert.ok(await getDataRoomDocumentForSubscriber(R.allow, ids.qib_apr.documentRowId))
    assert.equal(await getDataRoomDocumentForSubscriber(R.block, ids.aeo_jul.documentRowId), null)
    assert.equal(await getDataRoomDocumentForSubscriber(R.may, ids.other_plan.documentRowId), null)
  })

  it("search entries for the browser hold display fields only", async () => {
    const { entries } = await dataRoom(R.gap)
    for (const e of entries) assert.deepEqual(Object.keys(e).sort(), ["description", "editionDate", "id", "series", "title"])
    assert.ok(!JSON.stringify(entries).includes(`${tag}_pm_`))
  })
})

describe("Legacy library: the same rules", () => {
  it("every category, including an explicit OTHER record and one with no series", async () => {
    const lib = await legacy(L.gap)
    const s = sectionMap(lib.sections)
    assert.deepEqual(Object.keys(s), ["MIN", "AIU", "PLM", "AEO", "QIB", "OTHER", UNASSIGNED_KEY])
    assert.deepEqual(s.MIN, ["Legacy monthly note"])
    assert.deepEqual(s.QIB, ["Legacy quarterly brief"], "the April brief is in the gap")
    assert.deepEqual(s.OTHER, ["Legacy assigned paper"])
    assert.deepEqual(s[UNASSIGNED_KEY], ["Legacy unfiled paper"])
    assert.equal(lib.latest.title, "Legacy unfiled paper")
    assert.deepEqual(lib.types.map((t) => t.value), ["MIN", "AIU", "PLM", "AEO", "QIB", "OTHER", UNASSIGNED_KEY], "QIB, AEO and OTHER records are offered as types too")
  })

  it("May-only, Allow and Block decide what is listed and searchable, per reader", async () => {
    const may = await legacy(L.may)
    assert.deepEqual(sectionMap(may.sections).MIN, [])
    assert.ok(!may.types.some((t) => t.value === "MIN"))
    const allowed = await legacy(L.allow)
    assert.deepEqual(find(allowed.entries, { series: "QIB" }, allowed.types).entries.map((e) => e.title).sort(), ["Legacy April brief", "Legacy quarterly brief"])
    const blocked = await legacy(L.block)
    assert.deepEqual(sectionMap(blocked.sections).OTHER, [])
    assert.ok(!blocked.types.some((t) => t.value === "OTHER"))
    for (const lib of [may, allowed, blocked]) assert.ok(!lib.documents.some((d) => /quarterly brief$/i.test(d.title) && d.title.startsWith("Restricted")))
  })

  it("never lists another library's editions", async () => {
    const lib = await legacy(L.gap)
    assert.ok(!lib.documents.some((d) => /^(January|August|Restricted)/.test(d.title)))
  })
})

describe("Admin sees what has no category", () => {
  it("counts documents awaiting a category and names their unmapped folders", async () => {
    const catalogue = await getPublicationCatalogue({ fresh: true })
    assert.equal(catalogue.migrated, true)
    const pairs = (list) => list.map((f) => `${f.folderSlug}=${f.code}`).sort()
    assert.deepEqual(pairs(catalogue.folders.filter((f) => DEFAULT_FOLDER_MAPPINGS.some((d) => d.folderSlug === f.folderSlug))), pairs(DEFAULT_FOLDER_MAPPINGS), "the seeded mappings are in force")
    const overview = await unassignedOverview(sql, catalogue)
    assert.ok(overview.documents >= 2)
    const folders = Object.fromEntries(overview.folders.map((f) => [f.folder, f.documents]))
    assert.ok(folders["admin"] >= 1 && folders["board-intelligence-updates"] >= 1)
    assert.ok(overview.records >= 1, "a paid record with no series outside Data Rooms")
  })
})

// ---------------------------------------------------------------------------
// Complimentary Review
// ---------------------------------------------------------------------------

const RA = `${tag}_ra@example.invalid`
const RB = `${tag}_rb@example.invalid`
const RC = `${tag}_rc@example.invalid`
const ed = {}

async function reviewEdition(key, series, { state = "published", featured = false, copy = true } = {}) {
  const published = state === "published"
  const [row] = await sql`
    insert into review_publication_editions (series, title, edition_label, papermark_document_id, secure_link_id, secure_link_url,
        secure_link_document_id, secure_link_verified_at, publication_type, description, frequency, audience, publication_state,
        is_latest, complimentary_featured, edition_sort_key, owner_edited_fields, withdrawal_state, withdrawal_link_id)
    values (${series}, ${`${tag} ${key}`}, ${key}, ${`${tag}_rdoc_${key}`}, ${published ? `${tag}_rlink_${key}` : null},
        ${published ? `https://docs.example.invalid/view/${tag}_${key}` : ""}, ${`${tag}_rdoc_${key}`}, ${published ? new Date() : null},
        '', ${copy ? "Owner-written description." : ""}, '', '', ${state}, false, ${featured}, ${key},
        ${copy ? ["title", "description"] : []}::text[],
        ${state === "withdrawn" ? "revoking" : null}, ${state === "withdrawn" ? `${tag}_rold_${key}` : null})
    returning id, recipient_mode`
  ed[key] = row
}
const grant = (key, email) => sql`insert into review_edition_recipients (edition_id, email, source) values (${ed[key].id}::uuid, ${email}, 'owner')`

describe("Complimentary Review over the catalogue", () => {
  before(async () => {
    await sql`insert into app_settings (key, value) values ('review_library_enabled', 'true') on conflict (key) do update set value = 'true'`
    reader.resetReviewReaderSchemaCache()
    await reviewEdition("qib_pub", "QIB", { featured: true })
    await reviewEdition("aeo_pub", "AEO")
    await reviewEdition("min_pub", "MIN")
    await reviewEdition("qib_draft", "QIB", { state: "draft" })
    await reviewEdition("aeo_withdrawn", "AEO", { state: "withdrawn" })
    await reviewEdition("qib_other_reader", "QIB")
    await reviewEdition("other_unassigned", "OTHER")
    for (const k of ["qib_pub", "aeo_pub", "qib_draft", "aeo_withdrawn"]) await grant(k, RA)
    await grant("min_pub", RB)
    await grant("qib_other_reader", RC)
  })
  after(async () => {
    await sql`delete from review_reader_events where email like ${`${tag}%`}`
    await sql`delete from review_reader_sessions where email like ${`${tag}%`}`
    // This file's own SESSION_SECRET keys the rate-limit identity, so only its rows match.
    await sql`delete from review_rate_limits where identity_hash = ${reader.hashToken(`${process.env.SESSION_SECRET}:unknown`)}`
    await sql`delete from review_edition_recipients where email like ${`${tag}%`}`
    await sql`delete from review_publication_editions where title like ${`${tag}%`}`
  })

  it("a QIB and AEO reader sees exactly their published assigned editions, in catalogue order; a MIN reader only theirs", async () => {
    const a = await pubs.getReviewLibraryForEmail(RA)
    assert.deepEqual(a.map((c) => c.id), [ed.aeo_pub.id, ed.qib_pub.id], "AEO before QIB, as in the catalogue")
    assert.deepEqual(a.map((c) => c.slotKey), ["AEO", "QIB"])
    const b = await pubs.getReviewLibraryForEmail(RB)
    assert.deepEqual(b.map((c) => c.id), [ed.min_pub.id])
  })

  it("draft, withdrawn and another reader's editions never open, by lookup or by the direct open route", async () => {
    for (const key of ["qib_draft", "aeo_withdrawn", "qib_other_reader", "min_pub", "other_unassigned"]) {
      assert.equal(await pubs.getReviewEditionForEmail(RA, ed[key].id), null, key)
    }
    assert.ok(await pubs.getReviewEditionForEmail(RA, ed.qib_pub.id))
    globalThis.__browser = "ra"
    await reader.createReaderSession(RA, "code")
    for (const key of ["qib_draft", "aeo_withdrawn", "qib_other_reader", "min_pub", "other_unassigned"]) {
      const response = await openRoute.GET(new Request(`http://localhost:3111/review/library/open/${ed[key].id}`), { params: Promise.resolve({ id: ed[key].id }) })
      assert.equal(response.status, 303, key)
      assert.equal(new URL(response.headers.get("location")).pathname + new URL(response.headers.get("location")).search, "/review/library?unavailable=1", key)
    }
    globalThis.__browser = "none"
  })

  it("a new edition in a newly supported category is assigned to nobody until an owner chooses its readers", async () => {
    assert.equal(ed.other_unassigned.recipient_mode, "edition", "per-edition readers by default, never the shared list")
    const [{ n }] = await sql`select count(*)::int as n from review_edition_recipients where edition_id = ${ed.other_unassigned.id}::uuid`
    assert.equal(n, 0)
    for (const email of [RA, RB, RC]) assert.ok(!(await pubs.getReviewLibraryForEmail(email)).some((c) => c.id === ed.other_unassigned.id))
    assert.ok(!(await pubs.getReviewPublicationArchive()).some((c) => c.id === ed.other_unassigned.id), "and it is not in the public archive")
  })

  it("the homepage offers only the edition an owner explicitly featured, whatever its category", async () => {
    const home = await pubs.getReviewLibrary()
    const mine = (home?.items ?? []).filter((c) => Object.values(ed).some((e) => e.id === c.id))
    assert.deepEqual(mine.map((c) => c.id), [ed.qib_pub.id])
  })

  it("the public archive lists published, assigned editions of every category in catalogue order", async () => {
    const archive = (await pubs.getReviewPublicationArchive()).filter((c) => Object.values(ed).some((e) => e.id === c.id))
    assert.deepEqual(archive.map((c) => c.slotKey), ["MIN", "AEO", "QIB", "QIB"])
    assert.ok(!archive.some((c) => c.id === ed.qib_draft.id || c.id === ed.aeo_withdrawn.id))
  })

  it("the database accepts every review category but BP", async () => {
    await assert.rejects(sql`update review_publication_editions set series = 'BP' where id = ${ed.min_pub.id}::uuid`, /review_publication_editions_series_check/)
  })
})

// ---------------------------------------------------------------------------
// Admin -> Publication Categories: owner only
// ---------------------------------------------------------------------------

/** Runs a server action as its form would: { to } when it redirected, otherwise what it returned. */
async function act(action, fields) {
  const form = new FormData()
  for (const [name, value] of Object.entries(fields)) form.set(name, value)
  try {
    return await action(undefined, form)
  } catch (error) {
    const digest = String(error?.digest ?? "")
    if (!digest.startsWith("NEXT_REDIRECT;")) throw error
    return { to: digest.split(";").slice(2, -2).join(";") }
  }
}
async function as(role) {
  globalThis.__browser = `admin-${role}`
  globalThis.__jars.delete(globalThis.__browser)
  if (role === "owner") await session.createSession({ adminId: owner, role: "owner" })
  // A forged cookie claiming "owner" for an editor account: the role is re-read from the database.
  if (role === "editor") await session.createSession({ adminId: editor, role: "owner" })
}

describe("Admin -> Publication Categories actions", () => {
  const slug = `${tag.replace(/_/g, "-")}-folder`
  after(async () => {
    await sql`delete from publication_category_folders where folder_slug like ${`${tag.replace(/_/g, "-")}%`}`
    globalThis.__browser = "none"
  })

  it("refuse anyone who is not signed in, and an editor even with a forged owner cookie, changing nothing", async () => {
    const before = await sql`select code, label, singular_label, sort_order, active from publication_categories order by code`
    for (const role of ["anonymous", "editor"]) {
      await as(role)
      const expected = role === "anonymous" ? "/admin/login" : "/admin"
      assert.equal((await act(categories.savePublicationCategory, { code: "QIB", label: "Hijacked", singularLabel: "Hijacked", sortOrder: "0", active: "on", aliases: "" })).to, expected, role)
      assert.equal((await act(categories.addFolderMapping, { folder: slug, code: "QIB" })).to, expected, role)
      assert.equal((await act(categories.removeFolderMapping, { folderSlug: "quarterly-intelligence-briefs" })).to, expected, role)
    }
    assert.deepEqual(await sql`select code, label, singular_label, sort_order, active from publication_categories order by code`, before)
    assert.equal((await sql`select 1 from publication_category_folders where folder_slug = ${slug}`).length, 0)
    assert.equal((await sql`select 1 from publication_category_folders where folder_slug = 'quarterly-intelligence-briefs'`).length, 1)
  })

  it("let the owner map and unmap a folder, refuse to re-point a mapped one, and validate input", async () => {
    await as("owner")
    const added = await act(categories.addFolderMapping, { folder: `${slug}`, code: "OTHER" })
    assert.equal(added.ok, true, added.message)
    assert.deepEqual(await sql`select category_code from publication_category_folders where folder_slug = ${slug}`, [{ category_code: "OTHER" }])
    const repoint = await act(categories.addFolderMapping, { folder: slug, code: "QIB" })
    assert.notEqual(repoint.ok, true)
    assert.match(repoint.message, /already mapped/)
    assert.deepEqual(await sql`select category_code from publication_category_folders where folder_slug = ${slug}`, [{ category_code: "OTHER" }], "never silently re-pointed")
    assert.match((await act(categories.addFolderMapping, { folder: "/a/b", code: "QIB" })).message, /one folder name/)
    assert.match((await act(categories.addFolderMapping, { folder: `${slug}-x`, code: "ZZZ" })).message, /Choose a category/)
    assert.match((await act(categories.addFolderMapping, { folder: `${slug}-bp`, code: "BP" })).message, /inactive/)
    assert.equal((await act(categories.removeFolderMapping, { folderSlug: slug })).ok, true)
    assert.equal((await sql`select 1 from publication_category_folders where folder_slug = ${slug}`).length, 0)
    assert.match((await act(categories.removeFolderMapping, { folderSlug: "Not a slug!" })).message, /Unknown folder mapping/)
  })

  it("refuse a new code or bad labels, and deactivating a category in use without confirmation", async () => {
    await as("owner")
    assert.match((await act(categories.savePublicationCategory, { code: "NEW", label: "x", singularLabel: "x", sortOrder: "1", active: "on" })).message, /migration/)
    assert.match((await act(categories.savePublicationCategory, { code: "QIB", label: " ", singularLabel: "x", sortOrder: "1", active: "on" })).message, /section label/)
    const usage = await catalogueUsage(sql)
    assert.ok(usage.get("MIN").publications > 0, "MIN is in use")
    const refused = await act(categories.savePublicationCategory, { code: "MIN", label: "Monthly Intelligence Notes", singularLabel: "Monthly Intelligence Note", sortOrder: "10", aliases: "" })
    assert.notEqual(refused.ok, true)
    assert.match(refused.message, /is in use/)
    assert.deepEqual(await sql`select active from publication_categories where code = 'MIN'`, [{ active: true }])
  })

  it("save an owner's edit (here BP, saved with its current values, so nothing else in the shared test database moves)", async () => {
    await as("owner")
    const [bp] = await sql`select label, singular_label, sort_order, active, aliases from publication_categories where code = 'BP'`
    const saved = await act(categories.savePublicationCategory, { code: "BP", label: bp.label, singularLabel: bp.singular_label, sortOrder: String(bp.sort_order), aliases: bp.aliases.join(", ") })
    assert.equal(saved.ok, true, saved.message)
    assert.deepEqual(await sql`select label, singular_label, sort_order, active, aliases from publication_categories where code = 'BP'`, [bp])
  })

  it("every action authorises itself before reading or writing anything", async () => {
    const { readFileSync } = await import("node:fs")
    const source = readFileSync(new URL("../src/app/actions/publication-categories.ts", import.meta.url), "utf8")
    for (const name of ["savePublicationCategory", "addFolderMapping", "removeFolderMapping"]) {
      const fn = source.slice(source.indexOf(`export async function ${name}`))
      const body = fn.slice(0, fn.indexOf("\nexport async function") > 0 ? fn.indexOf("\nexport async function") : undefined)
      assert.ok(body.indexOf("await requireOwner()") > 0 && body.indexOf("await requireOwner()") < body.indexOf("db()"), name)
    }
  })
})

// ---------------------------------------------------------------------------
// Records made from synced documents, the publishing rules and the readiness
// report all follow the catalogue (a separate plan and room with no readers,
// so nothing above moves)
// ---------------------------------------------------------------------------

describe("records, publishing and reports follow the catalogue", () => {
  let room
  const dd = {}
  const pubOf = async (key) => (await sql`select publication_id from papermark_dataroom_documents where id = ${dd[key]}::uuid`)[0].publication_id
  before(async () => {
    room = (await plan("sync")).dataroom
    // The stored category is the old classifier's stale snapshot ('MIN'): it must play no part.
    for (const [key, title, folder] of [
      ["other", "Assigned paper July 2026.pdf", "/other-assigned-publications"],
      ["other2", "Second assigned paper July 2026.pdf", "/other-assigned-publications"],
      ["board", "Board update July 2026.pdf", "/board-intelligence-updates"],
      ["aeo", "Election monitor July 2026.pdf", "/election-and-democratic-governance-monitor"],
    ]) {
      const [row] = await sql`
        insert into papermark_dataroom_documents (papermark_dataroom_id, papermark_document_id, title, category, folder_path, version_key)
        values (${room}, ${`${tag}_pm_sync_${key}`}, ${`${tag} ${title}`}, 'MIN', ${folder}, 'v1') returning id`
      dd[key] = row.id
    }
  })
  after(async () => {
    const pubs = (await sql`select publication_id from papermark_dataroom_documents where papermark_dataroom_id = ${room} and publication_id is not null`).map((r) => r.publication_id)
    await sql`update papermark_dataroom_documents set publication_id = null where papermark_dataroom_id = ${room}`
    await sql`delete from publication_plans where publication_id = any(${pubs}::uuid[])`
    await sql`delete from documents where id = any(${pubs}::uuid[])`
    globalThis.__browser = "none"
  })

  it("a record made from a document in a folder explicitly mapped to Other Assigned Publications stores OTHER, with no invented edition code; an unmapped folder stores no series", async () => {
    const dal = await import("../src/lib/dataroom-dal.ts")
    for (const key of ["other", "other2", "board", "aeo"]) await dal.createPublicationForSyncedDocument({ documentRowId: dd[key] })
    const record = async (key) => (await sql`select series, code, status from documents where id = ${await pubOf(key)}::uuid`)[0]
    assert.deepEqual(await record("other"), { series: "OTHER", code: null, status: "draft" })
    assert.deepEqual(await record("other2"), { series: "OTHER", code: null, status: "draft" }, "two in one month: no edition-code clash")
    assert.equal((await record("board")).series, "", "the board folder is not guessed")
    assert.equal((await record("aeo")).series, "AEO", "the AEO folder at the path Papermark stores")
    const rows = await dal.getSyncedDocumentsForRoom(room)
    assert.ok(!rows.find((r) => r.id === dd.other).missingFields.includes("Series"), "Data Rooms no longer reports a missing series for it")
    assert.ok(rows.find((r) => r.id === dd.board).missingFields.includes("Series"))
  })

  it("Generate details completes a missing series from an explicit OTHER mapping", async () => {
    const dal = await import("../src/lib/dataroom-dal.ts")
    await sql`update documents set series = '' where id = ${await pubOf("other")}::uuid`
    await dal.generateMissingDetailsForSingleDocument(dd.other)
    assert.equal((await sql`select series from documents where id = ${await pubOf("other")}::uuid`)[0].series, "OTHER")
  })

  it("publishing any paid edition -- in a category or awaiting one -- needs its edition date", async () => {
    const docs = await import("../src/app/actions/documents.ts")
    await as("owner")
    const board = await pubOf("board")
    await sql`update documents set edition_date = null where id = ${board}::uuid`
    const refused = await docs.setDocumentStatus(board, "published")
    assert.match(refused.message, /Add the edition date before publishing/)
    assert.equal((await sql`select status from documents where id = ${board}::uuid`)[0].status, "draft")
    await sql`update documents set edition_date = '2026-07-01' where id = ${board}::uuid`
    const held=await docs.setDocumentStatus(board, "published")
    assert.match(held.message,/editorial record|approval/)
    assert.equal((await sql`select status from documents where id=${board}::uuid`)[0].status,'draft', 'a date alone is no longer an editorial approval')
  })

  it("the readiness report compares a record's series with its folder's category as the portal places it today, not the stored snapshot", async () => {
    const report = await import("../src/lib/access-report.ts")
    await sql`update documents set series = 'AIU' where id = ${await pubOf("other2")}::uuid`
    await sql`update documents set series = 'QIB' where id = ${await pubOf("board")}::uuid`
    const readiness = await report.publicationReadiness()
    const flagsOf = async (key) => {
      const pub = await pubOf(key)
      return readiness.find((r) => r.publicationId === pub)?.flags ?? []
    }
    assert.ok(!(await flagsOf("aeo")).some((f) => /differs/.test(f)), "AEO in the AEO folder agrees, although the stored snapshot says MIN")
    assert.ok((await flagsOf("other2")).includes("Series AIU differs from the Data Room folder category (OTHER)."), "an explicit OTHER folder counts")
    assert.ok(!(await flagsOf("board")).some((f) => /differs/.test(f)), "an unmapped folder has no category to differ from")
  })
})

describe("Complimentary Review copy is the owner's own outside MIN, AIU and PLM", () => {
  let id
  const MIN = { title: "Nigeria Political & Regulatory Environment" }
  before(async () => {
    const { generateReviewMetadata } = await import("../src/lib/review-classify.ts")
    MIN.description = generateReviewMetadata("MIN", "June 2026.pdf").description
    const [row] = await sql`
      insert into review_publication_editions (series, title, edition_label, papermark_document_id, secure_link_id, secure_link_url,
          secure_link_document_id, secure_link_verified_at, publication_type, description, frequency, audience, publication_state,
          is_latest, complimentary_featured, edition_sort_key, owner_edited_fields)
      values ('MIN', ${MIN.title}, 'June 2026', ${`${tag}_rdoc_copy`}, ${`${tag}_rlink_copy`}, ${`https://docs.example.invalid/view/${tag}_copy`},
          ${`${tag}_rdoc_copy`}, now(), 'Monthly Intelligence Note', ${MIN.description}, 'Monthly', '', 'draft', false, false, 'June 2026', '{}'::text[])
      returning id`
    id = row.id
  })
  after(async () => {
    await sql`delete from review_publication_editions where id = ${id}::uuid`
    globalThis.__browser = "none"
  })

  it("moving a MIN draft to QIB unchanged saves, says why it cannot be published, and publishing is refused", async () => {
    const review = await import("../src/app/actions/review-library.ts")
    await as("owner")
    const details = { series: "QIB", editionLabel: "Q2 2026", title: MIN.title, publicationType: "Monthly Intelligence Note", description: MIN.description, frequency: "Monthly", audience: "" }
    const saved = await review.updateEditionDetails(id, details)
    assert.equal(saved.ok, true)
    assert.match(saved.message, /Before it can be published: The title or description is still the approved MIN card copy/)
    const [row] = await sql`select series, owner_edited_fields from review_publication_editions where id = ${id}::uuid`
    assert.equal(row.series, "QIB")
    assert.ok(row.owner_edited_fields.includes("title") && row.owner_edited_fields.includes("description"), "every field is marked owner-edited, which alone is not enough")
    const refused = await review.publishHistoricalEdition(id)
    assert.match(refused.message, /^Not published: The title or description is still the approved MIN card copy/)
    assert.equal((await sql`select publication_state from review_publication_editions where id = ${id}::uuid`)[0].publication_state, "draft")
  })

  it("once the owner writes QIB's own title and description, the copy rule no longer stops it", async () => {
    const review = await import("../src/app/actions/review-library.ts")
    await as("owner")
    const saved = await review.updateEditionDetails(id, { series: "QIB", editionLabel: "Q2 2026", title: "Quarterly outlook, second quarter", publicationType: "Quarterly brief", description: "The owner's own description of this brief.", frequency: "Quarterly", audience: "" })
    assert.equal(saved.message, "Edition details saved; its document and link were unchanged.")
    const next = await review.publishHistoricalEdition(id)
    assert.doesNotMatch(next.message, /card copy|Assign a category/)
    assert.match(next.message, /recipient/, "it now stops only at the next rule: no readers chosen")
    assert.equal((await sql`select publication_state from review_publication_editions where id = ${id}::uuid`)[0].publication_state, "draft")
  })
})
