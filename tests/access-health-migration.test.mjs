/**
 * db/migrations/20261004_paid_release_and_access_health.sql is additive and
 * safe to run more than once, and changes no existing row. Private database.
 */
import { it } from "node:test"
import assert from "node:assert/strict"
import { createSchemaDatabase, applyMigration } from "./support/test-database.mjs"

const FILE = "20261004_paid_release_and_access_health.sql"

it("applies on top of the previous schema, keeps existing rows, and re-runs cleanly", async () => {
  const db = await createSchemaDatabase({ skipMigrations: [FILE] })
  await db.query(`insert into documents (slug, title, series, visibility, status, is_published, summary, cta_label) values ('m1', 'Record', 'MIN', 'L1', 'draft', false, 's', 'Read')`)
  await applyMigration(db, FILE)
  await applyMigration(db, FILE)
  const { rows } = await db.query(`select status, paid_release_state from documents where slug = 'm1'`)
  assert.deepEqual(rows, [{ status: "draft", paid_release_state: null }], "no release decision is invented for an existing record")
  const cols = await db.query(`select column_name from information_schema.columns where table_name = 'subscriber_access_reconciliations' and column_name in ('lease_token', 'outcome', 'last_verified_at')`)
  assert.equal(cols.rows.length, 3)
  await assert.rejects(db.query(`update documents set paid_release_state = 'maybe' where slug = 'm1'`), "only released or withheld")
  await db.close()
})
