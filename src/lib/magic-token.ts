import { createHash, createHmac, timingSafeEqual } from "node:crypto"

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export type StoredTokenState = {
  consumed_at: string | null
  expires_at: string
}

export function storedTokenFailureReason(
  row: StoredTokenState | null | undefined,
  now = new Date(),
): "invalid" | "expired" | "used" {
  if (!row) return "invalid"
  if (row.consumed_at) return "used"
  const expiresAt = new Date(row.expires_at)
  return Number.isNaN(expiresAt.getTime()) || expiresAt <= now
    ? "expired"
    : "invalid"
}

// ---------------------------------------------------------------------------
// The 8-digit sign-in code printed beside the link in the same email.
//
// Typed on the sign-in page, it signs in the browser it is typed into -- the
// subscriber's own browser -- rather than whichever browser their email app
// opens links in. It is derived from the link's token with a key built from
// SESSION_SECRET, so it needs no storage of its own, and only a keyed hash is
// kept: a read of the database cannot be brute-forced into a working code.
// ---------------------------------------------------------------------------

export const SIGN_IN_CODE_DIGITS = 8
export const SIGN_IN_CODE_MAX_ATTEMPTS = 5

function codeKey(secret: string): Buffer {
  return createHmac("sha256", secret).update("apri-signin-code-key:v1").digest()
}

/** The code for one link's token. */
export function deriveSignInCode(token: string, secret: string): string {
  const mac = createHmac("sha256", codeKey(secret)).update(`derive:${token}`).digest()
  const value = mac.readBigUInt64BE(0) % BigInt(10 ** SIGN_IN_CODE_DIGITS)
  return value.toString().padStart(SIGN_IN_CODE_DIGITS, "0")
}

/** What is stored for a code: keyed, and tied to its own token row. */
export function signInCodeHash(tokenHash: string, code: string, secret: string): string {
  return createHmac("sha256", codeKey(secret)).update(`code:${tokenHash}:${code}`).digest("hex")
}

/** Digits only, or null when the input cannot be a code. */
export function normaliseSignInCode(input: unknown): string | null {
  const digits = String(input ?? "").replace(/[\s-]/g, "")
  return digits.length === SIGN_IN_CODE_DIGITS && /^[0-9]+$/.test(digits) ? digits : null
}

/** "1234 5678", easier to read and type from an email. */
export function formatSignInCode(code: string): string {
  return `${code.slice(0, 4)} ${code.slice(4)}`
}

export function sameHash(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const x = Buffer.from(a, "utf8")
  const y = Buffer.from(b, "utf8")
  return x.length === y.length && timingSafeEqual(x, y)
}
