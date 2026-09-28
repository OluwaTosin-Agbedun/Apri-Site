/**
 * Withdrawing a Complimentary Review edition.
 *
 * The sequence (src/lib/review-withdrawal.ts) takes its database and Papermark
 * calls as dependencies, so these tests run the real sequence against fakes
 * and can make Papermark refuse, keep a link alive, or stop answering, and make
 * the database fail at each step. They prove:
 *
 *  - latest and historical editions of each series can be withdrawn, whether
 *    their recipients are still the shared list or have been adopted;
 *  - success is reported only once Papermark reads the link as gone
 *    (direct-link denial), never merely because the card is hidden;
 *  - a failure at any step leaves a state the same action finishes, without
 *    creating or restoring any access;
 *  - only the edition's own link is ever revoked, and never one APRI records as
 *    paid access;
 *  - public pages are refreshed at each change;
 *  - each series is chosen independently on the homepage.
 *
 * Source checks cover what only the source can show: who may call each action,
 * what each touches, and that paid access is never written.
 *
 * Written on the assumption that an attacker can read this repository.
 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import {
  buildAccessPathReport,
  decideWithdrawal,
  describeAccessPaths,
  parseReplacementChoice,
  proposedReplacement,
  REVIEW_SERIES,
  revocationTargetProblem,
  runWithdrawal,
  selectOfferedCards,
  withdrawalDisplay,
  withdrawalPreviewKey,
} from "../src/lib/review-withdrawal.ts"

const ROOT = resolve(import.meta.dirname, "..")
const read = (p) => readFileSync(join(ROOT, p), "utf8")

const ACTIONS = "src/app/actions/review-withdrawal.ts"
const DAL = "src/lib/review-withdrawal-dal.ts"
const MIGRATION = "db/migrations/20260929_review_edition_withdrawal.sql"
const SERVICE = "src/lib/papermark-datarooms.ts"
const PANEL = "src/app/admin/review-library/edition-withdrawal-panel.tsx"
const FORM = "src/app/admin/review-library/review-form.tsx"
const LIBRARY_ACTIONS = "src/app/actions/review-library.ts"
const PUBLICATIONS = "src/lib/publications.ts"

function body(src, name) {
  const start = src.search(new RegExp(`(export )?async function ${name}\\(`))
  assert.notEqual(start, -1, `${name} must exist`)
  const rest = src.slice(start)
  const end = rest.search(/\n\}[ \t]*(\r?\n|$)/)
  assert.notEqual(end, -1, `${name} must have a closing brace`)
  return rest.slice(0, end + 2)
}

// ---------------------------------------------------------------------------
// A fake APRI and Papermark
// ---------------------------------------------------------------------------

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

function edition(over = {}) {
  return {
    id: uuid(1),
    series: "MIN",
    label: "MIN · September 2026",
    publicationState: "published",
    isLatest: true,
    featured: true,
    papermarkDocumentId: "doc-min-sept",
    secureLinkId: "lnk-min-sept",
    recipientMode: "edition",
    withdrawalState: null,
    withdrawalLinkId: null,
    ...over,
  }
}

/**
 * A world with editions and Papermark links. Every call is logged, so a test
 * can prove what was and was not touched.
 */
function world(editions, options = {}) {
  const log = []
  const db = new Map(editions.map((e) => [e.id, { ...e }]))
  const links = new Map(
    editions
      .filter((e) => e.secureLinkId)
      .map((e) => [e.secureLinkId, { alive: true, targetType: "document", documentId: e.papermarkDocumentId }]),
  )
  for (const [id, l] of Object.entries(options.extraLinks ?? {})) links.set(id, l)
  let refreshes = 0
  const deps = {
    loadEdition: async (id) => {
      log.push(["loadEdition", id])
      const e = db.get(id)
      return e ? { ...e } : null
    },
    loadReplacementCandidates: async (e) => {
      log.push(["loadReplacementCandidates", e.id])
      return [...db.values()]
        .filter((c) => c.id !== e.id && c.series === e.series && c.publicationState === "published" && c.secureLinkId)
        .map((c) => ({ id: c.id, label: c.label }))
    },
    verifyReplacement: async (id) => {
      log.push(["verifyReplacement", id])
      return options.replacementFails ? { ok: false, message: "The chosen replacement did not verify." } : { ok: true }
    },
    paidAccessCheck: async (linkId) => {
      log.push(["paidAccessCheck", linkId])
      if (options.paidUnknown) return "unknown"
      return (options.paidLinks ?? []).includes(linkId) ? "paid" : "not_paid"
    },
    readLink: async (linkId) => {
      log.push(["readLink", linkId])
      if (options.papermarkDownAfterRevoke && log.some(([op]) => op === "revokeLink")) {
        return { state: "unknown", message: "Papermark could not be reached." }
      }
      const l = links.get(linkId)
      if (!l || !l.alive) return { state: "gone" }
      return { state: "active", targetType: l.targetType, documentId: l.documentId, dataroomId: null }
    },
    revokeLink: async (linkId) => {
      log.push(["revokeLink", linkId])
      if (options.revokeRefused) return { ok: false, message: "403 missing scope" }
      const l = links.get(linkId)
      // A link Papermark accepts the DELETE for but keeps serving.
      if (l && !options.linkSurvivesRevoke) l.alive = false
      return { ok: true }
    },
    beginWithdrawal: async ({ editionId, linkId, replacementId }) => {
      log.push(["beginWithdrawal", editionId, linkId, replacementId])
      if (options.beginFails) throw new Error("withdrawal: the edition's link changed since it was previewed")
      const e = db.get(editionId)
      Object.assign(e, { publicationState: "withdrawn", withdrawalState: "revoking", withdrawalLinkId: linkId, featured: false, isLatest: false })
      if (replacementId) db.get(replacementId).featured = true
      return "started"
    },
    completeWithdrawal: async ({ editionId, linkId }) => {
      log.push(["completeWithdrawal", editionId, linkId])
      if (options.completeFailsOnce && !options._completeFailed) {
        options._completeFailed = true
        throw new Error("database unavailable")
      }
      const e = db.get(editionId)
      Object.assign(e, { withdrawalState: "revoked", secureLinkId: null })
      return "completed"
    },
    recordUnconfirmed: async ({ editionId, reason }) => {
      log.push(["recordUnconfirmed", editionId, reason])
    },
    refresh: () => {
      refreshes++
      log.push(["refresh"])
    },
    scanAccessPaths: async ({ documentId, withdrawnLinkId }) => {
      log.push(["scanAccessPaths", documentId, withdrawnLinkId])
      return buildAccessPathReport({
        links: options.otherLinks ?? [],
        withdrawnLinkId,
        knownIds: new Map(Object.entries(options.knownIds ?? {})),
        knownUrls: new Map(),
        complete: options.scanIncomplete ? false : true,
        notes: options.scanIncomplete ? ["the Data Rooms could not be listed"] : [],
      })
    },
  }
  return { deps, db, links, log, refreshes: () => refreshes, ops: () => log.map(([op]) => op) }
}

const input = (e, choice = "none") => ({
  editionId: e.id,
  previewKey: withdrawalPreviewKey(e),
  choice: parseReplacementChoice(choice),
})

// ---------------------------------------------------------------------------
// The homepage: each series stands alone
// ---------------------------------------------------------------------------

describe("which edition each series offers", () => {
  const card = (slotKey, accessConfigured = true, id = slotKey) => ({ slotKey, accessConfigured, id })

  it("shows every series that has a ready edition, in MIN, AIU, PLM order", () => {
    const cards = selectOfferedCards([card("PLM"), card("MIN"), card("AIU")])
    assert.deepEqual(cards.map((c) => c.slotKey), ["MIN", "AIU", "PLM"])
  })

  for (const withdrawn of REVIEW_SERIES) {
    it(`withdrawing ${withdrawn} leaves the other two series on the homepage`, () => {
      const cards = selectOfferedCards(REVIEW_SERIES.filter((s) => s !== withdrawn).map((s) => card(s)))
      assert.deepEqual(cards.map((c) => c.slotKey), REVIEW_SERIES.filter((s) => s !== withdrawn))
    })
  }

  it("a series whose chosen edition is not ready loses only its own card, with no older substitute", () => {
    const cards = selectOfferedCards([card("MIN", false, "min-sept"), card("MIN", true, "min-aug"), card("AIU"), card("PLM")])
    assert.deepEqual(cards.map((c) => c.id), ["AIU", "PLM"])
  })

  it("no series offering anything means no cards, and anything but MIN, AIU and PLM is ignored", () => {
    assert.deepEqual(selectOfferedCards([]), [])
    assert.deepEqual(selectOfferedCards([card("XYZ")]), [])
  })
})

describe("the proposed homepage replacement", () => {
  it("preselects August MIN when it is the newest eligible replacement for September MIN", () => {
    const august = { id: uuid(2), label: "MIN · August 2026" }
    const july = { id: uuid(3), label: "MIN · July 2026" }
    assert.equal(proposedReplacement([august, july]), august.id)
  })

  it("does not infer a replacement when no eligible candidate exists", () => {
    assert.equal(proposedReplacement([]), "")
  })
})

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

describe("deciding a withdrawal", () => {
  const candidates = [{ id: uuid(2), label: "MIN · August 2026" }]

  it("the offered edition needs an explicit choice: a replacement, or none", () => {
    const e = edition()
    const unset = decideWithdrawal({ edition: e, previewKey: withdrawalPreviewKey(e), choice: { kind: "unset" }, candidates })
    assert.equal(unset.ok, false)
    assert.match(unset.message, /Choose another verified published edition to offer instead, or choose no replacement/)
    const none = decideWithdrawal({ edition: e, previewKey: withdrawalPreviewKey(e), choice: { kind: "none" }, candidates })
    assert.deepEqual(none, { ok: true, resume: false, linkId: "lnk-min-sept", replacementId: null })
    const repl = decideWithdrawal({ edition: e, previewKey: withdrawalPreviewKey(e), choice: { kind: "edition", id: uuid(2) }, candidates })
    assert.deepEqual(repl, { ok: true, resume: false, linkId: "lnk-min-sept", replacementId: uuid(2) })
  })

  it("a replacement must be one of the verified candidates, and never the edition itself", () => {
    const e = edition()
    for (const id of [uuid(9), e.id]) {
      const d = decideWithdrawal({ edition: e, previewKey: withdrawalPreviewKey(e), choice: { kind: "edition", id }, candidates })
      assert.equal(d.ok, false)
    }
  })

  it("a historical edition needs no choice, and cannot take a replacement", () => {
    const e = edition({ isLatest: false, featured: false })
    assert.equal(decideWithdrawal({ edition: e, previewKey: withdrawalPreviewKey(e), choice: { kind: "unset" }, candidates: [] }).ok, true)
    const d = decideWithdrawal({ edition: e, previewKey: withdrawalPreviewKey(e), choice: { kind: "edition", id: uuid(2) }, candidates })
    assert.equal(d.ok, false)
    assert.match(d.message, /nothing to replace/)
  })

  it("an edition still on the shared list is withdrawn without being adopted", () => {
    const e = edition({ recipientMode: "shared_legacy", featured: false, isLatest: false })
    const d = decideWithdrawal({ edition: e, previewKey: withdrawalPreviewKey(e), choice: { kind: "none" }, candidates: [] })
    assert.equal(d.ok, true)
  })

  it("refuses what was not previewed, what is not published, and an edition with no link on record", () => {
    const e = edition()
    assert.equal(decideWithdrawal({ edition: e, previewKey: "stale", choice: { kind: "none" }, candidates }).ok, false)
    assert.equal(decideWithdrawal({ edition: edition({ publicationState: "draft" }), previewKey: "", choice: { kind: "none" }, candidates }).ok, false)
    const noLink = edition({ secureLinkId: null })
    const d = decideWithdrawal({ edition: noLink, previewKey: withdrawalPreviewKey(noLink), choice: { kind: "none" }, candidates })
    assert.equal(d.ok, false)
    assert.match(d.message, /no APRI-managed Papermark link on record/)
  })

  it("an unfinished withdrawal is resumed with its recorded link, whatever is posted", () => {
    const e = edition({ publicationState: "withdrawn", withdrawalState: "revoking", withdrawalLinkId: "lnk-min-sept", featured: false })
    assert.deepEqual(
      decideWithdrawal({ edition: e, previewKey: "", choice: { kind: "edition", id: uuid(2) }, candidates }),
      { ok: true, resume: true, linkId: "lnk-min-sept" },
    )
  })

  it("the preview key changes when the link or the offer changes", () => {
    const e = edition()
    assert.notEqual(withdrawalPreviewKey(e), withdrawalPreviewKey({ ...e, secureLinkId: "lnk-other" }))
    assert.notEqual(withdrawalPreviewKey(e), withdrawalPreviewKey({ ...e, featured: false }))
  })

  it("only a document link to the edition's own PDF may be revoked", () => {
    const e = edition()
    assert.equal(revocationTargetProblem(e, { state: "active", targetType: "document", documentId: "doc-min-sept", dataroomId: null }), null)
    assert.match(revocationTargetProblem(e, { state: "active", targetType: "dataroom", documentId: null, dataroomId: "dr-1" }), /not a document link/)
    assert.match(revocationTargetProblem(e, { state: "active", targetType: "document", documentId: "doc-other", dataroomId: null }), /does not target/)
    assert.equal(revocationTargetProblem(e, { state: "gone" }), null)
  })

  it("parses the replacement choice strictly", () => {
    assert.deepEqual(parseReplacementChoice("none"), { kind: "none" })
    assert.deepEqual(parseReplacementChoice(uuid(2)), { kind: "edition", id: uuid(2) })
    for (const bad of [undefined, "", "all", "1; drop table", 5]) assert.deepEqual(parseReplacementChoice(bad), { kind: "unset" })
  })
})

// ---------------------------------------------------------------------------
// The sequence: latest and historical, each series, legacy recipients
// ---------------------------------------------------------------------------

describe("withdrawing an edition", () => {
  it("withdraws the latest edition, offering a replacement, and reports success only after Papermark confirms", async () => {
    const latest = edition()
    const august = edition({ id: uuid(2), label: "MIN · August 2026", isLatest: false, featured: false, papermarkDocumentId: "doc-min-aug", secureLinkId: "lnk-min-aug" })
    const w = world([latest, august])
    const r = await runWithdrawal(w.deps, input(latest, uuid(2)))
    assert.equal(r.ok, true)
    assert.equal(r.status, "withdrawn")
    assert.deepEqual(w.log.find(([op]) => op === "beginWithdrawal"), ["beginWithdrawal", latest.id, "lnk-min-sept", uuid(2)])
    assert.equal(w.db.get(uuid(2)).featured, true, "the replacement is offered")
    assert.equal(w.links.get("lnk-min-aug").alive, true, "the replacement's link is untouched")
    const ops = w.ops()
    assert.ok(ops.indexOf("beginWithdrawal") < ops.indexOf("revokeLink"), "hidden and recorded before Papermark is touched")
    assert.ok(ops.lastIndexOf("readLink") > ops.indexOf("revokeLink"), "read back after revoking")
    assert.ok(ops.indexOf("completeWithdrawal") > ops.lastIndexOf("readLink"), "completed only after the read-back")
  })

  it("withdraws a published historical edition without changing what the series offers", async () => {
    const latest = edition()
    const august = edition({ id: uuid(2), label: "MIN · August 2026", isLatest: false, featured: false, papermarkDocumentId: "doc-min-aug", secureLinkId: "lnk-min-aug" })
    const w = world([latest, august])
    const r = await runWithdrawal(w.deps, input(august))
    assert.equal(r.ok, true)
    assert.equal(w.db.get(latest.id).featured, true)
    assert.equal(w.links.get("lnk-min-sept").alive, true)
    assert.equal(w.links.get("lnk-min-aug").alive, false)
  })

  for (const series of REVIEW_SERIES) {
    it(`withdrawing ${series} revokes only ${series}'s own link`, async () => {
      const editions = REVIEW_SERIES.map((s, i) =>
        edition({ id: uuid(10 + i), series: s, label: `${s} · latest`, papermarkDocumentId: `doc-${s}`, secureLinkId: `lnk-${s}` }),
      )
      const target = editions.find((e) => e.series === series)
      const w = world(editions)
      const r = await runWithdrawal(w.deps, input(target, "none"))
      assert.equal(r.ok, true)
      assert.deepEqual(w.log.filter(([op]) => op === "revokeLink"), [["revokeLink", `lnk-${series}`]])
      for (const e of editions.filter((x) => x !== target)) {
        assert.equal(w.links.get(e.secureLinkId).alive, true)
        assert.equal(w.db.get(e.id).publicationState, "published")
        assert.equal(w.db.get(e.id).featured, true, "the other series keep offering their editions")
      }
    })
  }

  it("withdraws an edition still on the shared list, without adopting it", async () => {
    const legacy = edition({ recipientMode: "shared_legacy" })
    const w = world([legacy])
    const r = await runWithdrawal(w.deps, input(legacy, "none"))
    assert.equal(r.ok, true)
    assert.equal(w.db.get(legacy.id).recipientMode, "shared_legacy", "withdrawal does not change the recipient mode")
    assert.ok(!w.ops().some((op) => /adopt/i.test(op)))
  })

  it("an already completed withdrawal changes nothing", async () => {
    const done = edition({ publicationState: "withdrawn", withdrawalState: "revoked", withdrawalLinkId: "lnk-min-sept", secureLinkId: null, featured: false })
    const w = world([done])
    const r = await runWithdrawal(w.deps, input(done))
    assert.equal(r.ok, true)
    assert.equal(r.status, "already_withdrawn")
    assert.deepEqual(w.ops().filter((op) => op !== "loadEdition"), [])
  })
})

// ---------------------------------------------------------------------------
// Direct-link denial: hiding the card is never enough
// ---------------------------------------------------------------------------

describe("the direct link must stop working", () => {
  it("if Papermark still serves the link after the revoke, the withdrawal is not reported as done", async () => {
    const e = edition()
    const w = world([e], { linkSurvivesRevoke: true })
    const r = await runWithdrawal(w.deps, input(e))
    assert.equal(r.ok, false)
    assert.equal(r.status, "link_still_open")
    assert.match(r.message, /may still open the document/)
    assert.match(r.message, /The withdrawal is not complete/)
    assert.ok(!w.ops().includes("completeWithdrawal"), "never recorded as complete")
    assert.equal(w.db.get(e.id).publicationState, "withdrawn", "but the edition is already hidden from every public page")
    assert.ok(w.ops().includes("recordUnconfirmed"))
  })

  it("if Papermark refuses the revoke, nothing is claimed", async () => {
    const e = edition()
    const w = world([e], { revokeRefused: true })
    const r = await runWithdrawal(w.deps, input(e))
    assert.equal(r.ok, false)
    assert.match(r.message, /Papermark did not revoke it \(403 missing scope\)/)
    assert.ok(!w.ops().includes("completeWithdrawal"))
  })

  it("if Papermark cannot be read after the revoke, it is unconfirmed, not done", async () => {
    const e = edition()
    const w = world([e], { papermarkDownAfterRevoke: true })
    const r = await runWithdrawal(w.deps, input(e))
    assert.equal(r.ok, false)
    assert.equal(r.status, "unconfirmed")
    assert.ok(!w.ops().includes("completeWithdrawal"))
  })

  it("the success message says the link no longer opens, and lists what else can still open the PDF", async () => {
    const e = edition()
    const w = world([e], {
      otherLinks: [
        { id: "lnk-manual", name: "Board copy", url: null, targetType: "document", roomId: null, roomName: null, emailProtected: false },
        { id: "lnk-paid", name: "Jane Subscriber", url: null, targetType: "document", roomId: null, roomName: null, emailProtected: true },
      ],
      knownIds: { "lnk-paid": "paid_subscriber" },
    })
    const r = await runWithdrawal(w.deps, input(e))
    assert.equal(r.ok, true)
    assert.match(r.message, /Papermark confirmed its complimentary link no longer opens/)
    const lines = r.accessPaths.join("\n")
    assert.match(lines, /Still open and not managed by APRI -- review in Papermark: "Board copy" \(document link, id lnk-manual\)/)
    assert.match(lines, /Paid subscriber access to this PDF, left unchanged: 1 link\./)
    assert.doesNotMatch(lines, /Jane Subscriber/, "paid access is counted, never named")
  })
})

// ---------------------------------------------------------------------------
// Partial failures and retries
// ---------------------------------------------------------------------------

describe("failures part-way, and finishing afterwards", () => {
  it("if APRI cannot record the start, Papermark is never touched", async () => {
    const e = edition()
    const w = world([e], { beginFails: true })
    const r = await runWithdrawal(w.deps, input(e))
    assert.equal(r.ok, false)
    assert.match(r.message, /Nothing was changed\./)
    assert.ok(!w.ops().includes("revokeLink"))
    assert.equal(w.links.get("lnk-min-sept").alive, true)
  })

  it("if Papermark revoked the link but APRI could not record it, Complete withdrawal finishes without recreating access", async () => {
    const e = edition()
    const w = world([e], { completeFailsOnce: true })
    const first = await runWithdrawal(w.deps, input(e))
    assert.equal(first.ok, false)
    assert.equal(first.status, "record_failed")
    assert.match(first.message, /Papermark confirms .* no longer opens, but APRI could not record the withdrawal as complete/)
    assert.match(first.message, /it does not create or restore any access/)
    assert.equal(w.links.get("lnk-min-sept").alive, false)

    // The owner clicks Complete withdrawal: the panel posts no preview and no choice.
    const beginsBefore = w.log.filter(([op]) => op === "beginWithdrawal").length
    const retry = await runWithdrawal(w.deps, { editionId: e.id, previewKey: "", choice: parseReplacementChoice("none") })
    assert.equal(retry.ok, true)
    assert.equal(retry.status, "withdrawn")
    assert.equal(w.log.filter(([op]) => op === "beginWithdrawal").length, beginsBefore, "the start is not repeated")
    assert.equal(w.db.get(e.id).withdrawalState, "revoked")
    // Nothing in the dependencies can create a link, so a retry cannot restore access.
    assert.ok(!Object.keys(w.deps).some((k) => /create|restore|mint/i.test(k)))
  })

  it("a retry after Papermark refused goes straight to revoking the recorded link", async () => {
    const e = edition()
    const w = world([e], { revokeRefused: true })
    await runWithdrawal(w.deps, input(e))
    w.deps.revokeLink = async (linkId) => {
      w.log.push(["revokeLink", linkId])
      w.links.get(linkId).alive = false
      return { ok: true }
    }
    const retry = await runWithdrawal(w.deps, { editionId: e.id, previewKey: "", choice: parseReplacementChoice("none") })
    assert.equal(retry.ok, true)
    assert.deepEqual(w.log.filter(([op]) => op === "revokeLink").map(([, id]) => id), ["lnk-min-sept", "lnk-min-sept"])
  })

  it("a replacement that no longer verifies stops everything before any change", async () => {
    const latest = edition()
    const august = edition({ id: uuid(2), label: "MIN · August 2026", isLatest: false, featured: false, papermarkDocumentId: "doc-min-aug", secureLinkId: "lnk-min-aug" })
    const w = world([latest, august], { replacementFails: true })
    const r = await runWithdrawal(w.deps, input(latest, uuid(2)))
    assert.equal(r.ok, false)
    assert.deepEqual(w.log.filter(([op]) => op === "verifyReplacement"), [["verifyReplacement", august.id]])
    assert.ok(!w.ops().includes("beginWithdrawal") && !w.ops().includes("revokeLink"))
  })
})

// ---------------------------------------------------------------------------
// Isolation from paid access and other editions
// ---------------------------------------------------------------------------

describe("isolation from paid access", () => {
  it("never revokes a link APRI records as paid subscriber access", async () => {
    const e = edition()
    const w = world([e], { paidLinks: ["lnk-min-sept"] })
    const r = await runWithdrawal(w.deps, input(e))
    assert.equal(r.ok, false)
    assert.match(r.message, /paid subscriber access, so it will not revoke it/)
    assert.ok(!w.ops().includes("revokeLink") && !w.ops().includes("beginWithdrawal"))
  })

  it("refuses when it cannot tell whether the link is paid access", async () => {
    const e = edition()
    const w = world([e], { paidUnknown: true })
    const r = await runWithdrawal(w.deps, input(e))
    assert.equal(r.ok, false)
    assert.ok(!w.ops().includes("revokeLink"))
  })

  it("never revokes a link that points anywhere but the edition's own PDF", async () => {
    const e = edition()
    const w = world([e])
    w.links.set("lnk-min-sept", { alive: true, targetType: "dataroom", documentId: null })
    const r = await runWithdrawal(w.deps, input(e))
    assert.equal(r.ok, false)
    assert.ok(!w.ops().includes("revokeLink") && !w.ops().includes("beginWithdrawal"))
  })

  it("the withdraw action is wired to revoke one review link and nothing else", () => {
    const src = read(ACTIONS)
    const withdraw = body(src, "withdrawReviewEdition")
    assert.match(withdraw, /revokeLink: async \(linkId\) => \{\s*const result = await pm\.revokeWithdrawnReviewLink\(linkId\)/)
    for (const forbidden of [
      "createDataRoomLink", "updateDataRoomLink", "revokeDataRoomLink", "createDocumentLink", "updateLinkWatermark",
      "createReviewDocumentLink", "updateReviewDocumentLink", "setReviewLinkAllowList", "revokeReviewDocumentLink",
    ]) {
      assert.doesNotMatch(src, new RegExp(`\\b${forbidden}\\b`), forbidden)
    }
  })

  it("no withdrawal code writes a subscriber, paid-access, Data Room or recipient record", () => {
    for (const f of [ACTIONS, DAL, MIGRATION]) {
      const src = read(f)
      for (const table of [
        "subscribers", "publication_access", "papermark_client_documents", "papermark_dataroom_links",
        "papermark_subscriber_document_links", "briefing_requests", "review_edition_recipients", "app_settings",
      ]) {
        assert.doesNotMatch(src, new RegExp(`(insert into|update|delete from)\\s+${table}\\b`, "i"), `${f} writes ${table}`)
      }
    }
  })

  it("the Papermark calls are narrow: read one link, delete one link, list links", () => {
    const service = read(SERVICE)
    const state = body(service, "readReviewLinkState")
    assert.match(state, /if \(result\.status === 404\) return \{ state: 'gone' \}/)
    assert.match(state, /return \{ state: 'unknown', message: result\.message \}/)
    const revoke = body(service, "revokeWithdrawnReviewLink")
    assert.match(revoke, /method: 'DELETE'/)
    assert.equal((revoke.match(/papermarkRequest/g) ?? []).length, 1)
    const list = body(service, "listDocumentLinks")
    assert.doesNotMatch(list, /method:/)
  })
})

// ---------------------------------------------------------------------------
// Cache refresh
// ---------------------------------------------------------------------------

describe("public pages are refreshed at each change", () => {
  it("after the edition is hidden, and again once the withdrawal completes", async () => {
    const e = edition()
    const w = world([e])
    await runWithdrawal(w.deps, input(e))
    const ops = w.ops()
    const first = ops.indexOf("refresh")
    assert.ok(first > ops.indexOf("beginWithdrawal") && first < ops.indexOf("revokeLink"))
    assert.ok(ops.lastIndexOf("refresh") > ops.indexOf("completeWithdrawal"))
  })

  it("also when the withdrawal stops part-way", async () => {
    for (const option of ["linkSurvivesRevoke", "completeFailsOnce"]) {
      const e = edition()
      const w = world([e], { [option]: true })
      await runWithdrawal(w.deps, input(e))
      assert.ok(w.refreshes() >= 2, option)
    }
  })

  it("refreshes every page that can show, list or grant an edition", () => {
    const refresh = read(ACTIONS).slice(read(ACTIONS).indexOf("function refreshReviewPages()"))
    for (const path of ['"/"', '"/publications"', '"/review/library"', '"/admin/review-library"', '"/admin/review-requests"']) {
      assert.match(refresh.slice(0, refresh.indexOf("}")), new RegExp(`revalidatePath\\(${path.replace(/\//g, "\\/")}`), path)
    }
  })
})

// ---------------------------------------------------------------------------
// Other access paths
// ---------------------------------------------------------------------------

describe("reporting other ways to open the same PDF", () => {
  const link = (id, over = {}) => ({ id, name: null, url: null, targetType: "document", roomId: null, roomName: null, emailProtected: null, ...over })

  it("leaves out the edition's own link, which is reported from reading it directly", () => {
    const report = buildAccessPathReport({ links: [link("lnk-self")], withdrawnLinkId: "lnk-self", knownIds: new Map(), knownUrls: new Map(), complete: true, notes: [] })
    assert.deepEqual(report.paths, [])
    assert.deepEqual(describeAccessPaths(report), ["No other Papermark link outside APRI's paid access opens this PDF."])
  })

  it("lists Data Room links and manual links as still open, and never claims they were closed", () => {
    const report = buildAccessPathReport({
      links: [
        link("lnk-room", { targetType: "dataroom", roomName: "Partners", name: "All partners" }),
        link("lnk-legacy"),
        link("lnk-brief", { url: "https://docs.example.org/brief" }),
      ],
      withdrawnLinkId: "lnk-self",
      knownIds: new Map([["lnk-legacy", "complimentary"]]),
      knownUrls: new Map([["https://docs.example.org/brief", "briefing"]]),
      complete: true,
      notes: [],
    })
    const lines = describeAccessPaths(report).join("\n")
    assert.match(lines, /"All partners" \(Data Room link for room "Partners", id lnk-room\)/)
    assert.match(lines, /Other APRI Complimentary Review records also point at this PDF: link lnk-legacy/)
    assert.match(lines, /Briefing client access to this PDF, left unchanged: 1 link/)
    assert.doesNotMatch(lines, /No other Papermark link/)
  })

  it("says so when the check could not finish", () => {
    const report = buildAccessPathReport({ links: [], withdrawnLinkId: null, knownIds: new Map(), knownUrls: new Map(), complete: false, notes: ["the Data Rooms could not be listed"] })
    const lines = describeAccessPaths(report).join("\n")
    assert.match(lines, /could not finish \(the Data Rooms could not be listed\)/)
    assert.match(lines, /other ways to open this PDF may remain/)
  })

  it("the scan reads the document's links and every Data Room holding it, read-only", () => {
    const scan = read(ACTIONS).slice(read(ACTIONS).indexOf("async function scanAccessPaths("), read(ACTIONS).indexOf("// Preview"))
    assert.match(scan, /pm\.listDocumentLinks\(documentId\)/)
    assert.match(scan, /pm\.listDataRooms\(\)/)
    assert.match(scan, /pm\.listDataRoomDocuments\(room\.id\)/)
    assert.match(scan, /pm\.listDataRoomLinks\(room\.id\)/)
    assert.match(scan, /only the first \$\{checked\.length\} of \$\{rooms\.value\.length\} Data Rooms were checked/)
  })
})

// ---------------------------------------------------------------------------
// Who may call what
// ---------------------------------------------------------------------------

describe("the actions", () => {
  const src = read(ACTIONS)
  const names = [...src.matchAll(/export async function (\w+)\(/g)].map((m) => m[1])

  it("are exactly preview, withdraw, offer and offer again", () => {
    assert.deepEqual(names.sort(), ["offerReviewEdition", "previewReviewEditionWithdrawal", "reofferWithdrawnEdition", "withdrawReviewEdition"])
  })

  for (const name of ["offerReviewEdition", "previewReviewEditionWithdrawal", "reofferWithdrawnEdition", "withdrawReviewEdition"]) {
    it(`${name} authorises, validates its id and waits for the migration before reading anything`, () => {
      const b = body(src, name)
      const owner = b.indexOf("await requireOwner()")
      const id = b.indexOf("UUID.test(editionId")
      const ready = b.indexOf("editionWithdrawalReady(sql, { fresh: true })")
      assert.ok(owner !== -1 && id > owner && ready > id, name)
      for (const call of ["loadEditionForWithdrawal(", "runWithdrawal(", "featureEdition(", "reofferEdition("]) {
        const at = b.indexOf(call)
        assert.ok(at === -1 || at > ready, `${name}: ${call} before the migration check`)
      }
    })
  }

  it("offering an edition re-verifies its link against its own list first", () => {
    const b = body(src, "offerReviewEdition")
    assert.ok(b.indexOf("verifyReviewDocumentLink(") < b.indexOf("featureEdition("))
    assert.match(b, /if \(expected\.length === 0\)/)
  })

  it("offering again needs a completed withdrawal, and never keeps the revoked link", () => {
    const b = body(src, "reofferWithdrawnEdition")
    assert.match(b, /edition\.withdrawalState !== "revoked"/)
    const reoffer = body(read(DAL), "reofferEdition")
    assert.match(reoffer, /and withdrawal_state = 'revoked'\s+and secure_link_id is null/)
    assert.match(reoffer, /publication_state = 'draft'/)
    assert.match(reoffer, /recipient_mode\s+= 'edition'/)
    assert.doesNotMatch(reoffer, /secure_link_(id|url)\s*=/)
  })

  it("preparing a link for a re-offered edition always creates a new one", () => {
    const prepare = body(read(LIBRARY_ACTIONS), "prepareEditionSecureLink")
    assert.match(prepare, /where id = \$\{edition\.id\}::uuid and recipient_mode = 'edition' and secure_link_id is null/)
    assert.match(prepare, /createReviewDocumentLink\(/)
  })

  it("a withdrawn edition cannot be published, or moved to draft or ignored, except by offering it again", () => {
    const library = read(LIBRARY_ACTIONS)
    assert.match(body(library, "verifyEditionForPublishing"), /edition\?\.publicationState === "withdrawn"/)
    assert.match(body(library, "publishHistoricalEdition"), /and publication_state in \('draft', 'published'\)/)
    assert.match(body(library, "setEditionReviewState"), /publication_state in \('draft', 'ignored'\)/)
  })

  it("enabling the library needs one series with an edition to offer, not all three", () => {
    const b = body(read(LIBRARY_ACTIONS), "saveReviewLibrarySettings")
    assert.match(b, /if \(offered\.length === 0\)/)
    assert.doesNotMatch(b, /if \(missing\.length\)/)
  })
})

// ---------------------------------------------------------------------------
// Where withdrawn editions are no longer offered
// ---------------------------------------------------------------------------

describe("a withdrawn edition leaves every public and grant path", () => {
  it("the homepage offers only the edition each series chose, once the migration has run", () => {
    const b = body(read(PUBLICATIONS), "getReviewLibrary")
    assert.match(b, /const offering = perEdition && \(await editionWithdrawalReady\(sql\)\)/)
    assert.match(b, /where e\.complimentary_featured\s+and e\.publication_state = 'published'/)
  })

  it("/publications, /review/library, grants and send-access list only published editions", () => {
    const pub = read(PUBLICATIONS)
    for (const name of ["getReviewPublicationArchive", "getProspectReviewLibrary"]) {
      const b = body(pub, name)
      assert.equal((b.match(/e\.publication_state = 'published'/g) ?? []).length, 2, name)
    }
    assert.match(body(read("src/lib/edition-recipients-dal.ts"), "grantedEditionsForProspect"), /e\.publication_state = 'published'/)
    assert.match(read("src/app/admin/review-requests/[id]/page.tsx"), /where e\.publication_state = 'published'/)
    assert.match(read("src/lib/edition-recipients.ts"), /edition\.publicationState !== "published"/)
  })

  it("the homepage never falls back from an explicit no-replacement decision", () => {
    const b = body(read(PUBLICATIONS), "getReviewLibrary")
    const offeredQuery = b.slice(b.indexOf("? await sql`"), b.indexOf("`\n      : perEdition"))
    assert.match(offeredQuery, /where e\.complimentary_featured/)
    assert.doesNotMatch(offeredQuery, /distinct on \(e\.series\)|where[^`]*is_latest/)
  })
})

describe("replacement eligibility and ordering", () => {
  it("accepts historical editions and orders candidates by edition identity, never latest or sync time", () => {
    const b = body(read(DAL), "loadReplacementCandidates")
    assert.match(b, /publication_state = 'published'/)
    assert.match(b, /secure_link_document_id = e\.papermark_document_id/)
    assert.match(b, /review_edition_recipients/)
    assert.match(b, /order by e\.edition_sort_key desc, e\.edition_date desc nulls last,\s*e\.edition_order desc, e\.id desc/)
    assert.doesNotMatch(b.slice(b.indexOf("order by")), /is_latest|last_synced_at|updated_at|created_at/)
  })

  it("the Admin preview preselects the proposed edition but leaves No replacement explicit", () => {
    const panel = read(PANEL)
    assert.match(panel, /setChoice\(p\.ok && p\.replacementRequired \? proposedReplacement\(p\.candidates\) : ""\)/)
    assert.match(panel, /value="none"/)
    assert.match(panel, /No eligible replacement exists\. You can still choose No replacement/)
  })
})

// ---------------------------------------------------------------------------
// The migration
// ---------------------------------------------------------------------------

describe("the withdrawal migration", () => {
  const sql = read(MIGRATION)
  const code = sql.replace(/--.*$/gm, "")

  it("is one transaction that gives up quickly and requires 20260928 first", () => {
    assert.match(code, /^\s*begin;/m)
    assert.match(code, /commit;\s*$/)
    assert.match(code, /set local lock_timeout = '5s';/)
    assert.match(code, /select recipient_mode from review_publication_editions limit 0;/)
  })

  it("adds 'withdrawn' and keeps every earlier state", () => {
    assert.match(code, /check \(publication_state in \('draft', 'published', 'ignored', 'withdrawn'\)\)/)
  })

  it("fills the offered flag once, from what is published and latest today", () => {
    assert.match(code, /add column if not exists complimentary_featured boolean;/)
    assert.match(code, /set complimentary_featured = \(publication_state = 'published' and is_latest\)\s+where complimentary_featured is null;/)
  })

  it("allows at most one offered edition per series, and only a published one", () => {
    assert.match(code, /exclude using btree \(series with =\) where \(complimentary_featured\)\s+deferrable initially deferred/)
    assert.match(code, /check \(not complimentary_featured or \(publication_state = 'published' and series is not null\)\)/)
  })

  it("keeps a withdrawn edition's state and its revoked link consistent", () => {
    assert.match(code, /\(publication_state = 'withdrawn'\) = \(withdrawal_state is not null\)/)
    assert.match(code, /or \(secure_link_id is null and withdrawn_at is not null\)/)
  })

  it("keeps an append-only history with no address in it", () => {
    assert.match(code, /create trigger review_edition_events_append_only\s+before update or delete on review_edition_events/)
    assert.doesNotMatch(code, /@/)
  })

  it("never touches Papermark, recipients or paid access", () => {
    assert.doesNotMatch(code, /papermark\.com|app_settings|review_edition_recipients\s*\(|publication_access|subscribers/i)
  })

  it("records the start before the link is revoked, and clears the link only on completion", () => {
    const begin = code.slice(code.indexOf("function begin_review_edition_withdrawal"), code.indexOf("function complete_review_edition_withdrawal"))
    assert.match(begin, /withdrawal_state\s+= 'revoking'/)
    assert.match(begin, /withdrawal_link_id\s+= target\.secure_link_id/)
    assert.doesNotMatch(begin, /secure_link_id\s+= null/)
    const complete = code.slice(code.indexOf("function complete_review_edition_withdrawal"), code.indexOf("function feature_review_publication_edition"))
    assert.match(complete, /withdrawal_state\s+= 'revoked'/)
    assert.match(complete, /secure_link_id\s+= null/)
    assert.match(complete, /secure_link_url\s+= ''/)
  })

  it("a withdrawn edition cannot be promoted, and the deployed one-argument call still works", () => {
    assert.match(code, /if target\.publication_state = 'withdrawn' then\s+raise exception 'Edition is withdrawn; re-offer it before publishing it again';/)
    assert.match(code, /create or replace function promote_review_publication_edition\(target_id uuid\)\s+returns void language plpgsql as \$\$\s+begin\s+perform promote_review_publication_edition\(target_id, null::uuid\);/)
  })

  it("has a guarded rollback", () => {
    const rollback = read("db/rollback/20260929_review_edition_withdrawal.rollback.sql")
    assert.match(rollback, /NOT a migration/)
    assert.match(rollback, /raise exception 'Refusing to roll back: an edition has been withdrawn/)
  })
})

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

describe("the Admin panel", () => {
  const panel = read(PANEL)

  it("is a client component that decides nothing and imports only actions", () => {
    assert.match(panel, /^"use client"/)
    assert.doesNotMatch(panel, /from "@\/lib\/(db|dal|review-withdrawal-dal|papermark|papermark-datarooms)"/)
  })

  it("previews the exact edition, its document and the link to be revoked before anything changes", () => {
    for (const text of ["Papermark document", "Link to be revoked", "Papermark now", "Other ways to open this PDF"]) {
      assert.match(panel, new RegExp(text), text)
    }
    assert.match(panel, /previewReviewEditionWithdrawal\(editionId\)/)
    assert.match(panel, /withdrawReviewEdition\(editionId, preview\.previewKey, replacement\)/)
  })

  it("for the offered edition, requires an explicit replacement or no replacement", () => {
    assert.match(panel, /Offer instead on the homepage \(required\)/)
    assert.match(panel, /No replacement: this series offers no edition until you choose one/)
    assert.match(panel, /disabled=\{busy \|\| \(preview\.replacementRequired && !choice\)\}/)
    assert.match(panel, /const \[choice, setChoice\] = useState<string>\(""\)/, "nothing pre-selected")
  })

  it("confirms before withdrawing, and offers Complete withdrawal for an unfinished one", () => {
    assert.match(panel, /window\.confirm\(\s*`Withdraw \$\{preview\.label\} from Complimentary Review\?/)
    assert.match(panel, /withdrawReviewEdition\(editionId, "", "none"\)/)
    assert.match(panel, /Complete withdrawal/)
  })

  it("keeps a withdrawn edition visible with its history, and offers it again only explicitly", () => {
    assert.match(panel, /Withdrawn from Complimentary Review/)
    assert.match(panel, /reofferWithdrawnEdition\(editionId\)/)
    assert.match(panel, /the PDF was not deleted/)
  })

  it("the edition card offers publishing only for drafts, never for a withdrawn edition", () => {
    const form = read(FORM)
    assert.match(form, /\{e\.publicationState === "draft" && \(/)
    assert.match(form, /"Withdrawal not complete"/)
    assert.match(form, /<EditionWithdrawalPanel/)
  })

  it("the Admin display reads the three withdrawal states", () => {
    assert.deepEqual(withdrawalDisplay({ publicationState: "published", withdrawalState: null, withdrawalLinkId: null }), { kind: "not_withdrawn" })
    assert.deepEqual(withdrawalDisplay({ publicationState: "withdrawn", withdrawalState: "revoking", withdrawalLinkId: "l" }), { kind: "incomplete", linkId: "l" })
    assert.deepEqual(withdrawalDisplay({ publicationState: "withdrawn", withdrawalState: "revoked", withdrawalLinkId: "l" }), { kind: "withdrawn", linkId: "l" })
  })
})
