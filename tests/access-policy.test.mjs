/**
 * The one access rule (src/lib/access-policy.ts): an edition appears when it
 * is On, ticked for the subscriber's plan and dated within their term; "Also
 * give" and "Hide" adjust it for one person. Pure: no database or network.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { decideAccess, effectiveRelease } from "../src/lib/access-policy.ts"
import { SUBSCRIPTION_CATALOGUE } from "../src/lib/subscription-catalogue.ts"

const active = { state: "active", termStart: "2026-01-01", termEnd: "2026-06-30" }
const edition = (over = {}) => ({
  publicationId: "p1",
  editionDate: "2026-02-15",
  visibility: "L1",
  series: "MIN",
  paidRelease: "released",
  editorialStatus: "draft",
  plans: ["Individual Access"],
  ...over,
})
const decide = (over = {}) =>
  decideAccess({
    subscription: active,
    plan: "Individual Access",
    periods: [],
    exception: null,
    ...over,
    publication: edition(over.publication),
  })

describe("On, their plan, within their term", () => {
  it("shows an edition that is On, ticked for their plan and dated within their term, first and last day included", () => {
    assert.deepEqual(decide(), { outcome: "allowed", reason: "within_term" })
    assert.equal(decide({ publication: { editionDate: "2026-01-01" } }).outcome, "allowed")
    assert.equal(decide({ publication: { editionDate: "2026-06-30" } }).outcome, "allowed")
  })

  it("does not show an edition dated before or after their term", () => {
    assert.deepEqual(decide({ publication: { editionDate: "2025-12-31" } }), { outcome: "excluded", reason: "before_term" })
    assert.deepEqual(decide({ publication: { editionDate: "2026-07-01" } }), { outcome: "excluded", reason: "outside_term" })
  })

  it("someone starting on 30 September does not get a 1 September edition unless it is also given", () => {
    const subscription = { state: "active", termStart: "2026-09-30", termEnd: "2026-11-20" }
    assert.deepEqual(decide({ subscription, publication: { editionDate: "2026-09-01" } }), { outcome: "excluded", reason: "before_term" })
    assert.deepEqual(decide({ subscription, exception: "allow", publication: { editionDate: "2026-09-01" } }), { outcome: "allowed", reason: "also_given" })
  })

  it("editions from an earlier term stay available after a renewal; a voided term gives nothing", () => {
    const subscription = { state: "active", termStart: "2027-01-01", termEnd: "2027-12-31" }
    const periods = [{ startsOn: "2026-01-01", endsOn: "2026-06-30" }, { startsOn: "2026-07-01", endsOn: "2026-09-30", voided: true }]
    assert.equal(decide({ subscription, periods, publication: { editionDate: "2026-03-01" } }).outcome, "allowed")
    assert.equal(decide({ subscription, periods, publication: { editionDate: "2026-08-01" } }).reason, "outside_term", "a gap stays a gap")
  })

  it("an edition for other plans is simply not theirs", () => {
    assert.deepEqual(decide({ publication: { plans: ["Political Monitor"] } }), { outcome: "excluded", reason: "not_in_plan" })
    assert.deepEqual(decide({ publication: { plans: ["Political Monitor"], paidRelease: null } }), { outcome: "excluded", reason: "not_in_plan" }, "not someone else's undecided edition either")
  })

  it("each of the five plans sees exactly the editions ticked for it", () => {
    for (const offering of SUBSCRIPTION_CATALOGUE) {
      for (const other of SUBSCRIPTION_CATALOGUE) {
        const shown = decide({ plan: offering.storedName, publication: { plans: [other.storedName] } }).outcome === "allowed"
        assert.equal(shown, offering.storedName === other.storedName, `${offering.name} and an edition for ${other.name}`)
      }
    }
    const shared = SUBSCRIPTION_CATALOGUE.slice(0, 3).map((o) => o.storedName)
    assert.ok(shared.every((plan) => decide({ plan, publication: { plans: shared } }).outcome === "allowed"), "one edition shared by three plans")
  })
})

describe("On and Off", () => {
  it("Off removes it for everyone, including anyone it was also given to", () => {
    assert.deepEqual(decide({ publication: { paidRelease: "withheld" } }), { outcome: "excluded", reason: "switched_off" })
    assert.deepEqual(decide({ exception: "allow", publication: { paidRelease: "withheld" } }), { outcome: "excluded", reason: "switched_off" })
  })

  it("not switched on yet is waiting, never a removal", () => {
    assert.deepEqual(decide({ publication: { paidRelease: null, editorialStatus: "draft" } }), { outcome: "unresolved", reason: "not_switched_on" })
  })

  it("an explicit decision wins; without one, published counts as On, archived as Off, draft as not decided", () => {
    assert.equal(effectiveRelease({ paidRelease: "withheld", editorialStatus: "published" }), "withheld")
    assert.equal(effectiveRelease({ paidRelease: "released", editorialStatus: "draft" }), "released")
    assert.equal(effectiveRelease({ paidRelease: null, editorialStatus: "published" }), "released")
    assert.equal(effectiveRelease({ paidRelease: null, editorialStatus: "archived" }), "withheld")
    assert.equal(effectiveRelease({ paidRelease: null, editorialStatus: "draft" }), null)
  })
})

describe("individual adjustments", () => {
  it("Hide always wins", () => {
    assert.deepEqual(decide({ exception: "block" }), { outcome: "excluded", reason: "hidden" })
    assert.deepEqual(decide({ exception: "block", publication: { editionDate: null } }), { outcome: "excluded", reason: "hidden" })
  })

  it("Also give works whatever the plan or date, but only inside a current subscription", () => {
    assert.equal(decide({ exception: "allow", publication: { plans: ["Board Briefing"], editionDate: "2020-01-01" } }).outcome, "allowed")
    for (const state of ["expired", "suspended", "inactive", "not_started"]) {
      assert.equal(decide({ exception: "allow", subscription: { ...active, state } }).outcome, "excluded", state)
    }
  })

  it("Automatic (no adjustment) follows the rule", () => {
    assert.equal(decide({ exception: null, publication: { editionDate: "2027-01-01" } }).outcome, "excluded")
  })
})

describe("missing information is waiting, never a removal", () => {
  it("no plan ticked, no date, no record, plans unreadable, or no plan on the subscriber", () => {
    assert.deepEqual(decide({ publication: { plans: [] } }), { outcome: "unresolved", reason: "no_plan_ticked" })
    assert.deepEqual(decide({ publication: { plans: null } }), { outcome: "unresolved", reason: "plans_unavailable" })
    assert.deepEqual(decide({ publication: { editionDate: null } }), { outcome: "unresolved", reason: "edition_date_missing" })
    assert.deepEqual(decide({ publication: { publicationId: null } }), { outcome: "unresolved", reason: "no_publication_record" })
    assert.deepEqual(decide({ plan: null }), { outcome: "unresolved", reason: "plan_missing" })
  })

  it("a term that needs correcting is not an ended subscription", () => {
    assert.deepEqual(decide({ subscription: { ...active, state: "term_missing" } }), { outcome: "unresolved", reason: "term_needs_correction" })
  })

  it("an ended, suspended, inactive or not-yet-started subscription shows nothing", () => {
    assert.equal(decide({ subscription: { ...active, state: "expired" } }).reason, "subscription_ended")
    assert.equal(decide({ subscription: { ...active, state: "suspended" } }).reason, "subscription_suspended")
    assert.equal(decide({ subscription: { ...active, state: "inactive" } }).reason, "subscription_inactive")
    assert.equal(decide({ subscription: { ...active, state: "not_started" } }).reason, "subscription_not_started")
  })

  it("a public publication is never issued as a paid edition", () => {
    assert.deepEqual(decide({ publication: { visibility: "OPEN" } }), { outcome: "excluded", reason: "public_publication" })
  })
})
