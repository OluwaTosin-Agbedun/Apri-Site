import { SignJWT, jwtVerify } from "jose"
import { portalPrincipalFromClaims, type PortalPrincipal } from "./portal-session-claims"

/**
 * The signed subscriber session cookie, without any request plumbing, so the
 * proxy (which renews it) and the session module (which issues and reads it)
 * share one definition.
 *
 * A session is valid only while three things hold: the signature verifies, it
 * has not expired, and -- checked against the database on every protected
 * request, not here -- its session record is still open and the subscription
 * is current. The cookie alone never grants a document.
 */
export const SUBSCRIBER_COOKIE_NAME = "apri_subscriber"

/** Ninety days from the last renewal; renewed at most once a day while in use. */
export const SUBSCRIBER_SESSION_SECONDS = 60 * 60 * 24 * 90
export const SUBSCRIBER_SESSION_RENEW_AFTER_SECONDS = 60 * 60 * 24

export type SubscriberSessionClaims = PortalPrincipal & {
  /** The session record (subscriber_sessions.id). Absent on cookies issued before sessions were recorded. */
  sid?: string
  /** Issued-at, seconds. */
  iat?: number
}

function key(): Uint8Array {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET is missing or too short (need at least 32 characters). " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    )
  }
  return new TextEncoder().encode(secret)
}

/** Throws when no session can be signed, so callers can check before spending a link. */
export function assertSessionKey(): void {
  key()
}

export async function signSubscriberSession(claims: { principalId: string; sid?: string }): Promise<string> {
  return new SignJWT({
    principalId: claims.principalId,
    principalType: "subscriber",
    ...(claims.sid ? { sid: claims.sid } : {}),
    aud: "subscriber",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SUBSCRIBER_SESSION_SECONDS}s`)
    .sign(key())
}

/** The verified claims, or null. Never throws. */
export async function verifySubscriberSession(token?: string): Promise<SubscriberSessionClaims | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, key(), {
      algorithms: ["HS256"], // Pinned, to prevent algorithm confusion.
      audience: "subscriber", // An admin or review token cannot satisfy this.
    })
    const principal = portalPrincipalFromClaims(payload)
    if (!principal) return null
    const sid = typeof payload.sid === "string" && /^[0-9a-f-]{36}$/i.test(payload.sid) ? payload.sid : undefined
    return { ...principal, sid, iat: typeof payload.iat === "number" ? payload.iat : undefined }
  } catch {
    return null
  }
}

/** Secure and HttpOnly: unreadable from JavaScript, sent only over HTTPS when deployed. */
export function subscriberCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SUBSCRIBER_SESSION_SECONDS,
  }
}

/** Whether a recorded session's cookie is old enough to be renewed. */
export function shouldRenew(claims: SubscriberSessionClaims, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  return Boolean(claims.sid && claims.iat && nowSeconds - claims.iat >= SUBSCRIBER_SESSION_RENEW_AFTER_SECONDS)
}
