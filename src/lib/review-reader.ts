import "server-only"
import { randomBytes } from "node:crypto"
import { cookies } from "next/headers"
import { SignJWT, jwtVerify } from "jose"
import { getSql } from "./db"
import { readReviewSession } from "./review-security"
import { getReviewLibraryForEmail } from "./publications"
import {
  hashToken,
  deriveSignInCode,
  signInCodeHash,
  normaliseSignInCode,
  sameHash,
  SIGN_IN_CODE_MAX_ATTEMPTS,
} from "./magic-token"

/**
 * The remembered Complimentary Review Library: one email verification on APRI,
 * then return visits in the same browser without verifying again.
 *
 * Kept entirely apart from paid subscriber sign-in: its own tables, its own
 * cookie (scoped to /review, audience "review-reader") and its own sessions.
 * A subscriber cookie can never open the review library or the reverse.
 *
 * The session proves only WHICH email this browser verified. What that email
 * may read is decided on every listing and every open by the per-edition
 * recipient lists and each edition's state (src/lib/publications.ts,
 * getReviewLibraryForEmail), so a withdrawal or a removed recipient takes
 * effect immediately, whatever the cookie says.
 */

export const READER_COOKIE = "apri_review_reader"
export const READER_PENDING_COOKIE = "apri_review_pending"
export const READER_LINK_COOKIE = "apri_review_link"
const SESSION_SECONDS = 60 * 60 * 24 * 90
const TOKEN_MINUTES = 15

function secret(): string {
  const value = process.env.SESSION_SECRET
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters")
  return value
}
const key = () => new TextEncoder().encode(secret())
const cookieBase = () => ({ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const })
export const readerCookieOptions = () => ({ ...cookieBase(), path: "/review", maxAge: SESSION_SECONDS })
export const readerShortCookieOptions = () => ({ ...cookieBase(), path: "/review", maxAge: TOKEN_MINUTES * 60 })

export function normaliseReaderEmail(value: unknown): string | null {
  const email = String(value ?? "").trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null
}

let ready: { value: boolean; at: number } | null = null
/** Whether 20261008_review_reader_library.sql has been applied. */
export async function reviewReaderSchemaReady(): Promise<boolean> {
  if (ready && Date.now() - ready.at < (ready.value ? 300_000 : 60_000)) return ready.value
  try {
    const [row] = (await getSql()`select to_regclass('public.review_reader_sessions') is not null
      and to_regclass('public.review_reader_tokens') is not null as ok`) as { ok: boolean }[]
    ready = { value: row?.ok === true, at: Date.now() }
  } catch {
    ready = { value: false, at: Date.now() }
  }
  return ready.value
}
export function resetReviewReaderSchemaCache() {
  ready = null
}

/**
 * Where the public Complimentary Review cards lead: straight to each
 * edition's Papermark link (the current behaviour, and the default), or into
 * the remembered APRI Review Library. Reversible from Admin at any time.
 */
export async function reviewEntryMode(): Promise<"papermark" | "library" | "rooms"> {
  try {
    const [row] = (await getSql()`select value from app_settings where key = 'review_entry_mode'`) as { value: string }[]
    if (row?.value === "rooms") {
      // Only after an owner has recorded the controlled two-reader proof.
      const { readerRoomsSchemaReady } = await import("./review-reader-rooms")
      return (await readerRoomsSchemaReady()) && (await reviewRoomsProof()) ? "rooms" : "papermark"
    }
    return row?.value === "library" && (await reviewReaderSchemaReady()) ? "library" : "papermark"
  } catch {
    return "papermark"
  }
}

export type RoomsProof = { at: string; by: string; readers: number; checks: string[] }

/** The owner's record that the controlled two-reader Papermark test passed, or null. */
export async function reviewRoomsProof(): Promise<RoomsProof | null> {
  try {
    const [row] = (await getSql()`select value from app_settings where key = 'review_rooms_proof'`) as { value: string }[]
    const proof = row ? (JSON.parse(row.value) as RoomsProof) : null
    return proof && typeof proof.at === "string" ? proof : null
  } catch {
    return null
  }
}

/** Whether this address may currently read at least one published edition. */
export async function readerHasEditions(email: string): Promise<boolean> {
  return (await getReviewLibraryForEmail(email)).length > 0
}

// ---------------------------------------------------------------------------
// Sign-in links and codes
// ---------------------------------------------------------------------------

const codeFor = (token: string) => deriveSignInCode(`review-reader:${token}`, secret())

/** Issues a link (and its code) for an approved address; earlier unused links stop working. */
export async function issueReaderSignIn(email: string, bindingHash: string | null): Promise<{ token: string; code: string }> {
  const sql = getSql()
  const token = randomBytes(32).toString("base64url")
  const tokenHash = hashToken(token)
  const code = codeFor(token)
  await sql`update review_reader_tokens set consumed_at = now() where email = ${email} and consumed_at is null`
  await sql`
    insert into review_reader_tokens (email, token_hash, code_hash, binding_hash, expires_at)
    values (${email}, ${tokenHash}, ${signInCodeHash(tokenHash, code, secret())}, ${bindingHash},
            now() + (${TOKEN_MINUTES} || ' minutes')::interval)
  `
  return { token, code }
}

export async function inspectReaderToken(
  token: string,
  bindingHash: string | null,
): Promise<{ usable: false } | { usable: true; sameBrowser: boolean }> {
  if (!/^[A-Za-z0-9_-]{40,80}$/.test(token)) return { usable: false }
  const [row] = (await getSql()`
    select binding_hash from review_reader_tokens
    where token_hash = ${hashToken(token)} and consumed_at is null and expires_at > now() limit 1
  `) as { binding_hash: string | null }[]
  return row ? { usable: true, sameBrowser: sameHash(row.binding_hash, bindingHash) } : { usable: false }
}

export type ReaderSignIn = { ok: true; email: string } | { ok: false; reason: "invalid" | "no_editions" | "session_failed" }

/** Spends a link and signs in THIS browser. */
export async function signInReaderWithToken(token: string): Promise<ReaderSignIn> {
  if (!/^[A-Za-z0-9_-]{40,80}$/.test(token)) return { ok: false, reason: "invalid" }
  const [row] = (await getSql()`
    update review_reader_tokens set consumed_at = now()
    where token_hash = ${hashToken(token)} and consumed_at is null and expires_at > now()
    returning id, email
  `) as { id: string; email: string }[]
  if (!row) return { ok: false, reason: "invalid" }
  return openReaderSession(row.email, "link", row.id)
}

/** Signs in THIS browser with the code from the same email. Five tries per code. */
export async function signInReaderWithCode(rawEmail: string, input: string): Promise<ReaderSignIn> {
  const email = normaliseReaderEmail(rawEmail)
  const code = normaliseSignInCode(input)
  if (!email || !code) return { ok: false, reason: "invalid" }
  const sql = getSql()
  const rows = (await sql`
    select id, token_hash, code_hash from review_reader_tokens
    where email = ${email} and consumed_at is null and expires_at > now()
      and code_hash is not null and code_attempts < ${SIGN_IN_CODE_MAX_ATTEMPTS}
    order by created_at desc limit 3
  `) as { id: string; token_hash: string; code_hash: string }[]
  const match = rows.find((r) => sameHash(signInCodeHash(r.token_hash, code, secret()), r.code_hash))
  if (!match) {
    if (rows.length) await sql`update review_reader_tokens set code_attempts = code_attempts + 1 where id = any(${rows.map((r) => r.id)}::uuid[])`
    return { ok: false, reason: "invalid" }
  }
  const [spent] = (await sql`
    update review_reader_tokens set consumed_at = now()
    where id = ${match.id}::uuid and consumed_at is null and expires_at > now() and code_attempts < ${SIGN_IN_CODE_MAX_ATTEMPTS}
    returning id
  `) as { id: string }[]
  if (!spent) return { ok: false, reason: "invalid" }
  return openReaderSession(email, "code", match.id)
}

async function openReaderSession(email: string, method: "link" | "code" | "access_link", tokenId: string | null): Promise<ReaderSignIn> {
  // Approval is re-checked at the moment of use: an address removed from
  // every edition since the email was sent gets no session.
  if (!(await readerHasEditions(email))) return { ok: false, reason: "no_editions" }
  try {
    await createReaderSession(email, method)
  } catch {
    if (tokenId) {
      try {
        await getSql()`update review_reader_tokens set consumed_at = null where id = ${tokenId}::uuid and expires_at > now()`
      } catch {}
    }
    return { ok: false, reason: "session_failed" }
  }
  await recordReaderEvent(email, "signed_in")
  return { ok: true, email }
}

/** Records a session for this browser and sets its cookie (Route Handler or Server Action only). */
export async function createReaderSession(email: string, method: "link" | "code" | "access_link"): Promise<void> {
  const [row] = (await getSql()`
    insert into review_reader_sessions (email, method) values (${email}, ${method}) returning id
  `) as { id: string }[]
  const token = await new SignJWT({ email, sid: row!.id, aud: "review-reader" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_SECONDS}s`)
    .sign(key())
  ;(await cookies()).set(READER_COOKIE, token, readerCookieOptions())
}

/**
 * The verified email this browser holds, or null. A recorded session must be
 * open (not signed out, under a year old). A one-day review session from an
 * Admin-sent access link (the older mechanism) is honoured too.
 */
export async function currentReviewReader(): Promise<{ email: string; sid: string | null } | null> {
  const store = await cookies()
  const raw = store.get(READER_COOKIE)?.value
  if (raw) {
    try {
      const { payload } = await jwtVerify(raw, key(), { algorithms: ["HS256"], audience: "review-reader" })
      const email = normaliseReaderEmail(payload.email)
      const sid = typeof payload.sid === "string" && /^[0-9a-f-]{36}$/i.test(payload.sid) ? payload.sid : null
      if (email && sid && (await reviewReaderSchemaReady())) {
        const [open] = (await getSql()`
          select 1 from review_reader_sessions
          where id = ${sid}::uuid and email = ${email} and revoked_at is null and created_at > now() - interval '365 days'
        `) as unknown[]
        if (open) {
          try {
            await getSql()`update review_reader_sessions set last_seen_at = now() where id = ${sid}::uuid and last_seen_at < now() - interval '1 hour'`
          } catch {}
          return { email, sid }
        }
      }
    } catch {
      // Not a valid reader session.
    }
  }
  const prospectId = await readReviewSession()
  if (prospectId && /^[0-9a-f-]{36}$/i.test(prospectId)) {
    const [p] = (await getSql()`
      select lower(btrim(email)) as email from review_prospects
      where id = ${prospectId}::uuid and verified_at is not null and access_sent_at is not null limit 1
    `) as { email: string }[]
    if (p?.email) return { email: p.email, sid: null }
  }
  return null
}

/** Signs this browser out of the review library, server-side as well. */
export async function destroyReaderSession(): Promise<void> {
  const store = await cookies()
  const raw = store.get(READER_COOKIE)?.value
  if (raw) {
    try {
      const { payload } = await jwtVerify(raw, key(), { algorithms: ["HS256"], audience: "review-reader" })
      if (typeof payload.sid === "string") {
        await getSql()`update review_reader_sessions set revoked_at = now(), revoke_reason = 'signed_out'
          where id = ${payload.sid}::uuid and revoked_at is null`
      }
    } catch {}
  }
  store.set(READER_COOKIE, "", { ...readerCookieOptions(), maxAge: 0 })
  store.set("apri_review_session", "", { ...readerCookieOptions(), maxAge: 0 })
}

/** Library visits and edition opens, by reader and edition, for Engagement. Never fails a request. */
export async function recordReaderEvent(email: string, type: "signed_in" | "library_opened" | "edition_opened", editionId?: string) {
  try {
    if (!(await reviewReaderSchemaReady())) return
    const sql = getSql()
    if (type === "library_opened") {
      const [recent] = (await sql`select 1 from review_reader_events where email = ${email} and event_type = 'library_opened'
        and occurred_at > now() - interval '30 minutes' limit 1`) as unknown[]
      if (recent) return
    }
    await sql`insert into review_reader_events (email, edition_id, event_type) values (${email}, ${editionId ?? null}, ${type})`
  } catch {}
}

/** Codes for an address that has failed too often today: refused. */
export async function readerCodeAttemptsExceeded(email: string): Promise<boolean> {
  const [row] = (await getSql()`
    select count(*)::int as n from review_rate_limits
    where action = 'review_reader_code_failed' and identity_hash = ${hashToken(`reader:${email}`)}
      and created_at > now() - interval '24 hours'
  `) as { n: number }[]
  return (row?.n ?? 0) >= 10
}
export async function recordReaderCodeFailure(email: string) {
  try {
    await getSql()`insert into review_rate_limits (action, identity_hash) values ('review_reader_code_failed', ${hashToken(`reader:${email}`)})`
  } catch {}
}

export { hashToken }
