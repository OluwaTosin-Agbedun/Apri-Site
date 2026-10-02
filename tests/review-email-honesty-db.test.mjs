/**
 * Review emails tell the truth: what the provider said is recorded for the
 * owner, a refused or unsent email is never reported as "on its way", and
 * "delivered" appears only from the provider's own delivery event. The
 * provider here is a stand-in for Resend's HTTP API in front of the real SDK.
 * The Review Library's sign-in email carries one code and no link, and every
 * way it can fail is told apart. Invented data only; no real email is sent.
 */
import { describe, it, before, after, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { registerHooks, createRequire } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import { existsSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { randomBytes } from "node:crypto"
import { sql, makeTag, cleanup, hashToken } from "./helpers.mjs"

const SRC = fileURLToPath(new URL("../src/", import.meta.url))
const HEADERS = `
const jar = () => { globalThis.__jar ??= new Map(); return globalThis.__jar }
export async function cookies() { return { get: (n) => jar().has(n) ? { name: n, value: jar().get(n) } : undefined, set: (n, v, o = {}) => { if (o.maxAge === 0) jar().delete(n); else jar().set(n, v) }, delete: (n) => jar().delete(n) } }
export async function headers() { return new Headers(globalThis.__ip ? { "x-forwarded-for": globalThis.__ip } : {}) }
`
// next/server as the application sees it, except after(): outside a request
// Next throws, so work deferred until after the response is only collected
// here and never run (it would call Papermark).
const NEXT_SERVER = pathToFileURL(createRequire(import.meta.url).resolve("next/server.js")).href
const SERVER = `export * from ${JSON.stringify(NEXT_SERVER)}
export function after(task) { (globalThis.__afterTasks ??= []).push(task) }`
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true }
    if (specifier === "next/headers") return { url: `data:text/javascript,${encodeURIComponent(HEADERS)}`, shortCircuit: true }
    if (specifier === "next/server" && !context.parentURL?.includes("/node_modules/")) {
      return { url: `data:text/javascript,${encodeURIComponent(SERVER)}`, shortCircuit: true }
    }
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

// The provider stand-in: answers Resend's /emails endpoint as it would. It
// keeps every message it was handed, including the ones it refuses, so a test
// can prove a code from a failed attempt is useless even to whoever saw it.
const provider = { mode: "accept", sent: [] }
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  if (new URL(url).hostname === "api.resend.com") {
    const body = JSON.parse(init?.body ?? "{}")
    provider.sent.push({ to: [body.to].flat(), subject: body.subject ?? "", html: body.html ?? "", text: body.text ?? "" })
    const json = (status, value) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })
    if (provider.mode === "accept") return json(200, { id: `msg_${provider.sent.length}_${tag}` })
    if (provider.mode === "unknown") return json(500, { statusCode: 500, name: "internal_server_error", message: "An unexpected error occurred." })
    return json(403, { statusCode: 403, name: "validation_error", message: "The sending domain is not verified." })
  }
  return realFetch(input, init)
}

process.env.DATABASE_URL = process.env.APRI_TEST_DATABASE_URL
process.env.SESSION_SECRET = randomBytes(32).toString("hex")
// A site address is configured, so a link could be built: the sign-in email still carries none.
process.env.APP_URL = "http://localhost:3002"

const email = await import("../src/lib/review-email.ts")
const attempts = await import("../src/lib/review-email-attempts.ts")
const readerActions = await import("../src/app/actions/review-reader.ts")
const tag = makeTag("mailtruth")
const APPROVED = `${tag}_ada@example.invalid`
const STRANGER = `${tag}_nobody@example.invalid`
const rowsFor = (address) => sql`select outcome, provider_message_id, detail, delivered_at from review_email_attempts where email = ${address} order by created_at desc`
const unspentCodes = async (address) =>
  (await sql`select count(*)::int as n from review_reader_tokens where email = ${address} and consumed_at is null and expires_at > now()`)[0].n

// Each test asks from its own invented network address (IPv6 documentation
// range), so the per-network limit never decides a test about the per-address one.
const network = randomBytes(2).toString("hex")
const ips = []
const nextIp = () => {
  const ip = `2001:db8:${network}::${(ips.length + 1).toString(16)}`
  ips.push(ip)
  return ip
}
const addresses = [APPROVED, STRANGER]
let editionId

/** A further approved reader, so each test counts only its own emails and codes. */
async function approvedReader(name) {
  const address = `${tag}_${name}@example.invalid`
  await sql`insert into review_edition_recipients (edition_id, email, source) values (${editionId}::uuid, ${address}, 'owner')`
  addresses.push(address)
  return address
}

/** Runs a server action as the form would: { to } when it redirected, otherwise what it returned. */
async function act(action, fields) {
  const form = new FormData()
  for (const [name, value] of Object.entries(fields)) form.set(name, value)
  try {
    return await action(undefined, form)
  } catch (error) {
    const digest = String(error?.digest ?? "")
    if (!digest.startsWith("NEXT_REDIRECT;")) throw error
    return { to: digest.split(";").slice(2, -2).join(";") }
  }
}
const ask = (address) => act(readerActions.requestReviewLibrarySignIn, { email: address })
const typeCode = (address, code) => act(readerActions.reviewLibrarySignInWithCode, { email: address, code })
const lastEmailTo = (address) => provider.sent.filter((m) => m.to.includes(address)).at(-1)
/** The 8-digit code as the email prints it ("1234 5678"), digits only. */
const codeIn = (message) => {
  const found = message?.text.match(/\b(\d{4}) (\d{4})\b/)
  assert.ok(found, "the email carries a code")
  return found[1] + found[2]
}

before(async () => {
  await sql`insert into app_settings (key, value) values ('review_library_enabled', 'true') on conflict (key) do update set value = 'true'`
  const [e] = await sql`
    insert into review_publication_editions (series, title, edition_label, papermark_document_id, secure_link_id, secure_link_url,
      secure_link_document_id, secure_link_verified_at, publication_type, description, frequency, audience, publication_state,
      is_latest, recipient_mode, complimentary_featured, edition_sort_key)
    values ('AIU', ${`${tag} one`}, 'one', ${`${tag}_doc`}, ${`${tag}_l`}, ${`https://docs.example.invalid/view/${tag}`}, ${`${tag}_doc`}, now(),
      'Periodic Focused Briefing', 'Invented.', 'Periodic', 'Readers', 'published', false, 'edition', false, 'one')
    returning id`
  editionId = e.id
  await sql`insert into review_edition_recipients (edition_id, email, source) values (${e.id}::uuid, ${APPROVED}, 'owner')`
  attempts.resetReviewEmailAttemptsCache()
})
after(async () => {
  globalThis.fetch = realFetch
  const identities = [
    ...addresses.flatMap((a) => [hashToken(`signin:${a}`), hashToken(`reader:${a}`)]),
    ...ips.flatMap((ip) => [hashToken(`${process.env.SESSION_SECRET}:${ip}`), hashToken(`missing:${ip}`)]),
  ]
  await sql`delete from review_rate_limits where identity_hash = any(${identities}::text[])`
  await sql`delete from review_email_attempts where email like ${`${tag}%`}`
  await sql`delete from review_reader_events where email like ${`${tag}%`}`
  await sql`delete from review_reader_sessions where email like ${`${tag}%`}`
  await sql`delete from review_reader_tokens where email like ${`${tag}%`}`
  await sql`delete from review_edition_recipients where email like ${`${tag}%`}`
  await sql`delete from review_publication_editions where title like ${`${tag}%`}`
  await cleanup(tag)
})
beforeEach(() => {
  provider.mode = "accept"
  process.env.RESEND_API_KEY = "re_test_not_real"
  globalThis.__ip = nextIp()
  globalThis.__jar = new Map()
})

describe("what the provider said is recorded, and nothing more is claimed", () => {
  it("no email key: nothing is sent, the attempt says so, and the caller is told it failed", async () => {
    delete process.env.RESEND_API_KEY
    await assert.rejects(() => email.sendReviewLibrarySignIn(APPROVED, "12345678"), email.ReviewEmailNotSent)
    assert.equal((await rowsFor(APPROVED))[0].outcome, "not_configured")
  })

  it("accepted is recorded with the provider's id, and shown as accepted -- not delivered", async () => {
    await email.sendReviewLibrarySignIn(APPROVED, "12345678")
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
    await assert.rejects(() => email.sendReviewLibrarySignIn(APPROVED, "12345678"), email.ReviewEmailNotSent)
    const [row] = await rowsFor(APPROVED)
    assert.equal(row.outcome, "rejected")
    assert.match(row.detail, /not verified/)
    assert.doesNotMatch(row.detail, /@/, "no address in the stored reason")
  })
})

describe("the sign-in email carries one code and no link", () => {
  it("the code is in the text and HTML but not the subject; there is no link of any kind; only hashes are stored", async () => {
    const ada = await approvedReader("content")
    const result = await ask(ada.toUpperCase())
    assert.equal(result.ok, true)
    assert.match(result.message, /A sign-in code is on its way/)
    const mail = lastEmailTo(ada)
    assert.deepEqual(mail.to, [ada], "sent to the approved address itself")
    const code = codeIn(mail)
    assert.match(code, /^\d{8}$/)
    assert.ok(!JSON.stringify(result).includes(code), "the code is never shown to whoever typed the address")
    // Not in the subject, which lock screens and notification previews show.
    assert.ok(!mail.subject.replace(/s/g, "").includes(code), "the subject never shows the code")
    for (const [part, body] of Object.entries({ subject: mail.subject, html: mail.html, text: mail.text })) {
      if (part !== "subject") assert.ok(body.includes(`${code.slice(0, 4)} ${code.slice(4)}`), `${part} shows the code`)
      assert.doesNotMatch(body, /http/i, `${part} has no link`)
      assert.doesNotMatch(body, /\/verify|href=|www\.|token=/i, `${part} has no link`)
      assert.doesNotMatch(body, /[A-Za-z0-9_-]{40,}/, `${part} has no sign-in token`)
    }
    const [row] = await sql`select token_hash, code_hash, binding_hash from review_reader_tokens where email = ${ada} and consumed_at is null`
    assert.match(row.token_hash, /^[0-9a-f]{64}$/)
    assert.match(row.code_hash, /^[0-9a-f]{64}$/)
    assert.ok(!Object.values(row).some((v) => String(v).includes(code)), "the code itself is not in the database")
    assert.deepEqual(await typeCode(ada, code), { to: "/review/library" }, "and the code signs the reader in")
  })

  it("asking again issues a new code, and the previous code is refused", async () => {
    const ada = await approvedReader("resend")
    assert.equal((await ask(ada)).ok, true)
    const first = codeIn(lastEmailTo(ada))
    assert.equal((await ask(ada)).ok, true)
    const second = codeIn(lastEmailTo(ada))
    assert.notEqual(first, second)
    assert.equal(await unspentCodes(ada), 1, "only the latest code is live")
    const refused = await typeCode(ada, first)
    assert.equal(refused.to, undefined)
    assert.match(refused.message, /That code did not work/)
    assert.equal(globalThis.__jar.has("apri_review_reader"), false)
    assert.deepEqual(await typeCode(ada, second), { to: "/review/library" })
    assert.ok(globalThis.__jar.has("apri_review_reader"))
  })
})

describe("the visitor is never told an unsent email is on its way", () => {
  it("an unassigned address is told plainly it is not assigned, and no email is attempted", async () => {
    const before = provider.sent.length
    const result = await ask(STRANGER)
    assert.equal(result.ok, undefined)
    assert.match(result.message, /No Complimentary Review publications are assigned to that address/)
    assert.match(result.message, /does not give access by itself/)
    assert.equal(provider.sent.length, before)
    assert.equal((await rowsFor(STRANGER)).length, 0)
    assert.equal((await sql`select count(*)::int as n from review_reader_tokens where email = ${STRANGER}`)[0].n, 0, "no code is issued")
  })

  it("the provider refused it: the reader is told so, and that attempt's code never works", async () => {
    const ada = await approvedReader("refused")
    provider.mode = "reject"
    const result = await ask(ada)
    assert.equal(result.ok, undefined)
    assert.match(result.message, /Our email provider did not accept the sign-in email, so no code was sent/)
    assert.doesNotMatch(result.message, /on its way|not verified/, "no provider text reaches the reader")
    assert.equal((await rowsFor(ada))[0].outcome, "rejected")
    const code = codeIn(lastEmailTo(ada))
    assert.equal(await unspentCodes(ada), 0)
    provider.mode = "accept"
    assert.match((await typeCode(ada, code)).message, /That code did not work/)
    assert.equal(globalThis.__jar.has("apri_review_reader"), false)
  })

  it("the provider gave no clear answer: the reader is told it is unconfirmed, and that attempt's code never works", async () => {
    const ada = await approvedReader("unclear")
    provider.mode = "unknown"
    const result = await ask(ada)
    assert.equal(result.ok, undefined)
    assert.match(result.message, /We could not confirm that the code was sent/)
    assert.match(result.message, /the code from this attempt will not work/)
    assert.equal((await rowsFor(ada))[0].outcome, "unknown")
    // The provider may have delivered it after all; it must be useless.
    const code = codeIn(lastEmailTo(ada))
    assert.equal(await unspentCodes(ada), 0)
    assert.match((await typeCode(ada, code)).message, /That code did not work/)
    assert.equal(globalThis.__jar.has("apri_review_reader"), false)
  })

  it("email is not configured: the reader is told it is a configuration problem, nothing is sent and no code is left", async () => {
    const ada = await approvedReader("unconfigured")
    delete process.env.RESEND_API_KEY
    const before = provider.sent.length
    const result = await ask(ada)
    assert.equal(result.ok, undefined)
    assert.match(result.message, /Sign-in emails cannot be sent at the moment because of a configuration problem on APRI's side/)
    assert.equal(provider.sent.length, before)
    assert.equal((await rowsFor(ada))[0].outcome, "not_configured")
    assert.equal(await unspentCodes(ada), 0, "the code was never handed over, and it is spent")
  })

  it("a problem on APRI's side is told apart from a problem with the address, and recorded for the owner", async () => {
    const ada = await approvedReader("apriside")
    const secret = process.env.SESSION_SECRET
    const before = provider.sent.length
    let result
    try {
      delete process.env.SESSION_SECRET
      result = await ask(ada)
    } finally {
      process.env.SESSION_SECRET = secret
    }
    assert.equal(result.ok, undefined)
    assert.match(result.message, /a problem on APRI's side, not with your address/)
    assert.equal(provider.sent.length, before)
    const [row] = await rowsFor(ada)
    assert.equal(row.outcome, "not_configured")
    assert.match(row.detail, /could not be prepared/)
    assert.equal((await sql`select count(*)::int as n from review_reader_tokens where email = ${ada}`)[0].n, 0)
  })

  it("the sixth request for one address within an hour is refused without sending, from any network", async () => {
    const ada = await approvedReader("limit")
    for (let i = 1; i <= 5; i++) assert.equal((await ask(ada)).ok, true, `request ${i}`)
    const latest = codeIn(lastEmailTo(ada))
    const sent = provider.sent.length
    globalThis.__ip = nextIp()
    const refused = await ask(ada)
    assert.equal(refused.ok, undefined)
    assert.match(refused.message, /Several codes have already been sent to this address in the last hour/)
    assert.equal(provider.sent.length, sent, "no sixth email")
    assert.equal((await rowsFor(ada)).length, 5, "no sixth attempt")
    assert.deepEqual(await typeCode(ada, latest), { to: "/review/library" }, "the latest code still works")
    // An hour later the address may ask again.
    await sql`update review_rate_limits set created_at = now() - interval '61 minutes'
      where action = 'review_library_code_sent' and identity_hash = ${hashToken(`signin:${ada}`)}`
    globalThis.__ip = nextIp()
    assert.equal((await ask(ada)).ok, true)
  })

  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
  it("the review request and Admin's access email report a failed send honestly", () => {
    const funnel = read("src/app/actions/review-funnel.ts")
    assert.match(funnel, /could not send the confirmation email just now/)
    assert.match(funnel, /The access email was not sent: \$\{reason\}\. Nothing was marked as sent/)
    assert.match(funnel, /Accepted by the email provider\. That is not proof of delivery/)
    const actions = read("src/app/actions/review-reader.ts")
    const request = actions.slice(actions.indexOf("export async function requestReviewLibrarySignIn"), actions.indexOf("export async function reviewLibrarySignInWithCode"))
    assert.ok(request.indexOf("await sendReviewLibrarySignIn(") > 0)
    assert.ok(request.indexOf("on its way") > request.indexOf("await sendReviewLibrarySignIn("), "'on its way' only after the provider accepted the email")
  })
  it("provider delivery events for review emails reach the owner's record before any subscriber handling", () => {
    const hook = read("src/app/api/resend/webhook/route.ts")
    assert.ok(hook.indexOf("applyReviewEmailEvent(") < hook.indexOf("principalForResendEmail(emailId)"))
  })
})
