import 'server-only'
import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'

const COOKIE_NAME = 'apri_session'
const MAX_AGE_SECONDS = 60 * 60 * 8 // 8 hours. Admin sessions should be short.

export type SessionPayload = {
  adminId: string
  role: 'owner' | 'editor'
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

async function encrypt(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(getKey())
}

/**
 * Returns the verified payload, or null. Never throws on bad input: a forged,
 * expired or truncated cookie is simply "not logged in".
 */
export async function decrypt(token?: string): Promise<SessionPayload | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, getKey(), {
      algorithms: ['HS256'], // Pinned. Prevents algorithm-confusion attacks.
    })
    const adminId = payload.adminId
    const role = payload.role
    if (typeof adminId !== 'string') return null
    if (role !== 'owner' && role !== 'editor') return null
    return { adminId, role }
  } catch {
    return null
  }
}

export async function createSession(payload: SessionPayload): Promise<void> {
  const token = await encrypt(payload)
  const cookieStore = await cookies()

  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true, // Unreadable from JavaScript, so XSS cannot steal it.
    secure: process.env.NODE_ENV === 'production', // HTTPS only when deployed.
    sameSite: 'lax', // Not sent on cross-site POSTs.
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  })
}

export async function readSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies()
  return decrypt(cookieStore.get(COOKIE_NAME)?.value)
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(COOKIE_NAME)
}

export { COOKIE_NAME }
