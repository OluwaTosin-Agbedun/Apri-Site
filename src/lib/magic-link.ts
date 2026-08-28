import "server-only"
import { randomBytes, timingSafeEqual } from "node:crypto"
import { getSql } from "./db"
import { createSubscriberSession } from "./subscriber-session"
import { hashToken, storedTokenFailureReason } from "./magic-token"
import { recordClientEvent } from "./client-engagement"
import { hashToken } from "./magic-token"

/**
 * One-time sign-in tokens for subscribers.
 *
 * No password is ever stored for a subscriber. Sign-in is proof of control of
 * the mailbox we already hold on file, which is also the address the
 * watermarked document is issued to.
 *
 * Only the SHA-256 hash of a token is written to the database. A read of
 * `auth_tokens` -- a backup, a log, a leaked query result -- therefore yields
 * nothing replayable.
 */

const TOKEN_BYTES = 32 // 256 bits of entropy.
const TTL_MINUTES = 15

export { hashToken } from "./magic-token"

/**
 * Issues a token for a subscriber and returns the raw value, which is sent by
 * email and never persisted.
 *
 * Any token already outstanding for this subscriber is consumed first, so a
 * fresh request invalidates an older link rather than leaving several valid
 * doors open at once.
 */
export async function issueToken(subscriberId: string): Promise<string> {
  const sql = getSql()
  const token = randomBytes(TOKEN_BYTES).toString("base64url")

  await sql`
    update auth_tokens
    set consumed_at = now()
    where subscriber_id = ${subscriberId} and consumed_at is null
  `

  await sql`
    insert into auth_tokens (subscriber_id, token_hash, expires_at)
    values (
      ${subscriberId},
      ${hashToken(token)},
      now() + (${TTL_MINUTES} || ' minutes')::interval
    )
  `

  return token
}

export async function issueBriefingToken(
  briefingRequestId: string,
): Promise<string> {
  const sql = getSql()
  const token = randomBytes(TOKEN_BYTES).toString("base64url")
  await sql`update auth_tokens set consumed_at = now()
    where briefing_request_id = ${briefingRequestId} and consumed_at is null`
  await sql`insert into auth_tokens (briefing_request_id, token_hash, expires_at)
    values (${briefingRequestId}, ${hashToken(token)},
            now() + (${TTL_MINUTES} || ' minutes')::interval)`
  return token
}

/**
 * Verifies and consumes a token, returning the subscriber id or null.
 *
 * The consuming update is the atomic step: `consumed_at is null` in the WHERE
 * clause means two simultaneous uses of the same link cannot both succeed, so a
 * forwarded or prefetched URL is spent exactly once. Postgres, not application
 * logic, is what makes it single-use.
 */
export async function consumeToken(
  token: string,
): Promise<{
  id: string
  type: "subscriber" | "briefing"
} | null> {
  if (!token || token.length < 16 || token.length > 200) return null

  const sql = getSql()
  const hash = hashToken(token)
  const [schema] = (await sql`
    select exists (select 1 from information_schema.columns
      where table_schema='public' and table_name='auth_tokens'
        and column_name='briefing_request_id') as ready
  `) as { ready: boolean }[]
  const rows = (
    schema?.ready
      ? await sql.query(
          `update auth_tokens set consumed_at=now()
        where token_hash=$1 and consumed_at is null and expires_at>now()
        returning subscriber_id,briefing_request_id,token_hash`,
          [hash],
        )
      : await sql.query(
          `update auth_tokens set consumed_at=now()
        where token_hash=$1 and consumed_at is null and expires_at>now()
        returning subscriber_id,null::uuid as briefing_request_id,token_hash`,
          [hash],
        )
  ) as {
    subscriber_id: string | null
    briefing_request_id: string | null
    token_hash: string
  }[]

  const row = rows[0]
  if (!row) return null

  // The lookup above is already an equality match on a unique index, but the
  // comparison is repeated in constant time so that no future refactor of this
  // function can reintroduce a timing signal on the token value.
  if (!constantTimeEquals(row.token_hash, hash)) return null

  return row.subscriber_id
    ? { id: row.subscriber_id, type: "subscriber" }
    : row.briefing_request_id
      ? { id: row.briefing_request_id, type: "briefing" }
      : null
}

export type SignInResult = {
  ok: true
  principalType: "subscriber" | "briefing"
} | {
  ok: false
  reason: "invalid" | "expired" | "used" | "inactive" | "subscription-expired"
}

async function failedTokenReason(hash: string): Promise<SignInResult> {
  const sql = getSql()
  const rows = (await sql`select consumed_at, expires_at from auth_tokens
    where token_hash=${hash} limit 1`) as {
    consumed_at: string | null
    expires_at: string
  }[]
  return { ok: false, reason: storedTokenFailureReason(rows[0]) }
  const row = rows[0]
  if (!row) return { ok: false, reason: "invalid" }
  if (row.consumed_at) return { ok: false, reason: "used" }
  if (new Date(row.expires_at) <= new Date())
    return { ok: false, reason: "expired" }
  return { ok: false, reason: "invalid" }
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8")
  const bufferB = Buffer.from(b, "utf8")
  if (bufferA.length !== bufferB.length) return false
  return timingSafeEqual(bufferA, bufferB)
}

/**
 * Consumes a token and opens a session, returning whether it worked.
 *
 * Lives here rather than in the actions file on purpose: it is called by the
 * /portal/verify route handler, not submitted from a form, and putting it in a
 * `'use server'` module would publish it as a POST endpoint for no reason.
 */
export async function signInWithToken(token: string): Promise<SignInResult> {
  const principal = await consumeToken(token)
  if (!principal) {
    if (!token || token.length < 16 || token.length > 200)
      return { ok: false, reason: "invalid" }
    return failedTokenReason(hashToken(token))
  }

  const sql = getSql()

  // Eligibility is re-checked at the moment of use. A seat suspended in the
  // fifteen minutes since the link was sent must not still let its holder in.
  if (principal.type === "briefing") {
    const rows = (await sql`
      select id from briefing_requests
      where id = ${principal.id} and status = 'Active'
        and private_link_url is not null and private_link_url <> ''
      limit 1
    `) as { id: string }[]
    if (!rows[0]) return { ok: false, reason: "inactive" }
    await createSubscriberSession(principal.id, "briefing")
    try { await recordClientEvent({type:"briefing",id:principal.id},"signin_completed") } catch {}
    return { ok: true, principalType: "briefing" }
  }

  const rows = (await sql`
    select id, status, term_end from subscribers where id = ${principal.id} limit 1
  `) as { id: string; status: string; term_end: string | null }[]

  const subscriber = rows[0]
  if (!subscriber) return { ok: false, reason: "invalid" }

  const status = subscriber.status.toLowerCase()
  const termCurrent =
    !subscriber.term_end || new Date(subscriber.term_end) >= startOfToday()

  if (status !== "active") return { ok: false, reason: "inactive" }
  if (!termCurrent) return { ok: false, reason: "subscription-expired" }

  await createSubscriberSession(subscriber.id, "subscriber")
  try { await recordClientEvent({type:"subscriber",id:subscriber.id},"signin_completed") } catch {}
  return { ok: true, principalType: "subscriber" }
}

function startOfToday(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

/** Housekeeping: drop spent and expired tokens. Safe to call at any time. */
export async function pruneTokens(): Promise<void> {
  const sql = getSql()
  await sql`
    delete from auth_tokens
    where expires_at < now() - interval '7 days'
       or (consumed_at is not null and consumed_at < now() - interval '7 days')
  `
}
