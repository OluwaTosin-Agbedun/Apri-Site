/**
 * The one access decision (src/lib/access-policy.ts), every branch.
 * Pure: no database or network. Invented data only.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { decideAccess, effectiveRelease } from "../src/lib/access-policy.ts"
import { SUBSCRIPTION_CATALOGUE } from "../src/lib/subscription-catalogue.ts"

const active = { state: "active", termStart: "2026-01-01", termEnd: "2026-12-31" }
const released = (over = {}) => ({
  publicationId: "p1",
  editionDate: "2026-01-15",
  visibility: "L1",
  series: "MIN",
  paidRelease: "released",
  editorialStatus: "draft",
  ...over,
})
const decide = (over = {}) =>
  decideAccess({
    subscription: active,
    level: "L1",
    periods: [
      { startsOn: "2026-01-01", endsOn: "2026-01-31", level: "L1" },
      { startsOn: "2026-05-01", endsOn: "2026-05-31", level: "L1" },
    ],
    periodsKnown: true,
    exception: null,
    ...over,
    publication: released(over.publication),
  })

describe("paid periods by edition date", () => {
  it("covers January and May, inclusive at both ends, and leaves the gap uncovered", () => {
    assert.deepEqual(decide({ publication: { editionDate: "2026-01-01" } }), { outcome: "allowed", reason: "within_paid_period" })
    assert.deepEqual(decide({ publication: { editionDate: "2026-01-31" } }), { outcome: "allowed", reason: "within_paid_period" })
    assert.deepEqual(decide({ publication: { editionDate: "2026-05-20" } }), { outcome: "allowed", reason: "within_paid_period" })
    assert.deepEqual(decide({ publication: { editionDate: "2026-03-01" } }), { outcome: "excluded", reason: "outside_paid_periods" })
    assert.deepEqual(decide({ publication: { editionDate: "2025-12-31" } }), { outcome: "excluded", reason: "before_coverage" })
  })

  it("a renewal adds coverage; a voided period grants nothing", () => {
    const periods = [
      { startsOn: "2026-01-01", endsOn: "2026-06-30", level: "L1" },
      { startsOn: "2026-07-01", endsOn: "2026-12-31", level: "L1" },
      { startsOn: "2027-01-01", endsOn: "2027-12-31", level: "L1", voided: true },
    ]
    assert.equal(decide({ periods, publication: { editionDate: "2026-09-01" } }).outcome, "allowed")
    assert.deepEqual(decide({ periods, publication: { editionDate: "2027-03-01" } }), { outcome: "excluded", reason: "outside_paid_periods" })
  })

  it("someone starting on 30 September does not receive a 1 September edition, unless it is allowed", () => {
    const periods = [{ startsOn: "2026-09-30", endsOn: "2026-11-20", level: "L1" }]
    assert.deepEqual(decide({ periods, publication: { editionDate: "2026-09-01" } }), { outcome: "excluded", reason: "before_coverage" })
    assert.deepEqual(decide({ periods, exception: "allow", publication: { editionDate: "2026-09-01" } }), { outcome: "allowed", reason: "manually_allowed" })
  })

  it("no paid-period history is undecided, never a confirmed exclusion", () => {
    assert.deepEqual(decide({ periods: [] }), { outcome: "unresolved", reason: "no_coverage_history" })
    assert.deepEqual(decide({ periodsKnown: false }), { outcome: "unresolved", reason: "no_coverage_history" })
    assert.deepEqual(decide({ periods: [{ startsOn: "2026-01-01", endsOn: "2026-12-31", level: "L1", voided: true }] }), { outcome: "unresolved", reason: "no_coverage_history" })
  })
})

describe("levels", () => {
  it("a period below the edition's level does not cover it, and Allow never lifts a subscriber above their level", () => {
    const periods = [{ startsOn: "2026-01-01", endsOn: "2026-12-31", level: "L1" }]
    assert.deepEqual(decide({ level: "L2", periods, publication: { visibility: "L2" } }), { outcome: "excluded", reason: "period_level" })
    assert.deepEqual(decide({ level: "L1", exception: "allow", publication: { visibility: "L2" } }), { outcome: "excluded", reason: "above_level" })
  })

  it("after a level change up, editions in periods paid at the new level are covered; old-level periods still cover old-level editions", () => {
    const periods = [
      { startsOn: "2026-01-01", endsOn: "2026-06-30", level: "L1" },
      { startsOn: "2026-07-01", endsOn: "2026-12-31", level: "L3" },
    ]
    assert.equal(decide({ level: "L3", periods, publication: { visibility: "L3", editionDate: "2026-08-01" } }).outcome, "allowed")
    assert.equal(decide({ level: "L3", periods, publication: { visibility: "L3", editionDate: "2026-02-01" } }).reason, "period_level")
    assert.equal(decide({ level: "L3", periods, publication: { visibility: "L1", editionDate: "2026-02-01" } }).outcome, "allowed")
  })

  it("all five offerings read their own level and below", () => {
    for (const offering of SUBSCRIPTION_CATALOGUE) {
      const periods = [{ startsOn: "2026-01-01", endsOn: "2026-12-31", level: offering.level }]
      for (const visibility of ["L1", "L2", "L3", "L4"]) {
        const expected = Number(visibility.slice(1)) <= Number(offering.level.slice(1))
        assert.equal(
          decide({ level: offering.level, periods, publication: { visibility } }).outcome === "allowed",
          expected,
          `${offering.name} (${offering.level}) and ${visibility}`,
        )
      }
    }
  })
})

describe("individual exceptions", () => {
  it("Block always wins, even over coverage and Allow's own bounds", () => {
    assert.deepEqual(decide({ exception: "block" }), { outcome: "excluded", reason: "manually_blocked" })
    assert.deepEqual(decide({ exception: "block", publication: { editionDate: null } }), { outcome: "excluded", reason: "manually_blocked" })
  })

  it("Automatic (no exception) returns to the paid-period rule", () => {
    assert.equal(decide({ exception: null, publication: { editionDate: "2026-03-01" } }).outcome, "excluded")
    assert.equal(decide({ exception: "allow", publication: { editionDate: "2026-03-01" } }).outcome, "allowed")
  })

  it("Allow stays bounded by an active subscription", () => {
    for (const state of ["expired", "suspended", "inactive", "not_started"]) {
      assert.equal(decide({ exception: "allow", subscription: { ...active, state } }).outcome, "excluded", state)
    }
  })
})

describe("the subscription and the record decide first", () => {
  it("ended, suspended, inactive and not-yet-started subscriptions are confirmed exclusions", () => {
    assert.equal(decide({ subscription: { ...active, state: "expired" } }).reason, "subscription_ended")
    assert.equal(decide({ subscription: { ...active, state: "suspended" } }).reason, "subscription_suspended")
    assert.equal(decide({ subscription: { ...active, state: "inactive" } }).reason, "subscription_inactive")
    assert.equal(decide({ subscription: { ...active, state: "not_started" } }).reason, "subscription_not_started")
  })

  it("a term that needs correcting is undecided, not an ended subscription", () => {
    assert.deepEqual(decide({ subscription: { ...active, state: "term_missing" } }), { outcome: "unresolved", reason: "term_needs_correction" })
  })

  it("missing publication details are undecided; public and withheld records are excluded", () => {
    assert.deepEqual(decide({ publication: { publicationId: null } }), { outcome: "unresolved", reason: "no_publication_record" })
    assert.deepEqual(decide({ publication: { editionDate: null } }), { outcome: "unresolved", reason: "edition_date_missing" })
    assert.deepEqual(decide({ publication: { paidRelease: null, editorialStatus: "draft" } }), { outcome: "unresolved", reason: "release_undecided" })
    assert.deepEqual(decide({ publication: { visibility: "OPEN" } }), { outcome: "excluded", reason: "public_publication" })
    assert.deepEqual(decide({ publication: { paidRelease: "withheld" } }), { outcome: "excluded", reason: "withheld" })
    assert.deepEqual(decide({ level: null }), { outcome: "unresolved", reason: "level_missing" })
  })
})

describe("paid release", () => {
  it("an explicit decision wins; without one, published is released, archived withheld, draft undecided", () => {
    assert.equal(effectiveRelease({ paidRelease: "withheld", editorialStatus: "published" }), "withheld")
    assert.equal(effectiveRelease({ paidRelease: "released", editorialStatus: "draft" }), "released")
    assert.equal(effectiveRelease({ paidRelease: null, editorialStatus: "published" }), "released")
    assert.equal(effectiveRelease({ paidRelease: null, editorialStatus: "archived" }), "withheld")
    assert.equal(effectiveRelease({ paidRelease: null, editorialStatus: "draft" }), null)
  })

  it("a draft record released explicitly is issued, independently of its editorial status", () => {
    assert.equal(decide({ publication: { paidRelease: "released", editorialStatus: "draft" } }).outcome, "allowed")
  })
})
