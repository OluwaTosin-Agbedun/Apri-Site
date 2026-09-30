import 'server-only'
import type { getSql } from './db'

type Sql = ReturnType<typeof getSql>

const RECHECK_MS = 30_000
let applied = false
let checkedAt = 0

/**
 * Whether db/migrations/20261002_engagement_page_progress.sql has been
 * applied. Until it has, page evidence is not collected and the monitor shows
 * "Progress unavailable"; everything else keeps working.
 */
export async function pageProgressReady(sql: Sql, options: { fresh?: boolean } = {}): Promise<boolean> {
  if (applied) return true
  const now = Date.now()
  if (!options.fresh && now - checkedAt < RECHECK_MS) return false
  checkedAt = now
  try {
    const rows = (await sql`
      select (to_regclass('document_view_pages') is not null
              and to_regclass('papermark_document_versions') is not null
              and exists (select 1 from information_schema.columns
                          where table_schema = current_schema() and table_name = 'document_views'
                            and column_name = 'next_enrichment_at')) as ready
    `) as { ready: boolean }[]
    applied = rows[0]?.ready === true
  } catch {
    applied = false
  }
  return applied
}

export const PAGE_PROGRESS_MIGRATION_PENDING =
  'Page-level progress is collected once db/migrations/20261002_engagement_page_progress.sql has been run.'
