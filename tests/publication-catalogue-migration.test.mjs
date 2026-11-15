/**
 * db/migrations/20261114_publication_catalogue.sql and its rollback, in
 * isolated in-memory databases (never the shared test database, so changing
 * labels or constraints here cannot disturb another test file).
 *
 * Fresh: the catalogue tables exist, seeded with exactly the built-in
 * defaults in src/lib/publication-catalogue.ts (the single source the seed
 * copies), and the widened series rules hold.
 *
 * Upgrade: a database at the schema before the migration (reached by running
 * the rollback on an unused catalogue) is seeded with representative
 * subscribers, paid periods, editions, plans, exceptions, Data Room documents
 * and Complimentary Review editions with readers and an offer; the migration
 * is applied twice; nothing that existed changes; owner edits survive a
 * re-run; and the rollback refuses while anything depends on the catalogue.
 *
 * Invented data only.
 */
import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createSchemaDatabase, applyMigration } from "./support/test-database.mjs"
import { loadApp } from "../scripts/lib/load-app.mjs"
import { CATALOGUE_CODES, DEFAULT_CATALOGUE, DEFAULT_FOLDER_MAPPINGS } from "../src/lib/publication-catalogue.ts"

const FILE = "20261114_publication_catalogue.sql"
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
const ROLLBACK = read(`db/rollback/20261114_publication_catalogue.rollback.sql`)
const dal = await loadApp("lib/publication-catalogue-dal.ts")

/** The Neon tag shape over an isolated PGlite database, for the catalogue DAL. */
const tagged = (db) => async (strings, ...values) => {
  let text = strings[0]
  for (let i = 1; i < strings.length; i++) text += `$${i}${strings[i]}`
  return (await db.query(text, values)).rows
}

async function rollback(db) {
  try {
    await db.exec(ROLLBACK)
  } catch (error) {
    await db.exec("rollback").catch(() => {})
    throw error
  }
}

const seeded = async (db) => ({
  categories: (await db.query(`select code, label, singular_label, sort_order, active, aliases from publication_categories order by sort_order, code`)).rows,
  folders: (await db.query(`select folder_slug, category_code from publication_category_folders order by folder_slug`)).rows,
})
const defaults = () => ({
  categories: DEFAULT_CATALOGUE.map((c) => ({ code: c.code, label: c.label, singular_label: c.singularLabel, sort_order: c.sortOrder, active: c.active, aliases: [...c.aliases] })),
  folders: DEFAULT_FOLDER_MAPPINGS.map((m) => ({ folder_slug: m.folderSlug, category_code: m.code })).sort((a, b) => a.folder_slug.localeCompare(b.folder_slug)),
})
const tables = async (db) =>
  (await db.query(`select table_name from information_schema.tables where table_name in ('publication_categories', 'publication_category_folders') order by table_name`)).rows.map((r) => r.table_name)

describe("a fresh database", () => {
  let db
  before(async () => {
    db = await createSchemaDatabase()
  })
  after(async () => db?.close())

  it("has the catalogue tables, seeded with exactly the built-in defaults", async () => {
    assert.deepEqual(await tables(db), ["publication_categories", "publication_category_folders"])
    assert.deepEqual(await seeded(db), defaults())
    assert.equal((await db.query(`select value from app_settings where key = 'publication_catalogue_folders_seeded'`)).rows[0]?.value, "true")
  })

  it("schema.sql mirrors the migration's tables and seed exactly", () => {
    const migration = read(`db/migrations/${FILE}`)
    const schema = read("db/schema.sql")
    const blocks = (source) =>
      [
        source.match(/create table if not exists publication_categories \([\s\S]*?\n\);/)?.[0],
        source.match(/create table if not exists publication_category_folders \([\s\S]*?\n\);/)?.[0],
        source.match(/insert into publication_categories[\s\S]*?on conflict \(code\) do nothing;/)?.[0],
        source.match(/insert into publication_category_folders[\s\S]*?on conflict \(folder_slug\) do nothing;/)?.[0],
      ].map((b) => (b ?? "").replace(/\s+/g, " "))
    const m = blocks(migration)
    assert.ok(m.every((b) => b.length > 20), "the migration has every block")
    assert.deepEqual(blocks(schema), m)
    assert.match(schema, /check \(series = '' or series in \('MIN', 'AIU', 'PLM', 'AEO', 'QIB', 'OTHER', 'BP'\)\)/)
  })

  it("the rollback's list of default mappings is exactly the built-in one, and the migration fails fast on a lock", () => {
    const guard = ROLLBACK.slice(ROLLBACK.indexOf("from publication_category_folders f"), ROLLBACK.indexOf("added or changed a folder mapping"))
    const pairs = [...guard.matchAll(/\('([a-z0-9-]+)', '([A-Z]+)'\)/g)].map((m) => `${m[1]}=${m[2]}`).sort()
    assert.deepEqual(pairs, DEFAULT_FOLDER_MAPPINGS.map((m) => `${m.folderSlug}=${m.code}`).sort())
    const migration = read(`db/migrations/${FILE}`)
    const lock = migration.indexOf("set local lock_timeout = '5s';")
    assert.ok(lock > migration.indexOf("begin;") && lock < migration.indexOf("create table"), "lock_timeout is set inside the transaction, before any table is touched")
  })

  it("Admin's 'awaiting a category' counts: only published, released paid records; unmapped Review Data Room folders listed", async () => {
    dal.resetCatalogueSchemaCache()
    const sql = tagged(db)
    await db.exec(`
      insert into documents (slug, title, series, visibility, status) values
        ('aw-draft', 'Draft, no series', '', 'L1', 'draft'),
        ('aw-archived', 'Archived, no series', '', 'L1', 'archived'),
        ('aw-published', 'Published, no series', '', 'L1', 'published'),
        ('aw-withheld', 'Withheld, no series', '', 'L1', 'published'),
        ('aw-open', 'Open, no series', '', 'OPEN', 'published'),
        ('aw-qib', 'Published QIB', 'QIB', 'L1', 'published');
      update documents set paid_release_state = 'withheld' where slug = 'aw-withheld';
      insert into review_sync_candidates (papermark_document_id, papermark_dataroom_id, raw_filename, folder_path, is_present) values
        ('aw-r1', 'review-room', 'Issue 03.pdf', '/political-landscape-monitors', true),
        ('aw-r2', 'review-room', 'Issue 04.pdf', '/political-landscape-monitors', true),
        ('aw-r3', 'review-room', 'Issue 05.pdf', '/political-landscape-monitor', true),
        ('aw-r4', 'review-room', 'Issue 06.pdf', '/gone-folder', false),
        ('aw-r5', 'review-room', 'Issue 07.pdf', null, true);
    `)
    const catalogue = await dal.loadPublicationCatalogue(sql, { fresh: true })
    const overview = await dal.unassignedOverview(sql, catalogue)
    assert.equal(overview.records, 1, "only the published, released record with no series: no draft, archived, withheld or open one")
    assert.deepEqual(overview.reviewFolders, [{ folder: "political-landscape-monitors", documents: 2 }], "mapped, absent and folderless review documents are not listed")
  })

  it("lets a record's series be OTHER and a review edition use every category but BP", async () => {
    await db.query(`insert into documents (slug, title, series) values ('fresh-other', 'Other paper', 'OTHER')`)
    for (const series of ["MIN", "AIU", "PLM", "AEO", "QIB", "OTHER"]) {
      await db.query(`insert into review_publication_editions (series, papermark_document_id) values ($1, $2)`, [series, `fresh-${series}`])
    }
    await assert.rejects(db.query(`insert into review_publication_editions (series, papermark_document_id) values ('BP', 'fresh-bp')`), /review_publication_editions_series_check/)
    await assert.rejects(db.query(`insert into documents (slug, title, series) values ('fresh-bad', 'Bad', 'ZZZ')`), /documents_series_check/)
    await assert.rejects(db.query(`insert into publication_categories (code, label, singular_label, sort_order) values ('NEW', 'New', 'New', 1)`), /check/)
  })

  it("the DAL reads the owner's labels, order, active flag and mappings once the migration is applied", async () => {
    dal.resetCatalogueSchemaCache()
    const sql = tagged(db)
    let catalogue = await dal.loadPublicationCatalogue(sql, { fresh: true })
    assert.equal(catalogue.migrated, true)
    assert.deepEqual(catalogue.categories.map((c) => c.code), [...CATALOGUE_CODES])
    await db.query(`update publication_categories set label = 'Quarterly Briefs', sort_order = 5 where code = 'QIB'`)
    await db.query(`update publication_categories set active = false where code = 'OTHER'`)
    await db.query(`delete from publication_category_folders where folder_slug = 'election-watch'`)
    await db.query(`insert into publication_category_folders (folder_slug, category_code) values ('board-intelligence-updates', 'OTHER')`)
    catalogue = await dal.loadPublicationCatalogue(sql, { fresh: true })
    assert.deepEqual(catalogue.categories.slice(0, 2).map((c) => [c.code, c.label]), [["QIB", "Quarterly Briefs"], ["MIN", "Monthly Intelligence Notes"]])
    assert.equal(catalogue.categories.find((c) => c.code === "OTHER").active, false)
    assert.ok(!catalogue.folders.some((f) => f.folderSlug === "election-watch"))
    assert.ok(catalogue.folders.some((f) => f.folderSlug === "board-intelligence-updates" && f.code === "OTHER"))
  })
})

describe("upgrading an existing database", () => {
  let db
  const snapshot = {}
  const SNAPSHOT_TABLES = {
    subscribers: "select id, email, status, level, public_tier, term_start, term_end from subscribers order by id",
    periods: "select subscriber_id, starts_on, ends_on, level from subscriber_subscription_periods order by subscriber_id, starts_on",
    documents: "select id, slug, title, series, visibility, status, edition_date from documents order by id",
    plans: "select publication_id, public_tier from publication_plans order by publication_id, public_tier",
    exceptions: "select subscriber_id, publication_id, decision, reason from subscriber_publication_exceptions order by subscriber_id, publication_id",
    dataroom: "select id, title, category, folder_path, publication_id from papermark_dataroom_documents order by id",
    editions: "select id, series, title, publication_state, complimentary_featured, recipient_mode, secure_link_id from review_publication_editions order by id",
    recipients: "select edition_id, email, revoked_at from review_edition_recipients order by edition_id, email",
  }
  const take = async () => Object.fromEntries(await Promise.all(Object.entries(SNAPSHOT_TABLES).map(async ([k, q]) => [k, (await db.query(q)).rows])))

  before(async () => {
    db = await createSchemaDatabase()
    // The schema before this release: the rollback on an unused catalogue.
    await rollback(db)
    assert.deepEqual(await tables(db), [], "the upgrade starts without the catalogue")
    await assert.rejects(db.query(`insert into documents (slug, title, series) values ('pre-other', 'x', 'OTHER')`), /documents_series_check/)
    await assert.rejects(db.query(`insert into review_publication_editions (series, papermark_document_id) values ('QIB', 'pre-qib')`), /review_publication_editions_series_check/)

    await db.exec(`
      insert into admins (id, email, name, password_hash, role) values ('a0000000-0000-4000-8000-000000000001', 'owner@example.test', 'Owner', 'x', 'owner');
      insert into subscribers (id, full_name, name, email, client_type, public_tier, level, seats, term_start, term_end, status) values
        ('11111111-1111-4111-8111-111111111111', 'Existing Active', 'Existing Active', 'active@example.test', 'subscriber', 'Political Monitor', 'L2', 1, '2026-05-01', '2027-04-30', 'active'),
        ('22222222-2222-4222-8222-222222222222', 'Existing Pending', 'Existing Pending', 'pending@example.test', 'subscriber', 'Individual Access', 'L1', 1, null, '2027-01-01', 'pending');
      insert into subscriber_subscription_periods (subscriber_id, starts_on, ends_on, level, source) values
        ('11111111-1111-4111-8111-111111111111', '2026-01-01', '2026-03-31', 'L2', 'admin'),
        ('11111111-1111-4111-8111-111111111111', '2026-05-01', '2027-04-30', 'L2', 'admin');
      insert into documents (id, slug, title, series, visibility, status, edition_date) values
        ('33333333-3333-4333-8333-000000000001', 'up-min', 'Monthly note', 'MIN', 'L1', 'published', '2026-06-01'),
        ('33333333-3333-4333-8333-000000000002', 'up-qib', 'Quarterly brief', 'QIB', 'L1', 'published', '2026-04-01'),
        ('33333333-3333-4333-8333-000000000003', 'up-none', 'Board update', '', 'L1', 'published', '2026-07-01'),
        ('33333333-3333-4333-8333-000000000004', 'up-bp', 'Board paper', 'BP', 'L4', 'draft', null);
      insert into publication_plans (publication_id, public_tier, source) values
        ('33333333-3333-4333-8333-000000000001', 'Political Monitor', 'admin'),
        ('33333333-3333-4333-8333-000000000002', 'Political Monitor', 'admin');
      insert into subscriber_publication_exceptions (subscriber_id, publication_id, decision, reason, administrator_id) values
        ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-000000000002', 'allow', 'Promised at sign-up', 'a0000000-0000-4000-8000-000000000001'),
        ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-000000000003', 'block', 'Not for them', 'a0000000-0000-4000-8000-000000000001');
      insert into papermark_dataroom_documents (id, papermark_dataroom_id, papermark_document_id, title, category, folder_path, publication_id, version_key) values
        ('44444444-4444-4444-8444-000000000001', 'room', 'pm-1', 'Monthly note.pdf', 'MIN', '/monthly-intelligence-note', '33333333-3333-4333-8333-000000000001', 'v1'),
        ('44444444-4444-4444-8444-000000000002', 'room', 'pm-2', 'Board update.pdf', 'OTHER', '/board-intelligence-updates', '33333333-3333-4333-8333-000000000003', 'v1'),
        ('44444444-4444-4444-8444-000000000003', 'room', 'pm-3', 'Admin pack.pdf', 'MIN', '/Admin', null, 'v1');
      insert into review_publication_editions (id, series, title, papermark_document_id, secure_link_id, secure_link_url, secure_link_document_id, secure_link_verified_at, publication_state, complimentary_featured) values
        ('55555555-5555-4555-8555-000000000001', 'MIN', 'Review MIN', 'rpm-1', 'link-1', 'https://docs.example.invalid/view/link-1', 'rpm-1', now(), 'published', true),
        ('55555555-5555-4555-8555-000000000002', 'AIU', 'Review AIU draft', 'rpm-2', null, '', null, null, 'draft', false);
      insert into review_edition_recipients (edition_id, email, source) values
        ('55555555-5555-4555-8555-000000000001', 'reader@example.test', 'owner');
    `)
    snapshot.before = await take()
    await applyMigration(db, FILE)
    snapshot.after = await take()
    await applyMigration(db, FILE)
    snapshot.again = await take()
  })
  after(async () => db?.close())

  it("before it, the DAL serves the built-in defaults and says the migration is needed", async () => {
    const fresh = await createSchemaDatabase()
    try {
      await rollback(fresh)
      dal.resetCatalogueSchemaCache()
      const catalogue = await dal.loadPublicationCatalogue(tagged(fresh), { fresh: true })
      assert.equal(catalogue.migrated, false)
      assert.deepEqual(catalogue.categories.map((c) => [c.code, c.label, c.active]), DEFAULT_CATALOGUE.map((c) => [c.code, c.label, c.active]))
      assert.deepEqual(catalogue.folders, DEFAULT_FOLDER_MAPPINGS.map((m) => ({ ...m })))
    } finally {
      await fresh.close()
      dal.resetCatalogueSchemaCache()
    }
  })

  it("changes no existing row: subscribers, periods, editions, plans, exceptions, Data Room documents, review editions and readers", () => {
    assert.deepEqual(snapshot.after, snapshot.before)
    assert.deepEqual(snapshot.again, snapshot.before, "and re-running it changes nothing either")
    assert.equal(snapshot.before.dataroom.find((r) => r.title === "Admin pack.pdf").category, "MIN", "no stored classification is rewritten or guessed")
  })

  it("adds and seeds the catalogue, and widens the series rules", async () => {
    assert.deepEqual(await tables(db), ["publication_categories", "publication_category_folders"])
    assert.deepEqual(await seeded(db), defaults())
    await db.query(`insert into documents (slug, title, series) values ('up-other', 'Other paper', 'OTHER')`)
    await db.query(`delete from documents where slug = 'up-other'`)
  })

  it("a re-run keeps the owner's edits and never re-adds a mapping the owner removed", async () => {
    await db.query(`update publication_categories set label = 'Quarterly Briefs', updated_at = now() where code = 'QIB'`)
    await db.query(`delete from publication_category_folders where folder_slug = 'election-watch'`)
    await db.query(`insert into publication_category_folders (folder_slug, category_code) values ('board-intelligence-updates', 'OTHER')`)
    await applyMigration(db, FILE)
    const { categories, folders } = await seeded(db)
    assert.equal(categories.find((c) => c.code === "QIB").label, "Quarterly Briefs")
    assert.ok(!folders.some((f) => f.folder_slug === "election-watch"))
    assert.ok(folders.some((f) => f.folder_slug === "board-intelligence-updates"))
  })

  it("the rollback refuses, changing nothing, while an owner edit, a non-default mapping, an OTHER record or a new review category exists", async () => {
    await assert.rejects(rollback(db), /added or changed a folder mapping/)
    await db.query(`delete from publication_category_folders where folder_slug = 'board-intelligence-updates'`)
    await assert.rejects(rollback(db), /owner changed a category/)
    await db.query(`update publication_categories set label = 'Quarterly Intelligence Briefs' where code = 'QIB'`)
    await db.query(`update documents set series = 'OTHER' where slug = 'up-none'`)
    await assert.rejects(rollback(db), /series OTHER/)
    await db.query(`update documents set series = '' where slug = 'up-none'`)
    await db.query(`update review_publication_editions set series = 'QIB' where id = '55555555-5555-4555-8555-000000000002'`)
    await assert.rejects(rollback(db), /filed under AEO, QIB or OTHER/)
    await db.query(`update review_publication_editions set series = 'AIU' where id = '55555555-5555-4555-8555-000000000002'`)
    assert.deepEqual(await tables(db), ["publication_categories", "publication_category_folders"], "every refusal left the catalogue in place")
  })

  it("once nothing depends on it, the rollback restores the earlier schema and keeps every record", async () => {
    // A removed default mapping is not a reason to refuse.
    await rollback(db)
    assert.deepEqual(await tables(db), [])
    assert.deepEqual(await take(), snapshot.before)
    await assert.rejects(db.query(`insert into documents (slug, title, series) values ('rb-other', 'x', 'OTHER')`), /documents_series_check/)
    assert.equal((await db.query(`select 1 from app_settings where key = 'publication_catalogue_folders_seeded'`)).rows.length, 0)
    // Running it a second time (tables already gone) succeeds and changes nothing.
    await rollback(db)
    assert.deepEqual(await tables(db), [])
    assert.deepEqual(await take(), snapshot.before)
    // And the migration can be applied again afterwards.
    await applyMigration(db, FILE)
    assert.deepEqual(await seeded(db), defaults())
  })
})
