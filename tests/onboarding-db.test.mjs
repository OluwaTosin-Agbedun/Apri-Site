/**
 * The onboarding tracking tables against the isolated test database: the
 * constraints and the claim statements that stop an email being sent twice,
 * reported as sent when it was not, or overwritten by a late writer.
 *
 * The statements below are the service's own (src/lib/subscriber-onboarding.ts);
 * a source check at the end keeps them identical. All data is invented and
 * removed afterwards.
 */
import { describe, it, after } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { sql, makeTag, makeSeat, cleanup } from "./helpers.mjs"

const tag = makeTag("onboarding")
after(() => cleanup(tag))

async function rowsFor(subscriberId) {
  await sql`
    insert into subscriber_onboarding_messages (subscriber_id, kind)
    values (${subscriberId}::uuid, 'welcome'), (${subscriberId}::uuid, 'secure_access')
    on conflict (subscriber_id, kind) do nothing
  `
  const rows = await sql`select id, kind from subscriber_onboarding_messages where subscriber_id = ${subscriberId}::uuid`
  return Object.fromEntries(rows.map((r) => [r.kind, r.id]))
}

const claim = (rowId, allowStale, withinWindow = true) => sql`
  update subscriber_onboarding_messages
  set state = 'sending', attempts = attempts + 1, claimed_at = now(), updated_at = now()
  where id = ${rowId}::uuid
    and (
      state in ('pending', 'failed')
      or (${allowStale}::boolean and state = 'unknown' and ${withinWindow}::boolean)
      or (${allowStale}::boolean and state = 'sending' and claimed_at < now() - interval '2 minutes' and ${withinWindow}::boolean)
    )
  returning attempts
`
const accept = (rowId, id) => sql`
  update subscriber_onboarding_messages
  set state = 'accepted', provider_message_id = ${id}, accepted_at = now(), last_error = null, updated_at = now()
  where id = ${rowId}::uuid and state <> 'accepted'
`
const fail = (rowId, state, message, attempt) => sql`
  update subscriber_onboarding_messages
  set state = ${state}, last_error = ${message}, updated_at = now()
  where id = ${rowId}::uuid and state = 'sending' and attempts = ${attempt}
`
const resendClaim = (subscriberId) => sql`
  insert into subscriber_email_claims (subscriber_id, purpose)
  values (${subscriberId}::uuid, 'signin_resend')
  on conflict (subscriber_id, purpose) do update set claimed_at = now()
    where subscriber_email_claims.claimed_at < now() - (${60} || ' seconds')::interval
  returning claimed_at
`
const state = async (rowId) =>
  (await sql`select state, attempts, provider_message_id from subscriber_onboarding_messages where id = ${rowId}::uuid`)[0]

describe("the onboarding tables", () => {
  it("exist after the additive migration, and start every message pending", async () => {
    const seat = await makeSeat(tag, { suffix: "exists", status: "pending" })
    const ids = await rowsFor(seat.id)
    assert.equal((await state(ids.welcome)).state, "pending")
    assert.equal((await state(ids.secure_access)).attempts, 0)
  })

  it("hold one welcome and one secure-access email per person", async () => {
    const seat = await makeSeat(tag, { suffix: "unique", status: "pending" })
    await rowsFor(seat.id)
    await rowsFor(seat.id)
    const [{ n }] = await sql`select count(*)::int as n from subscriber_onboarding_messages where subscriber_id = ${seat.id}::uuid`
    assert.equal(n, 2)
    await assert.rejects(
      () => sql`insert into subscriber_onboarding_messages (subscriber_id, kind) values (${seat.id}::uuid, 'welcome')`,
      /duplicate key|unique/,
    )
    await assert.rejects(
      () => sql`insert into subscriber_onboarding_messages (subscriber_id, kind) values (${seat.id}::uuid, 'reminder')`,
      /check constraint/,
    )
  })

  it("accept only a message with a provider id, and nothing else as accepted", async () => {
    const seat = await makeSeat(tag, { suffix: "accepted", status: "pending" })
    const ids = await rowsFor(seat.id)
    await assert.rejects(
      () => sql`update subscriber_onboarding_messages set state = 'accepted' where id = ${ids.welcome}::uuid`,
      /check constraint/,
    )
    await assert.rejects(
      () => sql`update subscriber_onboarding_messages set provider_message_id = 'x', accepted_at = now() where id = ${ids.welcome}::uuid`,
      /check constraint/,
    )
  })

  it("let exactly one of several simultaneous attempts claim a message", async () => {
    const seat = await makeSeat(tag, { suffix: "race", status: "active" })
    const ids = await rowsFor(seat.id)
    const results = await Promise.all(Array.from({ length: 6 }, () => claim(ids.welcome, true)))
    assert.equal(results.filter((r) => r.length === 1).length, 1)
    assert.equal((await state(ids.welcome)).attempts, 1)
  })

  it("never hand an unsettled secure-access email to an automatic retry", async () => {
    const seat = await makeSeat(tag, { suffix: "unknown", status: "active" })
    const ids = await rowsFor(seat.id)
    const [{ attempts }] = await claim(ids.secure_access, false)
    await fail(ids.secure_access, "unknown", "timeout", attempts)
    assert.equal((await claim(ids.secure_access, false)).length, 0, "automatic retry refused")
    assert.equal((await claim(ids.secure_access, true)).length, 1, "only an explicit resend takes it")
  })

  it("never let an automatic retry take an unsettled welcome outside the idempotency window", async () => {
    const seat = await makeSeat(tag, { suffix: "window", status: "active" })
    const ids = await rowsFor(seat.id)
    const [{ attempts }] = await claim(ids.welcome, true)
    await fail(ids.welcome, "unknown", "timeout", attempts)
    assert.equal((await claim(ids.welcome, true, false)).length, 0)
    assert.equal((await claim(ids.welcome, true, true)).length, 1)
  })

  it("keep a late writer from an older attempt from undoing a newer one or an acceptance", async () => {
    const seat = await makeSeat(tag, { suffix: "fence", status: "active" })
    const ids = await rowsFor(seat.id)
    const [{ attempts: first }] = await claim(ids.welcome, true)
    await sql`update subscriber_onboarding_messages set claimed_at = now() - interval '3 minutes' where id = ${ids.welcome}::uuid`
    const [{ attempts: second }] = await claim(ids.welcome, true)
    assert.equal(second, first + 1)

    await fail(ids.welcome, "failed", "late refusal", first)
    assert.equal((await state(ids.welcome)).state, "sending", "the older attempt wrote nothing")

    await accept(ids.welcome, "msg-accepted")
    await fail(ids.welcome, "unknown", "later timeout", second)
    await accept(ids.welcome, "msg-other")
    const final = await state(ids.welcome)
    assert.equal(final.state, "accepted")
    assert.equal(final.provider_message_id, "msg-accepted", "the first acceptance stands")
  })

  it("keep each person's messages apart", async () => {
    const ada = await makeSeat(tag, { suffix: "ada", status: "active" })
    const bola = await makeSeat(tag, { suffix: "bola", status: "active" })
    const a = await rowsFor(ada.id)
    const b = await rowsFor(bola.id)
    const [{ attempts }] = await claim(a.secure_access, false)
    await fail(a.secure_access, "failed", "refused", attempts)
    assert.equal((await state(b.secure_access)).state, "pending")
    assert.notEqual(a.welcome, b.welcome)
  })

  it("go when the subscriber record is deleted", async () => {
    const seat = await makeSeat(tag, { suffix: "cascade", status: "pending" })
    await rowsFor(seat.id)
    await resendClaim(seat.id)
    await sql`delete from subscribers where id = ${seat.id}::uuid`
    const [{ n }] = await sql`select count(*)::int as n from subscriber_onboarding_messages where subscriber_id = ${seat.id}::uuid`
    const [{ c }] = await sql`select count(*)::int as c from subscriber_email_claims where subscriber_id = ${seat.id}::uuid`
    assert.equal(n + c, 0)
  })
})

describe("an explicit resend's claim", () => {
  it("is won by one of several simultaneous clicks, then refused inside the window", async () => {
    const seat = await makeSeat(tag, { suffix: "resend", status: "active" })
    const results = await Promise.all(Array.from({ length: 5 }, () => resendClaim(seat.id)))
    assert.equal(results.filter((r) => r.length === 1).length, 1)
    assert.equal((await resendClaim(seat.id)).length, 0)
  })

  it("can be taken again once the window has passed", async () => {
    const seat = await makeSeat(tag, { suffix: "resend-later", status: "active" })
    await resendClaim(seat.id)
    await sql`update subscriber_email_claims set claimed_at = now() - interval '2 minutes' where subscriber_id = ${seat.id}::uuid`
    assert.equal((await resendClaim(seat.id)).length, 1)
  })

  it("accepts only a known purpose", async () => {
    const seat = await makeSeat(tag, { suffix: "purpose", status: "active" })
    await assert.rejects(
      () => sql`insert into subscriber_email_claims (subscriber_id, purpose) values (${seat.id}::uuid, 'anything')`,
      /check constraint/,
    )
  })
})

describe("revoking older sign-in links", () => {
  it("keeps any link issued after the new one", async () => {
    const seat = await makeSeat(tag, { suffix: "tokens", status: "active" })
    const insert = (hash, secondsAgo) => sql`
      insert into auth_tokens (subscriber_id, token_hash, expires_at, created_at)
      values (${seat.id}::uuid, ${hash}, now() + interval '15 minutes', now() - (${secondsAgo} || ' seconds')::interval)
    `
    await insert(`${tag}-older`, 30)
    await insert(`${tag}-kept`, 20)
    await insert(`${tag}-newer`, 10)
    // The statement in src/lib/magic-link.ts revokeOtherTokens, with the kept hash.
    await sql`
      update auth_tokens set consumed_at = now()
      where subscriber_id = ${seat.id}::uuid and consumed_at is null
        and token_hash <> ${`${tag}-kept`}
        and created_at < (select k.created_at from auth_tokens k where k.token_hash = ${`${tag}-kept`})
    `
    const rows = await sql`select token_hash, consumed_at is not null as used from auth_tokens where subscriber_id = ${seat.id}::uuid order by created_at`
    assert.deepEqual(rows.map((r) => r.used), [true, false, false])
    const magic = readFileSync(new URL("../src/lib/magic-link.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n")
    assert.ok(magic.includes("and created_at < (select k.created_at from auth_tokens k where k.token_hash = ${hashToken(keepToken)})"))
  })
})

describe("the service uses these same statements", () => {
  const source = readFileSync(new URL("../src/lib/subscriber-onboarding.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n")
  it("claims, fences and records exactly as tested here", () => {
    assert.ok(source.includes(`        state in ('pending', 'failed')
        or (\${allowStale}::boolean and state = 'unknown' and \${withinWindow}::boolean)
        or (\${allowStale}::boolean and state = 'sending' and claimed_at < now() - interval '2 minutes' and \${withinWindow}::boolean)`))
    assert.match(source, /claimRow\(sql, row\.id, allowStale, row\.kind !== 'welcome' \|\| withinIdempotencyWindow\(row, Date\.now\(\)\)\)/)
    assert.ok(source.includes(`where id = \${rowId}::uuid and state <> 'accepted'`))
    assert.ok(source.includes(`where id = \${rowId}::uuid and state = 'sending' and attempts = \${attempt}`))
    assert.ok(source.includes(`on conflict (subscriber_id, purpose) do update set claimed_at = now()
        where subscriber_email_claims.claimed_at < now() - (\${RESEND_WINDOW_SECONDS} || ' seconds')::interval`))
  })

  it("an explicit resend revokes older links only after the provider accepted the new one", () => {
    const fn = source.slice(source.indexOf("export async function resendSecureAccessEmail"), source.indexOf("export type OnboardingStatus"))
    assert.match(fn, /issueToken\(sub\.id, \{ revokeOutstanding: false \}\)/)
    const accepted = fn.indexOf("case 'accepted':")
    assert.ok(accepted > 0 && fn.indexOf("revokeOtherTokens(sub.id, token)") > accepted)
    assert.ok(fn.indexOf("revokeIssuedToken(token)") > fn.indexOf("case 'not_configured':"))
    assert.doesNotMatch(fn, /sendWelcome\(/, "the explicit resend never repeats the welcome")
    // A welcome that may already be in the inbox is not sent again by a resend.
    assert.match(fn, /if \(welcome && \(welcome\.state === 'pending' \|\| welcome\.state === 'failed'\)\)/)
    // Before the migration there is no atomic claim, so older links are left to expire.
    assert.match(fn, /if \(tracked\) \{\s+try \{\s+await revokeOtherTokens/)
  })

  it("onboarding emails go only to a subscriber inside their term", () => {
    const fn = source.slice(source.indexOf("export async function sendOnboardingEmails"), source.indexOf("async function claimRow"))
    assert.match(fn, /loadActive\(sql, args\.subscriberId, \{ inTerm: true \}\)/)
  })

  it("automatic onboarding sends never revoke another link", () => {
    assert.match(source, /issueToken\(sub\.id, \{ revokeOutstanding: false \}\)/)
    assert.doesNotMatch(source.slice(0, source.indexOf("export async function resendSecureAccessEmail")), /revokeOtherTokens\(/)
  })
})
