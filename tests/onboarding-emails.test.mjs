/**
 * The email outcomes and the two-email onboarding sequence, exercised
 * directly: what a provider answer means, when each email is sent, what a
 * retry does, and which sign-in links survive.
 *
 * No network, no database and no real address: the provider and the tracked
 * rows are fakes that behave the way Resend and the claim SQL do.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { deliverEmail, fingerprint, safeText } from "../src/lib/email-delivery.ts"
import {
  runOnboarding,
  describeOnboarding,
  withinIdempotencyWindow,
  STALE_CLAIM_MS,
  IDEMPOTENCY_WINDOW_MS,
} from "../src/lib/onboarding-sequence.ts"

const ok = (id) => async () => ({ data: { id }, error: null })
const err = (name, statusCode, message = "no") => async () => ({ data: null, error: { name, statusCode, message } })

describe("an email's outcome is what the provider answered", () => {
  it("missing configuration is reported, and nothing is sent", async () => {
    const outcome = await deliverEmail(null, "k")
    assert.equal(outcome.status, "not_configured")
    assert.match(outcome.message, /nothing was sent/)
  })

  it("a refusal returned without an exception is a refusal, not a success", async () => {
    const outcome = await deliverEmail(err("validation_error", 422, "Invalid `to` field"), "k")
    assert.equal(outcome.status, "rejected")
    assert.equal(outcome.retryable, false)
  })

  it("a rate limit is a retryable refusal", async () => {
    const outcome = await deliverEmail(err("rate_limit_exceeded", 429), "k")
    assert.deepEqual([outcome.status, outcome.retryable], ["rejected", true])
  })

  it("a provider fault, a network failure or a concurrent same-key request is unknown, never a refusal", async () => {
    for (const send of [
      err("internal_server_error", 500),
      err("application_error", null, "fetch failed"),
      err("concurrent_idempotent_requests", 409),
      async () => {
        throw new Error("socket hang up")
      },
    ]) {
      assert.equal((await deliverEmail(send, "k")).status, "unknown")
    }
  })

  it("a provider that does not answer in time is unknown", async () => {
    const started = Date.now()
    const outcome = await deliverEmail(() => new Promise(() => {}), "k", { timeoutMs: 30 })
    assert.equal(outcome.status, "unknown")
    assert.match(outcome.message, /did not answer/)
    assert.ok(Date.now() - started < 2000)
  })

  it("an answer without a message id is not acceptance", async () => {
    assert.equal((await deliverEmail(async () => ({ data: null, error: null }), "k")).status, "unknown")
    assert.equal((await deliverEmail(async () => undefined, "k")).status, "unknown")
  })

  it("acceptance carries the provider's message id, and the idempotency key reaches the provider", async () => {
    let seen = null
    const outcome = await deliverEmail(async (key) => {
      seen = key
      return { data: { id: "msg_1" }, error: null }
    }, "welcome:abc")
    assert.deepEqual(outcome, { status: "accepted", providerMessageId: "msg_1" })
    assert.equal(seen, "welcome:abc")
  })

  it("provider text shown to Admin carries no address, link or token", async () => {
    const outcome = await deliverEmail(
      err("validation_error", 422, "Invalid to: person@example.test, see https://example.test/x?token=abc key=secret"),
      "k",
    )
    assert.doesNotMatch(outcome.message, /person@example\.test|https:|token=abc|key=secret/)
    assert.match(safeText("a@b.test"), /\[address\]/)
  })

  it("the fingerprint is stable and tells payloads apart", () => {
    assert.equal(fingerprint("same"), fingerprint("same"))
    assert.notEqual(fingerprint("one"), fingerprint("two"))
  })
})

/**
 * Two tracked rows behaving like the claim SQL in src/lib/subscriber-onboarding.ts:
 * a claim is a check-and-set on the CURRENT row, only one caller wins it, and
 * an outcome is written only for the attempt that holds the claim.
 */
function fakeSubscriber({ welcome = [], access = [], rows = {} } = {}) {
  const store = {
    welcome: { id: "w", kind: "welcome", state: "pending", attempts: 0, claimedAt: null, lastError: null, providerId: null, createdAt: Date.now(), ...rows.welcome },
    secure_access: { id: "s", kind: "secure_access", state: "pending", attempts: 0, claimedAt: null, lastError: null, providerId: null, createdAt: Date.now(), ...rows.secure_access },
  }
  const byId = (id) => (id === "w" ? store.welcome : store.secure_access)
  const log = { welcomeSends: 0, accessSends: [], issued: [], revoked: [], order: [] }
  const tick = () => new Promise((done) => setImmediate(done))
  const deps = {
    rows: async () => ({ welcome: { ...store.welcome }, secureAccess: { ...store.secure_access } }),
    claim: async (row, { allowStale }) => {
      const r = byId(row.id)
      const stale = r.claimedAt && Date.now() - r.claimedAt > STALE_CLAIM_MS
      const can =
        r.state === "pending" || r.state === "failed" || (allowStale && r.state === "unknown") || (allowStale && r.state === "sending" && stale)
      if (!can) return null
      r.state = "sending"
      r.attempts += 1
      r.claimedAt = Date.now()
      return r.attempts
    },
    sendWelcome: async (...args) => {
      assert.equal(args.length, 0, "the welcome is sent with no sign-in token")
      log.welcomeSends++
      log.order.push("welcome")
      await tick()
      const next = welcome.shift() ?? { status: "accepted", providerMessageId: "welcome-id" }
      if (next instanceof Error) throw next
      return next
    },
    issueToken: async () => {
      const token = `token-${log.issued.length + 1}`
      log.issued.push(token)
      return { token, revoke: async () => void log.revoked.push(token) }
    },
    sendSecureAccess: async (token, attemptKey) => {
      log.accessSends.push({ token, attemptKey })
      log.order.push("access")
      await tick()
      return access.shift() ?? { status: "accepted", providerMessageId: `access-${log.accessSends.length}` }
    },
    record: async (row, outcome, attempt) => {
      const r = byId(row.id)
      if (outcome.status === "accepted") {
        if (r.state !== "accepted") Object.assign(r, { state: "accepted", providerId: outcome.providerMessageId, lastError: null })
        return
      }
      if (r.state === "sending" && r.attempts === attempt) {
        Object.assign(r, { state: outcome.status === "unknown" ? "unknown" : "failed", lastError: outcome.message })
      }
    },
    markUnknown: async (row, message) => {
      const r = byId(row.id)
      if (r.state === "sending" && r.attempts === row.attempts) Object.assign(r, { state: "unknown", lastError: message })
    },
  }
  return { store, log, deps }
}

describe("the two onboarding emails", () => {
  it("sends the welcome first and the secure-access email only after the welcome is accepted", async () => {
    const { deps, log, store } = fakeSubscriber()
    const report = await runOnboarding(deps)
    assert.equal(report.complete, true)
    assert.deepEqual(log.order, ["welcome", "access"])
    assert.equal(log.issued.length, 1)
    assert.equal(log.revoked.length, 0)
    assert.equal(store.welcome.providerId, "welcome-id")
    assert.equal(store.secure_access.state, "accepted")
    assert.match(describeOnboarding(report), /accepted by the email provider/)
    assert.doesNotMatch(describeOnboarding(report), /token-1|delivered to/)
  })

  it("a refused welcome holds the secure-access email: no link is even issued", async () => {
    const { deps, log, store } = fakeSubscriber({ welcome: [{ status: "rejected", message: "refused (422)", retryable: false }] })
    const report = await runOnboarding(deps)
    assert.equal(report.complete, false)
    assert.equal(report.welcome.step, "failed")
    assert.equal(report.secureAccess.step, "waiting_for_welcome")
    assert.equal(log.issued.length, 0)
    assert.equal(store.welcome.state, "failed", "failure is visible and retryable")
  })

  it("missing email configuration is never recorded as sent, and stays retryable", async () => {
    const { deps, store } = fakeSubscriber({ welcome: [{ status: "not_configured", message: "Email is not configured" }] })
    const report = await runOnboarding(deps)
    assert.equal(report.welcome.step, "not_configured")
    assert.equal(store.welcome.state, "failed")
    assert.equal(store.welcome.providerId, null)
    const retried = await runOnboarding(deps)
    assert.equal(retried.complete, true, "once configured, the retry completes")
  })

  it("welcome accepted but secure access refused: the retry sends only the secure-access email", async () => {
    const { deps, log, store } = fakeSubscriber({ access: [{ status: "rejected", message: "refused", retryable: true }] })
    const first = await runOnboarding(deps)
    assert.equal(first.welcome.step, "accepted")
    assert.equal(first.secureAccess.step, "failed")
    assert.deepEqual(log.revoked, ["token-1"], "only the refused link is revoked")
    assert.equal(store.secure_access.state, "failed")

    const second = await runOnboarding(deps)
    assert.equal(second.complete, true)
    assert.equal(log.welcomeSends, 1, "the welcome is not repeated")
    assert.equal(log.accessSends.length, 2)
    assert.notEqual(log.accessSends[0].attemptKey, log.accessSends[1].attemptKey, "each attempt has its own key")
    assert.deepEqual(log.revoked, ["token-1"], "the delivered link is never revoked by a retry")
  })

  it("an unsettled secure-access email keeps its link and is never resent automatically", async () => {
    const { deps, log, store } = fakeSubscriber({ access: [{ status: "unknown", message: "did not answer" }] })
    const first = await runOnboarding(deps)
    assert.equal(first.secureAccess.step, "unknown")
    assert.deepEqual(log.revoked, [], "a link that may be in the inbox stays valid")
    assert.equal(store.secure_access.state, "unknown")
    const second = await runOnboarding(deps)
    assert.equal(second.secureAccess.step, "unknown")
    assert.equal(log.accessSends.length, 1, "no second link without an administrator's decision")
  })

  it("an unsettled welcome is retried under the same fixed message, so the provider can deduplicate it", async () => {
    const { deps, log } = fakeSubscriber({ welcome: [{ status: "unknown", message: "timeout" }] })
    const first = await runOnboarding(deps)
    assert.equal(first.welcome.step, "unknown")
    const second = await runOnboarding(deps)
    assert.equal(second.complete, true)
    assert.equal(log.welcomeSends, 2)
    assert.equal(log.issued.length, 1)
  })

  it("an unsettled welcome older than the provider's idempotency window is not resent automatically", async () => {
    const old = Date.now() - IDEMPOTENCY_WINDOW_MS - 60_000
    const { deps, log } = fakeSubscriber({ rows: { welcome: { state: "unknown", attempts: 1, createdAt: old, lastError: "timeout" } } })
    const report = await runOnboarding(deps)
    assert.equal(report.welcome.step, "unknown")
    assert.match(report.welcome.message, /too old to resend safely/)
    assert.equal(log.welcomeSends, 0, "no possible second welcome")
    assert.equal(report.secureAccess.step, "waiting_for_welcome")
    assert.equal(withinIdempotencyWindow({ createdAt: new Date() }, Date.now()), true)
    assert.equal(withinIdempotencyWindow({ createdAt: null }, Date.now()), false)
  })

  it("a failed write after the provider accepted still reports acceptance, and never resends the access email", async () => {
    const { deps, log } = fakeSubscriber()
    const record = deps.record
    deps.record = async (row, outcome, attempt) => {
      if (row.id === "s") throw new Error("db write failed")
      return record(row, outcome, attempt)
    }
    const report = await runOnboarding(deps)
    assert.equal(report.secureAccess.step, "accepted", "what the provider said stands")
    assert.deepEqual(log.revoked, [])
    deps.record = record
    const again = await runOnboarding(deps)
    assert.equal(log.accessSends.length, 1, "the row left 'sending' is not resent while its claim is fresh")
    assert.equal(again.secureAccess.step, "in_progress")
  })

  it("a crash after the provider accepted the welcome is recovered once the claim is stale", async () => {
    const { deps, log, store } = fakeSubscriber({
      rows: { welcome: { state: "sending", attempts: 1, claimedAt: Date.now() - STALE_CLAIM_MS - 1000 } },
    })
    const report = await runOnboarding(deps)
    assert.equal(report.complete, true)
    assert.equal(store.welcome.attempts, 2)
    assert.equal(log.welcomeSends, 1)
  })

  it("a fresh claim held by another attempt is left alone", async () => {
    const { deps, log } = fakeSubscriber({ rows: { welcome: { state: "sending", attempts: 1, claimedAt: Date.now() } } })
    const report = await runOnboarding(deps)
    assert.equal(report.welcome.step, "in_progress")
    assert.equal(log.welcomeSends, 0)
  })

  it("a crash mid secure-access attempt becomes unknown, and is not resent", async () => {
    const { deps, log, store } = fakeSubscriber({
      rows: {
        welcome: { state: "accepted", providerId: "w1" },
        secure_access: { state: "sending", attempts: 1, claimedAt: Date.now() - STALE_CLAIM_MS - 1000 },
      },
    })
    const report = await runOnboarding(deps)
    assert.equal(report.secureAccess.step, "unknown")
    assert.equal(store.secure_access.state, "unknown")
    assert.equal(log.accessSends.length, 0)
  })

  it("two attempts at once -- a double-click, two admins -- send each email once", async () => {
    const { deps, log } = fakeSubscriber()
    const [a, b] = await Promise.all([runOnboarding(deps), runOnboarding(deps)])
    assert.equal(log.welcomeSends, 1)
    assert.equal(log.accessSends.length, 1)
    assert.ok([a, b].some((r) => r.complete))
    assert.ok([a, b].some((r) => r.welcome.step === "in_progress" || r.secureAccess.step === "in_progress" || r.welcome.when === "earlier"))
  })

  it("an accepted message is never sent again", async () => {
    const { deps, log } = fakeSubscriber({
      rows: { welcome: { state: "accepted", providerId: "w" }, secure_access: { state: "accepted", providerId: "s" } },
    })
    const report = await runOnboarding(deps)
    assert.equal(report.complete, true)
    assert.equal(log.welcomeSends + log.accessSends.length, 0)
    assert.match(describeOnboarding(report), /earlier/)
  })

  it("each named person's emails are their own: one person's failure never touches another's", async () => {
    const ada = fakeSubscriber({ access: [{ status: "rejected", message: "refused", retryable: false }] })
    const bola = fakeSubscriber()
    const [ra, rb] = await Promise.all([runOnboarding(ada.deps), runOnboarding(bola.deps)])
    assert.equal(ra.complete, false)
    assert.equal(rb.complete, true)
    assert.deepEqual(bola.log.revoked, [])
  })

  it("a sign-in link that could not be issued sends nothing and stays retryable", async () => {
    const { deps, log, store } = fakeSubscriber()
    deps.issueToken = async () => {
      throw new Error("db down")
    }
    const report = await runOnboarding(deps)
    assert.equal(report.secureAccess.step, "failed")
    assert.equal(log.accessSends.length, 0)
    assert.equal(store.secure_access.state, "failed")
  })

  it("a late write from an older attempt cannot overwrite a newer one", async () => {
    const { deps, store } = fakeSubscriber()
    const row = { id: "w" }
    const first = await deps.claim(row, { allowStale: true })
    store.welcome.claimedAt = Date.now() - STALE_CLAIM_MS - 1000
    const second = await deps.claim(row, { allowStale: true })
    await deps.record(row, { status: "rejected", message: "late", retryable: false }, first)
    assert.equal(store.welcome.state, "sending", "the stale writer changed nothing")
    await deps.record(row, { status: "accepted", providerMessageId: "id" }, second)
    await deps.record(row, { status: "unknown", message: "later" }, second)
    assert.equal(store.welcome.state, "accepted", "nothing overwrites acceptance")
  })
})
