import 'server-only'
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'

/**
 * Neon Postgres access.
 *
 * The `sql` tagged template parameterises every interpolated value, so
 * `sql`select * from admins where email = ${email}`` is a bound parameter and
 * never string concatenation. Always use the tag form. If you ever need a
 * dynamic identifier (a column or table name), whitelist it against a literal
 * array in code -- never interpolate it into the query text.
 *
 * The client is created lazily so that `next build` and any tooling that
 * imports this module do not crash when DATABASE_URL is absent. The failure
 * surfaces loudly at first query instead, which is what we want: a missing
 * connection string must never silently fall back to some default.
 */
let client: NeonQueryFunction<false, false> | null = null

export function getSql(): NeonQueryFunction<false, false> {
  if (client) return client

  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Add it to .env.local for local development, ' +
        'and to the hosting environment variables for deployed builds.'
    )
  }

  client = neon(url)
  return client
}
