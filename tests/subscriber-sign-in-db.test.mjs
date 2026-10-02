/**
 * Subscriber sign-in lands in the browser the subscriber uses, and stays.
 *
 * The incident: a session was created in whichever browser opened the emailed
 * link -- usually an email app's own browser -- so the subscriber's browser
 * never held one and every return asked for email again. These tests run the
 * real sign-in code against the test database, with each "browser" a separate
 * cookie jar standing in for Next's cookie store. Invented data only.
 */
import { describe, it, before, after, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import { existsSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { createHash, randomBytes } from "node:crypto"
import { sql, makeTag, cleanup, makeSeat } from "./helpers.mjs"
import { createSchemaDatabase, applyMigration } from "./support/test-database.mjs"

// Each browser is its own cookie jar; next/headers reads the current one.
globalThis.__jars = new Map()
globalThis.__browser = "none"
const HEADERS = `
const jar = () => { const j = globalThis.__jars; if (!j.has(globalThis.__browser)) j.set(globalThis.__browser, new Map()); return j.get(globalThis.__browser) }
export async function cookies() {
  if (globalThis.__cookiesFail) throw new Error("cookie store unavailable")
  return {
    get: (name) => (jar().has(name) ? { name, value: jar().get(name).value } : undefined),
    set: (name, value, options = {}) => { if (options.maxAge === 0) jar().delete(name); else jar().set(name, { value, options }) },
    delete: (name) => { jar().delete(name) },
  }
}
export async function headers() { return new Headers() }
`
const SRC = fileURLToPath(new URL("../src/", import.meta.url))
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

process.env.DATABASE_URL = process.env.APRI_TEST_DATABASE_URL
process.env.SESSION_SECRET = randomBytes(32).toString("hex")

const magic = await import("../src/lib/magic-link.ts")
const token = await import("../src/lib/magic-token.ts")
const session = await import("../src/lib/subscriber-session.ts")
const sessionToken = await import("../src/lib/subscriber-session-token.ts")
const principal = await import("../src/lib/subscriber-principal.ts")
const admin = await import("../src/lib/subscriber-session-admin.ts")
const adminSession = await import("../src/lib/session.ts")
const { resetSignInSchemaCache } = await import("../src/lib/sign-in-schema.ts")

const tag = makeTag("signin")
const use = (name) => { globalThis.__browser = name }
const cookieIn = (name, cookie) => globalThis.__jars.get(name)?.get(cookie)?.value
const sha = (v) => createHash("sha256").update(v).digest("hex")

/** What the sign-in page does for the browser that asks: a marker cookie, its hash on the link. */
async function askFor(seat, browser) {
  use(browser)
  const pending = randomBytes(32).toString("base64url")
  globalThis.__jars.get(browser)?.clear()
  const store = await (await import("next/headers")).cookies()
  store.set("apri_signin_pending", pending, {})
  const link = await magic.issueToken(seat.id, { bindingHash: sha(pending) })
  return { link, code: await magic.signInCodeFor(link), pending }
}

/** The portal's own check for the browser now in use. */
async function portalSees(browser) {
  use(browser)
  const claims = await session.readSubscriberSession()
  if (!claims) return null
  return principal.loadSessionSubscriber(claims.principalId, { sid: claims.sid, iat: claims.iat })
}

describe("the sign-in migration", () => {
  it("is additive and re-runs cleanly", async () => {
    const FILE = "20261007_subscriber_sign_in_sessions.sql"
    const db = await createSchemaDatabase({ skipMigrations: [FILE] })
    await applyMigration(db, FILE)
    await applyMigration(db, FILE)
    const { rows } = await db.query(`select column_name from information_schema.columns
      where table_name = 'auth_tokens' and column_name in ('code_hash','code_attempts','binding_hash') order by 1`)
    assert.deepEqual(rows.map((r) => r.column_name), ["binding_hash", "code_attempts", "code_hash"])
    const { rows: t } = await db.query(`select to_regclass('public.subscriber_sessions') is not null as ok`)
    assert.equal(t[0].ok, true)
    await db.close()
  })

  it("has a rollback", () => {
    assert.match(readFileSync(new URL("../db/rollback/20261007_subscriber_sign_in_sessions.rollback.sql", import.meta.url), "utf8"), /drop table if exists subscriber_sessions/)
  })
})

describe("the 8-digit code", () => {
  it("is fixed by the link and the server key, and only a keyed hash is stored", () => {
    const secret = "s".repeat(40)
    const a = token.deriveSignInCode("link-a", secret)
    assert.match(a, /^\d{8}$/)
    assert.equal(token.deriveSignInCode("link-a", secret), a)
    assert.notEqual(token.deriveSignInCode("link-b", secret), a)
    assert.notEqual(token.deriveSignInCode("link-a", "t".repeat(40)), a)
    assert.notEqual(token.signInCodeHash("h", a, secret), token.signInCodeHash("h", a, "t".repeat(40)), "a database read alone cannot test codes")
    assert.equal(token.normaliseSignInCode(" 1234 5678 "), "12345678")
    assert.equal(token.normaliseSignInCode("1234567"), null)
    assert.equal(token.formatSignInCode("12345678"), "1234 5678")
  })
})

describe("signing in lands in the browser that is used, and stays", () => {
  let seat, other
  before(async () => {
    resetSignInSchemaCache()
    seat = await makeSeat(tag, { suffix: "reader" })
    other = await makeSeat(tag, { suffix: "other" })
  })
  after(() => cleanup(tag))
  beforeEach(() => { globalThis.__cookiesFail = false })

  it("the asking browser's own click on the link signs in at once; another browser must confirm", async () => {
    const { link, pending } = await askFor(seat, "laptop")
    assert.deepEqual(await magic.inspectToken(link, sha(pending)), { usable: true, sameBrowser: true })
    assert.deepEqual(await magic.inspectToken(link, null), { usable: true, sameBrowser: false }, "the email app's browser holds no marker")
    assert.deepEqual(await magic.inspectToken(link, sha("someone else")), { usable: true, sameBrowser: false })
    const [row] = await sql`select consumed_at from auth_tokens where token_hash = ${sha(link)}`
    assert.equal(row.consumed_at, null, "looking at a link never spends it, so a mail scanner cannot")
  })

  it("a link sets a recorded session in that browser, which the next visit accepts", async () => {
    const { link } = await askFor(seat, "laptop")
    use("laptop")
    assert.deepEqual(await magic.signInWithToken(link), { ok: true, principalType: "subscriber" })
    const cookie = cookieIn("laptop", "apri_subscriber")
    assert.ok(cookie, "the browser that used the link holds the session cookie")
    const opts = globalThis.__jars.get("laptop").get("apri_subscriber").options
    assert.equal(opts.httpOnly, true)
    assert.equal(opts.sameSite, "lax")
    assert.equal(opts.path, "/")
    assert.equal(opts.maxAge, 60 * 60 * 24 * 90)
    const claims = await sessionToken.verifySubscriberSession(cookie)
    assert.equal(claims.principalId, seat.id)
    assert.match(claims.sid, /^[0-9a-f-]{36}$/)
    const [rec] = await sql`select method, revoked_at from subscriber_sessions where id = ${claims.sid}::uuid`
    assert.deepEqual(rec, { method: "link", revoked_at: null })
    // Later visits, in the same browser: accepted with no email.
    assert.equal((await portalSees("laptop"))?.id, seat.id)
    assert.equal((await portalSees("laptop"))?.hasAccess, true)
    // A different browser has nothing.
    assert.equal(await portalSees("private-window"), null)
    // The link works once.
    use("laptop")
    assert.deepEqual(await magic.signInWithToken(link), { ok: false, reason: "used" })
  })

  it("the code signs in the browser it is typed into, even when the email app opened the link elsewhere", async () => {
    const { link, code } = await askFor(seat, "phone-safari")
    assert.match(code, /^\d{8}$/)
    use("phone-safari")
    const result = await magic.signInWithCode(seat.email.toUpperCase(), token.formatSignInCode(code))
    assert.deepEqual(result, { ok: true, principalType: "subscriber" })
    assert.equal((await portalSees("phone-safari"))?.id, seat.id, "Safari now returns straight to the library")
    assert.equal(await portalSees("gmail-in-app"), null)
    use("gmail-in-app")
    assert.deepEqual(await magic.signInWithToken(link), { ok: false, reason: "used" }, "a code and its link open one session between them")
    const claims = await sessionToken.verifySubscriberSession(cookieIn("phone-safari", "apri_subscriber"))
    const [rec] = await sql`select method from subscriber_sessions where id = ${claims.sid}::uuid`
    assert.equal(rec.method, "code")
  })

  it("a wrong code never signs in, counts against the link, and five wrong tries end the code", async () => {
    const { code } = await askFor(seat, "tablet")
    const wrong = code === "00000000" ? "11111111" : "00000000"
    use("tablet")
    for (let i = 0; i < 5; i++) assert.deepEqual(await magic.signInWithCode(seat.email, wrong), { ok: false, reason: "invalid" })
    assert.deepEqual(await magic.signInWithCode(seat.email, code), { ok: false, reason: "invalid" }, "the right code no longer works")
    assert.equal(cookieIn("tablet", "apri_subscriber"), undefined)
  })

  it("a code works only for its own address, and never for an unknown one", async () => {
    const { code } = await askFor(seat, "desk")
    use("desk")
    assert.deepEqual(await magic.signInWithCode(other.email, code), { ok: false, reason: "invalid" })
    assert.deepEqual(await magic.signInWithCode(`${tag}_nobody@example.invalid`, code), { ok: false, reason: "invalid" })
    assert.deepEqual(await magic.signInWithCode(seat.email, code), { ok: true, principalType: "subscriber" })
  })

  it("an expired link and its code are refused", async () => {
    const { link, code } = await askFor(seat, "old")
    await sql`update auth_tokens set expires_at = now() - interval '1 minute' where token_hash = ${sha(link)}`
    assert.deepEqual(await magic.inspectToken(link, null), { usable: false, reason: "expired" })
    use("old")
    assert.deepEqual(await magic.signInWithCode(seat.email, code), { ok: false, reason: "invalid" })
    assert.deepEqual(await magic.signInWithToken(link), { ok: false, reason: "expired" })
  })

  it("if the session cannot be opened after the link is spent, the link is put back and says so", async () => {
    const { link, code } = await askFor(seat, "flaky")
    use("flaky")
    globalThis.__cookiesFail = true
    assert.deepEqual(await magic.signInWithToken(link), { ok: false, reason: "session-failed" })
    globalThis.__cookiesFail = false
    assert.deepEqual(await magic.inspectToken(link, null), { usable: true, sameBrowser: false }, "the same link still works")
    globalThis.__cookiesFail = true
    assert.deepEqual(await magic.signInWithCode(seat.email, code), { ok: false, reason: "session-failed" })
    globalThis.__cookiesFail = false
    assert.deepEqual(await magic.signInWithCode(seat.email, code), { ok: true, principalType: "subscriber" }, "and so does the code")
  })

  it("signing out ends that browser's session on the server, and only that one", async () => {
    const a = await askFor(seat, "home")
    use("home")
    await magic.signInWithToken(a.link)
    const b = await askFor(seat, "office")
    use("office")
    await magic.signInWithToken(b.link)
    const copied = cookieIn("home", "apri_subscriber")
    use("home")
    await session.destroySubscriberSession()
    assert.equal(cookieIn("home", "apri_subscriber"), undefined)
    assert.equal(await portalSees("home"), null)
    // A copy of the signed-out cookie is refused too.
    globalThis.__jars.set("copy", new Map([["apri_subscriber", { value: copied, options: {} }]]))
    assert.equal(await portalSees("copy"), null)
    assert.equal((await portalSees("office"))?.id, seat.id, "the other browser stays signed in")
  })

  it("Admin's sign-out of all browsers ends recorded and older cookies alike", async () => {
    const a = await askFor(other, "o1")
    use("o1")
    await magic.signInWithToken(a.link)
    // A cookie from before sessions were recorded: no session id.
    const legacy = await sessionToken.signSubscriberSession({ principalId: other.id })
    globalThis.__jars.set("legacy", new Map([["apri_subscriber", { value: legacy, options: {} }]]))
    assert.equal((await portalSees("legacy"))?.id, other.id, "older cookies keep working until they expire")
    assert.equal((await admin.loadSessionSummary(other.id)).open, 1)
    await new Promise((r) => setTimeout(r, 1100))
    assert.equal(await admin.revokeAllSessions(other.id), 1)
    assert.equal(await portalSees("o1"), null)
    assert.equal(await portalSees("legacy"), null)
    assert.equal((await admin.loadSessionSummary(other.id)).open, 0)
    // Signing in again afterwards works.
    const again = await askFor(other, "o1")
    use("o1")
    await magic.signInWithToken(again.link)
    assert.equal((await portalSees("o1"))?.id, other.id)
  })

  it("suspension and an ended term deny the library on the very next request", async () => {
    const { link } = await askFor(seat, "susp")
    use("susp")
    await magic.signInWithToken(link)
    await sql`update subscribers set status = 'suspended' where id = ${seat.id}::uuid`
    assert.equal((await portalSees("susp")).hasAccess, false)
    await sql`update subscribers set status = 'active', term_end = current_date - 1 where id = ${seat.id}::uuid`
    assert.equal((await portalSees("susp")).hasAccess, false)
    assert.equal((await portalSees("susp")).subscription.state, "expired")
    await sql`update subscribers set term_end = current_date + 90 where id = ${seat.id}::uuid`
    assert.equal((await portalSees("susp")).hasAccess, true)
    // A suspended seat cannot sign in with a code either.
    const fresh = await askFor(seat, "susp2")
    await sql`update subscribers set status = 'suspended' where id = ${seat.id}::uuid`
    use("susp2")
    assert.deepEqual(await magic.signInWithCode(seat.email, fresh.code), { ok: false, reason: "suspended" })
    await sql`update subscribers set status = 'active' where id = ${seat.id}::uuid`
  })

  it("a forged, tampered or other-purpose cookie is not a session", async () => {
    const real = await sessionToken.signSubscriberSession({ principalId: seat.id })
    assert.equal(await sessionToken.verifySubscriberSession(real.slice(0, -2) + "xx"), null)
    assert.equal(await sessionToken.verifySubscriberSession("not.a.jwt"), null)
    assert.equal(await adminSession.decrypt(real), null, "a subscriber cookie is never an admin session")
    const someoneElse = await sessionToken.signSubscriberSession({ principalId: other.id, sid: "00000000-0000-4000-8000-000000000000" })
    globalThis.__jars.set("forged", new Map([["apri_subscriber", { value: someoneElse, options: {} }]]))
    assert.equal(await portalSees("forged"), null, "a session id that is not theirs is refused")
  })

  it("renews a recorded session once a day while in use, never a pre-release cookie", () => {
    const now = Math.floor(Date.now() / 1000)
    assert.equal(sessionToken.shouldRenew({ principalId: "x", principalType: "subscriber", sid: "s", iat: now - 3600 }, now), false)
    assert.equal(sessionToken.shouldRenew({ principalId: "x", principalType: "subscriber", sid: "s", iat: now - 90000 }, now), true)
    assert.equal(sessionToken.shouldRenew({ principalId: "x", principalType: "subscriber", iat: now - 90000 }, now), false)
  })
})

describe("the wiring", () => {
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
  it("the link route signs in at once only for the asking browser and otherwise asks to confirm", () => {
    const route = read("src/app/portal/verify/route.ts")
    assert.match(route, /inspectToken\(token, pending \? hashToken\(pending\) : null\)/)
    assert.match(route, /if \(!state\.sameBrowser\)[\s\S]*?LINK_COOKIE[\s\S]*?\/portal\/verify\/continue/)
  })
  it("the sign-in page sends only a fully valid session to the library, so a signed-out cookie cannot loop", () => {
    assert.match(read("src/lib/subscriber-dal.ts"), /export async function hasPortalSession\(\): Promise<boolean> \{\s*return \(await getCurrentSubscriber\(\)\) !== null/)
  })
  it("asking for an email marks the asking browser whether or not the address is known", () => {
    const actions = read("src/app/actions/subscriber-auth.ts")
    const fn = actions.slice(actions.indexOf("export async function requestSignInLink"), actions.indexOf("export async function subscriberSignOut"))
    assert.ok(fn.indexOf("PENDING_COOKIE") < fn.indexOf("readSubscriberTerm"), "set before the address is looked up")
  })
  it("the proxy renews only page views, never a sign-out post or the sign-in steps", () => {
    const proxy = read("proxy.ts")
    assert.match(proxy, /req\.method !== 'GET'/)
    assert.match(proxy, /startsWith\('\/portal\/verify'\)/)
    assert.match(proxy, /matcher: \['\/admin', '\/admin\/:path\*', '\/portal', '\/portal\/:path\*'\]/)
  })
})
