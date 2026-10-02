import "server-only"
import { cookies } from "next/headers"
import { SignJWT, jwtVerify } from "jose"
import { normaliseReaderEmail } from "./review-reader"

/**
 * Getting an approved reader to their personal Papermark room without an APRI
 * code. APRI here only ROUTES; it does not authenticate. The security check
 * is Papermark's: the room link admits only its group's one member, after
 * Papermark emails that address a one-time code.
 *
 *  - The entry link (emailed to an approved address, valid 30 days) says which
 *    reader's room to open. Forwarding it gives nothing: Papermark still
 *    sends its code to the reader's own mailbox.
 *  - Opening it once leaves a signed routing cookie on that browser, so the
 *    public cards go straight to the reader's room next time.
 */
const ENTRY_DAYS = 30
const HINT_DAYS = 180
export const ROOM_HINT_COOKIE = "apri_review_room"

function key() {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters")
  return new TextEncoder().encode(secret)
}

export async function signRoomEntry(email: string): Promise<string> {
  return new SignJWT({ email, aud: "review-room-entry" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ENTRY_DAYS}d`)
    .sign(key())
}

async function verify(token: string | undefined, audience: string): Promise<string | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"], audience })
    return normaliseReaderEmail(payload.email)
  } catch {
    return null
  }
}

export const verifyRoomEntry = (token: string) => verify(token, "review-room-entry")

/** Route Handler or Server Action only. */
export async function setRoomHint(email: string): Promise<void> {
  const token = await new SignJWT({ email, aud: "review-room-hint" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${HINT_DAYS}d`)
    .sign(key())
  ;(await cookies()).set(ROOM_HINT_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/review",
    maxAge: HINT_DAYS * 24 * 60 * 60,
  })
}

export async function readRoomHint(): Promise<string | null> {
  return verify((await cookies()).get(ROOM_HINT_COOKIE)?.value, "review-room-hint")
}
