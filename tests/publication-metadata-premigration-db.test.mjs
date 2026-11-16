/**
 * Publication metadata, tags and protected summaries on a database WITHOUT
 * db/migrations/20261114_publication_editorial_metadata.sql, then with it.
 *
 * Runs against this file's OWN in-memory database (the shared one already has
 * the new tables, and other files use it concurrently), taken back to the
 * schema before the migration by running its rollback, the way an existing
 * production database is until the migration runs:
 *
 *  - both subscriber library paths list, open and search exactly as before:
 *    no details, no tag filters, no summary, nothing fails;
 *  - the publication editor's panels and Admin -> Publication Tags load and
 *    say the migration is needed; every action refuses, naming it, and
 *    writes nothing;
 *  - applying the migration (twice) changes no existing value, after which
 *    saving details, tags, drafts and approvals works and readers see them.
 *
 * Invented data only. No Papermark, no email.
 */
import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fixtures, signIn, act } from "./publication-metadata-harness.mjs"
import { neon, neonConfig } from "@neondatabase/serverless"
import { randomBytes } from "node:crypto"
import { startTestDatabase } from "./support/test-database.mjs"
import { dataRoomLibraryView, legacyLibraryView } from "../src/lib/portal-library.ts"
import { libraryTagOptions } from "../src/lib/library-search.ts"
import { DEFAULT_CATALOGUE } from "../src/lib/publication-catalogue.ts"

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
const MIGRATION = read("db/migrations/20261114_publication_editorial_metadata.sql")
const ROLLBACK = read("db/rollback/20261114_publication_editorial_metadata.rollback.sql")

/** A psql-style script as single statements (dollar-quoted blocks kept whole), without its transaction lines. */
function statements(script) {
  const out = []
  let current = ""
  let inDollar = false
  for (const line of script.split(/\r?\n/)) {
    if ((line.match(/\$\$/g) ?? []).length % 2 === 1) inDollar = !inDollar
    current += `${line}\n`
    if (!inDollar && /;\s*(--.*)?$/.test(line)) {
      out.push(current)
      current = ""
    }
  }
  return out
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter((s) => s && !/^(begin|commit|set local)\b/i.test(s))
}

// A private database, pointed at before any application module creates its client.
const database = await startTestDatabase()
neonConfig.fetchEndpoint = () => database.endpoint
process.env.DATABASE_URL = database.databaseUrl
process.env.SESSION_SECRET = randomBytes(32).toString("hex")
const sql = neon(database.databaseUrl)
const run = async (script) => {
  for (const statement of statements(script)) await sql.query(statement)
}
// As an existing database is before the migration runs.
await run(read('db/rollback/20261115_stage3_publishing_workflow.rollback.sql'))
await run(ROLLBACK)

const metadataActions = await import("../src/app/actions/publication-metadata.ts")
const { submitPublicationSummary } = await import("../src/app/actions/publication-summaries.ts")
const session = await import("../src/lib/session.ts")
const { getSql } = await import("../src/lib/db.ts")
const mdal = await import("../src/lib/publication-metadata-dal.ts")
const { EDITORIAL_METADATA_PENDING } = await import("../src/lib/publication-metadata.ts")
const { getDataRoomDocumentsForSubscriber, getDataRoomDocumentForSubscriber } = await import("../src/lib/papermark-client-library.ts")
const { getLibraryFor } = await import("../src/lib/subscriber-dal.ts")

const fx = fixtures(sql, `t_pmpre_${randomBytes(3).toString("hex")}`)
const SUMMARY = {
  whatChanged: "The tariff order was gazetted.",
  whyItMatters: "Margins narrow.",
  implications: "Phased pass-through, or a suspended order.",
  watchNext: "The hearing in November.",
  sourceDate: "2026-10-02",
  uncertainty: "",
}
const summaryForm = (intent, revision) => ({ intent, revision: String(revision), ...SUMMARY })
let owner, editor, reader, legacyReader
const ed = {}

const documentsSnapshot = () => sql`select to_jsonb(d) as row from documents d order by id`

before(async () => {
  owner = await fx.admin("owner")
  editor = await fx.admin("editor")
  const room = await fx.plan("room")
  const legacyPlan = await fx.plan("legacy", { room: false })
  ed.room = await fx.edition("room", { title: "Tariff order note", series: "MIN", date: "2026-10-05", forTiers: [room.tier], dataroom: room.dataroom, summary: "Public teaser." })
  ed.legacy = await fx.edition("legacy", { title: "Legacy note", series: "PLM", date: "2026-10-04", forTiers: [legacyPlan.tier] })
  reader = await fx.subscriber("reader", room.tier)
  legacyReader = await fx.subscriber("lreader", legacyPlan.tier)
})

after(async () => {
  globalThis.__browser = "none"
  await database.stop()
})

describe("before the migration", () => {
  it("the database is at the earlier schema", async () => {
    const [row] = await sql`select to_regclass('public.publication_summaries') as s, to_regclass('public.publication_tags') as t,
      exists (select 1 from information_schema.columns where table_name = 'documents' and column_name = 'reading_time_minutes') as c`
    assert.deepEqual(row, { s: null, t: null, c: false })
    assert.equal(await mdal.editorialMetadataReady(getSql(), { fresh: true }), false)
  })

  it("both library paths list, open and search exactly as before: no details, no tag filters, no summary", async () => {
    const library = await getDataRoomDocumentsForSubscriber(reader)
    assert.equal(library.state, "ready")
    const card = library.documents.find((d) => d.papermarkDocumentId === ed.room.papermarkDocumentId)
    assert.ok(card, "listed")
    assert.equal(card.details, null)
    const view = dataRoomLibraryView(library.documents, library.categories)
    const entry = view.entries.find((e) => e.id === card.id)
    assert.deepEqual(Object.keys(entry).sort(), ["description", "editionDate", "id", "series", "title"])
    assert.deepEqual(libraryTagOptions(view.entries), { subject: [], sector: [], geography: [] })
    assert.ok(await getDataRoomDocumentForSubscriber(reader, ed.room.documentRowId), "opens")

    const items = await getLibraryFor({ id: legacyReader, hasAccess: true, level: "L1" })
    const item = items.find((i) => i.id === ed.legacy.id)
    assert.ok(item, "listed")
    assert.equal(item.details, null)
    const legacyView = legacyLibraryView(items, DEFAULT_CATALOGUE)
    assert.deepEqual(libraryTagOptions(legacyView.entries), { subject: [], sector: [], geography: [] })
  })

  it("the editor's panels and the tag page load, and say the migration is needed", async () => {
    const panel = await mdal.loadEditorPanel(getSql(), ed.room.id)
    assert.equal(panel.ready, false)
    assert.equal(panel.summary, null)
    assert.deepEqual(panel.tags, [])
    assert.deepEqual(await mdal.loadTagVocabulary(getSql()), { ready: false, tags: [] })
    assert.match(EDITORIAL_METADATA_PENDING, /20261114_publication_editorial_metadata\.sql/)
    assert.match(EDITORIAL_METADATA_PENDING, /Author\/editor, covered period, information cut-off, reading time, subject\/sector\/geography tags and protected summaries/)
    // The page renders those panels disabled with that message, and survives a failing read.
    const page = read("src/app/admin/documents/[id]/page.tsx")
    assert.match(page, /loadEditorPanel\(sql, row\.id\)\.catch\(\(\) => null\)/)
    assert.match(page, /pendingMessage=\{panel \? EDITORIAL_METADATA_PENDING/)
  })

  it("every action refuses, naming the migration, and writes nothing", async () => {
    const before = await documentsSnapshot()
    await signIn(session, editor, "editor")
    const results = [
      await act(metadataActions.savePublicationDetails, { authorEditor: "APRI Research Team", readingMinutes: "12" }, ed.room.id),
      await act(metadataActions.addPublicationTag, { kind: "subject", label: "Tariffs" }),
      await act(submitPublicationSummary, summaryForm("draft", 0), ed.room.id),
    ]
    await signIn(session, owner, "owner")
    const someId = "00000000-0000-4000-8000-000000000001"
    results.push(
      await act(submitPublicationSummary, summaryForm("approve", 0), ed.room.id),
      await act(submitPublicationSummary, summaryForm("withdraw", 0), ed.room.id),
      await act(metadataActions.renamePublicationTag, { id: someId, label: "Renamed" }),
      await act(metadataActions.setPublicationTagActive, { id: someId, state: "retire" }),
      await act(metadataActions.deletePublicationTag, { id: someId }),
    )
    for (const result of results) {
      assert.equal(result.ok, undefined, JSON.stringify(result))
      assert.equal(result.message, EDITORIAL_METADATA_PENDING)
    }
    assert.deepEqual(await documentsSnapshot(), before)
  })

  it("an owner can still delete an unused publication record (its summary check needs no migration)", async () => {
    const spare = await fx.edition("spare", { title: "Unused duplicate", series: "MIN", date: "2026-10-01", status: "draft" })
    const { deleteDocument } = await import("../src/app/actions/documents.ts")
    await signIn(session, owner, "owner")
    const result = await deleteDocument(spare.id)
    assert.equal(result.ok, true, result.message)
    assert.equal((await sql`select count(*)::int as n from documents where id = ${spare.id}::uuid`)[0].n, 0)
  })
})

describe("applying the migration", () => {
  let before
  it("twice changes no existing value", async () => {
    before = await documentsSnapshot()
    await run(MIGRATION)
    await run(MIGRATION)
    const after = await sql`select to_jsonb(d) - array['author_editor', 'covered_period_start', 'covered_period_end', 'information_cutoff', 'reading_time_minutes'] as row from documents d order by id`
    assert.deepEqual(after, before)
  })

  it("after which details, tags, drafts and approvals save, and entitled readers see them on both paths", async () => {
    mdal.resetEditorialMetadataCache()
    await signIn(session, editor, "editor")
    const added = await act(metadataActions.addPublicationTag, { kind: "geography", label: "Lagos" })
    assert.equal(added.ok, true, added.message)
    const [lagos] = await sql`select id from publication_tags where label = 'Lagos'`
    for (const id of [ed.room.id, ed.legacy.id]) {
      const { detailsVersion } = await mdal.loadEditorPanel(getSql(), id)
      const saved = await act(metadataActions.savePublicationDetails, { detailsVersion, readingMinutes: "12", tags: [lagos.id] }, id)
      assert.equal(saved.ok, true, saved.message)
      assert.equal((await act(submitPublicationSummary, summaryForm("draft", 0), id)).ok, true)
    }
    await signIn(session, owner, "owner")
    for (const id of [ed.room.id, ed.legacy.id]) {
      const approved = await act(submitPublicationSummary, summaryForm("approve", 1), id)
      assert.equal(approved.ok, true, approved.message)
    }
    mdal.resetEditorialMetadataCache()
    const library = await getDataRoomDocumentsForSubscriber(reader)
    const card = library.documents.find((d) => d.papermarkDocumentId === ed.room.papermarkDocumentId)
    assert.equal(card.details.readingMinutes, 12)
    assert.deepEqual(card.details.tags.geography, ["Lagos"])
    assert.deepEqual(card.details.summary, SUMMARY)
    const items = await getLibraryFor({ id: legacyReader, hasAccess: true, level: "L1" })
    assert.deepEqual(items.find((i) => i.id === ed.legacy.id).details.summary, SUMMARY)
  })
})
