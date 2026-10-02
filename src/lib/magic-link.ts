import { readSubscriberTerm } from "./subscriber-principal"
import { signInDecision } from "./subscription-term"
import "server-only"
import { randomBytes, timingSafeEqual } from "node:crypto"
import { getSql } from "./db"
import { createSubscriberSession } from "./subscriber-session"
import { assertSessionKey } from "./subscriber-session-token"
import { signInSchemaReady } from "./sign-in-schema"
import {
  hashToken,
  storedTokenFailureReason,
  deriveSignInCode,
  signInCodeHash,
  normaliseSignInCode,
  sameHash,
  SIGN_IN_CODE_MAX_ATTEMPTS,
} from "./magic-token"
import { recordClientEvent } from "./client-engagement"

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
 *
 * `revokeOutstanding: false` is for an automatic onboarding send: it must not
 * invalidate a link that may already be in the subscriber's inbox. The new
 * link still expires on its own schedule.
 */
export async function issueToken(
  subscriberId: string,
  options: { revokeOutstanding?: boolean; bindingHash?: string | null } = {},
): Promise<string> {
  const sql = getSql()
  const token = randomBytes(TOKEN_BYTES).toString("base64url")

  if (options.revokeOutstanding !== false) {
    await sql`
      update auth_tokens
      set consumed_at = now()
      where subscriber_id = ${subscriberId} and consumed_at is null
    `
  }

  if (await signInSchemaReady()) {
    // The code printed beside the link, kept only as a keyed hash; and, when
    // a browser asked for this link, the hash of that browser's own cookie.
    const tokenHash = hashToken(token)
    await sql`
      insert into auth_tokens (subscriber_id, token_hash, expires_at, code_hash, binding_hash)
      values (
        ${subscriberId},
        ${tokenHash},
        now() + (${TTL_MINUTES} || ' minutes')::interval,
        ${codeHashFor(token, tokenHash)},
        ${options.bindingHash ?? null}
      )
    `
    return token
  }

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

function sessionSecret(): string {
  assertSessionKey()
  return process.env.SESSION_SECRET!
}

/** The stored hash of a link's code, or null when no session key is configured (no code is then printed). */
function codeHashFor(token: string, tokenHash: string): string | null {
  try {
    const secret = sessionSecret()
    return signInCodeHash(tokenHash, deriveSignInCode(token, secret), secret)
  } catch {
    return null
  }
}

/**
 * The 8-digit code that belongs to a link, for the email -- or null before
 * the sign-in migration, when no code is stored and none should be printed.
 */
export async function signInCodeFor(token: string): Promise<string | null> {
  try {
    return (await signInSchemaReady()) ? deriveSignInCode(token, sessionSecret()) : null
  } catch {
    return null
  }
}

/**
 * A link's state, read WITHOUT spending it: whether it can still be used, and
 * whether the browser presenting it is the one that asked for it.
 */
export async function inspectToken(
  token: string,
  bindingHash: string | null,
): Promise<{ usable: false; reason: "invalid" | "expired" | "used" } | { usable: true; sameBrowser: boolean }> {
  if (!token || token.length < 16 || token.length > 200) return { usable: false, reason: "invalid" }
  const rows = (await getSql()`
    select consumed_at, expires_at, binding_hash from auth_tokens
    where token_hash = ${hashToken(token)} limit 1
  `) as { consumed_at: string | null; expires_at: string; binding_hash: string | null }[]
  const row = rows[0]
  if (!row) return { usable: false, reason: "invalid" }
  if (row.consumed_at) return { usable: false, reason: "used" }
  if (new Date(row.expires_at) <= new Date()) return { usable: false, reason: "expired" }
  return { usable: true, sameBrowser: sameHash(row.binding_hash, bindingHash) }
}

/** Puts a spent link back, when signing in failed after it was spent. */
async function restoreToken(tokenHash: string): Promise<void> {
  try {
    await getSql()`
      update auth_tokens set consumed_at = null
      where token_hash = ${tokenHash} and consumed_at > now() - interval '2 minutes' and expires_at > now()
    `
  } catch {
    // The link then reads as used; the subscriber requests another.
  }
}

/**
 * Revokes one issued token -- one whose email the provider refused, so it
 * never reached anybody. Every other outstanding link is left alone.
 */
export async function revokeIssuedToken(token: string): Promise<void> {
  const sql = getSql()
  await sql`
    update auth_tokens set consumed_at = now()
    where token_hash = ${hashToken(token)} and consumed_at is null
  `
}

/**
 * Revokes a subscriber's outstanding links issued BEFORE `keepToken` -- used
 * once an explicit resend's new link has been accepted by the provider, so an
 * older link stops working only after its replacement is on its way. A link
 * issued after it (the subscriber asking on the sign-in page meanwhile) is
 * left alone, so overlapping sends never leave them with no working link.
 */
export async function revokeOtherTokens(subscriberId: string, keepToken: string): Promise<void> {
  const sql = getSql()
  await sql`
    update auth_tokens set consumed_at = now()
    where subscriber_id = ${subscriberId} and consumed_at is null
      and token_hash <> ${hashToken(keepToken)}
      and created_at < (select k.created_at from auth_tokens k where k.token_hash = ${hashToken(keepToken)})
  `
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
  principalType: "subscriber"
} | {
  ok: false
  reason: "invalid" | "expired" | "used" | "inactive" | "suspended" | "subscription-expired" | "session-failed"
}

async function failedTokenReason(hash: string): Promise<SignInResult> {
  const sql = getSql()
  const rows = (await sql`select consumed_at, expires_at from auth_tokens
    where token_hash=${hash} limit 1`) as {
    consumed_at: string | null
    expires_at: string
  }[]
  return { ok: false, reason: storedTokenFailureReason(rows[0]) }
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
  // No session could be signed: say so before spending the link.
  try {
    assertSessionKey()
  } catch {
    return { ok: false, reason: "session-failed" }
  }
  const principal = await consumeToken(token)
  if (!principal) {
    if (!token || token.length < 16 || token.length > 200)
      return { ok: false, reason: "invalid" }
    return failedTokenReason(hashToken(token))
  }

  const sql = getSql()

  // Eligibility is re-checked at the moment of use. A seat suspended in the
  // fifteen minutes since the link was sent must not still let its holder in.
  if (principal.type !== "subscriber") return { ok: false, reason: "inactive" }

  // Status and term only, in Lagos days (src/lib/subscription-term.ts). Which
  // documents the subscription covers, and whether their links are ready, are
  // the portal's to explain -- never a reason to refuse a valid sign-in.
  const subscriber = await readSubscriberTerm({ id: principal.id })
  if (!subscriber) return { ok: false, reason: "invalid" }
  const decision = signInDecision(subscriber.subscription)
  if (!decision.ok) return { ok: false, reason: decision.reason }

  return openSession(subscriber.id, "link", hashToken(token))
}

/**
 * Opens this browser's session for a subscriber whose link or code was just
 * spent. If the session cannot be created, the link or code is put back so
 * the same email still works, and the subscriber is told exactly that.
 */
async function openSession(subscriberId: string, method: "link" | "code", tokenHash: string): Promise<SignInResult> {
  try {
    await createSubscriberSession(subscriberId, method)
  } catch {
    await restoreToken(tokenHash)
    return { ok: false, reason: "session-failed" }
  }
  try { await recordClientEvent({ type: "subscriber", id: subscriberId }, "signin_completed") } catch {}
  return { ok: true, principalType: "subscriber" }
}

/**
 * Signs in with the 8-digit code from a sign-in email, in the browser it is
 * typed into.
 *
 * The code is checked against every unspent, unexpired link of the subscriber
 * with that address; each wrong code counts against all of them, and a link's
 * code stops working after five wrong tries (the link itself still works). The
 * caller also limits wrong codes per address per day. An unknown address and
 * a wrong code give the same answer.
 */
export async function signInWithCode(email: string, input: string): Promise<SignInResult> {
  const code = normaliseSignInCode(input)
  if (!code || !(await signInSchemaReady())) return { ok: false, reason: "invalid" }
  try {
    assertSessionKey()
  } catch {
    return { ok: false, reason: "session-failed" }
  }
  const subscriber = await readSubscriberTerm({ email: email.trim().toLowerCase() })
  if (!subscriber) return { ok: false, reason: "invalid" }

  const sql = getSql()
  const rows = (await sql`
    select id, token_hash, code_hash from auth_tokens
    where subscriber_id = ${subscriber.id}::uuid
      and consumed_at is null and expires_at > now()
      and code_hash is not null and code_attempts < ${SIGN_IN_CODE_MAX_ATTEMPTS}
    order by created_at desc
    limit 5
  `) as { id: string; token_hash: string; code_hash: string }[]
  const match = rows.find((row) => sameHash(signInCodeHash(row.token_hash, code, sessionSecret()), row.code_hash))
  if (!match) {
    if (rows.length > 0) {
      await sql`update auth_tokens set code_attempts = code_attempts + 1 where id = any(${rows.map((r) => r.id)}::uuid[])`
    }
    return { ok: false, reason: "invalid" }
  }

  // Spent atomically: a code and its link open one session between them.
  const spent = (await sql`
    update auth_tokens set consumed_at = now()
    where id = ${match.id}::uuid and consumed_at is null and expires_at > now()
      and code_attempts < ${SIGN_IN_CODE_MAX_ATTEMPTS}
    returning id
  `) as { id: string }[]
  if (!spent[0]) return { ok: false, reason: "invalid" }

  const decision = signInDecision(subscriber.subscription)
  if (!decision.ok) return { ok: false, reason: decision.reason }
  return openSession(subscriber.id, "code", match.token_hash)
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
