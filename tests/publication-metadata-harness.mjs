/**
 * Shared set-up for the publication metadata, tag and summary database tests
 * (tests/publication-metadata*-db, publication-summaries*-db and
 * library-tag-filters-db). Not a test file itself.
 *
 * Importing it registers module hooks before any application module loads:
 * next/headers as a cookie jar (one browser at a time), next/cache recording
 * revalidations, next/server's after() collected rather than run, Next's
 * "server-only" marker stubbed, and the "@/" alias resolved -- so the real
 * server actions run with a signed admin session whose role is re-read from
 * the database.
 *
 * Every row a fixture creates is prefixed with the file's tag and removed by
 * cleanup(). Invented data only.
 */
import { registerHooks, createRequire } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import { existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { randomBytes } from "node:crypto"

globalThis.__jars = new Map()
globalThis.__browser = "none"
globalThis.__revalidated = []
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
const CACHE = `export function revalidatePath(path) { globalThis.__revalidated.push(path) } export function revalidateTag() {} export function unstable_cache(fn) { return fn }`
const NEXT_SERVER = pathToFileURL(createRequire(import.meta.url).resolve("next/server.js")).href
const SERVER = `export * from ${JSON.stringify(NEXT_SERVER)}
export function after(task) { (globalThis.__afterTasks ??= []).push(task) }`
const SRC = fileURLToPath(new URL("../src/", import.meta.url))
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true }
    if (specifier === "next/headers") return { url: `data:text/javascript,${encodeURIComponent(HEADERS)}`, shortCircuit: true }
    if (specifier === "next/cache") return { url: `data:text/javascript,${encodeURIComponent(CACHE)}`, shortCircuit: true }
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

process.env.SESSION_SECRET ??= randomBytes(32).toString("hex")

export const FAR = "2099-12-31"

/** Fixtures over the given Neon-style `sql` tag, all prefixed with `tag`. */
export function fixtures(sql, tag) {
  const tiers = []
  const admins = []
  const short = tag.slice(-6)

  return {
    short,
    /** A label unique to this file (labels are unique per kind across the shared database). */
    label: (text) => `${text} ${short}`,

    async admin(role, name = `Test ${role}`) {
      const [row] = await sql`insert into admins (email, name, password_hash, role) values (${`${tag}_${role}_${admins.length}@example.invalid`}, ${name}, 'not-a-hash', ${role}) returning id`
      admins.push(row.id)
      return row.id
    },

    async plan(suffix, { room = true } = {}) {
      const tier = `${tag}_${suffix}`
      tiers.push(tier)
      const dataroom = room ? `${tag}_room_${suffix}` : null
      if (dataroom) await sql`insert into papermark_level_rooms (public_tier, papermark_dataroom_id, dataroom_name) values (${tier}, ${dataroom}, ${`Test room ${suffix}`})`
      return { tier, dataroom }
    },

    /** An active paid seat on `tier` whose term runs from `start` to 2099. */
    async subscriber(suffix, tier, start = "2026-01-01") {
      const [row] = await sql`
        insert into subscribers (name, full_name, email, level, public_tier, status, seats, term_start, term_end, organization)
        values (${`Reader ${suffix}`}, ${`Reader ${suffix}`}, ${`${tag}_${suffix}@example.invalid`}, 'L1', ${tier}, 'active', 1, ${start}::date, ${FAR}::date, 'Test Org')
        returning id`
      await sql`insert into subscriber_subscription_periods (subscriber_id, starts_on, ends_on, level, source) values (${row.id}::uuid, ${start}::date, ${FAR}::date, 'L1', 'test')`
      return row.id
    },

    /** A released paid edition for `forTiers`, optionally in a Data Room. */
    async edition(key, { title, series = "MIN", date, forTiers = [], dataroom = null, summary = "", description = "", status = "published", visibility = "L1", release = "released" }) {
      const [row] = await sql`
        insert into documents (slug, title, series, visibility, status, is_published, edition_date, summary, description, paid_release_state)
        values (${`${tag}_${key}`}, ${title}, ${series}, ${visibility}, ${status}, ${status === "published"}, ${date}::date, ${summary}, ${description}, ${release})
        returning id`
      for (const tier of forTiers) await sql`insert into publication_plans (publication_id, public_tier, source) values (${row.id}::uuid, ${tier}, 'test')`
      let documentRowId = null
      const papermarkDocumentId = `${tag}_pm_${key}`
      if (dataroom) {
        const [dd] = await sql`
          insert into papermark_dataroom_documents (papermark_dataroom_id, papermark_document_id, title, category, publication_id, version_key)
          values (${dataroom}, ${papermarkDocumentId}, ${`${title}.pdf`}, ${series || "OTHER"}, ${row.id}::uuid, 'v1')
          returning id`
        documentRowId = dd.id
      }
      return { id: row.id, documentRowId, papermarkDocumentId, title, slug: `${tag}_${key}` }
    },

    async tag(kind, text, { active = true } = {}) {
      const [row] = await sql`insert into publication_tags (kind, label, active) values (${kind}, ${`${text} ${short}`}, ${active}) returning id, label`
      return row
    },

    assign: (publicationId, tagId) => sql`insert into publication_tag_assignments (publication_id, tag_id) values (${publicationId}::uuid, ${tagId}::uuid) on conflict do nothing`,

    async cleanup() {
      await sql`delete from subscriber_publication_exceptions where subscriber_id in (select id from subscribers where email like ${`${tag}%`})`
      await sql`delete from subscriber_subscription_periods where subscriber_id in (select id from subscribers where email like ${`${tag}%`})`
      await sql`delete from publication_access where subscriber_id in (select id from subscribers where email like ${`${tag}%`})`
      await sql`delete from papermark_subscriber_document_links where subscriber_id in (select id from subscribers where email like ${`${tag}%`})`
      await sql`delete from subscribers where email like ${`${tag}%`}`
      await sql`delete from papermark_dataroom_documents where papermark_dataroom_id like ${`${tag}%`}`
      await sql`delete from publication_plans where public_tier = any(${tiers}::text[])`
      // Summaries and tag assignments go with their records (on delete cascade).
      await sql`delete from documents where slug like ${`${tag}%`}`
      await sql`delete from publication_tags where label like ${`% ${short}`}`
      await sql`delete from papermark_level_rooms where public_tier = any(${tiers}::text[])`
      if (admins.length) await sql`delete from admins where id = any(${admins}::uuid[])`
    },
  }
}

/**
 * Signs this file's one browser in: "anonymous", or as `adminId` with the role
 * the cookie claims (a forged "owner" claim for an editor is the point of
 * some tests: the role is re-read from the database).
 */
export async function signIn(session, adminId, claimedRole = "owner") {
  globalThis.__browser = `admin-${adminId ?? "anonymous"}-${claimedRole}`
  globalThis.__jars.delete(globalThis.__browser)
  if (adminId) await session.createSession({ adminId, role: claimedRole })
}

/** Runs a server action as its form would: { to } when it redirected, otherwise what it returned. */
export async function act(action, fields, ...bound) {
  const form = new FormData()
  for (const [name, value] of Object.entries(fields)) {
    if (Array.isArray(value)) for (const v of value) form.append(name, v)
    else if (value !== undefined && value !== null) form.set(name, value)
  }
  try {
    return await action(...bound, undefined, form)
  } catch (error) {
    const digest = String(error?.digest ?? "")
    if (!digest.startsWith("NEXT_REDIRECT;")) throw error
    return { to: digest.split(";").slice(2, -2).join(";") }
  }
}
