/**
 * db/migrations/20261114_publication_editorial_metadata.sql and its rollback,
 * in isolated in-memory databases (never the shared test database, so
 * dropping and re-adding tables here cannot disturb another test file).
 *
 * Fresh: the five optional documents columns, the tag vocabulary, tag
 * assignments and protected summaries exist, with their rules, and
 * db/schema.sql mirrors the migration exactly.
 *
 * Upgrade: a database at the schema before the migration (reached by running
 * the rollback while nothing is saved) is seeded with representative
 * administrators, subscribers, paid periods, editions (with public teasers,
 * coverage areas and an editorial title override), plans, exceptions and
 * Data Room documents; the migration is applied twice; nothing that existed
 * changes, nothing is backfilled, and coverage areas are untouched. Then,
 * with reader details, a tag and an approved summary saved on it, the
 * rollback refuses for each in turn (changing nothing), and once they are
 * cleared it succeeds and leaves every existing row as before the migration.
 *
 * Rollback: refuses, changing nothing, while any summary, tag, assignment or
 * metadata value is saved, naming which; succeeds once nothing is, and can
 * be re-run; the migration then applies again.
 *
 * Invented data only.
 */
import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { createSchemaDatabase, applyMigration } from "./support/test-database.mjs"
import { loadApp } from "../scripts/lib/load-app.mjs"

const FILE = "20261114_publication_editorial_metadata.sql"
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
const MIGRATION = read(`db/migrations/${FILE}`)
const ROLLBACK = read("db/rollback/20261114_publication_editorial_metadata.rollback.sql")
const dal = await loadApp("lib/publication-metadata-dal.ts")
const summaries = await loadApp("lib/publication-summaries.ts")

const NEW_COLUMNS = ["author_editor", "covered_period_start", "covered_period_end", "information_cutoff", "reading_time_minutes"]
const NEW_TABLES = ["publication_summaries", "publication_tag_assignments", "publication_tags"]

/** The Neon tag shape over an isolated PGlite database, for the DAL. */
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

const tables = async (db) =>
  (await db.query(`select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1::text[]) order by table_name`, [NEW_TABLES])).rows.map((r) => r.table_name)
const columns = async (db) =>
  (await db.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'documents' and column_name = any($1::text[]) order by column_name`, [NEW_COLUMNS])).rows.map((r) => r.column_name)

const OWNER = "a0000000-0000-4000-8000-0000000000b1"
const DOC = (n) => `33333333-3333-4333-8333-0000000000b${n}`

describe("a fresh database", () => {
  let db
  before(async () => {
    db = await createSchemaDatabase()
    await db.query(`insert into admins (id, email, name, password_hash, role) values ($1, 'owner-b@example.test', 'Owner', 'x', 'owner')`, [OWNER])
    await db.query(`insert into documents (id, slug, title, series, visibility, status) values ($1, 'fresh-b1', 'Fresh note', 'MIN', 'L1', 'published')`, [DOC(1)])
  })
  after(async () => db?.close())

  it("has the optional metadata columns and the tag and summary tables", async () => {
    assert.deepEqual(await columns(db), [...NEW_COLUMNS].sort())
    assert.deepEqual(await tables(db), NEW_TABLES)
    // Every new column is optional, with no default: nothing is filled in for an editor.
    const meta = (await db.query(`select column_name, is_nullable, column_default from information_schema.columns where table_name = 'documents' and column_name = any($1::text[])`, [NEW_COLUMNS])).rows
    for (const c of meta) {
      assert.equal(c.is_nullable, "YES", c.column_name)
      assert.equal(c.column_default, null, c.column_name)
    }
    assert.equal(await dal.editorialMetadataReady(tagged(db), { fresh: true }), true)
  })

  it("enforces the metadata rules: both ends of a covered period, end on or after start, minutes 1 to 600, a real author", async () => {
    const set = (sets) => db.query(`update documents set ${sets} where id = $1`, [DOC(1)])
    await set(`covered_period_start = '2026-09-01', covered_period_end = '2026-09-01', reading_time_minutes = 1, author_editor = 'A'`)
    await set(`reading_time_minutes = 600`)
    await assert.rejects(set(`covered_period_end = '2026-08-31'`), /documents_covered_period_check/)
    await assert.rejects(set(`covered_period_end = null`), /documents_covered_period_check/)
    await assert.rejects(set(`reading_time_minutes = 0`), /documents_reading_time_check/)
    await assert.rejects(set(`reading_time_minutes = 601`), /documents_reading_time_check/)
    await assert.rejects(set(`author_editor = '   '`), /documents_author_editor_check/)
    await set(`covered_period_start = null, covered_period_end = null, reading_time_minutes = null, author_editor = null`)
  })

  it("keeps one label per kind (whatever its capitals), and an assigned tag cannot be deleted", async () => {
    const [{ id }] = (await db.query(`insert into publication_tags (kind, label) values ('subject', 'Tariffs') returning id`)).rows
    await db.query(`insert into publication_tags (kind, label) values ('sector', 'Tariffs')`)
    await assert.rejects(db.query(`insert into publication_tags (kind, label) values ('subject', 'TARIFFS')`), /publication_tags_kind_label_key/)
    await assert.rejects(db.query(`insert into publication_tags (kind, label) values ('topic', 'X')`), /check/)
    await assert.rejects(db.query(`insert into publication_tags (kind, label) values ('subject', ' padded ')`), /check/)
    await db.query(`insert into publication_tag_assignments (publication_id, tag_id) values ($1, $2)`, [DOC(1), id])
    await assert.rejects(db.query(`delete from publication_tags where id = $1`, [id]), /foreign key|violates/)
    // Retiring is the only way out for a tag in use.
    await db.query(`update publication_tags set active = false, retired_at = now() where id = $1`, [id])
    assert.equal((await db.query(`select count(*)::int as n from publication_tag_assignments where tag_id = $1`, [id])).rows[0].n, 1)
    await db.query(`delete from publication_tag_assignments`)
    await db.query(`delete from publication_tags`)
  })

  it("an approved copy and its approval time go together; one summary per publication", async () => {
    await db.query(`insert into publication_summaries (publication_id, what_changed) values ($1, 'x')`, [DOC(1)])
    await assert.rejects(db.query(`insert into publication_summaries (publication_id) values ($1)`, [DOC(1)]), /publication_summaries_pkey/)
    await assert.rejects(db.query(`update publication_summaries set approved_fields = '{}'::jsonb where publication_id = $1`, [DOC(1)]), /publication_summaries_approval_check/)
    await assert.rejects(db.query(`update publication_summaries set approval_removed_reason = 'other' where publication_id = $1`, [DOC(1)]), /check/)
    await db.query(`delete from publication_summaries`)
  })

  it("schema.sql mirrors the migration's statements exactly", () => {
    const blocks = (source) => [
      ...NEW_COLUMNS.map((c) => source.match(new RegExp(`alter table documents add column if not exists ${c}\\s+\\w+;`))?.[0]),
      source.match(/do \$\$\s*begin\s*if not exists \(select 1 from pg_constraint where conname = 'documents_author_editor_check'[\s\S]*?end \$\$;/)?.[0],
      source.match(/create table if not exists publication_tags \([\s\S]*?\n\);/)?.[0],
      source.match(/create unique index if not exists publication_tags_kind_label_key[\s\S]*?;/)?.[0],
      source.match(/create table if not exists publication_tag_assignments \([\s\S]*?\n\);/)?.[0],
      source.match(/create index if not exists publication_tag_assignments_tag_idx[\s\S]*?;/)?.[0],
      source.match(/create table if not exists publication_summaries \([\s\S]*?\n\);/)?.[0],
    ].map((b) => (b ?? "").replace(/\s+/g, " "))
    const fromMigration = blocks(MIGRATION)
    for (const b of fromMigration) assert.notEqual(b, "", "every block is present in the migration")
    assert.deepEqual(blocks(read("db/schema.sql")), fromMigration)
  })

  it("is additive: it creates and adds, and never drops, deletes, updates, inserts or grants", () => {
    const code = MIGRATION.replace(/--.*$/gm, "").replace(/\bon (update|delete) (restrict|cascade|set null)\b/gi, "")
    assert.doesNotMatch(code, /\b(drop|delete|update|truncate|insert|grant|revoke)\b/i)
    assert.match(code, /set local lock_timeout = '5s';/, "fails fast on a lock rather than queueing every read")
  })

  it("sorts after the publication catalogue migration, and no other migration uses its name", () => {
    const files = readdirSync(new URL("../db/migrations/", import.meta.url)).filter((f) => f.endsWith(".sql")).sort()
    assert.ok(files.indexOf("20261114_publication_catalogue.sql") >= 0)
    assert.ok(files.indexOf(FILE) > files.indexOf("20261114_publication_catalogue.sql"))
    assert.ok(!files.includes("20261013_library_decision_summaries.sql"))
    assert.ok(readdirSync(new URL("../db/rollback/", import.meta.url)).includes("20261114_publication_editorial_metadata.rollback.sql"))
  })

  it("re-running it on a fresh database changes nothing", async () => {
    const before = (await db.query(`select to_jsonb(d) as row from documents d order by id`)).rows
    const constraints = (await db.query(`select conname from pg_constraint where conname like 'documents_%' or conname like 'publication_%' order by 1`)).rows
    await applyMigration(db, FILE)
    await applyMigration(db, FILE)
    assert.deepEqual((await db.query(`select to_jsonb(d) as row from documents d order by id`)).rows, before)
    assert.deepEqual((await db.query(`select conname from pg_constraint where conname like 'documents_%' or conname like 'publication_%' order by 1`)).rows, constraints)
  })
})

describe("upgrading an existing database", () => {
  let db
  const snapshot = {}
  const SNAPSHOT_TABLES = {
    admins: "select id, email, name, role from admins order by id",
    subscribers: "select id, full_name, email, public_tier, level, term_start, term_end, status from subscribers order by id",
    periods: "select subscriber_id, starts_on, ends_on, level from subscriber_subscription_periods order by subscriber_id, starts_on",
    plans: "select publication_id, public_tier, source from publication_plans order by publication_id, public_tier",
    exceptions: "select subscriber_id, publication_id, decision, reason from subscriber_publication_exceptions order by subscriber_id, publication_id",
    roomDocuments: "select id, papermark_dataroom_id, papermark_document_id, title, category, publication_id, version_key from papermark_dataroom_documents order by id",
  }
  // Every documents column that existed before, row by row.
  const documentsBefore = async () =>
    (await db.query(`select to_jsonb(d) - $1::text[] as row from documents d order by id`, [NEW_COLUMNS])).rows.map((r) => r.row)
  const take = async () => ({
    documents: await documentsBefore(),
    ...Object.fromEntries(await Promise.all(Object.entries(SNAPSHOT_TABLES).map(async ([k, q]) => [k, (await db.query(q)).rows]))),
  })

  before(async () => {
    db = await createSchemaDatabase()
    // The schema before this release: the rollback while nothing is saved.
    await rollback(db)
    assert.deepEqual(await tables(db), [], "the upgrade starts without the new tables")
    assert.deepEqual(await columns(db), [], "and without the new columns")
    // (The readiness check is one-way per process: the fresh database above set it.)
    dal.resetEditorialMetadataCache()
    assert.equal(await dal.editorialMetadataReady(tagged(db), { fresh: true }), false)
    await db.exec(`
      insert into admins (id, email, name, password_hash, role) values ('${OWNER}', 'owner-b@example.test', 'Owner', 'x', 'owner');
      insert into subscribers (id, full_name, name, email, client_type, public_tier, level, seats, term_start, term_end, status) values
        ('11111111-1111-4111-8111-1111111111b1', 'Existing Active', 'Existing Active', 'active-b@example.test', 'subscriber', 'Political Monitor', 'L2', 1, '2026-05-01', '2027-04-30', 'active');
      insert into subscriber_subscription_periods (subscriber_id, starts_on, ends_on, level, source) values
        ('11111111-1111-4111-8111-1111111111b1', '2026-05-01', '2027-04-30', 'L2', 'admin');
      insert into documents (id, slug, title, series, visibility, status, edition_date, summary, description, coverage_areas, kicker) values
        ('${DOC(1)}', 'up-b-min', 'Monthly note', 'MIN', 'L1', 'published', '2026-06-01', 'Public one-line teaser', 'Public description', 'Power sector' || chr(10) || 'Tariff regulation', 'Issue line'),
        ('${DOC(2)}', 'up-b-aiu', 'Sector update', 'AIU', 'L1', 'published', '2026-04-01', '', '', '', ''),
        ('${DOC(3)}', 'up-b-open', 'Open paper', 'PLM', 'OPEN', 'published', '2026-03-01', 'Open teaser', '', 'Elections', ''),
        ('${DOC(4)}', 'up-b-draft', 'Draft paper', '', 'L4', 'draft', null, '', '', '', '');
      update documents set portal_title_override = true where id = '${DOC(1)}';
      insert into publication_plans (publication_id, public_tier, source) values
        ('${DOC(1)}', 'Political Monitor', 'admin'),
        ('${DOC(2)}', 'Political Monitor', 'room');
      insert into subscriber_publication_exceptions (subscriber_id, publication_id, decision, reason, administrator_id) values
        ('11111111-1111-4111-8111-1111111111b1', '${DOC(2)}', 'block', 'Not for them', '${OWNER}');
      insert into papermark_dataroom_documents (id, papermark_dataroom_id, papermark_document_id, title, category, publication_id, version_key) values
        ('44444444-4444-4444-8444-0000000000b1', 'room-b', 'pm-b1', 'Monthly note.pdf', 'MIN', '${DOC(1)}', 'v1'),
        ('44444444-4444-4444-8444-0000000000b2', 'room-b', 'pm-b2', 'Sector update.pdf', 'AIU', '${DOC(2)}', 'v1');
    `)
    snapshot.before = await take()
    await applyMigration(db, FILE)
    snapshot.after = await take()
    await applyMigration(db, FILE)
    snapshot.again = await take()
  })
  after(async () => db?.close())

  it("changes nothing that existed, applied once or twice", () => {
    assert.deepEqual(snapshot.after, snapshot.before)
    assert.deepEqual(snapshot.again, snapshot.before)
  })

  it("backfills nothing: no metadata, tag or summary is guessed for any edition", async () => {
    const rows = (await db.query(`select ${NEW_COLUMNS.join(", ")} from documents`)).rows
    assert.equal(rows.length, 4)
    for (const row of rows) for (const c of NEW_COLUMNS) assert.equal(row[c], null, c)
    for (const t of NEW_TABLES) assert.equal((await db.query(`select count(*)::int as n from ${t}`)).rows[0].n, 0, t)
  })

  it("leaves coverage areas (the public detail page's list) exactly as they were, and makes no tag from them", async () => {
    const [row] = (await db.query(`select coverage_areas from documents where id = $1`, [DOC(1)])).rows
    assert.equal(row.coverage_areas, "Power sector\nTariff regulation")
    assert.equal((await db.query(`select count(*)::int as n from publication_tags`)).rows[0].n, 0)
  })

  it("the DAL sees it applied, and gives readers nothing until an editor enters something", async () => {
    dal.resetEditorialMetadataCache()
    assert.equal(await dal.editorialMetadataReady(tagged(db), { fresh: true }), true)
    const details = await dal.loadReaderPublicationDetails([DOC(1), DOC(2)], { sql: tagged(db) })
    assert.equal(details.size, 0)
    const panel = await dal.loadEditorPanel(tagged(db), DOC(1))
    assert.equal(panel.ready, true)
    assert.deepEqual(panel.metadata, { authorEditor: null, coveredPeriodStart: null, coveredPeriodEnd: null, informationCutoff: null, readingMinutes: null })
    assert.deepEqual(panel.tags, [])
    assert.equal(panel.summary, null)
  })

  // Last in this block: it rolls the upgraded database back.
  it("the rollback, on the upgraded database with saved work: refuses for each kind of saved work, changing nothing, then succeeds once it is cleared", async () => {
    const sql = tagged(db)
    // Saved work as the editor saves it: reader details, a tag on an edition, and an approved summary.
    await db.query(
      `update documents set author_editor = 'APRI Research Team', reading_time_minutes = 9, information_cutoff = '2026-05-28',
              covered_period_start = '2026-05-01', covered_period_end = '2026-05-31' where id = $1`,
      [DOC(1)],
    )
    const [{ id: tagId }] = (await db.query(`insert into publication_tags (kind, label, created_by, updated_by) values ('sector', 'Power', $1, $1) returning id`, [OWNER])).rows
    await db.query(`insert into publication_tag_assignments (publication_id, tag_id, assigned_by) values ($1, $2, $3)`, [DOC(2), tagId, OWNER])
    const text = { whatChanged: "Upgrade change.", whyItMatters: "Upgrade reason.", implications: "Upgrade scenario.", watchNext: "Upgrade signal.", sourceDate: "2026-05-20", uncertainty: "" }
    assert.equal(await summaries.saveSummaryText(sql, { publicationId: DOC(1), revision: 0, text, adminId: OWNER, invalidates: false }), "saved")
    assert.equal(await summaries.approveSummaryRevision(sql, { publicationId: DOC(1), revision: 1, adminId: OWNER }), "saved")
    const shown = (await dal.loadReaderPublicationDetails([DOC(1), DOC(2)], { sql }))
    assert.deepEqual(shown.get(DOC(1))?.summary, text, "the approved summary is live for readers")
    assert.deepEqual(shown.get(DOC(2))?.tags.sector, ["Power"])

    const everything = async () => ({
      existing: await take(),
      documents: (await db.query(`select to_jsonb(d) as row from documents d order by id`)).rows,
      summaries: (await db.query(`select to_jsonb(s) as row from publication_summaries s order by publication_id`)).rows,
      tags: (await db.query(`select to_jsonb(t) as row from publication_tags t order by id`)).rows,
      assignments: (await db.query(`select to_jsonb(a) as row from publication_tag_assignments a order by publication_id, tag_id`)).rows,
      tables: await tables(db),
      columns: await columns(db),
    })
    const refuses = async (pattern) => {
      const before = await everything()
      await assert.rejects(rollback(db), pattern)
      assert.deepEqual(await everything(), before, "refused inside its transaction: nothing changed")
    }

    await refuses(/saved protected summaries exist/)
    await db.query(`delete from publication_summaries`)
    await refuses(/publications carry tags/)
    await db.query(`delete from publication_tag_assignments`)
    await refuses(/the tag vocabulary is not empty/)
    await db.query(`delete from publication_tags`)
    await refuses(/documents\.(author_editor|covered_period_start|covered_period_end|information_cutoff|reading_time_minutes)/)
    await db.query(`update documents set author_editor = null, reading_time_minutes = null, information_cutoff = null where id = $1`, [DOC(1)])
    await refuses(/documents\.covered_period_(start|end)/)
    await db.query(`update documents set covered_period_start = null, covered_period_end = null where id = $1`, [DOC(1)])

    // Nothing saved any more: it succeeds (and again), and every existing row is as it was before the migration.
    await rollback(db)
    await rollback(db)
    assert.deepEqual(await tables(db), [])
    assert.deepEqual(await columns(db), [])
    assert.deepEqual(await take(), snapshot.before)
  })
})

describe("the rollback", () => {
  let db
  before(async () => {
    db = await createSchemaDatabase()
    await db.query(`insert into admins (id, email, name, password_hash, role) values ($1, 'owner-b@example.test', 'Owner', 'x', 'owner')`, [OWNER])
    await db.query(`insert into documents (id, slug, title, series, visibility, status) values ($1, 'rb-b1', 'Rollback note', 'MIN', 'L1', 'published')`, [DOC(1)])
  })
  after(async () => db?.close())

  const refuses = async (pattern) => {
    const before = { documents: (await db.query(`select to_jsonb(d) as row from documents d order by id`)).rows, tables: await tables(db), columns: await columns(db) }
    await assert.rejects(rollback(db), pattern)
    // Refused inside its transaction: nothing changed.
    assert.deepEqual({ documents: (await db.query(`select to_jsonb(d) as row from documents d order by id`)).rows, tables: await tables(db), columns: await columns(db) }, before)
  }

  it("refuses while a protected summary is saved, draft or approved", async () => {
    await db.query(`insert into publication_summaries (publication_id, what_changed) values ($1, 'A draft only')`, [DOC(1)])
    await refuses(/saved protected summaries exist/)
    await db.query(`delete from publication_summaries`)
  })

  it("refuses while a publication carries a tag, or the vocabulary holds one", async () => {
    const [{ id }] = (await db.query(`insert into publication_tags (kind, label, active) values ('geography', 'Lagos', false) returning id`)).rows
    await db.query(`insert into publication_tag_assignments (publication_id, tag_id) values ($1, $2)`, [DOC(1), id])
    await refuses(/publications carry tags/)
    await db.query(`delete from publication_tag_assignments`)
    await refuses(/the tag vocabulary is not empty/)
    await db.query(`delete from publication_tags`)
  })

  it("refuses while any publication record holds one of the new metadata values, naming the column", async () => {
    for (const [column, value] of [["author_editor", "'APRI Research Team'"], ["information_cutoff", "'2026-09-28'"], ["reading_time_minutes", "12"]]) {
      await db.query(`update documents set ${column} = ${value} where id = $1`, [DOC(1)])
      await refuses(new RegExp(`documents\\.${column}`))
      await db.query(`update documents set ${column} = null where id = $1`, [DOC(1)])
    }
    await db.query(`update documents set covered_period_start = '2026-09-01', covered_period_end = '2026-09-30' where id = $1`, [DOC(1)])
    await refuses(/covered period/)
    await db.query(`update documents set covered_period_start = null, covered_period_end = null where id = $1`, [DOC(1)])
  })

  it("succeeds once nothing is saved, can be re-run, and removes only what the migration added", async () => {
    const otherTables = async () => (await db.query(`select table_name from information_schema.tables where table_schema = 'public' order by 1`)).rows.map((r) => r.table_name).filter((t) => !NEW_TABLES.includes(t))
    const otherColumns = async () => (await db.query(`select column_name from information_schema.columns where table_name = 'documents' order by 1`)).rows.map((r) => r.column_name).filter((c) => !NEW_COLUMNS.includes(c))
    const keptTables = await otherTables()
    const keptColumns = await otherColumns()
    await rollback(db)
    await rollback(db)
    assert.deepEqual(await tables(db), [])
    assert.deepEqual(await columns(db), [])
    assert.deepEqual(await otherTables(), keptTables)
    assert.deepEqual(await otherColumns(), keptColumns)
    assert.equal((await db.query(`select title from documents where id = $1`, [DOC(1)])).rows[0].title, "Rollback note")
    // And the migration applies again afterwards.
    await applyMigration(db, FILE)
    assert.deepEqual(await tables(db), NEW_TABLES)
    assert.deepEqual(await columns(db), [...NEW_COLUMNS].sort())
  })

  it("drops only the migration's own tables, columns and checks", () => {
    const code = ROLLBACK.replace(/--.*$/gm, "")
    const drops = [...code.matchAll(/\bdrop (table|column|constraint) if exists (\w+)/g)].map((m) => `${m[1]} ${m[2]}`).sort()
    assert.deepEqual(drops, [
      ...NEW_COLUMNS.map((c) => `column ${c}`),
      "constraint documents_author_editor_check",
      "constraint documents_covered_period_check",
      "constraint documents_reading_time_check",
      ...NEW_TABLES.map((t) => `table ${t}`),
    ].sort())
    assert.doesNotMatch(code, /\b(delete|update|truncate|insert|grant|revoke)\b/i)
  })
})
