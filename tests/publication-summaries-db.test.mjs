/**
 * Approved protected summaries, end to end against the isolated test
 * database: the real server action (signed admin session cookie, role re-read
 * from the database), the real subscriber library loaders for both paths
 * (Data Room and legacy), the search entries the portal builds from them, and
 * the public and Complimentary Review reads.
 *
 *  - editors save drafts; a draft never reaches any reader, their cards, their
 *    search records, public pages or review pages;
 *  - only an owner approves, only a complete summary, only the saved text, by
 *    the explicit Approve intent; an editor (even with a forged "owner"
 *    cookie) cannot; anonymous requests are sent to sign in;
 *  - only the current approved revision reaches readers, and only readers the
 *    access policy already lets read that edition;
 *  - editing approved text takes it down at once until a separate owner
 *    approval; a withdrawal takes it down and keeps the text;
 *  - concurrency: every write is a compare-and-set on the revision shown, so
 *    of an edit and an approval racing, or two edits, or two approvals, only
 *    one succeeds, and nobody approves text they did not see;
 *  - approval publishes nothing, releases nothing, changes no plan, exception
 *    or link, and sends nothing (no request leaves this machine);
 *  - an approval or withdrawal carrying a revision that has moved on is
 *    refused by the statement itself (the action's earlier read is not enough);
 *  - undecided editions: shown only where an earlier link is kept open
 *    (preserved), never where the edition is hidden;
 *  - a record holding a written summary is not deleted.
 *
 * Invented data only.
 */
import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { fixtures, signIn, act } from "./publication-metadata-harness.mjs"
import { sql, makeTag } from "./helpers.mjs"
import { dataRoomLibraryView, legacyLibraryView } from "../src/lib/portal-library.ts"
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

const { submitPublicationSummary } = await import("../src/app/actions/publication-summaries.ts")
const session = await import("../src/lib/session.ts")
const store = await import("../src/lib/publication-summaries.ts")
const { getDataRoomDocumentsForSubscriber, getDataRoomDocumentForSubscriber } = await import("../src/lib/papermark-client-library.ts")
const { getLibraryFor } = await import("../src/lib/subscriber-dal.ts")
const pubs = await import("../src/lib/publications.ts")

const tag = makeTag("pubsummary")
const fx = fixtures(sql, tag)

const TEXT = {
  whatChanged: "Zircon export levy gazetted by the ministry.",
  whyItMatters: "Exporters face higher landed costs from January.",
  implications: "Scenario one: phased pass-through. Scenario two: a court-ordered pause.",
  watchNext: "A court challenge is listed for the third week of November.",
  sourceDate: "2026-10-02",
  uncertainty: "The pass-through schedule is unpublished.",
}
const EDITED = { ...TEXT, watchNext: "Revised: the hearing moved to early December." }
// Every field its own words, so finding any of them anywhere is a leak of this draft.
const DRAFT_ONLY = {
  whatChanged: "Quarantined draft wording xylophone.",
  whyItMatters: "Unapproved consequence marimba.",
  implications: "Unapproved scenario glockenspiel.",
  watchNext: "Unapproved signal celesta.",
  sourceDate: "2026-09-09",
  uncertainty: "Unapproved doubt vibraphone.",
}
const WORDS = (text) => [text.whatChanged, text.whyItMatters, text.implications, text.watchNext, text.uncertainty]

let owner, owner2, editor
let R = {}, L = {}
let ed = {}

const form = (text) => ({ whatChanged: text.whatChanged, whyItMatters: text.whyItMatters, implications: text.implications, watchNext: text.watchNext, sourceDate: text.sourceDate ?? "", uncertainty: text.uncertainty })
const revisionOf = async (id) => (await store.readStoredSummary(sql, id))?.revision ?? 0
async function submit(adminId, claimedRole, id, intent, text, revision) {
  await signIn(session, adminId, claimedRole)
  return act(submitPublicationSummary, { intent, revision: String(revision ?? (await revisionOf(id))), ...form(text) }, id)
}
const asOwner = (id, intent, text, revision) => submit(owner, "owner", id, intent, text, revision)
const asEditor = (id, intent, text, revision) => submit(editor, "editor", id, intent, text, revision)

/** What the portal builds for a Data Room reader (the page's own helper over the real loader). */
async function dataRoom(subscriberId) {
  const library = await getDataRoomDocumentsForSubscriber(subscriberId)
  assert.equal(library.state, "ready")
  const view = dataRoomLibraryView(library.documents, library.categories)
  return { documents: library.documents, entries: view.entries, json: JSON.stringify({ documents: library.documents, entries: view.entries }) }
}
async function legacy(subscriberId) {
  const items = await getLibraryFor({ id: subscriberId, hasAccess: true, level: "L1" })
  assert.ok(Array.isArray(items))
  const view = legacyLibraryView(items, DEFAULT_CATALOGUE)
  return { items, entries: view.entries, json: JSON.stringify({ items, entries: view.entries }) }
}
const cardOf = (library, edition) => library.documents.find((d) => d.papermarkDocumentId === edition.papermarkDocumentId)
const itemOf = (library, edition) => library.items.find((i) => i.id === edition.id)
const contains = (json, text) => WORDS(text).some((w) => w && json.includes(w))

before(async () => {
  owner = await fx.admin("owner", "Owner One")
  owner2 = await fx.admin("owner", "Owner Two")
  editor = await fx.admin("editor", "Editor One")
  const room = await fx.plan("room")
  const otherRoom = await fx.plan("other")
  const legacyPlan = await fx.plan("legacy", { room: false })
  const legacyOther = await fx.plan("legacyother", { room: false })
  ed.levy = await fx.edition("levy", { title: "Zircon levy note", series: "MIN", date: "2026-10-05", forTiers: [room.tier], dataroom: room.dataroom })
  ed.plain = await fx.edition("plain", { title: "Untouched note", series: "AIU", date: "2026-10-01", forTiers: [room.tier], dataroom: room.dataroom })
  ed.otherPlan = await fx.edition("otherplan", { title: "Other plan note", series: "MIN", date: "2026-10-03", forTiers: [otherRoom.tier], dataroom: otherRoom.dataroom })
  ed.legacy = await fx.edition("legacy", { title: "Legacy levy note", series: "PLM", date: "2026-10-04", forTiers: [legacyPlan.tier] })
  R.reader = await fx.subscriber("reader", room.tier)
  R.blocked = await fx.subscriber("blocked", room.tier)
  R.other = await fx.subscriber("other", otherRoom.tier)
  L.reader = await fx.subscriber("lreader", legacyPlan.tier)
  L.other = await fx.subscriber("lother", legacyOther.tier)
  await sql`insert into subscriber_publication_exceptions (subscriber_id, publication_id, decision, reason, administrator_id) values (${R.blocked}::uuid, ${ed.levy.id}::uuid, 'block', 'Test block', ${owner}::uuid)`
})

after(async () => {
  globalThis.__browser = "none"
  await fx.cleanup()
})

describe("drafts and approval", () => {
  it("anyone not signed in is sent to sign in, and nothing is written", async () => {
    await signIn(session, null)
    const result = await act(submitPublicationSummary, { intent: "draft", revision: "0", ...form(TEXT) }, ed.levy.id)
    assert.equal(result.to, "/admin/login")
    assert.equal(await store.readStoredSummary(sql, ed.levy.id), null)
  })

  it("an editor saves a draft, which no reader sees on either path, in cards or search records", async () => {
    const saved = await asEditor(ed.levy.id, "draft", TEXT)
    assert.equal(saved.ok, true, saved.message)
    assert.match(saved.message, /not shown to subscribers until an owner approves/)
    assert.equal((await asEditor(ed.legacy.id, "draft", TEXT)).ok, true)
    const stored = await store.readStoredSummary(sql, ed.levy.id)
    assert.equal(stored.status, "draft")
    assert.equal(stored.revision, 1)
    assert.equal(stored.updatedBy, "Editor One")
    for (const library of [await dataRoom(R.reader), await legacy(L.reader)]) {
      assert.equal(contains(library.json, TEXT), false, "no draft word in the reader's payload")
    }
    assert.equal(cardOf(await dataRoom(R.reader), ed.levy).details, null, "nothing stated yet: the card is unchanged")
  })

  it("an editor cannot approve, even with a forged owner cookie; nothing changes", async () => {
    const forged = await submit(editor, "owner", ed.levy.id, "approve", TEXT)
    assert.notEqual(forged.ok, true)
    assert.match(forged.message, /Only an owner can approve/)
    const stored = await store.readStoredSummary(sql, ed.levy.id)
    assert.equal(stored.approved, null)
    assert.equal(stored.revision, 1)
    assert.match((await submit(editor, "owner", ed.levy.id, "withdraw", TEXT)).message, /Only an owner can withdraw/)
  })

  it("an owner cannot approve unsaved changes or an incomplete summary", async () => {
    const unsaved = await asOwner(ed.levy.id, "approve", EDITED)
    assert.notEqual(unsaved.ok, true)
    assert.match(unsaved.message, /Save the change as a draft first/)
    await asEditor(ed.plain.id, "draft", { ...TEXT, watchNext: "" })
    const incomplete = await asOwner(ed.plain.id, "approve", { ...TEXT, watchNext: "" })
    assert.match(incomplete.message, /before approving/)
    assert.equal((await store.readStoredSummary(sql, ed.plain.id)).approved, null)
    // The CAS statement refuses an incomplete summary on its own too.
    assert.equal(await store.approveSummaryRevision(sql, { publicationId: ed.plain.id, revision: await revisionOf(ed.plain.id), adminId: owner }), "stale")
    await sql`delete from publication_summaries where publication_id = ${ed.plain.id}::uuid`
  })

  it("an owner approves exactly the saved text; only entitled readers see it, on both paths", async () => {
    const before = (await sql`select status, is_published, paid_release_state, edition_date, title, summary from documents where id = ${ed.levy.id}::uuid`)[0]
    const plansBefore = await sql`select public_tier from publication_plans where publication_id = ${ed.levy.id}::uuid order by 1`
    const approved = await asOwner(ed.levy.id, "approve", TEXT)
    assert.equal(approved.ok, true, approved.message)
    assert.equal((await asOwner(ed.legacy.id, "approve", TEXT)).ok, true)
    const stored = await store.readStoredSummary(sql, ed.levy.id)
    assert.equal(stored.status, "approved")
    assert.deepEqual(stored.approved, TEXT)
    assert.equal(stored.approvedRevision, 1, "the revision the owner saw")
    assert.equal(stored.approvedBy, "Owner One")

    // Entitled readers, both paths: the card carries it, and its words are searchable.
    const reader = await dataRoom(R.reader)
    assert.deepEqual(cardOf(reader, ed.levy).details.summary, TEXT)
    const entry = reader.entries.find((e) => e.id === cardOf(reader, ed.levy).id)
    assert.ok(entry.brief.includes(TEXT.implications))
    assert.equal(cardOf(reader, ed.plain).details, null, "an edition without a summary is unchanged")
    const legacyReader = await legacy(L.reader)
    assert.deepEqual(itemOf(legacyReader, ed.legacy).details.summary, TEXT)

    // Readers the access policy does not let read the edition: never, anywhere in their payload.
    for (const library of [await dataRoom(R.blocked), await dataRoom(R.other), await legacy(L.other)]) {
      assert.equal(contains(library.json, TEXT), false)
    }
    assert.equal(cardOf(await dataRoom(R.blocked), ed.levy), undefined, "a blocked reader does not list it")
    assert.equal(await getDataRoomDocumentForSubscriber(R.other, ed.levy.documentRowId), null, "and cannot open it")

    // Approval changed nothing else.
    assert.deepEqual((await sql`select status, is_published, paid_release_state, edition_date, title, summary from documents where id = ${ed.levy.id}::uuid`)[0], before)
    assert.deepEqual(await sql`select public_tier from publication_plans where publication_id = ${ed.levy.id}::uuid order by 1`, plansBefore)
    assert.equal((await asOwner(ed.levy.id, "approve", TEXT)).message, "This text is already approved.")
  })

  it("editing approved text takes it down at once; re-approval is a separate owner action", async () => {
    const edited = await asEditor(ed.levy.id, "draft", EDITED)
    assert.equal(edited.ok, true)
    assert.match(edited.message, /no longer see this summary until an owner approves it again/)
    const stored = await store.readStoredSummary(sql, ed.levy.id)
    assert.equal(stored.status, "changed")
    assert.equal(stored.approved, null)
    assert.equal(stored.removedReason, "edited")
    const reader = await dataRoom(R.reader)
    assert.equal(cardOf(reader, ed.levy).details, null, "neither the old approved text nor the edit is shown")
    assert.equal(contains(reader.json, EDITED), false)
    assert.equal(reader.json.includes(TEXT.whatChanged), false)

    const reapproved = await asOwner(ed.levy.id, "approve", EDITED)
    assert.equal(reapproved.ok, true, reapproved.message)
    assert.deepEqual(cardOf(await dataRoom(R.reader), ed.levy).details.summary, EDITED)
  })

  it("an unchanged save writes nothing; a stale revision is refused and writes nothing", async () => {
    const revision = await revisionOf(ed.levy.id)
    assert.equal((await asEditor(ed.levy.id, "draft", EDITED)).message, "No changes to save.")
    assert.equal(await revisionOf(ed.levy.id), revision)
    const stale = await asEditor(ed.levy.id, "draft", DRAFT_ONLY, revision - 1)
    assert.match(stale.message, /changed by someone else/)
    assert.deepEqual((await store.readStoredSummary(sql, ed.levy.id)).text, EDITED)
    assert.match((await asOwner(ed.levy.id, "withdraw", EDITED, revision + 5)).message, /changed by someone else/)
    assert.match((await asOwner(ed.levy.id, "approve", EDITED, "x")).message, /Reload the page/)
  })

  it("an owner withdraws an approval: readers lose it, the text stays as a draft", async () => {
    const withdrawn = await asOwner(ed.levy.id, "withdraw", EDITED)
    assert.equal(withdrawn.ok, true, withdrawn.message)
    const stored = await store.readStoredSummary(sql, ed.levy.id)
    assert.equal(stored.status, "draft")
    assert.deepEqual(stored.text, EDITED)
    assert.equal(stored.removedReason, "withdrawn")
    assert.equal(cardOf(await dataRoom(R.reader), ed.levy).details, null)
    assert.equal((await asOwner(ed.levy.id, "approve", EDITED)).ok, true, "and can approve it again")
  })

  it("text changed outside the editor is never shown under an old approval", async () => {
    await sql`update publication_summaries set what_changed = ${DRAFT_ONLY.whatChanged} where publication_id = ${ed.levy.id}::uuid`
    const reader = await dataRoom(R.reader)
    assert.equal(cardOf(reader, ed.levy).details, null)
    assert.equal(reader.json.includes(DRAFT_ONLY.whatChanged), false)
    await sql`update publication_summaries set what_changed = ${EDITED.whatChanged} where publication_id = ${ed.levy.id}::uuid`
    assert.deepEqual(cardOf(await dataRoom(R.reader), ed.levy).details.summary, EDITED)
  })
})

describe("concurrency", () => {
  it("an edit racing an approval of the same revision: exactly one wins, and the approval is only ever of text the owner saw", async () => {
    for (let round = 0; round < 4; round++) {
      // A fresh draft each round.
      const draft = { ...TEXT, whatChanged: `Round ${round} draft.` }
      assert.equal((await asEditor(ed.levy.id, "draft", draft)).ok, true)
      const seen = await revisionOf(ed.levy.id)
      const edit = { ...draft, watchNext: `Round ${round} edit the owner never saw.` }
      const [approved, edited] = await Promise.all([
        store.approveSummaryRevision(sql, { publicationId: ed.levy.id, revision: seen, adminId: owner }),
        store.saveSummaryText(sql, { publicationId: ed.levy.id, revision: seen, text: edit, adminId: editor, invalidates: false }),
      ])
      assert.equal([approved, edited].filter((r) => r === "saved").length, 1, `round ${round}: one winner`)
      const stored = await store.readStoredSummary(sql, ed.levy.id)
      if (approved === "saved") {
        assert.deepEqual(stored.approved, draft, "the approved copy is the text the owner was shown")
        assert.deepEqual(stored.text, draft)
      } else {
        assert.equal(stored.approved, null, "nothing approved")
        assert.deepEqual(stored.text, edit)
      }
      assert.equal((await dataRoom(R.reader)).json.includes(edit.watchNext), false, "the unseen edit is never shown")
    }
  })

  it("the same race through the server action: one is refused as stale", async () => {
    assert.equal((await asEditor(ed.levy.id, "draft", { ...TEXT, whatChanged: "Action race base." })).ok, true)
    const seen = await revisionOf(ed.levy.id)
    const base = { ...TEXT, whatChanged: "Action race base." }
    // Each action reads the summary, then writes with the revision it read.
    const results = await Promise.all([
      store.approveSummaryRevision(sql, { publicationId: ed.levy.id, revision: seen, adminId: owner }),
      asEditor(ed.levy.id, "draft", { ...base, uncertainty: "Edited during approval." }, seen),
    ])
    const approvedWon = results[0] === "saved"
    const editWon = results[1].ok === true
    assert.equal(Number(approvedWon) + Number(editWon), 1)
    if (!editWon) assert.match(results[1].message, /changed by someone else/)
    const stored = await store.readStoredSummary(sql, ed.levy.id)
    if (approvedWon) assert.deepEqual(stored.approved, base)
    else assert.equal(stored.approved, null)
  })

  it("two edits of the same revision: one wins, the other is refused, nothing is merged", async () => {
    const seen = await revisionOf(ed.levy.id)
    const a = { ...TEXT, whatChanged: "Editor A's version." }
    const b = { ...TEXT, whatChanged: "Editor B's version." }
    const [ra, rb] = await Promise.all([asEditor(ed.levy.id, "draft", a, seen), store.saveSummaryText(sql, { publicationId: ed.levy.id, revision: seen, text: b, adminId: owner2, invalidates: true })])
    const aWon = ra.ok === true
    const bWon = rb === "saved"
    assert.equal(Number(aWon) + Number(bWon), 1)
    assert.deepEqual((await store.readStoredSummary(sql, ed.levy.id)).text, aWon ? a : b)
  })

  it("two owners approving at once: one approval, of the revision both saw", async () => {
    const text = { ...TEXT, whatChanged: "Two owners approve this." }
    assert.equal((await asEditor(ed.levy.id, "draft", text)).ok, true)
    const seen = await revisionOf(ed.levy.id)
    const results = await Promise.all([
      store.approveSummaryRevision(sql, { publicationId: ed.levy.id, revision: seen, adminId: owner }),
      store.approveSummaryRevision(sql, { publicationId: ed.levy.id, revision: seen, adminId: owner2 }),
    ])
    assert.deepEqual(results.sort(), ["saved", "stale"])
    const stored = await store.readStoredSummary(sql, ed.levy.id)
    assert.equal(stored.approvedRevision, seen)
    assert.deepEqual(stored.approved, text)
  })

  // The action reads the summary, checks the revision, then writes: between
  // that read and the write only the statement's own revision check stands.
  // These run in a fixed order, so they prove that check on its own.
  it("an approval of a revision that has moved on is refused, even though the newer text is complete and unapproved", async () => {
    const shown = { ...TEXT, whatChanged: "Text the owner was shown." }
    assert.equal((await asEditor(ed.levy.id, "draft", shown)).ok, true)
    const seen = await revisionOf(ed.levy.id)
    // An editor saves new text after the owner's page was loaded.
    const unseen = { ...TEXT, whatChanged: "Complete text the owner never saw.", watchNext: "An unseen signal to watch." }
    assert.equal(await store.saveSummaryText(sql, { publicationId: ed.levy.id, revision: seen, text: unseen, adminId: editor, invalidates: false }), "saved")
    // The owner's approval still carries the revision they were shown.
    assert.equal(await store.approveSummaryRevision(sql, { publicationId: ed.levy.id, revision: seen, adminId: owner }), "stale")
    const stored = await store.readStoredSummary(sql, ed.levy.id)
    assert.equal(stored.approved, null, "nothing approved")
    assert.equal(stored.approvedRevision, null)
    assert.equal(stored.status, "changed")
    assert.deepEqual(stored.text, unseen)
    assert.equal(stored.revision, seen + 1, "the refused approval wrote nothing")
    const reader = await dataRoom(R.reader)
    assert.equal(cardOf(reader, ed.levy).details, null)
    assert.equal(contains(reader.json, unseen), false, "the unseen text never reaches a reader")
  })

  it("a withdrawal of a revision that has moved on is refused: a newer approval the owner never saw stays", async () => {
    const first = { ...TEXT, whatChanged: "First approved text." }
    assert.equal((await asEditor(ed.levy.id, "draft", first)).ok, true)
    assert.equal((await asOwner(ed.levy.id, "approve", first)).ok, true)
    const seen = await revisionOf(ed.levy.id)
    // Meanwhile an editor changes it and another owner approves the change.
    const second = { ...TEXT, whatChanged: "Second approved text." }
    assert.equal(await store.saveSummaryText(sql, { publicationId: ed.levy.id, revision: seen, text: second, adminId: editor, invalidates: true }), "saved")
    assert.equal(await store.approveSummaryRevision(sql, { publicationId: ed.levy.id, revision: seen + 1, adminId: owner2 }), "saved")
    // The first owner's withdrawal, aimed at the text they were shown.
    assert.equal(await store.withdrawSummaryApproval(sql, { publicationId: ed.levy.id, revision: seen, adminId: owner }), "stale")
    const stored = await store.readStoredSummary(sql, ed.levy.id)
    assert.equal(stored.status, "approved")
    assert.deepEqual(stored.approved, second)
    assert.equal(stored.approvedBy, "Owner Two")
    assert.equal(stored.removedReason, null)
    assert.equal(stored.revision, seen + 2, "the refused withdrawal wrote nothing")
    assert.deepEqual(cardOf(await dataRoom(R.reader), ed.levy).details.summary, second)
  })

  it("the first save of a new summary is compare-and-set too (revision 0)", async () => {
    const results = await Promise.all([
      store.saveSummaryText(sql, { publicationId: ed.plain.id, revision: 0, text: { ...TEXT, whatChanged: "First." }, adminId: editor, invalidates: false }),
      store.saveSummaryText(sql, { publicationId: ed.plain.id, revision: 0, text: { ...TEXT, whatChanged: "Second." }, adminId: owner, invalidates: false }),
    ])
    assert.deepEqual(results.sort(), ["saved", "stale"])
    assert.equal(await revisionOf(ed.plain.id), 1)
    await sql`delete from publication_summaries where publication_id = ${ed.plain.id}::uuid`
  })
})

describe("drafts and protected text never leak", () => {
  before(async () => {
    // One approved summary and one standing draft, both on paid editions with public slugs.
    const approvedNow = await store.readStoredSummary(sql, ed.levy.id)
    if (approvedNow.status !== "approved") assert.equal((await asOwner(ed.levy.id, "approve", approvedNow.text)).ok, true)
    assert.equal((await asEditor(ed.plain.id, "draft", DRAFT_ONLY)).ok, true)
    await sql`update documents set is_published = true, status = 'published' where id = any(${[ed.levy.id, ed.plain.id]}::uuid[])`
  })

  const protectedWords = async () => {
    const levy = await store.readStoredSummary(sql, ed.levy.id)
    return [...WORDS(levy.text), ...WORDS(DRAFT_ONLY)].filter(Boolean)
  }

  it("a draft is in no reader's payload or search records, on either path", async () => {
    for (const library of [await dataRoom(R.reader), await dataRoom(R.blocked), await dataRoom(R.other), await legacy(L.reader), await legacy(L.other)]) {
      for (const word of WORDS(DRAFT_ONLY).filter(Boolean)) assert.equal(library.json.includes(word), false, word)
    }
  })

  it("public publication reads (the public pages' data) carry no protected text, approved or draft", async () => {
    const words = await protectedWords()
    const reads = [
      await pubs.getPublicationBySlug(ed.levy.slug),
      await pubs.getPublicationBySlug(ed.plain.slug),
      await pubs.getPublishedPublications(),
      await pubs.getOpenPublications(),
      await pubs.getReviewPublicationArchive(),
      await pubs.getPublicReviewLibrary(),
    ]
    const json = JSON.stringify(reads)
    for (const word of words) assert.equal(json.includes(word), false, word)
  })

  it("Complimentary Review reads carry no protected text", async () => {
    const words = await protectedWords()
    const json = JSON.stringify([
      await pubs.getReviewLibraryForEmail(`${tag}_reader@example.invalid`),
      await pubs.getReviewLibraryForEmail(`${tag}_lreader@example.invalid`),
    ])
    for (const word of words) assert.equal(json.includes(word), false, word)
  })

  it("only the summary modules, the reader loaders and the Admin editor read summaries (source guard)", () => {
    const allowed = new Set([
      "src/lib/publication-summaries.ts",
      "src/lib/publication-metadata-dal.ts",
      "src/app/actions/publication-summaries.ts",
      "src/app/admin/documents/[id]/page.tsx",
    ])
    const files = []
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) walk(path)
        else if (/\.(ts|tsx)$/.test(name)) files.push(path.replaceAll("\\", "/").slice(path.replaceAll("\\", "/").indexOf("src/")))
      }
    }
    walk(fileURLToPath(new URL("../src/", import.meta.url)))
    const source = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8")
    const readers = files.filter((f) => /\bpublication_summaries\b|from ["'](@\/lib\/|\.\/)publication-summaries["']/.test(source(f)))
    assert.deepEqual(readers.sort(), [...allowed].sort())
    // The reader-details loader is used only by the two subscriber library loaders and Admin.
    const detailUsers = files.filter((f) => /from ["'](@\/lib\/|\.\/)publication-metadata-dal["']/.test(source(f)))
    assert.deepEqual(detailUsers.sort(), [
      // Admin's delete, for hasWrittenSummary() only (a yes/no, never text).
      "src/app/actions/documents.ts",
      "src/app/actions/publication-metadata.ts",
      "src/app/actions/publication-summaries.ts",
      "src/app/admin/documents/[id]/page.tsx",
      "src/app/admin/tags/page.tsx",
      "src/lib/papermark-client-library.ts",
      "src/lib/subscriber-dal.ts",
    ].sort())
  })

  it("the portal's page metadata is static and it has no structured data", () => {
    const page = readFileSync(new URL("../src/app/portal/page.tsx", import.meta.url), "utf8")
    assert.match(page, /export const metadata = \{\s*title: "Your Library · Athena Strategic Advisory",\s*robots: \{ index: false, follow: false \},\s*\}/)
    assert.doesNotMatch(page, /generateMetadata|application\/ld\+json|openGraph/)
  })

  it("no request left this machine", () => {
    assert.deepEqual(outbound, [])
  })
})

// Which listed editions carry details and the approved summary: every edition
// the access policy lists for the reader, i.e. delivery open, preparing or
// preserved (src/lib/access-policy-dal.ts). Preserved means the decision is
// still unresolved but a link issued earlier stays open, so the reader can
// already open the whole document; an unresolved edition without such a link
// is hidden and gets nothing. (docs/publication-metadata-and-summaries.md)
describe("undecided editions", () => {
  const UNDECIDED = {
    whatChanged: "Undecided edition change oboe.",
    whyItMatters: "Undecided edition reason bassoon.",
    implications: "Undecided edition scenario clarinet.",
    watchNext: "Undecided edition signal piccolo.",
    sourceDate: "",
    uncertainty: "",
  }
  const SHOWN = { ...UNDECIDED, sourceDate: null }
  before(async () => {
    // Released and in the room, but ticked for no plan: the policy's answer is "unresolved".
    const room = (await sql`select papermark_dataroom_id from papermark_dataroom_documents where id = ${ed.levy.documentRowId}::uuid`)[0].papermark_dataroom_id
    ed.undecided = await fx.edition("undecided", { title: "Undecided room note", series: "MIN", date: "2026-10-06", forTiers: [], dataroom: room })
    ed.legacyUndecided = await fx.edition("legacyundecided", { title: "Undecided legacy note", series: "PLM", date: "2026-10-06", forTiers: [] })
    // R.reader and L.reader were issued a link earlier; R.blocked and L.other were not.
    await sql`
      insert into papermark_subscriber_document_links (subscriber_id, papermark_document_id, papermark_link_id, link_url)
      values (${R.reader}::uuid, ${ed.undecided.papermarkDocumentId}, ${`${tag}_prior_link`}, ${`https://docs.example.invalid/view/${tag}-prior`})`
    await sql`
      insert into publication_access (subscriber_id, publication_id, link_url, papermark_link_id, revoke_state)
      values (${L.reader}::uuid, ${ed.legacyUndecided.id}::uuid, ${`https://docs.example.invalid/view/${tag}-legacy-prior`}, ${`${tag}_legacy_prior`}, 'live')`
    await sql`update documents set reading_time_minutes = 7 where id = any(${[ed.undecided.id, ed.legacyUndecided.id]}::uuid[])`
    for (const id of [ed.undecided.id, ed.legacyUndecided.id]) {
      assert.equal((await asEditor(id, "draft", UNDECIDED)).ok, true)
      assert.equal((await asOwner(id, "approve", UNDECIDED)).ok, true)
    }
  })

  it("an allowed edition whose link is still being prepared shows its approved summary", async () => {
    const card = cardOf(await dataRoom(R.reader), ed.levy)
    assert.equal(card.delivery, "preparing")
    assert.ok(card.details?.summary, "allowed by the access policy")
  })

  it("an undecided edition with a link issued earlier (preserved) shows details and the approved summary, on both paths", async () => {
    const card = cardOf(await dataRoom(R.reader), ed.undecided)
    assert.equal(card.delivery, "preserved")
    assert.deepEqual(card.details.summary, SHOWN)
    assert.equal(card.details.readingMinutes, 7)
    const item = itemOf(await legacy(L.reader), ed.legacyUndecided)
    assert.ok(item.linkUrl, "the earlier link stays open")
    assert.deepEqual(item.details.summary, SHOWN)
  })

  it("an undecided edition without such a link is not listed, and nothing of it reaches the reader", async () => {
    const blocked = await dataRoom(R.blocked)
    assert.equal(cardOf(blocked, ed.undecided), undefined)
    assert.equal(contains(blocked.json, UNDECIDED), false)
    const other = await legacy(L.other)
    assert.equal(itemOf(other, ed.legacyUndecided), undefined)
    assert.equal(contains(other.json, UNDECIDED), false)
  })
})

describe("deleting a publication record", () => {
  const EMPTY = { whatChanged: "", whyItMatters: "", implications: "", watchNext: "", sourceDate: "", uncertainty: "" }
  const exists = async (id) => (await sql`select count(*)::int as n from documents where id = ${id}::uuid`)[0].n === 1

  it("is refused while it holds a written summary, approved or draft, and changes nothing; once the text is cleared it can be deleted", async () => {
    // A record nothing else uses: no Data Room document, review slot, access or reading history.
    const spare = await fx.edition("spare", { title: "Duplicate record", series: "MIN", date: "2026-10-07", status: "draft" })
    const { deleteDocument } = await import("../src/app/actions/documents.ts")
    assert.equal((await asEditor(spare.id, "draft", TEXT)).ok, true)
    assert.equal((await asOwner(spare.id, "approve", TEXT)).ok, true)

    await signIn(session, owner, "owner")
    const refused = await deleteDocument(spare.id)
    assert.notEqual(refused.ok, true)
    assert.match(refused.message, /used by a protected summary/)
    assert.match(refused.message, /Archive it instead/)
    assert.equal(await exists(spare.id), true)
    assert.deepEqual((await store.readStoredSummary(sql, spare.id)).approved, TEXT)

    // A draft is written work too.
    assert.equal((await asOwner(spare.id, "withdraw", TEXT)).ok, true)
    await signIn(session, owner, "owner")
    assert.match((await deleteDocument(spare.id)).message, /used by a protected summary/)
    assert.equal(await exists(spare.id), true)

    // Cleared in the editor: nothing is lost, so the delete goes ahead (and the empty row goes with it).
    assert.equal((await asEditor(spare.id, "draft", EMPTY)).ok, true)
    await signIn(session, owner, "owner")
    const deleted = await deleteDocument(spare.id)
    assert.equal(deleted.ok, true, deleted.message)
    assert.equal(await exists(spare.id), false)
    assert.equal(await store.readStoredSummary(sql, spare.id), null)
  })
})
