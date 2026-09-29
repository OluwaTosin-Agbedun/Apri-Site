/**
 * Individual and Professional subscriptions -- the decisions, as behaviour.
 *
 * Paid access follows a request only after a signed agreement AND a confirmed
 * payment. These tests drive the real gate (src/lib/subscription-journey.ts)
 * through every combination, the plan limits, and what counts as a complete
 * activation.
 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"

import {
  PLANS,
  parsePlan,
  validateAuthorisedUsers,
  activationGate,
  activationComplete,
  describeActivation,
  laterStatus,
  milestoneStatus,
} from "../src/lib/subscription-journey.ts"

const TODAY = "2026-09-30"
const ready = (overrides = {}) => ({
  plan: "Professional",
  requesterConfirmed: true,
  agreementSentAt: "2026-09-20",
  agreementSignedAt: "2026-09-22",
  invoiceSentAt: "2026-09-23",
  paymentConfirmedAt: "2026-09-25",
  termStart: "2026-10-01",
  termEnd: "2027-09-30",
  authorisedUsers: [
    { name: "Ada Test", email: "ada@example.test" },
    { name: "Bola Test", email: "bola@example.test" },
  ],
  ...overrides,
})

describe("the plans", () => {
  it("are priced and limited as published", () => {
    assert.equal(PLANS.Individual.label, "Individual Access")
    assert.equal(PLANS.Individual.price, "₦2 million annually")
    assert.equal(PLANS.Individual.users, "1 named authorised subscriber")
    assert.equal(PLANS.Individual.maxUsers, 1)
    assert.equal(PLANS.Professional.label, "Professional Access")
    assert.equal(PLANS.Professional.price, "₦5 million annually")
    assert.equal(PLANS.Professional.users, "Up to 3 named authorised subscribers")
    assert.equal(PLANS.Professional.maxUsers, 3)
  })

  it("map onto the existing stored tiers without renaming them", () => {
    assert.equal(PLANS.Individual.tier, "Individual Access")
    assert.equal(PLANS.Professional.tier, "Professional Team Access")
  })

  it("only the two plans exist; anything else is refused", () => {
    assert.deepEqual(Object.keys(PLANS), ["Individual", "Professional"])
    assert.equal(parsePlan("Individual"), "Individual")
    assert.equal(parsePlan("Professional"), "Professional")
    for (const bad of ["Political Monitor", "individual", "", null, undefined, "Professional "]) {
      assert.equal(parsePlan(bad), null)
    }
  })
})

describe("named subscribers", () => {
  const user = (i) => ({ name: `Person ${i}`, email: `person${i}@example.test` })

  it("Individual covers exactly one; Professional one to three", () => {
    assert.equal(validateAuthorisedUsers("Individual", [user(1)]).ok, true)
    assert.equal(validateAuthorisedUsers("Individual", [user(1), user(2)]).ok, false)
    for (const n of [1, 2, 3]) {
      assert.equal(validateAuthorisedUsers("Professional", Array.from({ length: n }, (_, i) => user(i))).ok, true)
    }
    const four = validateAuthorisedUsers("Professional", [user(1), user(2), user(3), user(4)])
    assert.equal(four.ok, false)
    assert.match(four.message, /at most three/)
    assert.equal(validateAuthorisedUsers("Professional", []).ok, false)
  })

  it("each needs a name and their own valid address, normalised", () => {
    const ok = validateAuthorisedUsers("Professional", [{ name: " Ada ", email: " ADA@Example.TEST " }])
    assert.deepEqual(ok, { ok: true, users: [{ name: "Ada", email: "ada@example.test" }] })
    assert.equal(validateAuthorisedUsers("Professional", [{ name: "Ada", email: "not-an-email" }]).ok, false)
    assert.equal(validateAuthorisedUsers("Professional", [{ name: "", email: "ada@example.test" }]).ok, false)
    const dup = validateAuthorisedUsers("Professional", [
      { name: "Ada", email: "ada@example.test" },
      { name: "Ada again", email: "ADA@example.test" },
    ])
    assert.equal(dup.ok, false)
    assert.match(dup.message, /their own email/)
  })
})

describe("the activation gate", () => {
  it("all four combinations of agreement signed and payment confirmed: only both proceed", () => {
    const cases = [
      { signed: false, paid: false, ok: false },
      { signed: true, paid: false, ok: false },
      { signed: false, paid: true, ok: false },
      { signed: true, paid: true, ok: true },
    ]
    for (const c of cases) {
      const gate = activationGate(
        ready({
          agreementSignedAt: c.signed ? "2026-09-22" : null,
          paymentConfirmedAt: c.paid ? "2026-09-25" : null,
        }),
        TODAY,
      )
      assert.equal(gate.ok, c.ok, `signed=${c.signed} paid=${c.paid}`)
      if (!c.ok) {
        if (!c.signed) assert.ok(gate.missing.includes("Agreement signed"))
        if (!c.paid) assert.ok(gate.missing.includes("Payment confirmed"))
      }
    }
  })

  it("a request, a verified email or an invoice alone never passes", () => {
    const bare = {
      plan: "Individual",
      requesterConfirmed: true,
      agreementSentAt: null,
      agreementSignedAt: null,
      invoiceSentAt: "2026-09-23",
      paymentConfirmedAt: null,
      termStart: "2026-10-01",
      termEnd: "2027-09-30",
      authorisedUsers: [{ name: "Ada Test", email: "ada@example.test" }],
    }
    const gate = activationGate(bare, TODAY)
    assert.equal(gate.ok, false)
    assert.deepEqual(gate.missing, ["Agreement sent", "Agreement signed", "Payment confirmed"])
  })

  it("requires the requester's address to be confirmed", () => {
    const gate = activationGate(ready({ requesterConfirmed: false }), TODAY)
    assert.equal(gate.ok, false)
    assert.ok(gate.missing.includes("The requester's email address confirmed"))
  })

  it("requires the invoice before a payment can count, and a sent agreement", () => {
    assert.ok(activationGate(ready({ invoiceSentAt: null }), TODAY).missing.includes("Invoice issued"))
    assert.ok(activationGate(ready({ agreementSentAt: null }), TODAY).missing.includes("Agreement sent"))
  })

  it("requires a real, current term", () => {
    assert.ok(activationGate(ready({ termEnd: null }), TODAY).missing.includes("Subscription start and end dates"))
    assert.ok(
      activationGate(ready({ termStart: "2027-01-01", termEnd: "2026-12-31" }), TODAY).missing.includes(
        "A subscription end date after its start date",
      ),
    )
    assert.ok(
      activationGate(ready({ termStart: "2025-01-01", termEnd: "2025-12-31" }), TODAY).missing.includes(
        "A subscription end date that has not passed",
      ),
    )
  })

  it("enforces the plan's named-subscriber limit at activation too", () => {
    const tooMany = activationGate(
      ready({
        authorisedUsers: [1, 2, 3, 4].map((i) => ({ name: `P ${i}`, email: `p${i}@example.test` })),
      }),
      TODAY,
    )
    assert.equal(tooMany.ok, false)
    const individualPair = activationGate(ready({ plan: "Individual" }), TODAY)
    assert.equal(individualPair.ok, false)
    assert.equal(activationGate(ready({ authorisedUsers: "not a list" }), TODAY).ok, false)
    assert.equal(activationGate(ready({ plan: "Enterprise" }), TODAY).ok, false)
  })

  it("passes with everything in place and returns the normalised people", () => {
    const gate = activationGate(ready(), TODAY)
    assert.equal(gate.ok, true)
    assert.equal(gate.plan, "Professional")
    assert.equal(gate.users.length, 2)
  })
})

describe("a complete activation", () => {
  const a = { name: "Ada", email: "ada@example.test" }
  const b = { name: "Bola", email: "bola@example.test" }

  it("is complete only when every named person's access is ready", () => {
    assert.equal(
      activationComplete([{ ...a, state: "activated", welcome: "sent" }, { ...b, state: "activated", welcome: "already_sent" }], 2),
      true,
    )
    assert.equal(activationComplete([{ ...a, state: "activated", welcome: "sent" }, { ...b, state: "held", reason: "x" }], 2), false)
    assert.equal(activationComplete([{ ...a, state: "activated", welcome: "sent" }, { ...b, state: "blocked", reason: "x" }], 2), false)
    assert.equal(activationComplete([{ ...a, state: "activated", welcome: "sent" }], 2), false, "a missing person is not complete")
    assert.equal(activationComplete([], 0), false)
  })

  it("a provisioning failure is reported as not complete, naming who and why", () => {
    const text = describeActivation(
      [
        { ...a, state: "activated", welcome: "sent" },
        { ...b, state: "held", reason: "1 of 3 personal document links ready." },
      ],
      2,
    )
    assert.match(text, /^Activation is not complete\./)
    assert.match(text, /Bola: activated, but the welcome email is held -- 1 of 3 personal document links ready\./)
    assert.match(text, /not emailed twice/)
    assert.doesNotMatch(text, /Access activated for all/)
  })
})

describe("status", () => {
  it("never moves backwards", () => {
    assert.equal(laterStatus("Payment Confirmed", "Email Verified"), "Payment Confirmed")
    assert.equal(laterStatus("Subscription Requested", "Agreement Sent"), "Agreement Sent")
    assert.equal(laterStatus("Access Activated", "Subscription Requested"), "Access Activated")
    assert.equal(laterStatus("Review Requested", "not a status"), "Review Requested")
  })

  it("follows the recorded milestones", () => {
    const none = { agreementSentAt: null, agreementSignedAt: null, invoiceSentAt: null, paymentConfirmedAt: null }
    assert.equal(milestoneStatus(none), "Subscription Requested")
    assert.equal(milestoneStatus({ ...none, agreementSentAt: "2026-09-20" }), "Agreement Sent")
    assert.equal(milestoneStatus({ ...none, agreementSentAt: "2026-09-20", agreementSignedAt: "2026-09-21" }), "Agreement Signed")
    assert.equal(milestoneStatus({ ...none, invoiceSentAt: "2026-09-22" }), "Invoice Sent")
    assert.equal(milestoneStatus({ ...none, invoiceSentAt: "2026-09-22", paymentConfirmedAt: "2026-09-23" }), "Payment Confirmed")
  })
})
