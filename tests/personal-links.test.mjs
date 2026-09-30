/**
 * Personal document links for paid subscribers.
 *
 * The live failure: an activated subscriber saw a card in their library and
 * opening it said "Document viewer unavailable. Your personal link is being
 * prepared." Activation had issued the Data Room link but no per-document
 * links, Data Room sync never prepared links for existing subscribers, and
 * the welcome and new-document emails went out regardless.
 *
 * Part 1 drives the real decision module (src/lib/personal-links.ts) against
 * a simulated Papermark and database, so every failure mode is exercised as
 * behaviour: missing links at activation, partial Papermark failure, repeat
 * activation and retry, a newly synced document, and stored rows that no
 * longer work. Nothing here calls Papermark or sends email.
 *
 * Part 2 checks the server code is wired to it: which paths prepare links,
 * which hold email back, who may run what.
 */

import { describe, it, test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import {
  preparePersonalLinks,
  describePersonalLinks,
  combineReports,
  expiryProblem,
} from "../src/lib/personal-links.ts"

const ROOT = resolve(import.meta.dirname, "..")
const read = (p) => readFileSync(join(ROOT, p), "utf8")

// ===========================================================================
// A simulated Papermark and database
// ===========================================================================

const TERM_END = "2027-06-30"
const TERM_EXPIRY = "2027-06-30T00:00:00.000Z"

/**
 * Papermark links and APRI's rows for one subscriber, with switches for every
 * failure the provisioning run has to survive.
 */
class World {
  constructor(documents) {
    this.documents = documents
    /** linkId -> { documentId, dataroomId, expiresAt, live } */
    this.papermark = new Map()
    /** { rowId, papermarkDocumentId, papermarkLinkId, expiresAt, live } */
    this.rows = []
    this.seq = 0
    this.calls = { create: [], save: [], withdraw: [], retire: [], read: [], correct: [] }
    this.faults = {
      createFails: new Set(), // document ids Papermark refuses to link
      createThrows: false,
      readUnknown: new Set(), // link ids Papermark cannot be asked about
      withdrawFails: new Set(), // link ids Papermark will not withdraw
      saveThrows: false,
      concurrentRowFor: new Set(), // document ids another run records first
      correctFails: false,
    }
  }

  /** A link that already exists in both Papermark and APRI's table. */
  seed(documentId, { expiresAt = TERM_EXPIRY, papermark = {} } = {}) {
    const linkId = `pm_link_${++this.seq}_SECRET`
    this.papermark.set(linkId, { documentId, dataroomId: null, expiresAt, live: true, ...papermark })
    this.rows.push({ rowId: `row-${this.seq}`, papermarkDocumentId: documentId, papermarkLinkId: linkId, expiresAt, live: true })
    return linkId
  }

  liveRows(documentId) {
    return this.rows.filter((r) => r.live && (!documentId || r.papermarkDocumentId === documentId))
  }

  livePapermarkLinks(documentId) {
    return [...this.papermark.entries()].filter(([, l]) => l.live && l.documentId === documentId)
  }

  deps() {
    return {
      documents: this.documents,
      stored: this.liveRows().map((r) => ({
        rowId: r.rowId,
        papermarkDocumentId: r.papermarkDocumentId,
        papermarkLinkId: r.papermarkLinkId,
        expiresAt: r.expiresAt,
      })),
      create: async (document) => {
        this.calls.create.push(document.papermarkDocumentId)
        if (this.faults.createThrows) throw new Error("socket hang up")
        if (this.faults.createFails.has(document.papermarkDocumentId)) {
          return { ok: false, message: "Creating the personal document link: Papermark could not be reached. Try again shortly." }
        }
        const linkId = `pm_link_${++this.seq}_SECRET`
        this.papermark.set(linkId, { documentId: document.papermarkDocumentId, dataroomId: null, expiresAt: TERM_EXPIRY, live: true })
        return { ok: true, linkId, url: `https://docs.example.test/view/${linkId}` }
      },
      save: async (document, minted) => {
        this.calls.save.push(document.papermarkDocumentId)
        if (this.faults.saveThrows) throw new Error("connection reset")
        if (this.faults.concurrentRowFor.has(document.papermarkDocumentId)) {
          // Another run recorded its own link a moment earlier.
          this.faults.concurrentRowFor.delete(document.papermarkDocumentId)
          this.seed(document.papermarkDocumentId)
        }
        // The unique index: one live row per subscriber per document.
        if (this.liveRows(document.papermarkDocumentId).length > 0) return null
        const rowId = `row-${++this.seq}`
        this.rows.push({
          rowId,
          papermarkDocumentId: document.papermarkDocumentId,
          papermarkLinkId: minted.linkId,
          expiresAt: TERM_EXPIRY,
          live: true,
        })
        return rowId
      },
      withdraw: async (linkId) => {
        this.calls.withdraw.push(linkId)
        if (this.faults.withdrawFails.has(linkId)) return { ok: false, message: "Revoking the link: Papermark could not be reached." }
        const link = this.papermark.get(linkId)
        if (link) link.live = false
        return { ok: true } // a link already gone counts as withdrawn
      },
      retire: async (rowId) => {
        this.calls.retire.push(rowId)
        const row = this.rows.find((r) => r.rowId === rowId)
        if (row) row.live = false
      },
      read: async (linkId) => {
        this.calls.read.push(linkId)
        if (this.faults.readUnknown.has(linkId)) {
          return { state: "unknown", message: "Checking the personal document link: Papermark could not be reached." }
        }
        const link = this.papermark.get(linkId)
        if (!link || !link.live) return { state: "gone" }
        return {
          state: "found",
          documentId: link.documentId,
          dataroomId: link.dataroomId,
          targetType: link.targetType ?? null,
          expiresAt: link.expiresAt,
        }
      },
      correctExpiry: async (stored) => {
        this.calls.correct.push(stored.rowId)
        if (this.faults.correctFails) return { ok: false, message: "Updating the link security: Papermark could not be reached." }
        const link = this.papermark.get(stored.papermarkLinkId)
        if (link) link.expiresAt = TERM_EXPIRY
        const row = this.rows.find((r) => r.rowId === stored.rowId)
        if (row) row.expiresAt = TERM_EXPIRY
        return { ok: true }
      },
    }
  }

  run(verify = false) {
    return preparePersonalLinks(this.deps(), { verify, termEndDate: TERM_END })
  }

  /** The invariant every run must keep: at most one live row, and no live Papermark link without one. */
  assertConsistent() {
    for (const { papermarkDocumentId } of this.documents) {
      assert.ok(this.liveRows(papermarkDocumentId).length <= 1, `one live row at most for ${papermarkDocumentId}`)
      for (const [linkId] of this.livePapermarkLinks(papermarkDocumentId)) {
        assert.ok(
          this.rows.some((r) => r.live && r.papermarkLinkId === linkId),
          `live Papermark link ${linkId} for ${papermarkDocumentId} has no live row`,
        )
      }
    }
  }
}

const DOCS = [
  { papermarkDocumentId: "doc_min_sep", title: "MIN — Monthly Intelligence Note — September 2026" },
  { papermarkDocumentId: "doc_aiu_001", title: "AIU — Athena Intelligence Update — Issue 001 (2026)" },
  { papermarkDocumentId: "doc_plm_02", title: "PLM — Political Landscape Monitor — Issue 02" },
]

// ===========================================================================
// Part 1. Behaviour
// ===========================================================================

describe("activation with missing links", () => {
  it("creates exactly one personal link per document and reports them ready", async () => {
    const world = new World(DOCS)
    const report = await world.run(true)

    assert.equal(report.complete, true)
    assert.equal(report.total, 3)
    assert.equal(report.created, 3)
    assert.deepEqual(world.calls.create.sort(), DOCS.map((d) => d.papermarkDocumentId).sort())
    for (const d of DOCS) assert.equal(world.liveRows(d.papermarkDocumentId).length, 1)
    world.assertConsistent()
    assert.equal(describePersonalLinks(report), "All 3 personal document links are ready (3 created).")
  })

  it("an empty room needs nothing and is complete", async () => {
    const world = new World([])
    const report = await world.run(true)
    assert.equal(report.complete, true)
    assert.equal(report.total, 0)
    assert.match(describePersonalLinks(report), /no documents yet/)
  })

  it("a document listed twice is prepared once", async () => {
    const world = new World([DOCS[0], { ...DOCS[0] }])
    await world.run()
    assert.equal(world.calls.create.length, 1)
    world.assertConsistent()
  })
})

describe("partial Papermark failure", () => {
  it("prepares what it can, names what it could not and why, and is not complete", async () => {
    const world = new World(DOCS)
    world.faults.createFails.add("doc_aiu_001")
    const report = await world.run(true)

    assert.equal(report.complete, false)
    assert.equal(report.ready, 2)
    assert.equal(report.failed, 1)
    assert.equal(world.liveRows("doc_aiu_001").length, 0)
    assert.equal(world.livePapermarkLinks("doc_aiu_001").length, 0)
    world.assertConsistent()

    const message = describePersonalLinks(report)
    assert.match(message, /^2 of 3 personal document links ready\./)
    assert.match(message, /Athena Intelligence Update — Issue 001/)
    assert.match(message, /Papermark could not be reached/)
  })

  it("a thrown error from Papermark is reported against its document, never thrown", async () => {
    const world = new World(DOCS)
    world.faults.createThrows = true
    const report = await world.run()
    assert.equal(report.failed, 3)
    assert.equal(report.complete, false)
  })

  it("a link that cannot be recorded is withdrawn again, so nothing untracked is left", async () => {
    const world = new World([DOCS[0]])
    world.faults.saveThrows = true
    const report = await world.run()
    assert.equal(report.failed, 1)
    assert.equal(report.strays, 0)
    assert.equal(world.livePapermarkLinks("doc_min_sep").length, 0)
    world.assertConsistent()
  })

  it("a link that can be neither recorded nor withdrawn is counted and reported", async () => {
    const world = new World([DOCS[0]])
    world.faults.saveThrows = true
    const original = world.deps
    world.deps = function () {
      const deps = original.call(this)
      const create = deps.create
      deps.create = async (d) => {
        const minted = await create(d)
        if (minted.ok) world.faults.withdrawFails.add(minted.linkId)
        return minted
      }
      return deps
    }
    const report = await world.run()
    assert.equal(report.strays, 1)
    assert.match(describePersonalLinks(report), /1 extra link could not be withdrawn in Papermark/)
  })
})

describe("repeat activation and retry", () => {
  it("a second run creates nothing and, with verify, confirms every link", async () => {
    const world = new World(DOCS)
    await world.run(true)
    const creates = world.calls.create.length

    const again = await world.run(true)
    assert.equal(world.calls.create.length, creates, "no new link on a repeat")
    assert.equal(again.confirmed, 3)
    assert.equal(again.complete, true)
    assert.equal(world.calls.withdraw.length + world.calls.retire.length, 0, "nothing changed")
    world.assertConsistent()
  })

  it("a retry after a partial failure prepares only the missing document", async () => {
    const world = new World(DOCS)
    world.faults.createFails.add("doc_plm_02")
    const first = await world.run(true)
    assert.equal(first.complete, false)

    world.faults.createFails.clear()
    world.calls.create = []
    const retry = await world.run(true)
    assert.deepEqual(world.calls.create, ["doc_plm_02"])
    assert.equal(retry.complete, true)
    assert.equal(retry.created, 1)
    assert.equal(retry.confirmed, 2)
    world.assertConsistent()
  })

  it("two runs racing for one document leave exactly one link", async () => {
    const world = new World([DOCS[0]])
    world.faults.concurrentRowFor.add("doc_min_sep")
    const report = await world.run()
    assert.equal(report.complete, true)
    assert.equal(report.stored, 1, "the other run's link is kept")
    assert.equal(world.liveRows("doc_min_sep").length, 1)
    assert.equal(world.livePapermarkLinks("doc_min_sep").length, 1, "the duplicate was withdrawn")
    world.assertConsistent()
  })
})

describe("a newly synced document", () => {
  it("gets a link; the subscriber's existing links are left alone", async () => {
    const world = new World(DOCS)
    for (const d of DOCS) world.seed(d.papermarkDocumentId)
    world.documents = [...DOCS, { papermarkDocumentId: "doc_min_oct", title: "MIN — October 2026" }]

    const report = await world.run(false)
    assert.deepEqual(world.calls.create, ["doc_min_oct"])
    assert.equal(report.created, 1)
    assert.equal(report.stored, 3)
    assert.equal(report.complete, true)
    assert.equal(world.calls.read.length, 0, "without verify, Papermark is not read")
    world.assertConsistent()
  })

  it("a stored row is prepared but never called confirmed without a Papermark check", async () => {
    const world = new World(DOCS)
    for (const d of DOCS) world.seed(d.papermarkDocumentId)
    const report = await world.run(false)
    assert.equal(report.confirmed, 0)
    assert.equal(report.stored, 3)
    assert.match(describePersonalLinks(report), /3 already prepared/)
    assert.doesNotMatch(describePersonalLinks(report), /confirmed/)
  })
})

describe("a stored row that no longer works", () => {
  it("revoked in Papermark: replaced, and the old row retired only once the replacement exists", async () => {
    const world = new World([DOCS[0]])
    const old = world.seed("doc_min_sep")
    world.papermark.get(old).live = false // revoked inside Papermark

    const report = await world.run(true)
    assert.equal(report.repaired, 1)
    assert.equal(report.complete, true)
    const live = world.liveRows("doc_min_sep")
    assert.equal(live.length, 1)
    assert.notEqual(live[0].papermarkLinkId, old)
    assert.ok(world.calls.withdraw.includes(old), "the old link is withdrawn too, in case the 404 was wrong")
    world.assertConsistent()
  })

  it("revoked, but Papermark refuses a replacement: the stored row is left exactly as it was", async () => {
    const world = new World([DOCS[0]])
    const old = world.seed("doc_min_sep")
    world.papermark.get(old).live = false
    world.faults.createFails.add("doc_min_sep")

    const report = await world.run(true)
    assert.equal(report.failed, 1)
    assert.equal(world.calls.retire.length, 0)
    assert.equal(world.liveRows("doc_min_sep")[0].papermarkLinkId, old)
  })

  it("Papermark cannot be asked: unconfirmed, nothing changed, not complete", async () => {
    const world = new World([DOCS[0]])
    const old = world.seed("doc_min_sep")
    world.faults.readUnknown.add(old)

    const report = await world.run(true)
    assert.equal(report.unconfirmed, 1)
    assert.equal(report.complete, false)
    assert.equal(world.calls.create.length + world.calls.retire.length + world.calls.withdraw.length, 0)
  })

  it("opens a different document: withdrawn first, then replaced", async () => {
    const world = new World([DOCS[0]])
    const old = world.seed("doc_min_sep", { papermark: { documentId: "doc_someone_else" } })

    const report = await world.run(true)
    assert.equal(report.repaired, 1)
    assert.equal(world.papermark.get(old).live, false)
    assert.equal(world.calls.withdraw[0], old)
    assert.equal(world.liveRows("doc_min_sep").length, 1)
  })

  it("opens a whole Data Room: treated as misdirected", async () => {
    const world = new World([DOCS[0]])
    world.seed("doc_min_sep", { papermark: { documentId: null, dataroomId: "room_1" } })
    const report = await world.run(true)
    assert.equal(report.repaired, 1)
  })

  it("misdirected and cannot be withdrawn: kept and tracked, nothing new minted", async () => {
    const world = new World([DOCS[0]])
    const old = world.seed("doc_min_sep", { papermark: { documentId: "doc_someone_else" } })
    world.faults.withdrawFails.add(old)

    const report = await world.run(true)
    assert.equal(report.failed, 1)
    assert.equal(world.calls.create.length, 0)
    assert.equal(world.liveRows("doc_min_sep")[0].papermarkLinkId, old)
  })

  it("Papermark does not say which document it opens: unconfirmed, never withdrawn", async () => {
    const world = new World([DOCS[0]])
    world.seed("doc_min_sep", { papermark: { documentId: null } })
    const report = await world.run(true)
    assert.equal(report.unconfirmed, 1)
    assert.equal(world.calls.withdraw.length, 0)
  })

  it("expires before the subscription ends: expiry corrected, same link kept", async () => {
    const world = new World([DOCS[0]])
    const old = world.seed("doc_min_sep", { papermark: { expiresAt: "2026-06-30T00:00:00.000Z" } })

    const report = await world.run(true)
    assert.equal(report.repaired, 1)
    assert.equal(world.papermark.get(old).expiresAt, TERM_EXPIRY)
    assert.equal(world.liveRows("doc_min_sep")[0].papermarkLinkId, old)
  })

  it("the database records a renewal that never reached Papermark: corrected even without verify", async () => {
    const world = new World([DOCS[0]])
    world.seed("doc_min_sep", { expiresAt: "2026-06-30T00:00:00.000Z" })
    const report = await world.run(false)
    assert.equal(report.repaired, 1)
    assert.equal(world.calls.read.length, 0)
  })

  it("an expiry that cannot be corrected is a failure, named", async () => {
    const world = new World([DOCS[0]])
    world.seed("doc_min_sep", { papermark: { expiresAt: null } })
    world.faults.correctFails = true
    const report = await world.run(true)
    assert.equal(report.failed, 1)
    assert.match(describePersonalLinks(report), /never expires/)
  })
})

describe("expiry rule", () => {
  it("accepts the start or the end of the term's last day", () => {
    assert.equal(expiryProblem("2027-06-30T00:00:00.000Z", TERM_END), null)
    assert.equal(expiryProblem("2027-06-30T23:59:59.999Z", TERM_END), null)
    assert.equal(expiryProblem(new Date("2027-06-30T00:00:00.000Z"), TERM_END), null)
  })

  it("rejects an expiry well before or after, and a link that never expires", () => {
    assert.match(expiryProblem("2027-01-31T00:00:00.000Z", TERM_END), /before the subscription ends/)
    assert.match(expiryProblem("2028-06-30T00:00:00.000Z", TERM_END), /after the subscription ends/)
    assert.match(expiryProblem(null, TERM_END), /never expires/)
  })

  it("says nothing when there is no term to enforce or Papermark reported no expiry", () => {
    assert.equal(expiryProblem("2027-01-31T00:00:00.000Z", null), null)
    assert.equal(expiryProblem(undefined, TERM_END), null)
  })
})

describe("room-wide reports", () => {
  it("combine subscribers and are complete only if every one is", async () => {
    const ok = new World([DOCS[0]])
    const bad = new World([DOCS[0]])
    bad.faults.createFails.add("doc_min_sep")
    const combined = combineReports([await ok.run(), await bad.run()])
    assert.equal(combined.total, 2)
    assert.equal(combined.ready, 1)
    assert.equal(combined.complete, false)
  })
})

describe("messages", () => {
  it("never carry a link id or URL: the id is what opens the document", async () => {
    const world = new World(DOCS)
    world.seed("doc_min_sep", { papermark: { documentId: "doc_someone_else" } })
    world.faults.createFails.add("doc_plm_02")
    const report = await world.run(true)
    const message = describePersonalLinks(report)
    assert.doesNotMatch(message, /pm_link_|SECRET|https?:\/\//)
  })
})

// ===========================================================================
// Part 2. Wiring
// ===========================================================================

/** From `export async function NAME(` to the lone closing brace of its body. */
function body(src, name) {
  const start = src.search(new RegExp(`(export )?async function ${name}\\(`))
  assert.notEqual(start, -1, `${name} must exist`)
  const rest = src.slice(start)
  const end = rest.search(/\n\}[ \t]*(\r?\n|$)/)
  assert.notEqual(end, -1, `${name} must have a closing brace`)
  return rest.slice(0, end + 2)
}

const SUBSCRIBERS = "src/app/actions/subscribers.ts"
const DATAROOMS = "src/app/actions/datarooms.ts"
const SERVICE = "src/lib/document-links.ts"
const LIFECYCLE = "src/lib/dataroom-lifecycle.ts"
const NOTIFY = "src/lib/dataroom-notifications.ts"
const WEBHOOK = "src/app/api/papermark/webhook/route.ts"

describe("activation", () => {
  // The action delegates to the one function every activation takes.
  const fn = body(read("src/lib/subscriber-activation.ts"), "activateSubscriberRecord")

  it("the Activate action goes through the shared activation, and is ok only when nothing is left owed", () => {
    const action = body(read(SUBSCRIBERS), "activateSubscriber")
    assert.match(action, /activateSubscriberRecord\(\{ subscriberId: id, admin \}\)/)
    assert.match(action, /ok: activationDone\(result\)/)
  })

  it("prepares and verifies the library -- room link and every personal link -- before the seat is made active", () => {
    const access = fn.indexOf("ensureSubscriberLibraryAccess(")
    const flip = fn.indexOf("set status = 'active'")
    assert.ok(access > 0 && flip > access, "the library comes first")
    assert.match(fn.slice(access, access + 400), /createRoomLink: true/)
    // A pending subscriber can be prepared, so activation never needs itself.
    assert.match(fn.slice(access, access + 400), /allowPending: !wasActive/)
    assert.ok(fn.indexOf("sendOnboardingEmails(") > flip, "emails only after the seat is active")
    assert.doesNotMatch(fn, /issueToken\(|sendWelcome\(/, "activation itself never issues a link or sends")
  })

  it("every library state that is not verified returns before the status change, sending nothing", () => {
    const flip = fn.indexOf("set status = 'active'")
    for (const branch of [
      "access.state === 'no_room_link'",
      "no Data Room is mapped for ${row.public_tier}. Map one under Admin",
      "this subscriber has no legacy library to open",
      "return notReady(`${access.message} ${retryHint(access)}`)",
    ]) {
      const at = fn.indexOf(branch)
      assert.ok(at > 0 && at < flip, `${branch} is handled before activation`)
    }
    assert.ok(fn.lastIndexOf("return notReady(") < flip)
    assert.match(fn, /state: 'access_not_ready'/)
  })

  it("a request's subscriber with no Data Room mapping is held, never passed as a legacy library", () => {
    assert.match(fn, /\} else if \(access\.state === 'no_room'\) \{\s*if \(gate\) \{[\s\S]*?return notReady\(/)
    assert.ok(fn.indexOf("if (gate) {") < fn.indexOf("validatedLegacyLibrary(sql"))
  })

  it("a legacy library counts only when the portal would really open an entitled edition", () => {
    const legacy = body(read("src/lib/subscriber-activation.ts"), "validatedLegacyLibrary")
    assert.match(legacy, /pa\.subscriber_id = \$1 and pa\.revoke_state = 'live'/)
    assert.match(legacy, /d\.status = 'published'/)
    assert.match(legacy, /d\.visibility = any\(\$2::text\[\]\)/)
    assert.match(legacy, /visibilitiesForLevel\(level\)/)
    assert.match(legacy, /pa\.link_url like 'https:\/\/%'/)
  })

  it("a new activation is refused until onboarding tracking exists, changing nothing", () => {
    const check = fn.indexOf("onboardingTrackingReady(sql, { fresh: true })")
    assert.ok(check > 0 && check < fn.indexOf("ensureSubscriberLibraryAccess("))
    assert.match(fn, /if \(!tracked\) return blocked\(`\$\{ONBOARDING_MIGRATION_PENDING\} Nothing was changed\.`\)/)
  })

  it("the onboarding rows exist before the seat is active, so no crash can lose them", () => {
    const rows = fn.indexOf("await startOnboardingTracking(id)")
    assert.ok(rows > 0 && rows < fn.indexOf("set status = 'active'"))
  })

  it("a subscriber already active is never sent a retrospective welcome, unless the request still owes it", () => {
    assert.match(fn, /sendOnboardingEmails\(\{ subscriberId: id, start: !wasActive \|\| args\.onboardingOwed === true \}\)/)
    const request = body(read("src/app/actions/review-admin.ts"), "activateSubscriptionRequest")
    assert.match(request, /event_type = 'subscriber_welcomed' and detail = \$\{subscriberId\}/)
    assert.match(request, /onboardingOwed: welcomedBefore\.length === 0/)
  })

  it("the seat is made active only at the tier and level that were verified", () => {
    assert.match(fn, /and public_tier = \$\{row\.public_tier\}\s+and level is not distinct from \$\{row\.level\}\s+and lower\(status\) <> 'active'\s+returning id/)
    assert.match(fn, /if \(flipped\.length === 0\) \{/)
  })

  it("a request's subscriber must carry exactly the plan's tier, level and one seat", () => {
    const gate = body(read("src/lib/subscriber-activation.ts"), "acquisitionGate")
    assert.match(gate, /row\.public_tier !== tier \|\| row\.level !== levelForPublicTier\(tier\) \|\| Number\(row\.seats\) !== 1/)
  })

  it("the public form never rewrites a record that belongs to a subscription request", () => {
    assert.match(read("src/app/actions/public.ts"), /and \(to_jsonb\(subscribers\) ->> 'subscription_request_id'\) is null/)
  })

  it("not started counts as done only for someone already active", () => {
    const src = read("src/lib/subscriber-activation.ts")
    const done = src.slice(src.indexOf("export function activationDone"), src.indexOf("async function validatedLegacyLibrary"))
    assert.match(done, /result\.onboarding\.state === 'not_started' && result\.wasActive/)
  })

  it("no longer swallows the Data Room step", () => {
    assert.doesNotMatch(fn, /catch \{\}/)
  })

  it("the library step verifies stored links with Papermark", () => {
    const fn2 = body(read(LIFECYCLE), "ensureSubscriberLibraryAccess")
    assert.match(fn2, /const linkOptions = \{ verify: true, dataroomId: room\.dataroomId, allowPending: args\.allowPending === true \}/)
    assert.match(fn2, /ensureAllDocumentLinks\(args\.subscriberId, linkOptions\)/)
    assert.match(fn2, /revokeDataRoomLink\(minted\.value\.linkId\)/, "an unrecorded room link is withdrawn")
  })
})

describe("resend sign-in link", () => {
  const fn = body(read(SUBSCRIBERS), "resendSignInLink")
  it("sends only the secure-access email, once the library is ready, without creating a room link", () => {
    assert.match(fn, /const admin = await requireAdmin\(\)/)
    const gate = fn.indexOf("libraryGate(id, admin)")
    assert.ok(gate > 0 && gate < fn.indexOf("resendSecureAccessEmail(id)"))
    assert.doesNotMatch(fn, /sendWelcome|sendOnboardingEmails|issueToken/)
    assert.match(body(read(SUBSCRIBERS), "libraryGate"), /createRoomLink: false/)
  })

  it("the retry action is admin only, checks the library, and never starts onboarding retrospectively", () => {
    const retry = body(read(SUBSCRIBERS), "retryOnboardingEmails")
    assert.match(retry, /const admin = await requireAdmin\(\)/)
    assert.ok(retry.indexOf("libraryGate(id, admin)") < retry.indexOf("sendOnboardingEmails("))
    assert.match(retry, /sendOnboardingEmails\(\{ subscriberId: id, start: false \}\)/)
  })
})

describe("the repair actions", () => {
  const src = read(DATAROOMS)
  const one = body(src, "prepareDocumentLinks")
  const level = body(src, "prepareDocumentLinksForLevel")

  it("per subscriber: owner only, checks every stored link with Papermark", () => {
    assert.match(one, /await requireOwner\(\)/)
    assert.match(one, /ensureAllDocumentLinks\(subscriberId, \{ verify: true \}\)/)
    assert.match(one, /ok: outcome\.report\.complete/)
  })

  it("level-wide: owner only, every subscriber of the room", () => {
    assert.match(level, /await requireOwner\(\)/)
    assert.match(level, /prepareRoomLinks\(room\.dataroomId\)/)
    assert.match(level, /ok: summary\.complete/)
  })

  it("neither sends any email", () => {
    for (const fn of [one, level]) {
      assert.doesNotMatch(fn, /sendWelcome|sendEditionAlert|notifyNewDataRoomDocuments|syncAndNotify|issueToken/)
    }
  })
})

describe("documents arriving in a room", () => {
  const src = read(DATAROOMS)

  it("sync prepares every subscriber's links after saving the documents, and says when it could not", () => {
    const sync = body(src, "syncRoomForLevel")
    assert.ok(sync.indexOf("prepareRoomLinks(mapping.dataroomId)") > sync.indexOf("syncDataRoomDocuments("))
    const action = body(src, "syncDataRoomForLevel")
    assert.match(action, /await requireAdmin\(\)/)
    assert.match(action, /ok: synced\.links\.complete/)
  })

  it("the sync helper is not exported, so it is not a callable action", () => {
    assert.doesNotMatch(src, /export async function syncRoomForLevel/)
  })

  it("sync and notify queues nothing for a document whose link does not exist yet", () => {
    const fn = body(src, "syncAndNotify")
    const gate = fn.indexOf("ready.has(")
    assert.ok(gate > 0 && gate < fn.indexOf("insert into papermark_document_notifications"))
    assert.match(fn, /held\+\+/)
  })

  it("the webhook prepares links for the new document before notifying, and fails the event until they are ready", () => {
    const src = read(WEBHOOK)
    const handler = body(src, "handleDocumentEvent")
    const prepare = handler.indexOf("prepareRoomLinks(dataroomId, { papermarkDocumentId: documentId })")
    assert.ok(prepare > 0 && prepare < handler.indexOf("notifyNewDataRoomDocuments("))
    assert.match(handler, /if \(!links\.complete\) \{[\s\S]*?throw new Error/)
  })

  it("an automatic new-document email waits for the subscriber's link", () => {
    const fn = body(read(NOTIFY), "notifyNewDataRoomDocuments")
    const gate = fn.indexOf("personalLinkReady(")
    assert.ok(gate > 0 && gate < fn.indexOf("insert into papermark_document_notifications"))
  })

  it("automatic new-document emails stay off unless explicitly enabled", () => {
    const src = read(NOTIFY)
    assert.match(src, /process\.env\.DATAROOM_NEW_DOCUMENT_EMAILS === "enabled"/)
    assert.match(body(src, "notifyNewDataRoomDocuments"), /if \(!newDocumentEmailsEnabled\(\)\) return/)
    assert.match(body(src, "reconcileAllDataRooms"), /if \(!newDocumentEmailsEnabled\(\)\)/)
  })

  it("the sender reads the columns its queries return", () => {
    const fn = body(read(NOTIFY), "notifyNewDataRoomDocuments")
    for (const alias of ['"dataroomDocumentId"', '"papermarkDocumentId"', '"versionKey"', '"subscriberId"', '"fullName"', '"linkUrl"', '"hasRoomLink"']) {
      assert.ok(fn.includes(alias), `${alias} is selected under the name the code reads`)
    }
  })
})

describe("other paths that issue a room link", () => {
  const src = read(DATAROOMS)
  it("Create Data Room link prepares the personal links, and withdraws a link it cannot record", () => {
    const fn = body(src, "createSubscriberDataRoomLink")
    assert.ok(fn.indexOf("ensureAllDocumentLinks(") > fn.indexOf("saveDataRoomLink("))
    assert.match(fn, /revokeDataRoomLink\(result\.value\.linkId\)/)
  })

  it("a level change reports the new room's links instead of swallowing them", () => {
    const fn = body(read(LIFECYCLE), "reassignDataRoomOnLevelChange")
    assert.doesNotMatch(fn, /try \{ await ensureAllDocumentLinks\(sub\.id\) \} catch \{\}/)
    assert.match(fn, /links = await ensureAllDocumentLinks\(sub\.id, \{ dataroomId: newRoom\.dataroomId \}\)/)
    assert.match(read(SUBSCRIBERS), /linkNote = levelChangeLinkNote\(moved\)/)
  })
})

describe("who can be given a personal link", () => {
  const src = read(SERVICE)
  const loader = body(src, "loadSubscriberForDocLinks")
  const ensure = body(src, "ensureAllDocumentLinks")

  it("only an active subscriber, read from the database by id -- or a pending one only when activation asks", () => {
    // Activation may prepare any seat not yet active -- pending, or a lapsed,
    // suspended or declined seat being reactivated; nothing else may.
    assert.match(loader, /and \(lower\(s\.status\) = 'active' or \$\{allowPending\}::boolean\)/)
    assert.match(src, /async function loadSubscriberForDocLinks\([^)]*allowPending = false,/)
    assert.match(ensure, /loadSubscriberForDocLinks\(subscriberId, options\.allowPending === true\)/)
    // Only activation, which verifies before it activates, may prepare a pending subscriber.
    for (const file of ["src/app/actions/subscribers.ts", "src/app/actions/datarooms.ts", "src/app/actions/review-admin.ts"]) {
      assert.doesNotMatch(read(file), /allowPending/, `${file} never prepares a pending subscriber`)
    }
    assert.match(read("src/lib/subscriber-activation.ts"), /allowPending: !wasActive/)
    assert.match(loader, /s\.client_type = 'subscriber'/)
    assert.match(loader, /UUID\.test\(subscriberId\)/)
  })

  it("only inside their term and assigned room, without requiring an unrestricted room URL", () => {
    assert.match(ensure, /if \(sub\.termEnded\) return notEligible/)
    assert.doesNotMatch(ensure, /if \(!sub\.hasRoomLink\) return notEligible/)
    assert.match(ensure, /getEligibleRoomDocumentsForSubscriber/)
    assert.match(ensure, /options\.dataroomId !== sub\.dataroomId/)
    assert.match(loader, /l\.revoke_state = 'live'/)
  })

  it("links are named for the subscriber, watermarked with their email and expire with their term", () => {
    assert.match(ensure, /assignedName: sub\.fullName/)
    assert.match(ensure, /assignedEmail: sub\.email/)
    assert.match(ensure, /watermarkText: subscriberWatermarkText\(sub\.email\)/)
    assert.match(ensure, /expiresAt: sub\.termEnd/)
  })

  it("the service is server-only and the decision module imports nothing", () => {
    assert.match(src, /^import 'server-only'/)
    assert.doesNotMatch(read("src/lib/personal-links.ts"), /^import /m)
  })

  it("the old single-document helper that could leave an untracked link is gone", () => {
    assert.doesNotMatch(src, /export async function ensureDocumentLink\(/)
  })
})

describe("Admin visibility", () => {
  it("the subscriber page shows each missing link and offers owners Check and repair", () => {
    const panel = read("src/components/DataRoomPanel.tsx")
    assert.match(panel, /Check and repair document links/)
    assert.match(panel, /prepareDocumentLinks\(subscriberId\)/)
    assert.match(panel, /Missing: /)
    assert.match(panel, /confirmed with Papermark only when Check and repair runs/)
    const page = read("src/app/admin/subscribers/[id]/page.tsx")
    assert.match(page, /canRepair=\{admin\.role === "owner"\}/)
    assert.match(page, /getPersonalLinkStatus\(row\.id\)/)
  })

  it("the page hands the panel titles and counts, never a personal link", () => {
    const page = read("src/app/admin/subscribers/[id]/page.tsx")
    const block = page.slice(page.indexOf("const personalLinks ="), page.indexOf(": null", page.indexOf("const personalLinks =")))
    assert.doesNotMatch(block, /linkUrl|link_url|papermarkLinkId|papermark_link_id/)
  })

  it("Data Rooms shows each level's missing personal links", () => {
    const page = read("src/app/admin/datarooms/page.tsx")
    assert.match(page, /getPersonalLinkGaps\(\)/)
    assert.match(page, /Personal Links/)
  })
})

test("Complimentary Review and the public publications page are untouched by this fix", () => {
  for (const f of ["src/app/actions/review-library.ts", "src/app/publications/page.tsx", "src/lib/publications.ts"]) {
    assert.doesNotMatch(read(f), /ensureAllDocumentLinks|prepareRoomLinks|personal-links/)
  }
})
