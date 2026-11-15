/**
 * Subject, Sector and Geography filters over real subscriber libraries:
 * readers with different access, built by the real loaders for both paths
 * (Data Room and legacy) from the isolated test database, then filtered and
 * rendered exactly as the portal does.
 *
 *  - each reader's filter options come only from editions the access policy
 *    lists for them: never another plan's, a hidden (blocked) edition's, or
 *    an unused vocabulary tag's;
 *  - tag filters combine with keywords, publication type and dates, and the
 *    counts are of that reader's permitted editions only;
 *  - a label from someone else's editions is refused on its own control and
 *    reveals nothing;
 *  - search entries carry tag labels only: no tag id, link, Papermark id or
 *    reader activity.
 *
 * Invented data only. No Papermark, no email.
 */
import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { fileURLToPath } from "node:url"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { fixtures } from "./publication-metadata-harness.mjs"
import { sql, makeTag } from "./helpers.mjs"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { dataRoomLibraryView, legacyLibraryView } from "../src/lib/portal-library.ts"
import { EMPTY_LIBRARY_FILTERS, libraryTagOptions, searchLibrary } from "../src/lib/library-search.ts"
import { DEFAULT_CATALOGUE } from "../src/lib/publication-catalogue.ts"

registerHooks({
  load(url, context, next) {
    if (!url.startsWith("file:") || !url.endsWith(".tsx")) return next(url, context)
    const path = fileURLToPath(url)
    const { outputText } = ts.transpileModule(readFileSync(path, "utf8"), {
      fileName: path,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    })
    return { format: "module", source: outputText, shortCircuit: true }
  },
})

process.env.DATABASE_URL = process.env.APRI_TEST_DATABASE_URL

const { default: LibrarySearch } = await import("../src/components/LibrarySearch.tsx")
const { getDataRoomDocumentsForSubscriber } = await import("../src/lib/papermark-client-library.ts")
const { getLibraryFor } = await import("../src/lib/subscriber-dal.ts")

const tag = makeTag("tagfilter")
const fx = fixtures(sql, tag)

const R = {}
const ed = {}
const T = {}
let owner

async function dataRoomEntries(subscriberId) {
  const library = await getDataRoomDocumentsForSubscriber(subscriberId)
  assert.equal(library.state, "ready")
  const view = dataRoomLibraryView(library.documents, library.categories)
  return { documents: library.documents, entries: view.entries, types: view.types }
}
async function legacyEntries(subscriberId) {
  const items = await getLibraryFor({ id: subscriberId, hasAccess: true, level: "L1" })
  const view = legacyLibraryView(items, DEFAULT_CATALOGUE)
  return { items, entries: view.entries, types: view.types }
}
const titlesOf = (entries) => entries.map((e) => e.title).sort()
const selectOptions = (html, label) => {
  const m = html.match(new RegExp(`<label for="[^"]+"[^>]*>${label}<select[^>]*>([\\s\\S]*?)</select>`))
  return m ? [...m[1].matchAll(/<option value="([^"]*)"/g)].map((o) => o[1]).filter(Boolean) : null
}

before(async () => {
  owner = await fx.admin("owner")
  const a = await fx.plan("a")
  const b = await fx.plan("b")
  const legacyPlan = await fx.plan("legacy", { room: false })
  ed.a1 = await fx.edition("a1", { title: "Grid tariff reset", series: "MIN", date: "2026-03-10", forTiers: [a.tier], dataroom: a.dataroom, description: "Distribution margins" })
  ed.a2 = await fx.edition("a2", { title: "Port concession update", series: "AIU", date: "2026-05-02", forTiers: [a.tier], dataroom: a.dataroom })
  ed.blocked = await fx.edition("blocked", { title: "Blocked brief", series: "MIN", date: "2026-04-01", forTiers: [a.tier], dataroom: a.dataroom })
  ed.b1 = await fx.edition("b1", { title: "Upstream licensing round", series: "MIN", date: "2026-06-20", forTiers: [b.tier], dataroom: b.dataroom })
  ed.shared = await fx.edition("shared", { title: "Fiscal outlook", series: "AIU", date: "2026-07-01", forTiers: [a.tier, b.tier] })
  // The shared edition sits in both rooms (one record, two Data Room files).
  for (const [room, suffix] of [[a.dataroom, "a"], [b.dataroom, "b"]]) {
    await sql`
      insert into papermark_dataroom_documents (papermark_dataroom_id, papermark_document_id, title, category, publication_id, version_key)
      values (${room}, ${`${tag}_pm_shared_${suffix}`}, 'Fiscal outlook.pdf', 'AIU', ${ed.shared.id}::uuid, 'v1')`
  }
  ed.legacy = await fx.edition("legacy", { title: "Election calendar note", series: "PLM", date: "2026-08-15", forTiers: [legacyPlan.tier] })

  R.a = await fx.subscriber("a", a.tier)
  R.b = await fx.subscriber("b", b.tier)
  R.legacy = await fx.subscriber("legacy", legacyPlan.tier)
  await sql`insert into subscriber_publication_exceptions (subscriber_id, publication_id, decision, reason, administrator_id) values (${R.a}::uuid, ${ed.blocked.id}::uuid, 'block', 'Test block', ${owner}::uuid)`

  T.tariffs = await fx.tag("subject", "Tariffs")
  T.regulation = await fx.tag("subject", "Regulation")
  T.licensing = await fx.tag("subject", "Licensing")
  T.publicFinance = await fx.tag("subject", "Public finance")
  T.secret = await fx.tag("subject", "Sanctions watch")
  T.elections = await fx.tag("subject", "Elections")
  T.power = await fx.tag("sector", "Power")
  T.transport = await fx.tag("sector", "Transport")
  T.oil = await fx.tag("sector", "Oil and gas")
  T.lagos = await fx.tag("geography", "Lagos")
  T.rivers = await fx.tag("geography", "Rivers")
  T.unused = await fx.tag("geography", "Kano")
  T.retired = await fx.tag("sector", "Ports", { active: false })

  const assign = async (edition, ...tags) => { for (const t of tags) await fx.assign(edition.id, t.id) }
  await assign(ed.a1, T.tariffs, T.regulation, T.power, T.lagos)
  await assign(ed.a2, T.regulation, T.transport, T.lagos, T.retired)
  await assign(ed.blocked, T.secret, T.lagos)
  await assign(ed.b1, T.licensing, T.oil, T.rivers)
  await assign(ed.shared, T.publicFinance)
  await assign(ed.legacy, T.elections, T.lagos)
})

after(async () => {
  await fx.cleanup()
})

describe("tag filters over readers with different access", () => {
  it("each reader's options come only from their own permitted editions", async () => {
    const a = await dataRoomEntries(R.a)
    const b = await dataRoomEntries(R.b)
    const legacy = await legacyEntries(R.legacy)
    assert.deepEqual(titlesOf(a.entries), ["Fiscal outlook", "Grid tariff reset", "Port concession update"], "the blocked edition is not listed")
    assert.deepEqual(titlesOf(b.entries), ["Fiscal outlook", "Upstream licensing round"])
    assert.deepEqual(libraryTagOptions(a.entries), {
      subject: [T.publicFinance.label, T.regulation.label, T.tariffs.label],
      sector: [T.retired.label, T.power.label, T.transport.label],
      geography: [T.lagos.label],
    })
    assert.deepEqual(libraryTagOptions(b.entries), {
      subject: [T.licensing.label, T.publicFinance.label],
      sector: [T.oil.label],
      geography: [T.rivers.label],
    })
    assert.deepEqual(libraryTagOptions(legacy.entries), { subject: [T.elections.label], sector: [], geography: [T.lagos.label] })
    // Never a blocked edition's tag, nor a tag no permitted edition carries.
    for (const entries of [a.entries, b.entries, legacy.entries]) {
      const json = JSON.stringify(entries)
      assert.equal(json.includes(T.secret.label), false)
      assert.equal(json.includes(T.unused.label), false)
    }
  })

  it("tag filters combine with keywords, type and dates, counting only the reader's editions", async () => {
    const { entries } = await dataRoomEntries(R.a)
    const find = (filters) => searchLibrary(entries, { ...EMPTY_LIBRARY_FILTERS, ...filters })
    assert.equal(find({ geography: T.lagos.label }).entries.length, 2, "not the blocked edition, also in Lagos")
    assert.deepEqual(titlesOf(find({ subject: T.regulation.label, series: "MIN" }).entries), ["Grid tariff reset"])
    assert.deepEqual(titlesOf(find({ subject: T.regulation.label, query: "concession" }).entries), ["Port concession update"])
    assert.deepEqual(titlesOf(find({ geography: T.lagos.label, from: "2026-05-02", to: "2026-05-02" }).entries), ["Port concession update"])
    assert.deepEqual(find({ geography: T.lagos.label, from: "2026-07-01" }).entries, [])
    assert.deepEqual(titlesOf(find({ sector: T.retired.label }).entries), ["Port concession update"], "a retired tag still filters the editions carrying it")
    assert.deepEqual(titlesOf(find({ subject: T.publicFinance.label, series: "AIU", sector: "" }).entries), ["Fiscal outlook"])
  })

  it("a label from another reader's (or a blocked) edition is refused on its control and reveals nothing", async () => {
    const { entries } = await dataRoomEntries(R.a)
    for (const [kind, label] of [["subject", T.licensing.label], ["subject", T.secret.label], ["geography", T.rivers.label], ["sector", T.oil.label]]) {
      const result = searchLibrary(entries, { ...EMPTY_LIBRARY_FILTERS, [kind]: label })
      assert.equal(result.errorField, kind)
      assert.deepEqual(result.entries, [])
    }
  })

  it("the rendered controls offer each reader only their labels, and counts follow", async () => {
    const a = await dataRoomEntries(R.a)
    const b = await dataRoomEntries(R.b)
    const render = (data, initialFilters) => renderToStaticMarkup(createElement(LibrarySearch, {
      entries: data.entries,
      types: data.types,
      ...(initialFilters ? { initialFilters: { ...EMPTY_LIBRARY_FILTERS, ...initialFilters } } : {}),
    }, createElement("div", null)))
    const htmlA = render(a)
    assert.deepEqual(selectOptions(htmlA, "Subject"), [T.publicFinance.label, T.regulation.label, T.tariffs.label])
    assert.deepEqual(selectOptions(htmlA, "Geography"), [T.lagos.label])
    const htmlB = render(b)
    assert.deepEqual(selectOptions(htmlB, "Subject"), [T.licensing.label, T.publicFinance.label])
    assert.deepEqual(selectOptions(htmlB, "Sector"), [T.oil.label])
    for (const label of [T.tariffs.label, T.lagos.label, T.secret.label]) assert.equal(htmlB.includes(label), false, label)
    assert.match(render(a, { geography: T.lagos.label }), /role="status" aria-live="polite"[^>]*>2 of 3 editions match\.</)
    assert.match(render(b, { subject: T.publicFinance.label }), /role="status" aria-live="polite"[^>]*>1 of 2 editions match\.</)
  })

  it("search entries carry tag labels only: no tag id, link, Papermark id or reading activity", async () => {
    const a = await dataRoomEntries(R.a)
    const legacy = await legacyEntries(R.legacy)
    const ids = (await sql`select id from publication_tags where label like ${`% ${fx.short}`}`).map((r) => r.id)
    for (const entries of [a.entries, legacy.entries]) {
      const json = JSON.stringify(entries)
      for (const id of ids) assert.equal(json.includes(id), false)
      assert.doesNotMatch(json, /_pm_|https?:|papermark|viewed|downloaded|linkUrl/i)
      for (const entry of entries) {
        for (const key of Object.keys(entry)) assert.ok(["id", "series", "editionDate", "title", "description", "tags", "brief"].includes(key), key)
        for (const labels of Object.values(entry.tags ?? {})) for (const label of labels) assert.equal(typeof label, "string")
      }
    }
  })
})
