/**
 * Papermark synchronisation, and every other writer of publication records,
 * never changes an edition's editorial metadata, tags or protected summary:
 *
 *  - the Data Room document snapshot (a renamed, re-versioned, removed and
 *    re-added file, and a repeat sync), as Admin's "Sync" and the Papermark
 *    webhook run it (src/lib/dataroom-dal.ts);
 *  - linking by Papermark id, creating-or-reusing the publication record
 *    (one file and the whole room, as the webhook does), and "generate
 *    missing details" for the room and for one document;
 *  - the publication editor's main form (public fields and the title
 *    override), which writes only its own columns.
 *
 * Afterwards the reader's library still shows the editorial title, the
 * stated metadata, the tags and the approved summary, and a draft is still
 * shown to no one. A source guard checks that no sync module names the new
 * columns or tables, and that every update of documents in the Data Room sync
 * fills a column only while it is blank.
 *
 * Against the isolated test database; no Papermark call is made (the
 * snapshot is passed in as Papermark would return it). Invented data only.
 */
import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fixtures, signIn, act } from "./publication-metadata-harness.mjs"
import { sql, makeTag } from "./helpers.mjs"
import { dataRoomLibraryView, legacyLibraryView } from "../src/lib/portal-library.ts"
import { EMPTY_LIBRARY_FILTERS, searchLibrary } from "../src/lib/library-search.ts"
import { DEFAULT_CATALOGUE } from "../src/lib/publication-catalogue.ts"

process.env.DATABASE_URL = process.env.APRI_TEST_DATABASE_URL

// Nothing may leave this machine: no Papermark, no Resend.
const outbound = []
const realFetch = globalThis.fetch
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url
  if (new URL(url).hostname !== "127.0.0.1") outbound.push(url)
  return realFetch(input, init)
}

const dal = await import("../src/lib/dataroom-dal.ts")
const metadataActions = await import("../src/app/actions/publication-metadata.ts")
const { submitPublicationSummary } = await import("../src/app/actions/publication-summaries.ts")
const { saveDocument } = await import("../src/app/actions/documents.ts")
const session = await import("../src/lib/session.ts")
const store = await import("../src/lib/publication-summaries.ts")
const { getDataRoomDocumentsForSubscriber } = await import("../src/lib/papermark-client-library.ts")
const { getLibraryFor } = await import("../src/lib/subscriber-dal.ts")
const mdal = await import("../src/lib/publication-metadata-dal.ts")
/** Saves reader details as the editor's form does, with the version of the page just loaded. */
const saveDetails = async (id, fields) =>
  act(metadataActions.savePublicationDetails, { detailsVersion: (await mdal.loadEditorPanel(sql, id)).detailsVersion, ...fields }, id)

const tag = makeTag("pubsync")
const fx = fixtures(sql, tag)

const SUMMARY = {
  whatChanged: "The regulator gazetted the revised quartz tariff order.",
  whyItMatters: "Distribution margins narrow in the first quarter.",
  implications: "Scenario one: phased pass-through. Scenario two: a suspended order.",
  watchNext: "The consultation on the order closes on 30 November.",
  sourceDate: "2026-10-02",
  uncertainty: "The pass-through schedule is unpublished.",
}
// An incomplete draft, its own words, so finding any of them is a leak.
const DRAFT = { whatChanged: "Unapproved sync draft obsidian.", whyItMatters: "", implications: "", watchNext: "", sourceDate: "", uncertainty: "" }
const FULL = { authorEditor: "APRA Research Team", coveredPeriodStart: "2026-09-01", coveredPeriodEnd: "2026-09-30", informationCutoff: "2026-09-28", readingMinutes: "14" }

let owner, editor, plan, reader, legacyReader
const ed = {}
const T = {}

const form = (text) => ({ whatChanged: text.whatChanged, whyItMatters: text.whyItMatters, implications: text.implications, watchNext: text.watchNext, sourceDate: text.sourceDate ?? "", uncertainty: text.uncertainty })
async function summary(adminId, role, id, intent, text) {
  await signIn(session, adminId, role)
  const revision = (await store.readStoredSummary(sql, id))?.revision ?? 0
  return act(submitPublicationSummary, { intent, revision: String(revision), ...form(text) }, id)
}

/** Everything an editor or owner saved on a record, plus its public fields: what no sync may change. */
async function editorial(id) {
  const [record] = await sql`
    select title, kicker, summary, description, strapline, coverage_areas, to_char(edition_date, 'YYYY-MM-DD') as edition_date,
           series, code, visibility, status, is_published, paid_release_state, portal_title_override,
           author_editor, to_char(covered_period_start, 'YYYY-MM-DD') as covered_period_start,
           to_char(covered_period_end, 'YYYY-MM-DD') as covered_period_end,
           to_char(information_cutoff, 'YYYY-MM-DD') as information_cutoff, reading_time_minutes
    from documents where id = ${id}::uuid`
  const tags = await sql`
    select a.tag_id, t.kind, t.label, t.active from publication_tag_assignments a join publication_tags t on t.id = a.tag_id
    where a.publication_id = ${id}::uuid order by t.kind, t.label`
  const [stored] = await sql`select to_jsonb(s) as row from publication_summaries s where s.publication_id = ${id}::uuid`
  return { record, tags, summary: stored?.row ?? null }
}
/** Only the new fields (metadata, tags, summary), for records whose blank public fields a sync may fill. */
async function editorialOnly(id) {
  const all = await editorial(id)
  const { author_editor, covered_period_start, covered_period_end, information_cutoff, reading_time_minutes } = all.record
  return { metadata: { author_editor, covered_period_start, covered_period_end, information_cutoff, reading_time_minutes }, tags: all.tags, summary: all.summary }
}

const snapshot = (versionKey, title) => [
  { documentId: ed.edited.papermarkDocumentId, title, category: "MIN", folderPath: "/monthly-intelligence-notes", numPages: 14, versionKey },
  { documentId: ed.sparse.papermarkDocumentId, title: "AIU-2026-09 Sector update.pdf", category: "AIU", folderPath: "/athena-intelligence-updates", numPages: 6, versionKey },
]

before(async () => {
  owner = await fx.admin("owner", "Owner Sync")
  editor = await fx.admin("editor", "Editor Sync")
  plan = await fx.plan("sync")
  const legacyPlan = await fx.plan("legacy", { room: false })
  reader = await fx.subscriber("reader", plan.tier)
  legacyReader = await fx.subscriber("lreader", legacyPlan.tier)

  ed.edited = await fx.edition("edited", { title: "Grid tariff reset: what changes", series: "MIN", date: "2026-10-05", forTiers: [plan.tier], dataroom: plan.dataroom, summary: "Public one-line teaser.", description: "Public description." })
  await sql`
    update documents set kicker = 'Editor issue line', strapline = 'Editor strapline', coverage_areas = ${"Power sector\nTariff regulation"},
           code = ${`${tag}-MIN-01`}, portal_title_override = true, papermark_document_id = ${ed.edited.papermarkDocumentId}
    where id = ${ed.edited.id}::uuid`
  ed.sparse = await fx.edition("sparse", { title: "Sparse record", series: "AIU", date: "2026-09-20", forTiers: [plan.tier], dataroom: plan.dataroom })
  ed.legacy = await fx.edition("legacy", { title: "Legacy record", series: "PLM", date: "2026-10-01", forTiers: [legacyPlan.tier], summary: "Legacy teaser." })

  T.subject = await fx.tag("subject", "Tariffs")
  T.sector = await fx.tag("sector", "Power")
  T.geography = await fx.tag("geography", "Lagos")
  T.retiring = await fx.tag("subject", "Regulation")

  await signIn(session, editor, "editor")
  for (const id of [ed.edited.id, ed.legacy.id]) {
    const saved = await saveDetails(id, { ...FULL, tags: [T.subject.id, T.sector.id, T.geography.id, T.retiring.id] })
    assert.equal(saved.ok, true, saved.message)
  }
  assert.equal((await saveDetails(ed.sparse.id, { readingMinutes: "5" })).ok, true)
  // A tag retired after it was assigned stays where it is.
  await signIn(session, owner, "owner")
  assert.equal((await act(metadataActions.setPublicationTagActive, { id: T.retiring.id, state: "retire" })).ok, true)

  for (const id of [ed.edited.id, ed.legacy.id]) {
    assert.equal((await summary(editor, "editor", id, "draft", SUMMARY)).ok, true)
    const approved = await summary(owner, "owner", id, "approve", SUMMARY)
    assert.equal(approved.ok, true, approved.message)
  }
  assert.equal((await summary(editor, "editor", ed.sparse.id, "draft", DRAFT)).ok, true)

  // A copy of the edited edition's file, not yet linked to any record, in a second room.
  ed.copyRowId = (await sql`
    insert into papermark_dataroom_documents (papermark_dataroom_id, papermark_document_id, title, category, version_key)
    values (${`${plan.dataroom}_second`}, ${ed.edited.papermarkDocumentId}, 'Athena MIN copy.pdf', 'MIN', 'v1')
    returning id`)[0].id
})

after(async () => {
  globalThis.__browser = "none"
  if (ed.edited) await sql`update documents set slug = ${ed.edited.slug} where id = ${ed.edited.id}::uuid`
  await fx.cleanup()
})

describe("Papermark sync keeps editorial metadata, tags and summaries", () => {
  it("a renamed, re-versioned file and a repeat sync change none of them", async () => {
    const edited = await editorial(ed.edited.id)
    const sparse = await editorial(ed.sparse.id)
    assert.equal(edited.summary.approved_fields.whatChanged, SUMMARY.whatChanged, "the fixture is approved")
    const first = await dal.syncDataRoomDocuments(plan.dataroom, snapshot("v2", "Renamed in Papermark - FINAL.pdf"))
    assert.equal(first.updated, 2, "the file rows themselves are updated")
    await dal.syncDataRoomDocuments(plan.dataroom, snapshot("v2", "Renamed in Papermark - FINAL.pdf"))
    assert.deepEqual(await editorial(ed.edited.id), edited)
    assert.deepEqual(await editorial(ed.sparse.id), sparse)
  })

  it("a file that disappears from Papermark and comes back changes none of them", async () => {
    const edited = await editorial(ed.edited.id)
    const removed = await dal.syncDataRoomDocuments(plan.dataroom, snapshot("v2", "x").slice(1))
    assert.equal(removed.removed, 1)
    assert.deepEqual(await editorial(ed.edited.id), edited)
    await dal.syncDataRoomDocuments(plan.dataroom, snapshot("v3", "Renamed again.pdf"))
    const [row] = await sql`select is_present, publication_id from papermark_dataroom_documents where papermark_dataroom_id = ${plan.dataroom} and papermark_document_id = ${ed.edited.papermarkDocumentId}`
    assert.equal(row.is_present, true)
    assert.equal(row.publication_id, ed.edited.id, "still the same record")
    assert.deepEqual(await editorial(ed.edited.id), edited)
  })

  it("linking by Papermark id and creating-or-reusing the record keep the existing record exactly as it is", async () => {
    const edited = await editorial(ed.edited.id)
    const linked = await dal.autoLinkByPapermarkId(`${plan.dataroom}_second`)
    assert.equal(linked.linked, 1)
    await sql`update papermark_dataroom_documents set publication_id = null where id = ${ed.copyRowId}::uuid`
    const reused = await dal.createPublicationForSyncedDocument({ documentRowId: ed.copyRowId, publicTier: plan.tier })
    assert.deepEqual(reused, { publicationId: ed.edited.id, created: false }, "the existing record is reused, never replaced")
    const created = await dal.autoCreatePublicationsForRoom(plan.dataroom, plan.tier)
    assert.equal(created.created, 0, "nothing new is created for files already linked")
    assert.deepEqual(await editorial(ed.edited.id), edited)
  })

  it("generating missing details fills only blank public fields, never metadata, tags or a summary", async () => {
    const edited = await editorial(ed.edited.id)
    const sparse = await editorialOnly(ed.sparse.id)
    await dal.generateMissingDetailsForRoom(plan.dataroom, plan.tier)
    await dal.generateMissingDetailsForSingleDocument(ed.edited.documentRowId)
    await dal.generateMissingDetailsForSingleDocument(ed.sparse.documentRowId)
    assert.deepEqual(await editorial(ed.edited.id), edited, "a complete record is untouched")
    assert.deepEqual(await editorialOnly(ed.sparse.id), sparse, "a sparse record's metadata and draft stay word for word")
    const [stored] = await sql`select what_changed, approved_fields from publication_summaries where publication_id = ${ed.sparse.id}::uuid`
    assert.equal(stored.what_changed, DRAFT.whatChanged)
    assert.equal(stored.approved_fields, null, "a draft is never approved by a sync")
  })

  it("the editor's main form and its title override write only their own columns", async () => {
    const before = await editorialOnly(ed.edited.id)
    await signIn(session, editor, "editor")
    // The form's slug rule allows no underscore (the fixture's slug has them): a
    // hyphenated slug for this save, put back afterwards so cleanup finds the row.
    const result = await act(saveDocument, {
      slug: `${tag.replaceAll("_", "-")}-edited`, title: "Grid tariff reset: what changes", series: "MIN", visibility: "L1", editionDate: "2026-10-05",
      summary: "Public one-line teaser, revised.", description: "Public description.", coverageAreas: "Power sector\nTariff regulation",
      kicker: "Editor issue line", strapline: "Editor strapline", code: `${tag}-MIN-01`,
      portalTitleOverrideField: "1", portalTitleOverride: "on",
    }, ed.edited.id)
    assert.equal(result?.ok, true, JSON.stringify(result))
    await sql`update documents set slug = ${ed.edited.slug} where id = ${ed.edited.id}::uuid`
    const [row] = await sql`select summary from documents where id = ${ed.edited.id}::uuid`
    assert.equal(row.summary, "Public one-line teaser, revised.", "the main form saved")
    assert.deepEqual(await editorialOnly(ed.edited.id), before)
    // And saving the reader details never touches a public field.
    const publicBefore = (await editorial(ed.edited.id)).record
    assert.equal((await saveDetails(ed.edited.id, { ...FULL, readingMinutes: "15", tags: [T.subject.id, T.sector.id, T.geography.id, T.retiring.id] })).ok, true)
    const publicAfter = (await editorial(ed.edited.id)).record
    assert.deepEqual({ ...publicAfter, reading_time_minutes: 14 }, { ...publicBefore, reading_time_minutes: 14 })
    assert.equal(publicAfter.reading_time_minutes, 15)
  })

  it("after every sync step readers still see the editorial title, metadata, tags and approved summary; never the draft", async () => {
    const library = await getDataRoomDocumentsForSubscriber(reader)
    assert.equal(library.state, "ready")
    const card = library.documents.find((d) => d.papermarkDocumentId === ed.edited.papermarkDocumentId)
    assert.equal(card.displayTitle, "Grid tariff reset: what changes", "the editor's title override, not the Papermark name")
    assert.equal(card.details.authorEditor, "APRA Research Team")
    assert.deepEqual(card.details.coveredPeriod, { start: "2026-09-01", end: "2026-09-30" })
    assert.equal(card.details.readingMinutes, 15)
    assert.deepEqual(card.details.tags, { subject: [T.retiring.label, T.subject.label].sort((a, b) => a.localeCompare(b, "en-GB", { sensitivity: "base" })), sector: [T.sector.label], geography: [T.geography.label] })
    assert.deepEqual(card.details.summary, SUMMARY)
    const view = dataRoomLibraryView(library.documents, library.categories)
    const found = searchLibrary(view.entries, { ...EMPTY_LIBRARY_FILTERS, subject: T.subject.label, query: "consultation" })
    assert.deepEqual(found.entries.map((e) => e.id), [card.id])
    const sparseCard = library.documents.find((d) => d.papermarkDocumentId === ed.sparse.papermarkDocumentId)
    assert.equal(sparseCard.details.summary, null)
    assert.equal(JSON.stringify({ documents: library.documents, entries: view.entries }).includes(DRAFT.whatChanged), false)

    const items = await getLibraryFor({ id: legacyReader, hasAccess: true, level: "L1" })
    const legacyItem = items.find((i) => i.id === ed.legacy.id)
    assert.deepEqual(legacyItem.details.summary, SUMMARY)
    assert.equal(legacyItem.details.informationCutoff, "2026-09-28")
    const legacyView = legacyLibraryView(items, DEFAULT_CATALOGUE)
    assert.deepEqual(searchLibrary(legacyView.entries, { ...EMPTY_LIBRARY_FILTERS, geography: T.geography.label }).entries.map((e) => e.id), [ed.legacy.id])
  })

  it("no sync module names the new columns or tables; every Data Room sync update fills only blank columns", () => {
    const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
    const NEW = /\b(author_editor|covered_period_start|covered_period_end|information_cutoff|reading_time_minutes|publication_tags|publication_tag_assignments|publication_summaries)\b/
    for (const path of [
      "src/lib/dataroom-dal.ts",
      "src/app/api/papermark/webhook/route.ts",
      "src/app/api/cron/dataroom-sync/route.ts",
      "src/app/actions/datarooms.ts",
      "src/app/actions/review-library.ts",
      "src/app/actions/documents.ts",
      "src/lib/dataroom-notifications.ts",
      "src/lib/papermark-dataroom-contract.ts",
      "src/lib/review-classify.ts",
    ]) {
      assert.doesNotMatch(read(path), NEW, path)
    }
    const source = read("src/lib/dataroom-dal.ts")
    const updates = source.match(/update documents set[\s\S]*?where id = /g) ?? []
    assert.equal(updates.length, 2)
    for (const update of updates) {
      const assignments = update.split(/\r?\n/).filter((line) => /^\s+\w+ = /.test(line))
      assert.ok(assignments.length >= 10)
      for (const line of assignments) {
        if (/^\s+updated_at = now\(\)/.test(line)) continue
        assert.match(line, /= case when \w+ (= ''|is null) then .* else \w+ end,?$/, line.trim())
      }
    }
  })

  it("no request left this machine", () => {
    assert.deepEqual(outbound, [])
  })
})
