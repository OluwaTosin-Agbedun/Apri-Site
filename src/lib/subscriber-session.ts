import "server-only"
import { cookies } from "next/headers"
import { getSql } from "./db"
import { signInSchemaReady } from "./sign-in-schema"
import {
  SUBSCRIBER_COOKIE_NAME,
  signSubscriberSession,
  verifySubscriberSession,
  subscriberCookieOptions,
  type SubscriberSessionClaims,
} from "./subscriber-session-token"

/**
 * Subscriber sessions, kept entirely separate from admin and review sessions.
 *
 * A distinct cookie name and audience mean an admin or review token can never
 * be replayed as a subscriber token or the reverse.
 *
 * The cookie is a signed claim of WHICH session this browser holds; whether
 * that session is still open is the database's to say (subscriber_sessions),
 * re-read on every protected request together with the subscriber's status
 * and term. So signing out, Admin's "Sign out of all browsers", a suspension
 * or an ended term takes effect at once, whatever the cookie says.
 *
 * Long-lived by design: a subscriber signs in once per browser and stays
 * signed in while they keep using it (ninety days, renewed with use).
 */

export type SubscriberSessionPayload = SubscriberSessionClaims

export { verifySubscriberSession as decrypt } from "./subscriber-session-token"

/**
 * Records a session and sets this browser's cookie. Only callable where Next
 * allows a cookie write: a Route Handler or a Server Action.
 */
export async function createSubscriberSession(
  principalId: string,
  method: "link" | "code" = "link",
): Promise<void> {
  let sid: string | undefined
  if (await signInSchemaReady()) {
    const [row] = (await getSql()`
      insert into subscriber_sessions (subscriber_id, method)
      values (${principalId}::uuid, ${method})
      returning id
    `) as { id: string }[]
    sid = row!.id
  }
  const token = await signSubscriberSession({ principalId, sid })
  const cookieStore = await cookies()
  cookieStore.set(SUBSCRIBER_COOKIE_NAME, token, subscriberCookieOptions())
}

export async function readSubscriberSession(): Promise<SubscriberSessionPayload | null> {
  const cookieStore = await cookies()
  return verifySubscriberSession(cookieStore.get(SUBSCRIBER_COOKIE_NAME)?.value)
}

/** Signs this browser out: its session record is closed, then the cookie goes. */
export async function destroySubscriberSession(): Promise<void> {
  const session = await readSubscriberSession()
  if (session?.sid) {
    try {
      await getSql()`
        update subscriber_sessions set revoked_at = now(), revoke_reason = 'signed_out'
        where id = ${session.sid}::uuid and subscriber_id = ${session.principalId}::uuid and revoked_at is null
      `
    } catch {
      // The cookie still goes below; a recorded session that cannot be closed
      // here is closed by Admin's "Sign out of all browsers".
    }
  }
  const cookieStore = await cookies()
  cookieStore.delete(SUBSCRIBER_COOKIE_NAME)
}

export { SUBSCRIBER_COOKIE_NAME }
