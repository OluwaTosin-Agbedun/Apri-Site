import 'server-only'
import type { getSql } from './db'

type Sql = ReturnType<typeof getSql>

let applied = false
let lastCheckedAt = 0
const RECHECK_MS = 30_000

/**
 * Whether db/migrations/20260930_portal_title_override.sql has been applied.
 *
 * Until it has, no editorial title can be an override, so every paid document
 * shows its Papermark name -- the intended default -- and Admin says the
 * override is not available yet. One-way once true; re-checked at most every
 * 30 seconds otherwise, or immediately with `fresh` (Admin).
 */
export async function portalTitleOverrideReady(sql: Sql, options: { fresh?: boolean } = {}): Promise<boolean> {
  if (applied) return true
  const now = Date.now()
  if (!options.fresh && now - lastCheckedAt < RECHECK_MS) return false
  lastCheckedAt = now
  try {
    const rows = (await sql`
      select exists (
        select 1 from information_schema.columns
        where table_schema = current_schema()
          and table_name = 'documents'
          and column_name = 'portal_title_override'
      ) as ready
    `) as { ready: boolean }[]
    applied = rows[0]?.ready === true
  } catch {
    applied = false
  }
  return applied
}
