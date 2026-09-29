/**
 * Fresh setup and upgrade, in isolated in-memory databases.
 *
 * Fresh: db/schema.sql and every migration build a working database (the
 * loader stops on anything that fails, bar two known lines in schema.sql).
 *
 * Upgrade: a database at the schema before this release -- without its new
 * migrations -- is seeded with representative existing subscribers,
 * publications and a Review Library subscription request, then the new
 * migrations are applied in order. Nothing that existed may change, the new
 * columns take their safe defaults, and each migration can be re-run.
 *
 * Everything here is invented; no production data is used.
 */
import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { createSchemaDatabase, applyMigration } from "./support/test-database.mjs"

const NEW_MIGRATIONS = ["20260930_portal_title_override.sql", "20260930_subscription_activation.sql"]

describe("a fresh database", () => {
  let db
  before(async () => {
    db = await createSchemaDatabase()
  })
  after(async () => db?.close())

  it("has every column this release reads", async () => {
    const { rows } = await db.query(`
      select table_name, column_name from information_schema.columns
      where (table_name, column_name) in (
        ('documents', 'portal_title_override'),
        ('subscribers', 'subscription_request_id'),
        ('review_subscription_requests', 'submitted_via'),
        ('review_subscription_requests', 'requester_confirmed_at'),
        ('papermark_subscriber_document_links', 'expires_at')
      )
    `)
    assert.equal(rows.length, 5)
  })
})

describe("upgrading an existing database", () => {
  let db
  const before_ = {}
  before(async () => {
    db = await createSchemaDatabase({ skipMigrations: NEW_MIGRATIONS })
    const has = await db.query(`select 1 from information_schema.columns where table_name = 'subscribers' and column_name = 'subscription_request_id'`)
    assert.equal(has.rows.length, 0, "the upgrade starts from the schema without this release")

    // Representative existing data: an active and a pending subscriber, a
    // publication with an editorial title, and a request from the Review Library.
    await db.query(`
      insert into subscribers (id, full_name, name, email, client_type, public_tier, level, seats, term_start, term_end, status)
      values
        ('11111111-1111-4111-8111-111111111111', 'Existing Active', 'Existing Active', 'active@example.test', 'subscriber',
         'Political Monitor', 'L2', 3, '2026-01-01', '2027-01-01', 'active'),
        ('22222222-2222-4222-8222-222222222222', 'Existing Pending', 'Existing Pending', 'pending@example.test', 'subscriber',
         'Individual Access', 'L1', 1, null, '2027-01-01', 'pending')
    `)
    await db.query(`insert into documents (id, slug, title) values ('33333333-3333-4333-8333-333333333333', 'min-august-2026', 'Athena Nigeria Monthly Intelligence Note August 2026 final')`)
    await db.query(`
      insert into review_prospects (id, full_name, email, role_profession, user_type, self_reported_source, attributed_source, verified_at, status, first_utm_source)
      values ('44444444-4444-4444-8444-444444444444', 'Existing Prospect', 'prospect@example.test', 'Director', 'Corporate or institutional', 'Referral', 'LinkedIn', now(), 'Subscription Requested', 'linkedin')
    `)
    await db.query(`
      insert into review_subscription_requests (id, prospect_id, plan, requester_name, requester_email, phone, legal_billing_name, billing_email,
        billing_address, city_state, country, authorised_users, terms_accepted_at, agreement_type, agreement_sent_at)
      values ('55555555-5555-4555-8555-555555555555', '44444444-4444-4444-8444-444444444444', 'Professional', 'Existing Prospect',
        'prospect@example.test', '+234 800 000 0002', 'Example Ltd', 'billing@example.test', '1 Test Road', 'Lagos', 'Nigeria',
        '[{"name":"A","email":"a@example.test"},{"name":"B","email":"b@example.test"}]', now(), 'APRI Professional Subscription', '2026-09-20')
    `)
    before_.subscribers = (await db.query(`select id, email, status, level, public_tier, seats, term_end from subscribers order by id`)).rows
    before_.documents = (await db.query(`select id, title from documents order by id`)).rows
    before_.request = (await db.query(`select * from review_subscription_requests`)).rows[0]

    for (const file of NEW_MIGRATIONS) await applyMigration(db, file)
  })
  after(async () => db?.close())

  it("leaves every existing subscriber exactly as it was", async () => {
    const now = (await db.query(`select id, email, status, level, public_tier, seats, term_end from subscribers order by id`)).rows
    assert.deepEqual(now, before_.subscribers)
    const links = (await db.query(`select count(*)::int as n from subscribers where subscription_request_id is not null`)).rows[0]
    assert.equal(links.n, 0, "no existing subscriber is linked to a request by the migration")
  })

  it("leaves publications' titles unchanged and marks none as an override", async () => {
    const now = (await db.query(`select id, title from documents order by id`)).rows
    assert.deepEqual(now, before_.documents)
    const overrides = (await db.query(`select count(*)::int as n from documents where portal_title_override`)).rows[0]
    assert.equal(overrides.n, 0)
  })

  it("treats the existing request as a Review Library request, unchanged otherwise", async () => {
    const now = (await db.query(`select * from review_subscription_requests`)).rows[0]
    assert.equal(now.submitted_via, "review_library")
    assert.equal(now.requester_confirmed_at, null)
    for (const [key, value] of Object.entries(before_.request)) {
      assert.deepEqual(now[key], value, key)
    }
  })

  it("can be run again without error or change", async () => {
    for (const file of NEW_MIGRATIONS) await applyMigration(db, file)
    const now = (await db.query(`select id, email, status, level, public_tier, seats, term_end from subscribers order by id`)).rows
    assert.deepEqual(now, before_.subscribers)
  })
})
