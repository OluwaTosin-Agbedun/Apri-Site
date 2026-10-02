/**
 * The remembered Complimentary Review Library, against the test database.
 * Two invented readers with different edition sets; each "browser" is its own
 * cookie jar standing in for Next's cookie store. Sign-in is one emailed code
 * typed into the browser, then 24 hours on that browser, checked server-side.
 * No real Papermark link is read or changed. Invented data only.
 */
import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { registerHooks, createRequire } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join, dirname, relative } from "node:path"
import { randomBytes } from "node:crypto"
import { sql, makeTag, cleanup, makeSeat, hashToken } from "./helpers.mjs"
import { createSchemaDatabase, applyMigration } from "./support/test-database.mjs"

globalThis.__jars = new Map()
globalThis.__browser = "none"
const HEADERS = `
const jar = () => { const j = globalThis.__jars; if (!j.has(globalThis.__browser)) j.set(globalThis.__browser, new Map()); return j.get(globalThis.__browser) }
export async function cookies() {
  return {
    get: (name) => (jar().has(name) ? { name, value: jar().get(name).value } : undefined),
    set: (name, value, options = {}) => { if (options.maxAge === 0) jar().delete(name); else jar().set(name, { value, options }) },
    delete: (name) => { jar().delete(name) },
  }
}
export async function headers() { return new Headers() }
`
// next/server as the application sees it, except after(): outside a request
// Next throws, so work deferred until after the response is only collected
// here and never run (it would call Papermark).
const NEXT_SERVER = pathToFileURL(createRequire(import.meta.url).resolve("next/server.js")).href
const SERVER = `export * from ${JSON.stringify(NEXT_SERVER)}
export function after(task) { (globalThis.__afterTasks ??= []).push(task) }`
const SRC = fileURLToPath(new URL("../src/", import.meta.url))
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

process.env.DATABASE_URL = process.env.APRI_TEST_DATABASE_URL
process.env.SESSION_SECRET = randomBytes(32).toString("hex")

const reader = await import("../src/lib/review-reader.ts")
const pubs = await import("../src/lib/publications.ts")
const subscriberToken = await import("../src/lib/subscriber-session-token.ts")
const actions = await import("../src/app/actions/review-reader.ts")
const verifyRoute = await import("../src/app/review/library/verify/route.ts")
const readRoute = await import("../src/app/review/read/route.ts")
const openRoute = await import("../src/app/review/library/open/[id]/route.ts")
const tag = makeTag("reviewlib")
const A = `${tag}_ada@example.invalid`
const B = `${tag}_bola@example.invalid`
const NOBODY = `${tag}_nobody@example.invalid`
const SITE = "http://localhost:3002"
const DAY_SECONDS = 60 * 60 * 24
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const use = (name) => { globalThis.__browser = name }
const jarOf = (name) => globalThis.__jars.get(name) ?? new Map()
const ed = {}

async function edition(key, state = "published", featured = false) {
  const [row] = await sql`
    insert into review_publication_editions (series, title, edition_label, papermark_document_id, secure_link_id, secure_link_url,
        secure_link_document_id, secure_link_verified_at, publication_type, description, frequency, audience, publication_state,
        is_latest, recipient_mode, complimentary_featured, edition_sort_key, withdrawal_state, withdrawal_link_id)
    values ('MIN', ${`${tag} ${key}`}, ${key}, ${`${tag}_doc_${key}`}, ${state === "published" ? `${tag}_link_${key}` : null},
        ${state === "published" ? `https://docs.example.invalid/view/${tag}_${key}` : ""}, ${`${tag}_doc_${key}`},
        ${state === "published" ? new Date() : null}, 'Monthly Intelligence Note', 'Invented.', 'Monthly', 'Readers', ${state},
        false, 'edition', ${featured}, ${key},
        ${state === "withdrawn" ? "revoking" : null}, ${state === "withdrawn" ? `${tag}_old_${key}` : null})
    returning id`
  ed[key] = row.id
}
const grant = (key, email) => sql`insert into review_edition_recipients (edition_id, email, source) values (${ed[key]}::uuid, ${email}, 'owner')`
const ids = (cards) => cards.map((c) => c.id).sort()

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
const spaced = (code) => `${code.slice(0, 4)} ${code.slice(4)}`
/** Any 8-digit code other than the right one. */
const wrongCode = (code) => String((Number(code) + 1) % 100_000_000).padStart(8, "0")
const location = (response) => {
  const url = new URL(response.headers.get("location"))
  return url.origin === SITE ? `${url.pathname}${url.search}` : url.href
}
const jwtPayload = (cookie) => JSON.parse(Buffer.from(cookie.split(".")[1], "base64url").toString("utf8"))

before(async () => {
  await sql`insert into app_settings (key, value) values ('review_library_enabled', 'true') on conflict (key) do update set value = 'true'`
  reader.resetReviewReaderSchemaCache()
  await edition("one")
  await edition("two")
  await edition("three")
  await edition("withdrawn", "withdrawn", false)
  await edition("draft", "draft", false)
  for (const k of ["one", "two", "withdrawn", "draft"]) await grant(k, A)
  await grant("three", B)
})
after(async () => {
  const identities = [A, B, NOBODY].flatMap((e) => [hashToken(`signin:${e}`), hashToken(`reader:${e}`)])
  identities.push(hashToken(`${process.env.SESSION_SECRET}:unknown`))
  await sql`delete from review_rate_limits where identity_hash = any(${identities}::text[])`
  await sql`delete from review_reader_events where email like ${`${tag}%`}`
  await sql`delete from review_reader_sessions where email like ${`${tag}%`}`
  await sql`delete from review_reader_tokens where email like ${`${tag}%`}`
  await sql`delete from review_edition_recipients where email like ${`${tag}%`}`
  await sql`delete from review_publication_editions where title like ${`${tag}%`}`
  await sql`delete from app_settings where key = 'review_entry_mode'`
  await cleanup(tag)
})

describe("the review reader migrations", () => {
  it("are additive and re-run cleanly, and the open-window rollback removes only its own columns", async () => {
    const FILE = "20261008_review_reader_library.sql"
    const WINDOW = "20261011_review_reader_open_window.sql"
    const db = await createSchemaDatabase({ skipMigrations: [FILE, WINDOW] })
    await applyMigration(db, FILE)
    await applyMigration(db, FILE)
    const { rows } = await db.query(`select to_regclass('public.review_reader_sessions') is not null and to_regclass('public.review_reader_tokens') is not null and to_regclass('public.review_reader_events') is not null as ok`)
    assert.equal(rows[0].ok, true)
    assert.match(readFileSync(new URL("../db/rollback/20261008_review_reader_library.rollback.sql", import.meta.url), "utf8"), /drop table if exists review_reader_sessions/)

    const windowColumns = async () =>
      (await db.query(`select column_name from information_schema.columns where table_name = 'review_reader_rooms'
        and column_name in ('link_open_until', 'room_documents') order by column_name`)).rows.map((r) => r.column_name)
    const roomColumns = async () => (await db.query(`select count(*)::int as n from information_schema.columns where table_name = 'review_reader_rooms'`)).rows[0].n
    assert.deepEqual(await windowColumns(), [])
    const before = await roomColumns()
    await applyMigration(db, WINDOW)
    await applyMigration(db, WINDOW)
    assert.deepEqual(await windowColumns(), ["link_open_until", "room_documents"])
    assert.equal(await roomColumns(), before + 2)
    await db.exec(readFileSync(new URL(`../db/rollback/20261011_review_reader_open_window.rollback.sql`, import.meta.url), "utf8"))
    assert.deepEqual(await windowColumns(), [])
    assert.equal(await roomColumns(), before, "the rollback leaves every other column of review_reader_rooms")
    await db.close()
  })
})

describe("each reader sees all and only their own published editions", () => {
  it("two readers with different sets", async () => {
    assert.deepEqual(ids(await pubs.getReviewLibraryForEmail(A)), [ed.one, ed.two].sort())
    assert.deepEqual(ids(await pubs.getReviewLibraryForEmail(B.toUpperCase())), [ed.three])
    assert.deepEqual(await pubs.getReviewLibraryForEmail(NOBODY), [])
  })

  it("withdrawn and draft editions are never listed or opened, even for their recipients", async () => {
    assert.equal(await pubs.getReviewEditionForEmail(A, ed.withdrawn), null)
    assert.equal(await pubs.getReviewEditionForEmail(A, ed.draft), null)
    assert.equal((await pubs.getReviewEditionForEmail(A, ed.one))?.id, ed.one)
  })

  it("guessing another reader's edition, a random id or a malformed id opens nothing", async () => {
    assert.equal(await pubs.getReviewEditionForEmail(B, ed.one), null)
    assert.equal(await pubs.getReviewEditionForEmail(A, ed.three), null)
    assert.equal(await pubs.getReviewEditionForEmail(A, "00000000-0000-4000-8000-000000000000"), null)
    assert.equal(await pubs.getReviewEditionForEmail(A, "' or 1=1 --"), null)
  })

  it("removing a recipient or withdrawing an edition takes effect on the very next request", async () => {
    await sql`update review_edition_recipients set revoked_at = now() where edition_id = ${ed.two}::uuid and email = ${A}`
    assert.deepEqual(ids(await pubs.getReviewLibraryForEmail(A)), [ed.one])
    assert.equal(await pubs.getReviewEditionForEmail(A, ed.two), null)
    await grant("two", A)
    await sql`update review_publication_editions set publication_state = 'withdrawn', withdrawal_state = 'revoking', withdrawal_link_id = secure_link_id where id = ${ed.two}::uuid`
    assert.equal(await pubs.getReviewEditionForEmail(A, ed.two), null)
    await sql`update review_publication_editions set publication_state = 'published', withdrawal_state = null where id = ${ed.two}::uuid`
    assert.equal((await pubs.getReviewEditionForEmail(A, ed.two))?.id, ed.two)
  })
})

describe("one code, then 24 hours on the same browser", () => {
  it("the right code signs this browser in; later visits need no code; another browser has nothing", async () => {
    use("laptop")
    const { code } = await reader.issueReaderSignIn(A, null)
    const signedIn = await act(actions.reviewLibrarySignInWithCode, { email: A.toUpperCase(), code: spaced(code), edition: ed.one })
    assert.deepEqual(signedIn, { to: `/review/library?edition=${ed.one}` }, "back to the library, with the chosen edition marked")
    const cookie = jarOf("laptop").get("apri_review_reader")
    assert.ok(cookie)
    assert.equal(cookie.options.path, "/review")
    assert.equal(cookie.options.httpOnly, true)
    assert.equal(cookie.options.sameSite, "lax")
    assert.equal(cookie.options.maxAge, DAY_SECONDS)
    const claims = jwtPayload(cookie.value)
    assert.equal(claims.exp - claims.iat, DAY_SECONDS, "the signed cookie itself lapses after 24 hours")
    assert.equal(claims.aud, "review-reader")

    const first = await reader.currentReviewReader()
    assert.equal(first?.email, A)
    assert.match(first.sid, UUID)
    const [session] = await sql`select method, created_at from review_reader_sessions where id = ${first.sid}::uuid`
    assert.equal(session.method, "code")
    assert.equal(first.until, new Date(new Date(session.created_at).getTime() + DAY_SECONDS * 1000).toISOString(), "open until 24 hours after the code")
    assert.equal((await reader.currentReviewReader())?.email, A, "a second visit, no code")

    use("other-browser")
    assert.equal(await reader.currentReviewReader(), null, "another browser, with an empty cookie jar, has nothing")
    use("phone")
    const again = await act(actions.reviewLibrarySignInWithCode, { email: A, code })
    assert.equal(again.to, undefined, "a code works once")
    assert.match(again.message, /That code did not work/)
    assert.equal(await reader.currentReviewReader(), null)
    use("laptop")
    assert.equal((await reader.currentReviewReader())?.email, A)
  })

  it("the code signs in only the browser it is typed into, and the redirect never leaves the library", async () => {
    const { code } = await reader.issueReaderSignIn(B, null)
    use("tablet")
    assert.deepEqual(await act(actions.reviewLibrarySignInWithCode, { email: B, code, edition: "//evil.example.invalid/x" }), { to: "/review/library" })
    assert.equal((await reader.currentReviewReader())?.email, B)
    use("laptop")
    assert.equal((await reader.currentReviewReader())?.email, A, "the laptop is still Ada's, not Bola's")
  })

  it("a wrong code is refused and counts an attempt; five wrong tries spend the code", async () => {
    use("wrong-code")
    const { code } = await reader.issueReaderSignIn(B, null)
    const wrong = wrongCode(code)
    const refused = await act(actions.reviewLibrarySignInWithCode, { email: B, code: wrong })
    assert.equal(refused.to, undefined)
    assert.match(refused.message, /That code did not work/)
    assert.equal(await reader.currentReviewReader(), null)
    const [token] = await sql`select code_attempts from review_reader_tokens where email = ${B} and consumed_at is null`
    assert.equal(token.code_attempts, 1, "the attempt is counted against the code")
    const [failures] = await sql`select count(*)::int as n from review_rate_limits
      where action = 'review_reader_code_failed' and identity_hash = ${hashToken(`reader:${B}`)}`
    assert.equal(failures.n, 1, "and against the address, for the daily limit")
    for (let i = 0; i < 4; i++) assert.deepEqual(await reader.signInReaderWithCode(B, wrong), { ok: false, reason: "invalid" })
    assert.deepEqual(await reader.signInReaderWithCode(B, code), { ok: false, reason: "invalid" }, "after five wrong tries even the right code is refused")
    assert.equal(await reader.currentReviewReader(), null)
  })

  it("an expired code is refused", async () => {
    use("late")
    const { code } = await reader.issueReaderSignIn(A, null)
    const [token] = await sql`select extract(epoch from expires_at - created_at)::int as seconds from review_reader_tokens where email = ${A} and consumed_at is null`
    assert.equal(token.seconds, 15 * 60, "a code lasts 15 minutes")
    await sql`update review_reader_tokens set expires_at = now() - interval '1 second' where email = ${A} and consumed_at is null`
    const refused = await act(actions.reviewLibrarySignInWithCode, { email: A, code })
    assert.equal(refused.to, undefined)
    assert.match(refused.message, /That code did not work/)
    assert.deepEqual(await reader.signInReaderWithCode(A, code), { ok: false, reason: "invalid" })
    assert.equal(await reader.currentReviewReader(), null)
  })

  it("an address with no assigned edition gets no session, and is told so", async () => {
    use("stranger")
    const { code } = await reader.issueReaderSignIn(NOBODY, null)
    const refused = await act(actions.reviewLibrarySignInWithCode, { email: NOBODY, code })
    assert.equal(refused.to, undefined)
    assert.match(refused.message, /No Complimentary Review publications are assigned to that address/)
    assert.equal(await reader.currentReviewReader(), null)
    assert.equal((await sql`select count(*)::int as n from review_reader_sessions where email = ${NOBODY}`)[0].n, 0)
  })

  it("a session is refused once it is more than 24 hours old, whatever the cookie says", async () => {
    use("old")
    const { code } = await reader.issueReaderSignIn(A, null)
    assert.deepEqual(await reader.signInReaderWithCode(A, code), { ok: true, email: A })
    const { sid } = await reader.currentReviewReader()
    await sql`update review_reader_sessions set created_at = now() - interval '23 hours 58 minutes' where id = ${sid}::uuid`
    assert.equal((await reader.currentReviewReader())?.email, A, "still open just inside 24 hours")
    await sql`update review_reader_sessions set created_at = now() - interval '24 hours 1 minute' where id = ${sid}::uuid`
    assert.ok(jarOf("old").has("apri_review_reader"), "the browser still holds an unexpired, validly signed cookie")
    assert.equal(await reader.currentReviewReader(), null, "the server refuses it")
  })

  it("signing out ends the session server-side, so a copied cookie is refused", async () => {
    use("shared")
    const { code } = await reader.issueReaderSignIn(A, null)
    assert.deepEqual(await reader.signInReaderWithCode(A, code), { ok: true, email: A })
    const copied = jarOf("shared").get("apri_review_reader").value
    const { sid } = await reader.currentReviewReader()
    await reader.destroyReaderSession()
    assert.equal(await reader.currentReviewReader(), null)
    assert.equal(jarOf("shared").has("apri_review_reader"), false)
    const [row] = await sql`select revoke_reason from review_reader_sessions where id = ${sid}::uuid`
    assert.equal(row.revoke_reason, "signed_out")
    globalThis.__jars.set("copy", new Map([["apri_review_reader", { value: copied, options: {} }]]))
    use("copy")
    assert.equal(await reader.currentReviewReader(), null)
    use("laptop")
    assert.equal((await reader.currentReviewReader())?.email, A, "only that browser's session ended")
  })

  it("an emailed sign-in link signs nobody in: it only points to the code sign-in", async () => {
    // Issuing a code returns no token at all, so a link-shaped value is made up.
    const issued = await reader.issueReaderSignIn(A)
    assert.deepEqual(Object.keys(issued).sort(), ["code", "id"], "no token to put in a link")
    const token = randomBytes(32).toString("base64url")
    use("link-click")
    const response = await verifyRoute.GET(new Request(`${SITE}/review/library/verify?token=${token}`))
    assert.equal(response.status, 303)
    assert.equal(location(response), "/review/library/sign-in?reason=code_only")
    assert.equal(response.headers.get("cache-control"), "private, no-store")
    assert.equal(jarOf("link-click").size, 0, "no cookie of any kind")
    assert.equal(await reader.currentReviewReader(), null)
    for (const gone of ["signInReaderWithToken", "inspectReaderToken", "READER_LINK_COOKIE", "READER_PENDING_COOKIE"]) {
      assert.equal(reader[gone], undefined, `${gone} is gone: no code path signs in by link`)
    }
  })

  it("issuing a code is serialised per address: overlapping requests leave exactly one live code", async () => {
    const results = await Promise.all([reader.issueReaderSignIn(A), reader.issueReaderSignIn(A), reader.issueReaderSignIn(A)])
    const live = await sql`select id from review_reader_tokens where email = ${A} and consumed_at is null and expires_at > now()`
    assert.equal(live.length, 1)
    assert.ok(results.some((r) => r.id === live[0].id))
    await reader.spendReaderSignIn(live[0].id)
    assert.equal((await sql`select count(*)::int as n from review_reader_tokens where email = ${A} and consumed_at is null`)[0].n, 0)
  })

  it("the older reading entry sends everyone to the library and sets no routing cookie", async () => {
    use("old-bookmark")
    const response = await readRoute.GET(new Request(`${SITE}/review/read`))
    assert.equal(response.status, 303)
    assert.equal(location(response), "/review/library")
    assert.equal(jarOf("old-bookmark").size, 0)
  })

  it("review and subscriber sessions never stand in for each other", async () => {
    use("mixed")
    const seat = await makeSeat(tag, { suffix: "sub" })
    const subscriberCookie = await subscriberToken.signSubscriberSession({ principalId: seat.id })
    globalThis.__jars.set("mixed", new Map([["apri_review_reader", { value: subscriberCookie, options: {} }]]))
    assert.equal(await reader.currentReviewReader(), null, "a subscriber cookie is not a review session")
    use("laptop")
    const reviewCookie = jarOf("laptop").get("apri_review_reader").value
    assert.equal(await subscriberToken.verifySubscriberSession(reviewCookie), null, "a review cookie is not a subscriber session")
  })

  it("visits and opens are recorded by reader and edition", async () => {
    await reader.recordReaderEvent(A, "edition_opened", ed.one)
    const rows = await sql`select event_type from review_reader_events where email = ${A} and edition_id = ${ed.one}::uuid`
    assert.ok(rows.some((r) => r.event_type === "edition_opened"))
  })
})

describe("Read is checked again on every open", () => {
  const open = (id) => openRoute.GET(new Request(`${SITE}/review/library/open/${encodeURIComponent(id)}`), { params: Promise.resolve({ id }) })

  it("without a session, Read goes to sign-in and hands out no Papermark address", async () => {
    use("no-session")
    const response = await open(ed.one)
    assert.equal(response.status, 303)
    assert.equal(location(response), `/review/library/sign-in?edition=${ed.one}`)
    assert.equal(response.headers.get("cache-control"), "private, no-store")
    assert.doesNotMatch(response.headers.get("location"), /docs\.example\.invalid/)
    assert.equal(location(await open("' or 1=1 --")), "/review/library/sign-in", "a malformed id is not echoed back")
  })

  it("a signed-in reader cannot open another reader's, a withdrawn, a draft or a guessed edition", async () => {
    use("laptop")
    assert.equal((await reader.currentReviewReader())?.email, A)
    for (const id of [ed.three, ed.withdrawn, ed.draft, "00000000-0000-4000-8000-000000000000", "' or 1=1 --"]) {
      const response = await open(id)
      assert.equal(response.status, 303)
      assert.equal(location(response), "/review/library?unavailable=1", `edition ${id}`)
      assert.doesNotMatch(response.headers.get("location"), /docs\.example\.invalid/)
    }
  })
})

describe("the public cards, reversibly", () => {
  it("lead to Papermark by default and to the library only once an owner switches", async () => {
    await sql`delete from app_settings where key = 'review_entry_mode'`
    assert.equal(await reader.reviewEntryMode(), "papermark")
    await sql`insert into app_settings (key, value) values ('review_entry_mode', 'library')`
    assert.equal(await reader.reviewEntryMode(), "library")
    await sql`update app_settings set value = 'rooms' where key = 'review_entry_mode'`
    assert.equal(await reader.reviewEntryMode(), "library", "the retired rooms route now means the library")
    await sql`update app_settings set value = 'anything-else' where key = 'review_entry_mode'`
    assert.equal(await reader.reviewEntryMode(), "papermark")
    await sql`update app_settings set value = 'papermark' where key = 'review_entry_mode'`
    assert.equal(await reader.reviewEntryMode(), "papermark")
  })

  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
  it("the library page never carries a Papermark URL; every open is re-checked", () => {
    const page = read("src/app/review/library/page.tsx")
    assert.doesNotMatch(page, /secureUrl/)
    assert.match(page, /\/review\/library\/open\/\$\{c\.id\}/)
    const open = read("src/app/review/library/open/[id]/route.ts")
    const session = open.indexOf("currentReviewReader()")
    const recheck = open.indexOf("getReviewEditionForEmail(reader.email, id)")
    assert.ok(session > 0 && recheck > session, "the session is checked, then the assignment")
    assert.ok(recheck < open.indexOf("readerDocumentFor(") && recheck < open.indexOf("secureUrl"), "before any Papermark address is chosen")
  })
  it("switching is owner-only and the homepage and Publications follow the setting", () => {
    const actions = read("src/app/actions/review-reader.ts")
    const fn = actions.slice(actions.indexOf("export async function setReviewEntryMode"))
    assert.ok(fn.indexOf("await requireOwner()") < fn.indexOf("getSql()"))
    assert.match(fn, /if \(mode !== "papermark" && mode !== "library"\) return/)
    for (const p of ["src/app/page.tsx", "src/app/publications/page.tsx"]) {
      const page = read(p)
      assert.match(page, /href=\{entryMode === "library" \? `\/review\/library\?edition=\$\{card\.id\}` : card\.secureUrl\}/)
      assert.doesNotMatch(page, /entryMode === "rooms"|"\/review\/read"/)
    }
  })
  it("nothing sets the routing cookie any more", () => {
    const files = []
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) walk(path)
        else if (/\.tsx?$/.test(entry.name)) files.push(path)
      }
    }
    walk(SRC)
    for (const file of files) {
      const name = relative(SRC, file).replace(/\\/g, "/")
      if (name === "lib/review-room-entry.ts") continue
      assert.doesNotMatch(readFileSync(file, "utf8"), /setRoomHint\(/, name)
    }
    const signOut = read("src/lib/review-reader.ts")
    assert.match(signOut, /store\.set\("apri_review_room", "", \{ \.\.\.readerCookieOptions\(\), maxAge: 0 \}\)/, "sign-out still clears an old one")
  })
})
