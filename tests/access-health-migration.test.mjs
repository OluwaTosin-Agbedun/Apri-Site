/**
 * db/migrations/20261004_paid_release_and_access_health.sql is additive and
 * safe to run more than once, and changes no existing row. Private database.
 */
import { it } from "node:test"
import assert from "node:assert/strict"
import { createSchemaDatabase, applyMigration } from "./support/test-database.mjs"

const FILE = "20261004_paid_release_and_access_health.sql"

it("applies on top of the previous schema, keeps existing rows, and re-runs cleanly", async () => {
  // 20261005 builds on this one, so it is left out too.
  const db = await createSchemaDatabase({ skipMigrations: [FILE, "20261005_publication_plans.sql"] })
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

it("20261005 fills plan ticks from the rooms, keeps what subscribers already hold, and re-runs cleanly", async () => {
  const PLANS = "20261005_publication_plans.sql"
  const db = await createSchemaDatabase({ skipMigrations: [PLANS] })
  const one = async (text, params = []) => (await db.query(text, params)).rows[0]
  await db.query(`insert into papermark_level_rooms (public_tier, papermark_dataroom_id, dataroom_name) values ('Individual Access', 'room_ind', 'Individual')`)
  const doc = async (slug, date, visibility) =>
    (await one(`insert into documents (slug, title, series, visibility, status, is_published, edition_date, summary, cta_label) values ($1, $1, 'MIN', $2, 'draft', false, $3::date, 's', 'Read') returning id`, [slug, visibility, date])).id
  const before = await doc("before", "2026-08-01", "L2")
  const within = await doc("within", "2026-09-10", "L1")
  const legacy = await doc("legacy", "2026-09-05", "L2")
  for (const [pub, pm] of [[before, "pm_before"], [within, "pm_within"]]) {
    await db.query(`insert into papermark_dataroom_documents (papermark_dataroom_id, papermark_document_id, title, category, publication_id, version_key) values ('room_ind', $1, $1, 'MIN', $2, 'v1')`, [pm, pub])
  }
  const sub = (await one(`insert into subscribers (full_name, name, email, level, public_tier, status, seats, term_start, term_end, organization, client_type)
    values ('Held', 'Held', 'held@example.invalid', 'L1', 'Individual Access', 'active', 1, '2026-08-27', '2026-11-11', 'Org', 'subscriber') returning id`)).id
  for (const pm of ["pm_before", "pm_within"]) {
    await db.query(`insert into papermark_subscriber_document_links (subscriber_id, papermark_document_id, papermark_link_id, link_url) values ($1, $2, $3, $4)`, [sub, pm, `pl_${pm}`, `https://docs.example.invalid/view/pl_${pm}`])
  }

  await applyMigration(db, PLANS)
  await applyMigration(db, PLANS)

  const ticks = (await db.query(`select publication_id, public_tier, source from publication_plans order by public_tier`)).rows
  assert.deepEqual(ticks.filter((t) => t.publication_id === before).map((t) => [t.public_tier, t.source]), [["Individual Access", "room"]], "ticked from the room it is in, whatever its old level")
  assert.deepEqual(ticks.filter((t) => t.publication_id === legacy).map((t) => t.public_tier), ["Board Briefing", "Executive Intelligence", "Political Monitor"], "a record in no room keeps its old level's plans")
  const kept = (await db.query(`select publication_id, decision, administrator_id from subscriber_publication_exceptions where subscriber_id = $1`, [sub])).rows
  assert.deepEqual(kept.map((k) => [k.publication_id, k.decision, k.administrator_id]), [[before, "allow", null]], "the edition dated before their term is kept for them; the one inside their term needs nothing")
  assert.equal((await one(`select count(*)::int as n from subscriber_exception_events where subscriber_id = $1`, [sub])).n, 1, "recorded once, even after a second run")
  assert.equal((await one(`select count(*)::int as n from papermark_subscriber_document_links where revoke_state = 'live'`)).n, 2, "no link is touched")
  await db.close()
})
