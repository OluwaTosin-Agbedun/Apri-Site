/**
 * Subscription requests against the isolated test database: the constraints
 * that make the application's promises hold even if a code path forgets them.
 *
 * All data is invented and removed at the end. No real person, address or
 * link is used.
 */
import { describe, it, after } from "node:test"
import assert from "node:assert/strict"
import { sql } from "./helpers.mjs"

const created = { prospects: [], requests: [], subscribers: [] }

async function prospect(email) {
  const [row] = await sql`
    insert into review_prospects (full_name, email, role_profession, user_type, self_reported_source, attributed_source)
    values ('Test Requester', ${email}, 'Analyst', 'Small professional team', 'LinkedIn', 'LinkedIn')
    returning id
  `
  created.prospects.push(row.id)
  return row.id
}

async function request(prospectId, users, extra = {}) {
  const [row] = await sql`
    insert into review_subscription_requests (
      prospect_id, plan, requester_name, requester_email, phone, legal_billing_name, billing_email,
      billing_address, city_state, country, authorised_users, terms_accepted_at, agreement_type, submitted_via
    ) values (
      ${prospectId}::uuid, 'Professional', 'Test Requester', 'req@example.test', '+234 800 000 0000', 'Example Ltd',
      'billing@example.test', '1 Test Road', 'Lagos', 'Nigeria', ${JSON.stringify(users)}::jsonb, now(),
      'APRI Professional Subscription', ${extra.submittedVia ?? "access_page"}
    )
    returning id, submitted_via, requester_confirmed_at
  `
  created.requests.push(row.id)
  return row
}

const people = (n) => Array.from({ length: n }, (_, i) => ({ name: `Person ${i}`, email: `person${i}.${Date.now()}@example.test` }))

after(async () => {
  if (created.subscribers.length) await sql`delete from subscribers where id = any(${created.subscribers}::uuid[])`
  if (created.requests.length) await sql`delete from review_subscription_requests where id = any(${created.requests}::uuid[])`
  // review_prospects rows are kept: their events are append-only by design.
})

describe("the database enforces the plan limits", () => {
  it("accepts one to three named subscribers and refuses four or none", async () => {
    for (const n of [1, 3]) {
      const p = await prospect(`limit-ok-${n}-${Date.now()}@example.test`)
      await request(p, people(n))
    }
    for (const n of [0, 4]) {
      const p = await prospect(`limit-bad-${n}-${Date.now()}@example.test`)
      await assert.rejects(() => request(p, people(n)), /review_subscription_users_check|violates check constraint/)
    }
  })

  it("keeps one request per prospect, so a repeat submission cannot create a second", async () => {
    const p = await prospect(`once-${Date.now()}@example.test`)
    await request(p, people(1))
    await assert.rejects(() => request(p, people(1)), /duplicate key|unique/)
  })
})

describe("the new request columns", () => {
  it("default an existing-style request to the Review Library and accept only known sources", async () => {
    const p = await prospect(`via-${Date.now()}@example.test`)
    const [row] = await sql`
      insert into review_subscription_requests (
        prospect_id, plan, requester_name, requester_email, phone, legal_billing_name, billing_email,
        billing_address, city_state, country, authorised_users, terms_accepted_at, agreement_type
      ) values (${p}::uuid, 'Individual', 'T', 't@example.test', '+234 800 000 0001', 'T', 'b@example.test', 'A', 'C', 'N',
        ${JSON.stringify(people(1))}::jsonb, now(), 'APRI Individual Subscription')
      returning id, submitted_via, requester_confirmed_at
    `
    created.requests.push(row.id)
    assert.equal(row.submitted_via, "review_library")
    assert.equal(row.requester_confirmed_at, null)
    const q = await prospect(`via-bad-${Date.now()}@example.test`)
    await assert.rejects(() => request(q, people(1), { submittedVia: "somewhere_else" }), /review_subscription_submitted_via_check/)
  })
})

describe("subscribers created from a request", () => {
  it("cannot duplicate an email in any letter case", async () => {
    const email = `dup-${Date.now()}@example.test`
    const [first] = await sql`
      insert into subscribers (full_name, name, email, client_type, public_tier, level, seats, status)
      values ('Dup One', 'Dup One', ${email}, 'subscriber', 'Professional Team Access', 'L1', 1, 'pending') returning id
    `
    created.subscribers.push(first.id)
    await assert.rejects(
      () => sql`
        insert into subscribers (full_name, name, email, client_type, public_tier, level, seats, status)
        values ('Dup Two', 'Dup Two', ${email.toUpperCase()}, 'subscriber', 'Professional Team Access', 'L1', 1, 'pending')
      `,
      /duplicate key|unique/,
    )
    // The activation's own insert is a no-op on the same address, not an error or a second row.
    const again = await sql`
      insert into subscribers (full_name, name, email, client_type, public_tier, level, seats, status)
      values ('Dup Three', 'Dup Three', ${email.toUpperCase()}, 'subscriber', 'Professional Team Access', 'L1', 1, 'pending')
      on conflict ((lower(email))) do nothing returning id
    `
    assert.equal(again.length, 0)
  })

  it("stay linked to their request, which cannot then be deleted from under them", async () => {
    const p = await prospect(`link-${Date.now()}@example.test`)
    const r = await request(p, people(1))
    const [sub] = await sql`
      insert into subscribers (full_name, name, email, client_type, public_tier, level, seats, status, subscription_request_id)
      values ('Linked', 'Linked', ${`linked-${Date.now()}@example.test`}, 'subscriber', 'Professional Team Access', 'L1', 1, 'pending', ${r.id}::uuid)
      returning id, subscription_request_id
    `
    created.subscribers.push(sub.id)
    assert.equal(sub.subscription_request_id, r.id)
    await assert.rejects(() => sql`delete from review_subscription_requests where id = ${r.id}::uuid`, /foreign key|violates/)
  })

  it("cannot be active without a level", async () => {
    await assert.rejects(
      () => sql`
        insert into subscribers (full_name, name, email, client_type, public_tier, level, seats, status)
        values ('No Level', 'No Level', ${`nolevel-${Date.now()}@example.test`}, 'subscriber', 'Professional Team Access', null, 1, 'active')
      `,
      /subscribers_level_by_type_check/,
    )
  })
})

describe("the audit trail", () => {
  it("is append-only: an event cannot be edited or removed", async () => {
    const p = await prospect(`audit-${Date.now()}@example.test`)
    const [event] = await sql`
      insert into review_prospect_events (prospect_id, event_type, detail)
      values (${p}::uuid, 'payment_confirmed', 'Payment confirmed on 2026-09-25 (reference TEST-1)')
      returning id
    `
    await assert.rejects(() => sql`update review_prospect_events set detail = 'changed' where id = ${event.id}::uuid`, /append-only/)
    await assert.rejects(() => sql`delete from review_prospect_events where id = ${event.id}::uuid`, /append-only/)
  })
})
