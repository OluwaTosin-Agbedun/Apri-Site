import "server-only"
import { getSql } from "./db"
import { signInSchemaReady } from "./sign-in-schema"

export type SessionSummary =
  | { ready: false }
  | { ready: true; open: number; lastSeenAt: string | null }

/** How many browsers a subscriber is signed in on, for Admin. Never shows a cookie or device detail. */
export async function loadSessionSummary(subscriberId: string): Promise<SessionSummary> {
  if (!(await signInSchemaReady())) return { ready: false }
  const [row] = (await getSql()`
    select count(*)::int as open, max(last_seen_at) as last_seen_at
    from subscriber_sessions
    where subscriber_id = ${subscriberId}::uuid and revoked_at is null
      and created_at > now() - interval '365 days'
  `) as { open: number; last_seen_at: string | Date | null }[]
  return {
    ready: true,
    open: row?.open ?? 0,
    lastSeenAt: row?.last_seen_at ? new Date(row.last_seen_at).toISOString() : null,
  }
}

/**
 * Ends every session a subscriber holds, at once: each recorded session is
 * closed, and cookies from before sessions were recorded stop working too.
 * Their subscription, term, level and documents are untouched; they simply
 * sign in again.
 */
export async function revokeAllSessions(subscriberId: string): Promise<number> {
  const sql = getSql()
  const closed = (await sql`
    update subscriber_sessions set revoked_at = now(), revoke_reason = 'admin_revoked'
    where subscriber_id = ${subscriberId}::uuid and revoked_at is null
    returning id
  `) as { id: string }[]
  await sql`update subscribers set sessions_revoked_at = now() where id = ${subscriberId}::uuid`
  return closed.length
}
