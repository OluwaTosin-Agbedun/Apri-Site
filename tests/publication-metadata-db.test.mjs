/**
 * Publication editorial metadata and the controlled tag vocabulary, against
 * the isolated test database with the real server actions (signed admin
 * session, role re-read from the database) and the real subscriber library
 * loaders for both paths.
 *
 *  - owners and editors set a publication's author/editor, covered period,
 *    information cut-off, reading time and tags; input is validated and an
 *    anonymous request is sent to sign in;
 *  - owners and editors may add tags; only owners rename, retire, restore or
 *    delete (an editor with a forged "owner" cookie is refused); a tag any
 *    publication carries is retired, never deleted (the database refuses
 *    too); a retired tag stays where it is and cannot be newly added;
 *  - readers see stated details only on editions they may read; absent
 *    metadata changes nothing, and no metadata ever decides access;
 *  - renaming a tag changes its label everywhere at once.
 *
 * Invented data only. No Papermark, no email.
 */
import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fixtures, signIn, act } from "./publication-metadata-harness.mjs"
import { sql, makeTag } from "./helpers.mjs"
import { dataRoomLibraryView, legacyLibraryView } from "../src/lib/portal-library.ts"
import { DEFAULT_CATALOGUE } from "../src/lib/publication-catalogue.ts"

process.env.DATABASE_URL = process.env.APRI_TEST_DATABASE_URL

const actions = await import("../src/app/actions/publication-metadata.ts")
const session = await import("../src/lib/session.ts")
const dal = await import("../src/lib/publication-metadata-dal.ts")
const { getDataRoomDocumentsForSubscriber, getDataRoomDocumentForSubscriber } = await import("../src/lib/papermark-client-library.ts")
const { getLibraryFor } = await import("../src/lib/subscriber-dal.ts")

const tag = makeTag("pubmeta")
const fx = fixtures(sql, tag)

let owner, editor
const R = {}
const ed = {}
const T = {}

/** The version the editor page would render now (sent back by its form). */
const versionOf = async (id) => (await dal.loadEditorPanel(sql, id)).detailsVersion
/** Saves as the editor's form does: with the version of the page just loaded, unless the test gives one. */
const details = async (id, fields) => act(actions.savePublicationDetails, { detailsVersion: await versionOf(id), ...fields }, id)
const FULL = { authorEditor: "APRA Research Team", coveredPeriodStart: "2026-09-01", coveredPeriodEnd: "2026-09-30", informationCutoff: "2026-09-28", readingMinutes: "14" }
const metadataRow = async (id) => (await sql`
  select author_editor, to_char(covered_period_start, 'YYYY-MM-DD') as cs, to_char(covered_period_end, 'YYYY-MM-DD') as ce,
         to_char(information_cutoff, 'YYYY-MM-DD') as ic, reading_time_minutes as rt
  from documents where id = ${id}::uuid`)[0]
const assignedLabels = async (id) => (await sql`
  select t.label from publication_tag_assignments a join publication_tags t on t.id = a.tag_id
  where a.publication_id = ${id}::uuid order by t.label`).map((r) => r.label)

async function dataRoom(subscriberId) {
  const library = await getDataRoomDocumentsForSubscriber(subscriberId)
  assert.equal(library.state, "ready")
  return { ...library, view: dataRoomLibraryView(library.documents, library.categories) }
}
const card = (library, edition) => library.documents.find((d) => d.papermarkDocumentId === edition.papermarkDocumentId)

before(async () => {
  owner = await fx.admin("owner")
  editor = await fx.admin("editor")
  const room = await fx.plan("room")
  const other = await fx.plan("other")
  const legacyPlan = await fx.plan("legacy", { room: false })
  ed.tagged = await fx.edition("tagged", { title: "Tariff reset note", series: "MIN", date: "2026-10-05", forTiers: [room.tier], dataroom: room.dataroom })
  ed.bare = await fx.edition("bare", { title: "Bare note", series: "AIU", date: "2026-10-01", forTiers: [room.tier], dataroom: room.dataroom })
  ed.otherPlan = await fx.edition("otherplan", { title: "Other plan note", series: "MIN", date: "2026-10-03", forTiers: [other.tier], dataroom: other.dataroom })
  ed.legacy = await fx.edition("legacy", { title: "Legacy note", series: "PLM", date: "2026-10-04", forTiers: [legacyPlan.tier] })
  R.reader = await fx.subscriber("reader", room.tier)
  R.other = await fx.subscriber("other", other.tier)
  R.legacy = await fx.subscriber("legacy", legacyPlan.tier)
  T.tariffs = await fx.tag("subject", "Tariffs")
  T.power = await fx.tag("sector", "Power")
  T.lagos = await fx.tag("geography", "Lagos")
  T.oldRetired = await fx.tag("subject", "Old subject", { active: false })
})

after(async () => {
  globalThis.__browser = "none"
  await fx.cleanup()
})

describe("saving a publication's reader details", () => {
  it("is refused to anyone not signed in, writing nothing", async () => {
    await signIn(session, null)
    assert.equal((await details(ed.tagged.id, FULL)).to, "/admin/login")
    assert.equal((await metadataRow(ed.tagged.id)).author_editor, null)
  })

  it("lets an editor save every field and tags; nothing is stored for an empty field", async () => {
    await signIn(session, editor, "editor")
    const saved = await details(ed.tagged.id, { ...FULL, tags: [T.tariffs.id, T.power.id, T.lagos.id] })
    assert.equal(saved.ok, true, saved.message)
    assert.deepEqual(await metadataRow(ed.tagged.id), { author_editor: "APRA Research Team", cs: "2026-09-01", ce: "2026-09-30", ic: "2026-09-28", rt: 14 })
    assert.deepEqual(await assignedLabels(ed.tagged.id), [T.lagos.label, T.power.label, T.tariffs.label].sort())
    assert.ok(globalThis.__revalidated.includes("/portal"))

    const cleared = await details(ed.bare.id, { authorEditor: "", coveredPeriodStart: "", coveredPeriodEnd: "", informationCutoff: "", readingMinutes: "" })
    assert.equal(cleared.ok, true)
    assert.deepEqual(await metadataRow(ed.bare.id), { author_editor: null, cs: null, ce: null, ic: null, rt: null })
  })

  it("validates every field and saves nothing when one is wrong", async () => {
    await signIn(session, editor, "editor")
    const before = await metadataRow(ed.tagged.id)
    for (const bad of [
      { coveredPeriodStart: "2026-09-30", coveredPeriodEnd: "2026-09-01" },
      { coveredPeriodStart: "2026-09-01", coveredPeriodEnd: "" },
      { readingMinutes: "0" },
      { readingMinutes: "2.5" },
      { informationCutoff: "2026-02-30" },
      { authorEditor: "x".repeat(201) },
    ]) {
      const result = await details(ed.tagged.id, { ...FULL, ...bad, tags: [T.tariffs.id] })
      assert.notEqual(result.ok, true, JSON.stringify(bad))
      assert.ok(result.errors && Object.keys(result.errors).length, JSON.stringify(bad))
    }
    assert.match((await details(ed.tagged.id, { ...FULL, tags: ["not-a-uuid"] })).message, /Check the tags/)
    assert.match((await details("not-a-uuid", FULL)).message, /Unknown publication/)
    assert.deepEqual(await metadataRow(ed.tagged.id), before)
    assert.equal((await assignedLabels(ed.tagged.id)).length, 3, "tags unchanged too")
  })

  it("the database refuses a reversed period or an impossible reading time even outside the editor", async () => {
    await assert.rejects(sql`update documents set covered_period_start = '2026-09-30', covered_period_end = '2026-09-01' where id = ${ed.bare.id}::uuid`, /documents_covered_period_check/)
    await assert.rejects(sql`update documents set reading_time_minutes = 0 where id = ${ed.bare.id}::uuid`, /documents_reading_time_check/)
    await assert.rejects(sql`update documents set covered_period_start = '2026-09-01' where id = ${ed.bare.id}::uuid`, /documents_covered_period_check/)
  })

  it("never adds a retired tag, but keeps one a publication already carries until removed", async () => {
    await signIn(session, editor, "editor")
    const refused = await details(ed.bare.id, { tags: [T.oldRetired.id] })
    assert.notEqual(refused.ok, true)
    assert.match(refused.message, /retired and cannot be added/)
    assert.deepEqual(await assignedLabels(ed.bare.id), [])

    // Carried before it was retired: kept on save, removable.
    await fx.assign(ed.bare.id, T.oldRetired.id)
    assert.equal((await details(ed.bare.id, { tags: [T.oldRetired.id] })).ok, true)
    assert.deepEqual(await assignedLabels(ed.bare.id), [T.oldRetired.label])
    assert.equal((await details(ed.bare.id, { tags: [] })).ok, true)
    assert.deepEqual(await assignedLabels(ed.bare.id), [])
  })

  it("refuses a tag that no longer exists", async () => {
    await signIn(session, editor, "editor")
    const result = await details(ed.bare.id, { tags: ["00000000-0000-4000-8000-000000000000"] })
    assert.match(result.message, /no longer exists/)
  })

  it("a save from a page opened before another editor's save is refused, so it never silently removes that editor's tag", async () => {
    await signIn(session, editor, "editor")
    assert.equal((await details(ed.bare.id, { readingMinutes: "8", tags: [T.tariffs.id] })).ok, true)
    // Editor A opens the page; editor B then ticks a geography and saves.
    const pageA = await versionOf(ed.bare.id)
    assert.equal((await details(ed.bare.id, { readingMinutes: "8", tags: [T.tariffs.id, T.lagos.id] })).ok, true)
    // A saves an unrelated author change from the page opened earlier.
    const stale = await details(ed.bare.id, { detailsVersion: pageA, authorEditor: "Editor A", readingMinutes: "8", tags: [T.tariffs.id] })
    assert.notEqual(stale.ok, true)
    assert.match(stale.message, /changed by someone else/)
    assert.deepEqual(await assignedLabels(ed.bare.id), [T.lagos.label, T.tariffs.label].sort(), "B's tag is kept")
    assert.equal((await metadataRow(ed.bare.id)).author_editor, null, "and nothing of A's save was written")
    // A save without the page's version, or with a malformed one, writes nothing either.
    const before = { row: await metadataRow(ed.bare.id), tags: await assignedLabels(ed.bare.id) }
    for (const detailsVersion of [undefined, "", "x".repeat(64), "0".repeat(63)]) {
      const result = await act(actions.savePublicationDetails, { ...(detailsVersion === undefined ? {} : { detailsVersion }), authorEditor: "Editor A", tags: [] }, ed.bare.id)
      assert.notEqual(result.ok, true, String(detailsVersion))
    }
    assert.deepEqual({ row: await metadataRow(ed.bare.id), tags: await assignedLabels(ed.bare.id) }, before)
    // Reloaded, A's save goes through.
    assert.equal((await details(ed.bare.id, { authorEditor: "Editor A", readingMinutes: "8", tags: [T.tariffs.id, T.lagos.id] })).ok, true)
    assert.equal((await metadataRow(ed.bare.id)).author_editor, "Editor A")
    // Renaming or retiring a tag is not a change to this publication's details.
    const version = await versionOf(ed.bare.id)
    await sql`update publication_tags set label = ${`${T.lagos.label} renamed`} where id = ${T.lagos.id}::uuid`
    await sql`update publication_tags set active = false where id = ${T.tariffs.id}::uuid`
    assert.equal(await versionOf(ed.bare.id), version)
    await sql`update publication_tags set label = ${T.lagos.label} where id = ${T.lagos.id}::uuid`
    await sql`update publication_tags set active = true where id = ${T.tariffs.id}::uuid`
    // Leave the record bare for the tests below.
    assert.equal((await details(ed.bare.id, { authorEditor: "", readingMinutes: "", tags: [] })).ok, true)
    assert.deepEqual(await metadataRow(ed.bare.id), { author_editor: null, cs: null, ce: null, ic: null, rt: null })
  })
})

describe("the tag vocabulary", () => {
  it("anyone not signed in is sent to sign in; an editor (even with a forged owner cookie) can add but not rename, retire or delete", async () => {
    await signIn(session, null)
    assert.equal((await act(actions.addPublicationTag, { kind: "subject", label: fx.label("Anonymous") })).to, "/admin/login")

    await signIn(session, editor, "owner")
    const added = await act(actions.addPublicationTag, { kind: "sector", label: fx.label("  Mining   and  quarrying ") })
    assert.equal(added.ok, true, added.message)
    const [row] = await sql`select id, label, active from publication_tags where label = ${fx.label("Mining and quarrying")}`
    assert.ok(row, "stored as one consistent line")
    T.mining = row

    const before = await sql`select id, label, active from publication_tags where id = ${row.id}::uuid`
    assert.equal((await act(actions.renamePublicationTag, { id: row.id, label: fx.label("Hijacked") })).to, "/admin")
    assert.equal((await act(actions.setPublicationTagActive, { id: row.id, state: "retire" })).to, "/admin")
    assert.equal((await act(actions.deletePublicationTag, { id: row.id })).to, "/admin")
    assert.deepEqual(await sql`select id, label, active from publication_tags where id = ${row.id}::uuid`, before)
  })

  it("keeps labels unique per kind whatever their capitals, and validates kind and label", async () => {
    await signIn(session, editor, "editor")
    const dup = await act(actions.addPublicationTag, { kind: "subject", label: T.tariffs.label.toUpperCase() })
    assert.notEqual(dup.ok, true)
    assert.match(dup.message, /already exists/)
    const retiredDup = await act(actions.addPublicationTag, { kind: "subject", label: T.oldRetired.label })
    assert.match(retiredDup.message, /retired subject\. An owner can restore it/)
    // The same label is allowed under another kind.
    assert.equal((await act(actions.addPublicationTag, { kind: "geography", label: T.tariffs.label })).ok, true)
    assert.match((await act(actions.addPublicationTag, { kind: "topic", label: fx.label("x") })).message, /subject, sector or geography/)
    assert.match((await act(actions.addPublicationTag, { kind: "subject", label: "   " })).message, /1 to 80 characters/)
  })

  it("lets an owner rename a tag everywhere at once, refusing a clash", async () => {
    await signIn(session, owner, "owner")
    const renamed = await act(actions.renamePublicationTag, { id: T.tariffs.id, label: fx.label("Electricity tariffs") })
    assert.equal(renamed.ok, true, renamed.message)
    T.tariffs.label = fx.label("Electricity tariffs")
    assert.ok((await assignedLabels(ed.tagged.id)).includes(T.tariffs.label))
    const reader = await dataRoom(R.reader)
    assert.deepEqual(card(reader, ed.tagged).details.tags.subject, [T.tariffs.label], "the reader sees the new label")
    const clash = await act(actions.renamePublicationTag, { id: T.tariffs.id, label: T.oldRetired.label.toLowerCase() })
    assert.match(clash.message, /already called/)
  })

  it("retires (never deletes) a tag in use; it stays where it is and in those readers' filters", async () => {
    await signIn(session, owner, "owner")
    const refused = await act(actions.deletePublicationTag, { id: T.power.id })
    assert.notEqual(refused.ok, true)
    assert.match(refused.message, /carried by 1 publication.*Retire it instead/)
    await assert.rejects(sql`delete from publication_tags where id = ${T.power.id}::uuid`, /publication_tag_assignments_tag_id_fkey|foreign key/, "the database refuses too")

    const retired = await act(actions.setPublicationTagActive, { id: T.power.id, state: "retire" })
    assert.equal(retired.ok, true, retired.message)
    assert.equal((await sql`select active from publication_tags where id = ${T.power.id}::uuid`)[0].active, false)
    assert.ok((await assignedLabels(ed.tagged.id)).includes(T.power.label), "still on the publication")
    const reader = await dataRoom(R.reader)
    assert.deepEqual(card(reader, ed.tagged).details.tags.sector, [T.power.label])

    // Not offered for new assignment in the editor, but shown where carried.
    const panelBare = await dal.loadEditorPanel(sql, ed.bare.id)
    assert.ok(!panelBare.tags.some((t) => t.id === T.power.id))
    const panelTagged = await dal.loadEditorPanel(sql, ed.tagged.id)
    assert.ok(panelTagged.tags.some((t) => t.id === T.power.id && t.active === false))

    assert.equal((await act(actions.setPublicationTagActive, { id: T.power.id, state: "restore" })).ok, true)
    assert.equal((await sql`select active from publication_tags where id = ${T.power.id}::uuid`)[0].active, true)
  })

  it("lets an owner delete a tag no publication carries", async () => {
    await signIn(session, owner, "owner")
    const deleted = await act(actions.deletePublicationTag, { id: T.mining.id })
    assert.equal(deleted.ok, true, deleted.message)
    assert.equal((await sql`select 1 from publication_tags where id = ${T.mining.id}::uuid`).length, 0)
    assert.match((await act(actions.deletePublicationTag, { id: T.mining.id })).message, /no longer exists/)
  })

  it("lists the vocabulary with usage for Admin", async () => {
    const { ready, tags } = await dal.loadTagVocabulary(sql)
    assert.equal(ready, true)
    const tariffs = tags.find((t) => t.id === T.tariffs.id)
    assert.equal(tariffs.publications, 1)
    assert.equal(tariffs.kind, "subject")
  })

  it("every action authorises itself before reading or writing anything", () => {
    const source = readFileSync(new URL("../src/app/actions/publication-metadata.ts", import.meta.url), "utf8")
    const body = (name) => {
      const start = source.indexOf(`export async function ${name}`)
      const next = source.indexOf("\nexport async function", start + 10)
      return source.slice(start, next > 0 ? next : undefined)
    }
    for (const [name, guard] of [["savePublicationDetails", "requireAdmin"], ["addPublicationTag", "requireAdmin"], ["renamePublicationTag", "requireOwner"], ["setPublicationTagActive", "requireOwner"], ["deletePublicationTag", "requireOwner"]]) {
      const fn = body(name)
      assert.ok(fn.indexOf(`await ${guard}()`) > 0, name)
      assert.ok(fn.indexOf(`await ${guard}()`) < fn.indexOf("getSql()"), `${name} authorises before any database access`)
    }
  })
})

describe("what readers see", () => {
  it("stated details and tag labels on permitted editions, on both paths", async () => {
    await signIn(session, editor, "editor")
    assert.equal((await details(ed.legacy.id, { readingMinutes: "6", tags: [T.lagos.id] })).ok, true)
    const reader = await dataRoom(R.reader)
    const tagged = card(reader, ed.tagged).details
    assert.equal(tagged.authorEditor, "APRA Research Team")
    assert.deepEqual(tagged.coveredPeriod, { start: "2026-09-01", end: "2026-09-30" })
    assert.equal(tagged.informationCutoff, "2026-09-28")
    assert.equal(tagged.readingMinutes, 14)
    assert.equal(tagged.summary, null, "no summary was written")

    const items = await getLibraryFor({ id: R.legacy, hasAccess: true, level: "L1" })
    const legacyItem = items.find((i) => i.id === ed.legacy.id)
    assert.equal(legacyItem.details.readingMinutes, 6)
    assert.deepEqual(legacyItem.details.tags.geography, [T.lagos.label])
    assert.equal(legacyItem.details.authorEditor, null, "only what was entered")
  })

  it("absent metadata changes nothing: the card, its search record and the library are as before", async () => {
    const reader = await dataRoom(R.reader)
    const bare = card(reader, ed.bare)
    assert.equal(bare.details, null)
    const entry = reader.view.entries.find((e) => e.id === bare.id)
    assert.deepEqual(Object.keys(entry).sort(), ["description", "editionDate", "id", "series", "title"])
    const legacyItems = legacyLibraryView(await getLibraryFor({ id: R.legacy, hasAccess: true, level: "L1" }), DEFAULT_CATALOGUE)
    assert.ok(legacyItems.entries.every((e) => e.id !== ed.legacy.id || e.tags))
  })

  it("details reach only readers who may read the edition, and never decide access", async () => {
    // Another plan's reader: neither the edition nor its details.
    const other = await dataRoom(R.other)
    assert.equal(card(other, ed.tagged), undefined)
    assert.ok(!JSON.stringify(other.documents).includes("APRA Research Team"))
    // The bare edition, with nothing stated, still lists and opens; the tagged one is listed exactly as before.
    const reader = await dataRoom(R.reader)
    assert.ok(card(reader, ed.bare))
    assert.ok(await getDataRoomDocumentForSubscriber(R.reader, ed.bare.documentRowId))
    assert.equal(await getDataRoomDocumentForSubscriber(R.other, ed.tagged.documentRowId), null)
  })

  it("the details loader returns nothing for ids it was not given, and survives a failing read", async () => {
    const map = await dal.loadReaderPublicationDetails([ed.bare.id, "not-a-uuid", null])
    assert.equal(map.size, 0)
    const failing = async () => { throw new Error("database down") }
    assert.equal((await dal.loadReaderPublicationDetails([ed.tagged.id], { sql: failing })).size, 0)
    const only = await dal.loadReaderPublicationDetails([ed.tagged.id])
    assert.deepEqual([...only.keys()], [ed.tagged.id])
  })
})
