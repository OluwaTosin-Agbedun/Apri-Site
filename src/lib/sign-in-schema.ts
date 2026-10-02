import "server-only"
import { getSql } from "./db"

/**
 * Whether 20261007_subscriber_sign_in_sessions.sql has been applied.
 *
 * Until it has, sign-in behaves exactly as before: the emailed link signs in
 * whichever browser opens it, no code is printed and no session is recorded.
 * Checked at most once a minute per server instance; "not ready" is never
 * cached for long, so applying the migration takes effect without a deploy.
 */
let cached: { ready: boolean; at: number } | null = null

export async function signInSchemaReady(): Promise<boolean> {
  if (cached && Date.now() - cached.at < (cached.ready ? 300_000 : 60_000)) return cached.ready
  try {
    const [row] = (await getSql()`
      select
        exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'auth_tokens' and column_name = 'binding_hash') and
        exists (select 1 from information_schema.tables
                 where table_schema = 'public' and table_name = 'subscriber_sessions') as ready
    `) as { ready: boolean }[]
    cached = { ready: row?.ready === true, at: Date.now() }
  } catch {
    cached = { ready: false, at: Date.now() }
  }
  return cached.ready
}

/** Tests only. */
export function resetSignInSchemaCache(): void {
  cached = null
}
