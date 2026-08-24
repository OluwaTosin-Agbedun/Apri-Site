import 'server-only'
import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'

/**
 * Subscriber sessions, kept entirely separate from admin sessions.
 *
 * A distinct cookie name and a distinct payload shape mean an admin token can
 * never be replayed as a subscriber token or the reverse: `decrypt` below
 * rejects any payload that does not carry a subscriberId, and the admin
 * verifier rejects any payload without an adminId.
 */
const COOKIE_NAME = 'apri_subscriber'

// Longer than the 8-hour admin session on purpose. A board member opening a
// briefing from an SMS two days later should not be bounced to a sign-in form.
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14 // 14 days

export type SubscriberSessionPayload = {
  subscriberId: string
}

function getKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) {
    throw new Error(
      'SESSION_SECRET is missing or too short (need at least 32 characters). ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"'
    )
  }
  return new TextEncoder().encode(secret)
}

async function encrypt(payload: SubscriberSessionPayload): Promise<string> {
  return new SignJWT({ ...payload, aud: 'subscriber' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(getKey())
}

/**
 * Returns the verified payload, or null. Never throws: a forged, expired or
 * truncated cookie is simply "not signed in".
 */
export async function decrypt(
  token?: string
): Promise<SubscriberSessionPayload | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, getKey(), {
      algorithms: ['HS256'], // Pinned, to prevent algorithm confusion.
      audience: 'subscriber', // An admin token cannot satisfy this.
    })
    const subscriberId = payload.subscriberId
    if (typeof subscriberId !== 'string') return null
    return { subscriberId }
  } catch {
    return null
  }
}

export async function createSubscriberSession(subscriberId: string): Promise<void> {
  const token = await encrypt({ subscriberId })
  const cookieStore = await cookies()

  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true, // Unreadable from JavaScript, so XSS cannot steal it.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  })
}

export async function readSubscriberSession(): Promise<SubscriberSessionPayload | null> {
  const cookieStore = await cookies()
  return decrypt(cookieStore.get(COOKIE_NAME)?.value)
}

export async function destroySubscriberSession(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(COOKIE_NAME)
}

export { COOKIE_NAME as SUBSCRIBER_COOKIE_NAME }
