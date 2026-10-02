/**
 * The remembered Complimentary Review Library, against the test database.
 * Two invented readers with different edition sets; each "browser" is its own
 * cookie jar standing in for Next's cookie store. No real Papermark link is
 * read or changed. Invented data only.
 */
import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import { existsSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { randomBytes } from "node:crypto"
import { sql, makeTag, cleanup, makeSeat } from "./helpers.mjs"
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

const reader = await import("../src/lib/review-reader.ts")
const pubs = await import("../src/lib/publications.ts")
const subscriberToken = await import("../src/lib/subscriber-session-token.ts")
const tag = makeTag("reviewlib")
const A = `${tag}_ada@example.invalid`
const B = `${tag}_bola@example.invalid`
const NOBODY = `${tag}_nobody@example.invalid`
const use = (name) => { globalThis.__browser = name }
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
  await sql`delete from review_reader_events where email like ${`${tag}%`}`
  await sql`delete from review_reader_sessions where email like ${`${tag}%`}`
  await sql`delete from review_reader_tokens where email like ${`${tag}%`}`
  await sql`delete from review_edition_recipients where email like ${`${tag}%`}`
  await sql`delete from review_publication_editions where title like ${`${tag}%`}`
  await sql`delete from app_settings where key = 'review_entry_mode'`
  await cleanup(tag)
})

describe("the review reader migration", () => {
  it("is additive and re-runs cleanly", async () => {
    const FILE = "20261008_review_reader_library.sql"
    const db = await createSchemaDatabase({ skipMigrations: [FILE] })
    await applyMigration(db, FILE)
    await applyMigration(db, FILE)
    const { rows } = await db.query(`select to_regclass('public.review_reader_sessions') is not null and to_regclass('public.review_reader_tokens') is not null and to_regclass('public.review_reader_events') is not null as ok`)
    assert.equal(rows[0].ok, true)
    await db.close()
    assert.match(readFileSync(new URL("../db/rollback/20261008_review_reader_library.rollback.sql", import.meta.url), "utf8"), /drop table if exists review_reader_sessions/)
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

describe("one verification, remembered on the same browser", () => {
  it("a link signs in that browser; later visits need no email; other browsers have nothing", async () => {
    use("laptop")
    const { token } = await reader.issueReaderSignIn(A, null)
    assert.deepEqual(await reader.signInReaderWithToken(token), { ok: true, email: A })
    const cookie = globalThis.__jars.get("laptop").get("apri_review_reader")
    assert.ok(cookie)
    assert.equal(cookie.options.path, "/review")
    assert.equal(cookie.options.httpOnly, true)
    assert.equal(cookie.options.maxAge, 60 * 60 * 24 * 90)
    assert.equal((await reader.currentReviewReader())?.email, A)
    assert.equal((await reader.currentReviewReader())?.email, A, "a second visit, no email")
    use("other-browser")
    assert.equal(await reader.currentReviewReader(), null)
    use("laptop")
    assert.deepEqual(await reader.signInReaderWithToken(token), { ok: false, reason: "invalid" }, "a link works once")
  })

  it("the code signs in the browser it is typed into", async () => {
    const { code } = await reader.issueReaderSignIn(B, null)
    use("phone")
    assert.deepEqual(await reader.signInReaderWithCode(B, code), { ok: true, email: B })
    assert.equal((await reader.currentReviewReader())?.email, B)
  })

  it("an address with no assigned edition gets no session", async () => {
    use("stranger")
    const { token } = await reader.issueReaderSignIn(NOBODY, null)
    assert.deepEqual(await reader.signInReaderWithToken(token), { ok: false, reason: "no_editions" })
    assert.equal(await reader.currentReviewReader(), null)
  })

  it("the asking browser is recognised; any other browser must confirm, and looking spends nothing", async () => {
    const { token } = await reader.issueReaderSignIn(A, reader.hashToken("marker"))
    assert.deepEqual(await reader.inspectReaderToken(token, reader.hashToken("marker")), { usable: true, sameBrowser: true })
    assert.deepEqual(await reader.inspectReaderToken(token, null), { usable: true, sameBrowser: false })
    assert.deepEqual(await reader.inspectReaderToken(token, null), { usable: true, sameBrowser: false })
  })

  it("signing out ends the session server-side, so a copied cookie is refused", async () => {
    use("shared")
    const { token } = await reader.issueReaderSignIn(A, null)
    await reader.signInReaderWithToken(token)
    const copied = globalThis.__jars.get("shared").get("apri_review_reader").value
    await reader.destroyReaderSession()
    assert.equal(await reader.currentReviewReader(), null)
    globalThis.__jars.set("copy", new Map([["apri_review_reader", { value: copied, options: {} }]]))
    use("copy")
    assert.equal(await reader.currentReviewReader(), null)
  })

  it("review and subscriber sessions never stand in for each other", async () => {
    use("mixed")
    const seat = await makeSeat(tag, { suffix: "sub" })
    const subscriberCookie = await subscriberToken.signSubscriberSession({ principalId: seat.id })
    globalThis.__jars.set("mixed", new Map([["apri_review_reader", { value: subscriberCookie, options: {} }]]))
    assert.equal(await reader.currentReviewReader(), null, "a subscriber cookie is not a review session")
    use("laptop")
    const reviewCookie = globalThis.__jars.get("laptop").get("apri_review_reader").value
    assert.equal(await subscriberToken.verifySubscriberSession(reviewCookie), null, "a review cookie is not a subscriber session")
  })

  it("visits and opens are recorded by reader and edition", async () => {
    await reader.recordReaderEvent(A, "edition_opened", ed.one)
    const rows = await sql`select event_type from review_reader_events where email = ${A} and edition_id = ${ed.one}::uuid`
    assert.ok(rows.some((r) => r.event_type === "edition_opened"))
  })
})

describe("the public cards, reversibly", () => {
  it("lead to Papermark by default and to the library only once an owner switches", async () => {
    await sql`delete from app_settings where key = 'review_entry_mode'`
    assert.equal(await reader.reviewEntryMode(), "papermark")
    await sql`insert into app_settings (key, value) values ('review_entry_mode', 'library')`
    assert.equal(await reader.reviewEntryMode(), "library")
    await sql`update app_settings set value = 'papermark' where key = 'review_entry_mode'`
    assert.equal(await reader.reviewEntryMode(), "papermark")
  })

  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
  it("the library page never carries a Papermark URL; every open is re-checked", () => {
    const page = read("src/app/review/library/page.tsx")
    assert.doesNotMatch(page, /secureUrl/)
    assert.match(page, /\/review\/library\/open\/\$\{c\.id\}/)
    const open = read("src/app/review/library/open/[id]/route.ts")
    assert.match(open, /getReviewEditionForEmail\(reader\.email, id\)/)
    assert.ok(open.indexOf("currentReviewReader()") < open.indexOf("secureUrl"))
  })
  it("switching is owner-only and the homepage and Publications follow the setting", () => {
    const actions = read("src/app/actions/review-reader.ts")
    const fn = actions.slice(actions.indexOf("export async function setReviewEntryMode"))
    assert.ok(fn.indexOf("await requireOwner()") < fn.indexOf("getSql()"))
    for (const p of ["src/app/page.tsx", "src/app/publications/page.tsx"]) {
      assert.match(read(p), /href=\{entryMode === "library" \? `\/review\/library\/open\/\$\{card\.id\}` : card\.secureUrl\}/)
    }
  })
})
