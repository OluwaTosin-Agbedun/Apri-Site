/**
 * Review emails tell the truth: what the provider said is recorded for the
 * owner, a refused or unsent email is never reported as "on its way", and
 * "delivered" appears only from the provider's own delivery event. The
 * provider here is a stand-in for Resend's HTTP API in front of the real SDK.
 * Invented data only; no real email is sent.
 */
import { describe, it, before, after, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import { existsSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { randomBytes } from "node:crypto"
import { sql, makeTag, cleanup } from "./helpers.mjs"

const SRC = fileURLToPath(new URL("../src/", import.meta.url))
const HEADERS = `
const jar = () => { globalThis.__jar ??= new Map(); return globalThis.__jar }
export async function cookies() { return { get: (n) => jar().has(n) ? { name: n, value: jar().get(n) } : undefined, set: (n, v, o = {}) => { if (o.maxAge === 0) jar().delete(n); else jar().set(n, v) }, delete: (n) => jar().delete(n) } }
export async function headers() { return new Headers() }
`
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true }
    if (specifier === "next/headers") return { url: `data:text/javascript,${encodeURIComponent(HEADERS)}`, shortCircuit: true }
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

// The provider stand-in: answers Resend's /emails endpoint as it would.
const provider = { mode: "accept", sent: [] }
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  if (new URL(url).hostname === "api.resend.com") {
    const body = JSON.parse(init?.body ?? "{}")
    provider.sent.push({ to: body.to, subject: body.subject })
    if (provider.mode === "accept") return new Response(JSON.stringify({ id: `msg_${provider.sent.length}_${tag}` }), { status: 200, headers: { "content-type": "application/json" } })
    return new Response(JSON.stringify({ statusCode: 403, name: "validation_error", message: "The sending domain is not verified." }), { status: 403, headers: { "content-type": "application/json" } })
  }
  return realFetch(input, init)
}

process.env.DATABASE_URL = process.env.APRI_TEST_DATABASE_URL
process.env.SESSION_SECRET = randomBytes(32).toString("hex")
process.env.APP_URL = "http://localhost:3002"

const email = await import("../src/lib/review-email.ts")
const attempts = await import("../src/lib/review-email-attempts.ts")
const readerActions = await import("../src/app/actions/review-reader.ts")
const tag = makeTag("mailtruth")
const APPROVED = `${tag}_ada@example.invalid`
const STRANGER = `${tag}_nobody@example.invalid`
const rowsFor = (address) => sql`select outcome, provider_message_id, detail, delivered_at from review_email_attempts where email = ${address} order by created_at desc`

before(async () => {
  await sql`insert into app_settings (key, value) values ('review_library_enabled', 'true') on conflict (key) do update set value = 'true'`
  const [e] = await sql`
    insert into review_publication_editions (series, title, edition_label, papermark_document_id, secure_link_id, secure_link_url,
      secure_link_document_id, secure_link_verified_at, publication_type, description, frequency, audience, publication_state,
      is_latest, recipient_mode, complimentary_featured, edition_sort_key)
    values ('AIU', ${`${tag} one`}, 'one', ${`${tag}_doc`}, ${`${tag}_l`}, ${`https://docs.example.invalid/view/${tag}`}, ${`${tag}_doc`}, now(),
      'Periodic Focused Briefing', 'Invented.', 'Periodic', 'Readers', 'published', false, 'edition', false, 'one')
    returning id`
  await sql`insert into review_edition_recipients (edition_id, email, source) values (${e.id}::uuid, ${APPROVED}, 'owner')`
  attempts.resetReviewEmailAttemptsCache()
})
after(async () => {
  globalThis.fetch = realFetch
  await sql`delete from review_email_attempts where email like ${`${tag}%`}`
  await sql`delete from review_reader_tokens where email like ${`${tag}%`}`
  await sql`delete from review_edition_recipients where email like ${`${tag}%`}`
  await sql`delete from review_publication_editions where title like ${`${tag}%`}`
  await cleanup(tag)
})
beforeEach(() => {
  provider.mode = "accept"
  process.env.RESEND_API_KEY = "re_test_not_real"
})

describe("what the provider said is recorded, and nothing more is claimed", () => {
  it("no email key: nothing is sent, the attempt says so, and the caller is told it failed", async () => {
    delete process.env.RESEND_API_KEY
    await assert.rejects(() => email.sendReviewLibrarySignIn(APPROVED, "http://localhost:3002/x", "12345678"), email.ReviewEmailNotSent)
    assert.equal((await rowsFor(APPROVED))[0].outcome, "not_configured")
  })

  it("accepted is recorded with the provider's id, and shown as accepted -- not delivered", async () => {
    await email.sendReviewLibrarySignIn(APPROVED, "http://localhost:3002/x", "12345678")
    const [row] = await rowsFor(APPROVED)
    assert.equal(row.outcome, "accepted")
    assert.match(row.provider_message_id, /^msg_/)
    assert.equal(attempts.attemptStatus({ outcome: "accepted", deliveredAt: null, bouncedAt: null, complainedAt: null, delayedAt: null, detail: null }), "Accepted by the email provider; no delivery report yet")
    const [stored] = await attempts.recentReviewEmailAttempts(1, APPROVED)
    assert.doesNotMatch(attempts.attemptStatus(stored), /Delivered/)
  })

  it("delivered appears only from the provider's signed delivery event", async () => {
    const [row] = await rowsFor(APPROVED)
    assert.equal(await attempts.applyReviewEmailEvent(row.provider_message_id, "email.delivered", new Date()), true)
    const [stored] = await attempts.recentReviewEmailAttempts(1, APPROVED)
    assert.match(attempts.attemptStatus(stored), /^Delivered/)
    assert.equal(await attempts.applyReviewEmailEvent("msg_unknown", "email.delivered", new Date()), false, "an event for another email changes nothing")
  })

  it("a refused email is recorded with the provider's reason, never as sent", async () => {
    provider.mode = "reject"
    await assert.rejects(() => email.sendReviewLibrarySignIn(APPROVED, "http://localhost:3002/x", "12345678"), email.ReviewEmailNotSent)
    const [row] = await rowsFor(APPROVED)
    assert.equal(row.outcome, "rejected")
    assert.match(row.detail, /not verified/)
    assert.doesNotMatch(row.detail, /@/, "no address in the stored reason")
  })
})

describe("the visitor is never told an unsent email is on its way", () => {
  it("an approved reader whose sign-in email is refused is told it could not be sent", async () => {
    provider.mode = "reject"
    const form = new FormData()
    form.set("email", APPROVED)
    const result = await readerActions.requestReviewLibrarySignIn(undefined, form)
    assert.equal(result.ok, undefined)
    assert.match(result.message, /could not send/i)
  })

  it("an unapproved address gets the neutral answer and no email is attempted", async () => {
    const before = provider.sent.length
    const form = new FormData()
    form.set("email", STRANGER)
    const result = await readerActions.requestReviewLibrarySignIn(undefined, form)
    assert.equal(result.ok, true)
    assert.equal(provider.sent.length, before)
    assert.equal((await rowsFor(STRANGER)).length, 0)
  })

  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
  it("the review request and Admin's access email report a failed send honestly", () => {
    const funnel = read("src/app/actions/review-funnel.ts")
    assert.match(funnel, /could not send the confirmation email just now/)
    assert.match(funnel, /The access email was not sent: \$\{reason\}\. Nothing was marked as sent/)
    assert.match(funnel, /Accepted by the email provider\. That is not proof of delivery/)
    assert.doesNotMatch(read("src/app/actions/review-reader.ts"), /on its way\. Please check your inbox\.", *\}\s*\}\s*$/)
  })
  it("provider delivery events for review emails reach the owner's record before any subscriber handling", () => {
    const hook = read("src/app/api/resend/webhook/route.ts")
    assert.ok(hook.indexOf("applyReviewEmailEvent(") < hook.indexOf("principalForResendEmail(emailId)"))
  })
})

describe("the normal reading route sends no APRI email", () => {
  it("opening the library for an approved address emails nothing and only routes", async () => {
    const before = provider.sent.length
    const form = new FormData()
    form.set("email", APPROVED)
    await assert.rejects(() => readerActions.openReviewLibrary(undefined, form), (e) => String(e?.digest ?? e?.message).includes("NEXT_REDIRECT"))
    assert.equal(provider.sent.length, before, "no APRI email in the normal flow")
    assert.ok(globalThis.__jar.has("apri_review_room"))
  })
  it("an unapproved address is told plainly that a request or confirmation is not approval, and gets no routing cookie", async () => {
    globalThis.__jar = new Map()
    const form = new FormData()
    form.set("email", STRANGER)
    const result = await readerActions.openReviewLibrary(undefined, form)
    assert.match(result.message, /does not give access by itself/)
    assert.equal(globalThis.__jar.has("apri_review_room"), false)
  })
})
