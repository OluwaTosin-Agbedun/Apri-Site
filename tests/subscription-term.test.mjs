/**
 * The subscription term rule, and the real portal query path it runs on.
 *
 * d004268 compared the Date objects the Neon driver returns for `date`
 * columns with a "YYYY-MM-DD" string, which is always false, so every current
 * subscriber was shown "Your access has ended". These tests go through the
 * same driver and the real queries, not a helper handed "active".
 * Invented data only.
 */
import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import { existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { types } from "@neondatabase/serverless"
import { sql, makeTag, cleanup } from "./helpers.mjs"

const SRC = fileURLToPath(new URL("../src/", import.meta.url))
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true }
    if (/^next\/[a-z-]+$/.test(specifier)) return next(`${specifier}.js`, context)
    let base = null
    if (specifier.startsWith("@/")) base = join(SRC, specifier.slice(2))
    else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.includes("/src/")) {
      base = join(dirname(fileURLToPath(context.parentURL)), specifier)
    }
    if (base && !/\.[cm]?[jt]sx?$/.test(base)) {
      for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
        if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true }
      }
    }
    return next(specifier, context)
  },
})
process.env.DATABASE_URL = process.env.APRI_TEST_DATABASE_URL

const term = await import("../src/lib/subscription-term.ts")
const principal = await import("../src/lib/subscriber-principal.ts")
const { decidePortalLinkCopy } = await import("../src/lib/portal-link-copy.ts")

const { dateOnly, subscriptionStatus, signInDecision, lagosToday } = term
const neonDate = types.getTypeParser(1082)

describe("date-only values", () => {
  it("reads the Neon driver's Date for a date column as the stored calendar day", () => {
    for (const day of ["2026-08-27", "2026-09-30", "2026-11-11", "2026-11-20", "2026-01-01", "2026-12-31"]) {
      const parsed = neonDate(day)
      assert.ok(parsed instanceof Date, "the driver really does return a Date")
      assert.equal(dateOnly(parsed), day)
    }
  })

  it("is the comparison that failed: a Date against a date string is always false", () => {
    const end = neonDate("2026-11-11")
    assert.equal(end >= "2026-09-30", false)
    assert.equal(end <= "2026-09-30", false)
    assert.equal(dateOnly(end) >= "2026-09-30", true)
  })

  it("reads UTC-midnight Dates, date strings and timestamp text", () => {
    assert.equal(dateOnly(new Date(Date.UTC(2026, 10, 11))), "2026-11-11")
    assert.equal(dateOnly("2026-11-11"), "2026-11-11")
    assert.equal(dateOnly("2026-11-11T00:00:00.000Z"), "2026-11-11")
    assert.equal(dateOnly("2026-11-11 00:00:00+00"), "2026-11-11")
  })

  it("rejects missing and impossible dates instead of guessing", () => {
    for (const bad of [null, undefined, "", "2026-02-30", "2026-13-01", "11/11/2026", "2026-11-11x", new Date("nope"), 20261111]) {
      assert.equal(dateOnly(bad), null, String(bad))
    }
  })
})

describe("subscription state, in Lagos days", () => {
  const at = (iso) => lagosToday(new Date(iso))
  const active = (termStart, termEnd, today) => subscriptionStatus({ status: "active", termStart, termEnd }, today).state

  it("accepts both terms from the incident, whether read as Dates or text", () => {
    const today = "2026-09-30"
    assert.equal(active(neonDate("2026-08-27"), neonDate("2026-11-11"), today), "active")
    assert.equal(active(neonDate("2026-09-30"), neonDate("2026-11-20"), today), "active")
    assert.equal(active("2026-08-27", "2026-11-11", today), "active")
    assert.equal(active("2026-09-30", "2026-11-20", today), "active")
  })

  it("includes the whole first and last day in Lagos, whatever the UTC date", () => {
    // Lagos is UTC+1: 23:30 UTC on 29 September is already 30 September there.
    assert.equal(active("2026-09-30", "2026-11-20", at("2026-09-29T22:59:00Z")), "not_started")
    assert.equal(active("2026-09-30", "2026-11-20", at("2026-09-29T23:00:00Z")), "active")
    assert.equal(active("2026-08-27", "2026-11-11", at("2026-11-11T22:59:59Z")), "active")
    assert.equal(active("2026-08-27", "2026-11-11", at("2026-11-11T23:00:00Z")), "expired")
  })

  it("names future, ended, suspended, lapsed, inactive and incomplete seats separately", () => {
    const today = "2026-09-30"
    assert.equal(active("2026-10-01", "2026-12-31", today), "not_started")
    assert.equal(active("2026-01-01", "2026-09-29", today), "expired")
    assert.equal(subscriptionStatus({ status: "suspended", termStart: "2026-01-01", termEnd: "2026-12-31" }, today).state, "suspended")
    assert.equal(subscriptionStatus({ status: "lapsed", termStart: "2026-01-01", termEnd: "2026-12-31" }, today).state, "expired")
    assert.equal(subscriptionStatus({ status: "Pending", termStart: "2026-01-01", termEnd: "2026-12-31" }, today).state, "inactive")
    assert.equal(subscriptionStatus({ status: "declined", termStart: null, termEnd: null }, today).state, "inactive")
    assert.equal(active(null, "2026-12-31", today), "term_missing", "a missing start is a record to fix, not an ended term")
    assert.equal(active("2026-01-01", null, today), "term_missing")
    assert.equal(active("2026-02-30", "2026-12-31", today), "term_missing")
    assert.equal(active("2027-12-31", "2027-01-01", today), "term_missing", "an end before the start is a record to fix")
    assert.equal(active(null, "2026-09-01", today), "expired", "an end date that has passed is decisive")
  })

  it("refuses sign-in only for ended, suspended and inactive seats, as before", () => {
    const decide = (state) => signInDecision({ state, termStart: null, termEnd: null })
    assert.deepEqual(decide("active"), { ok: true })
    assert.deepEqual(decide("not_started"), { ok: true })
    assert.deepEqual(decide("term_missing"), { ok: true })
    assert.deepEqual(decide("expired"), { ok: false, reason: "subscription-expired" })
    assert.deepEqual(decide("suspended"), { ok: false, reason: "suspended" })
    assert.deepEqual(decide("inactive"), { ok: false, reason: "inactive" })
  })
})

describe("the portal's own queries", () => {
  const tag = makeTag("term")
  const ids = {}
  const seat = async (suffix, status, termStart, termEnd) => {
    const [row] = await sql`
      insert into subscribers (full_name, name, email, level, public_tier, status, seats, term_start, term_end, organization)
      values (${`Seat ${suffix}`}, ${`Seat ${suffix}`}, ${`${tag}_${suffix}@example.invalid`}, 'L2', 'Individual Access',
              ${status}, 1, ${termStart}::date, ${termEnd}::date, 'Test Org')
      returning id`
    ids[suffix] = row.id
  }
  const today = lagosToday()
  const shift = (days) => {
    const d = new Date(`${today}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + days)
    return d.toISOString().slice(0, 10)
  }

  before(async () => {
    await seat("current", "active", shift(-34), shift(42))
    await seat("startsToday", "active", today, shift(51))
    await seat("endsToday", "active", shift(-60), today)
    await seat("future", "active", shift(3), shift(90))
    await seat("ended", "active", shift(-90), shift(-1))
    await seat("suspended", "suspended", shift(-30), shift(30))
    await seat("noStart", "active", null, shift(30))
  })
  after(() => cleanup(tag))

  it("the driver returns raw date columns as Date objects, so the query must not", async () => {
    const [raw] = await sql`select term_end from subscribers where id = ${ids.current}::uuid`
    assert.ok(raw.term_end instanceof Date)
  })

  it("gives a current subscriber access, including on the first and last day", async () => {
    for (const key of ["current", "startsToday", "endsToday"]) {
      const s = await principal.loadSessionSubscriber(ids[key])
      assert.equal(s.hasAccess, true, key)
      assert.equal(s.subscription.state, "active", key)
      assert.match(s.termEnd, /^\d{4}-\d{2}-\d{2}$/, "term dates reach the page as the stored day")
    }
  })

  it("keeps expiry, suspension and future starts enforced", async () => {
    const state = async (key) => (await principal.loadSessionSubscriber(ids[key])).subscription.state
    assert.equal(await state("future"), "not_started")
    assert.equal(await state("ended"), "expired")
    assert.equal(await state("suspended"), "suspended")
    assert.equal(await state("noStart"), "term_missing")
    for (const key of ["future", "ended", "suspended", "noStart"]) {
      assert.equal((await principal.loadSessionSubscriber(ids[key])).hasAccess, false, key)
    }
  })

  it("the sign-in checks read the same term, by id and by email", async () => {
    const byId = await principal.readSubscriberTerm({ id: ids.current })
    assert.equal(byId.subscription.state, "active")
    assert.deepEqual(signInDecision(byId.subscription), { ok: true })
    const byEmail = await principal.readSubscriberTerm({ email: `${tag}_ended@example.invalid` })
    assert.deepEqual(signInDecision(byEmail.subscription), { ok: false, reason: "subscription-expired" })
    const suspended = await principal.readSubscriberTerm({ id: ids.suspended })
    assert.deepEqual(signInDecision(suspended.subscription), { ok: false, reason: "suspended" })
  })

  it("Admin's copy-link rule accepts a term end the driver returned as a Date", () => {
    const decision = decidePortalLinkCopy({
      subscriber: { subscriberId: "s1", clientType: "subscriber", status: "active", termEnd: neonDate("2026-11-11"), email: "a@example.invalid" },
      accessEmail: null,
      signInUrl: "https://example.invalid/portal/sign-in",
      now: new Date("2026-09-30T12:00:00Z"),
    })
    assert.notEqual(decision.reason, "This subscriber's term has ended, so the portal would refuse their sign-in.")
  })
})
