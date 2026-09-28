import "server-only"
import type { getSql } from "./db"

type Sql = ReturnType<typeof getSql>

/**
 * Whether the per-edition recipients migration
 * (db/migrations/20260928_review_edition_recipients.sql) has been applied.
 *
 * This code may be deployed before that migration has run. Until it has:
 *
 *  - the public pages keep their pre-migration behaviour: every published
 *    edition with a secure link is judged by the shared list, which is exactly
 *    how the migration classifies those editions, so readers see no change at
 *    either step;
 *  - every Admin page and action that needs the new table says so and changes
 *    nothing, rather than failing part-way.
 *
 * The answer only ever moves from "not yet" to "applied". Once the schema has
 * been seen it is remembered for the life of this server instance. Until then,
 * public callers re-check at most every 30 seconds and Admin callers on every
 * call, so the site switches over by itself shortly after the migration runs.
 * A check that fails counts as "not yet": the pre-migration behaviour, which
 * grants nothing new.
 */

const RECHECK_MS = 30_000

/** Every column the migration adds to review_publication_editions. */
export const EDITION_RECIPIENT_COLUMNS = [
  "recipient_mode",
  "recipients_verified_hash",
  "recipients_verified_at",
  "recipients_applied_at",
  "recipients_adopted_at",
  "recipients_adopted_by",
] as const

let applied = false
let lastCheckedAt = 0

export async function editionRecipientsReady(
  sql: Sql,
  options: { fresh?: boolean } = {},
): Promise<boolean> {
  if (applied) return true
  const now = Date.now()
  if (!options.fresh && now - lastCheckedAt < RECHECK_MS) return false
  lastCheckedAt = now
  try {
    const rows = (await sql`
      select to_regclass('review_edition_recipients') is not null as has_table,
             (select count(*)::int from information_schema.columns
               where table_schema = current_schema()
                 and table_name = 'review_publication_editions'
                 and column_name = any(${[...EDITION_RECIPIENT_COLUMNS]}::text[])) as columns
    `) as { has_table: boolean; columns: number }[]
    applied =
      rows[0]?.has_table === true &&
      rows[0]?.columns === EDITION_RECIPIENT_COLUMNS.length
  } catch {
    applied = false
  }
  return applied
}
