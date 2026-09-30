import "server-only"
import type { getSql } from "./db"

let cached = false

/**
 * Whether db/migrations/20261004_paid_release_and_access_health.sql has run:
 * explicit paid release, voidable periods, the exception history and the
 * reconciliation lease. Without it the portal still works -- a published
 * record counts as released, every period counts -- but nothing is repaired,
 * because a run could not be fenced against a concurrent one.
 */
export async function accessHealthSchemaReady(sql: ReturnType<typeof getSql>, options: { fresh?: boolean } = {}): Promise<boolean> {
  if (cached && !options.fresh) return true
  try {
    const rows = (await sql`
      select
        exists (select 1 from information_schema.columns where table_name = 'documents' and column_name = 'paid_release_state')
        and exists (select 1 from information_schema.columns where table_name = 'subscriber_subscription_periods' and column_name = 'voided_at')
        and exists (select 1 from information_schema.columns where table_name = 'subscriber_access_reconciliations' and column_name = 'lease_token')
        and to_regclass('subscriber_exception_events') is not null
        and to_regclass('subscriber_period_events') is not null
        and to_regclass('publication_release_events') is not null
        as ready
    `) as { ready: boolean }[]
    cached = rows[0]?.ready === true
    return cached
  } catch {
    return false
  }
}

export const ACCESS_HEALTH_MIGRATION_PENDING =
  "Document access repair is paused until db/migrations/20261004_paid_release_and_access_health.sql is applied."
