import 'server-only'
import type { getSql } from './db'

type Sql = ReturnType<typeof getSql>

let applied = false
let lastCheckedAt = 0
const RECHECK_MS = 30_000

/**
 * Whether db/migrations/20260930_subscription_activation.sql has been applied.
 *
 * Until it has, a subscription request cannot be activated: without the link
 * from subscriber to request a retry could not tell its own subscribers from
 * anybody else's, so activation is refused with a message rather than guessed.
 * One-way once true; re-checked at most every 30 seconds, or immediately with
 * `fresh` (Admin).
 */
export async function subscriptionActivationReady(sql: Sql, options: { fresh?: boolean } = {}): Promise<boolean> {
  if (applied) return true
  const now = Date.now()
  if (!options.fresh && now - lastCheckedAt < RECHECK_MS) return false
  lastCheckedAt = now
  try {
    const rows = (await sql`
      select (
        select count(*)::int from information_schema.columns
        where table_schema = current_schema()
          and ((table_name = 'subscribers' and column_name = 'subscription_request_id')
            or (table_name = 'review_subscription_requests'
                and column_name in ('submitted_via', 'requester_confirmed_at')))
      ) as columns
    `) as { columns: number }[]
    applied = rows[0]?.columns === 3
  } catch {
    applied = false
  }
  return applied
}

let onboardingApplied = false
let onboardingCheckedAt = 0

/**
 * Whether db/migrations/20261001_subscriber_onboarding_messages.sql has been
 * applied. Until it has, no onboarding email is sent: without durable tracking
 * a retry could not tell a sent message from an unsent one.
 */
export async function onboardingTrackingReady(sql: Sql, options: { fresh?: boolean } = {}): Promise<boolean> {
  if (onboardingApplied) return true
  const now = Date.now()
  if (!options.fresh && now - onboardingCheckedAt < RECHECK_MS) return false
  onboardingCheckedAt = now
  try {
    const rows = (await sql`select (to_regclass('subscriber_onboarding_messages') is not null
                 and to_regclass('subscriber_email_claims') is not null) as ready`) as { ready: boolean }[]
    onboardingApplied = rows[0]?.ready === true
  } catch {
    onboardingApplied = false
  }
  return onboardingApplied
}

export const ONBOARDING_MIGRATION_PENDING =
  'Onboarding email tracking is not set up yet: run the database migration db/migrations/20261001_subscriber_onboarding_messages.sql first.'

export const SUBSCRIPTION_MIGRATION_PENDING =
  'Activating subscription requests needs the database migration db/migrations/20260930_subscription_activation.sql to be run first. Nothing was changed.'

/**
 * Whether a request's requester is confirmed as the owner of its email.
 *
 * A Review Library request was made from a session only a verified prospect
 * holds. A Subscription Access page request was made by whoever filled in the
 * form, so it is confirmed only once the link sent to that address was used.
 */
export function requesterConfirmed(r: {
  submitted_via?: unknown
  requester_confirmed_at?: unknown
  prospect_verified?: unknown
}): boolean {
  if (r.submitted_via === 'access_page') return Boolean(r.requester_confirmed_at)
  return r.prospect_verified === true
}
