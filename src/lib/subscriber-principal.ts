import "server-only"
import { getSql } from "./db"
import { isLevel, type Level } from "./entitlements"
import { subscriptionStatus, subscriptionCurrent, lagosToday, type SubscriptionStatus } from "./subscription-term"

/**
 * The subscriber record behind a portal session, read with its term dates as
 * text so the calendar day is exactly what is stored.
 *
 * Only ever called with the id from a verified session (src/lib/subscriber-dal.ts)
 * or, for sign-in, with the id a consumed token names. It lives apart from the
 * DAL so the real query can be tested against the database: the portal lockout
 * came from this query returning Date objects that the term check then
 * compared with a string.
 */

export type CurrentSubscriber = {
  type: "subscriber"
  id: string
  fullName: string
  organisation: string
  email: string
  roleTitle: string
  level: Level | null
  publicTier: string
  /** "YYYY-MM-DD" as stored, or null. */
  termStart: string | null
  termEnd: string | null
  status: string
  libraryLinkUrl: string | null
  papermarkFolderId: string | null
  /** The subscription alone: status and term, in Lagos days. */
  subscription: SubscriptionStatus
  /** True only while the subscription is current (subscription.state === "active"). */
  hasAccess: boolean
}

type SubscriberRow = {
  id: string
  full_name: string | null
  name: string
  organization: string
  email: string
  role_title: string
  level: string | null
  public_tier: string
  term_start: string | null
  term_end: string | null
  status: string
  library_link_url: string | null
  papermark_folder_id: string | null
}

export function subscriberFromRow(row: SubscriberRow, today: string = lagosToday()): CurrentSubscriber {
  const subscription = subscriptionStatus(
    { status: row.status, termStart: row.term_start, termEnd: row.term_end },
    today,
  )
  return {
    type: "subscriber",
    id: row.id,
    fullName: row.full_name || row.name || "",
    organisation: row.organization,
    email: row.email,
    roleTitle: row.role_title,
    level: isLevel(row.level) ? row.level : null,
    publicTier: row.public_tier,
    termStart: subscription.termStart,
    termEnd: subscription.termEnd,
    status: (row.status ?? "").toLowerCase(),
    libraryLinkUrl: row.library_link_url,
    papermarkFolderId: row.papermark_folder_id,
    subscription,
    hasAccess: subscriptionCurrent(subscription),
  }
}

/** The subscriber a session names, or null. */
export async function loadSessionSubscriber(principalId: string): Promise<CurrentSubscriber | null> {
  const sql = getSql()
  const rows = (await sql`
    select id, full_name, name, organization, email, role_title,
           level, public_tier,
           to_char(term_start, 'YYYY-MM-DD') as term_start,
           to_char(term_end, 'YYYY-MM-DD') as term_end,
           status, library_link_url, papermark_folder_id
    from subscribers
    where id = ${principalId}
    limit 1
  `) as SubscriberRow[]
  const row = rows[0]
  return row ? subscriberFromRow(row) : null
}

/** A subscriber's status and term, for the sign-in checks. */
export async function readSubscriberTerm(
  where: { id: string } | { email: string },
): Promise<{ id: string; email: string; fullName: string; subscription: SubscriptionStatus } | null> {
  const sql = getSql()
  const rows = (
    "id" in where
      ? await sql`
          select id, email, full_name, name, status,
                 to_char(term_start, 'YYYY-MM-DD') as term_start,
                 to_char(term_end, 'YYYY-MM-DD') as term_end
          from subscribers where id = ${where.id} limit 1`
      : await sql`
          select id, email, full_name, name, status,
                 to_char(term_start, 'YYYY-MM-DD') as term_start,
                 to_char(term_end, 'YYYY-MM-DD') as term_end
          from subscribers where lower(email) = ${where.email} limit 1`
  ) as {
    id: string
    email: string
    full_name: string | null
    name: string
    status: string
    term_start: string | null
    term_end: string | null
  }[]
  const row = rows[0]
  if (!row) return null
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name || row.name || "",
    subscription: subscriptionStatus({ status: row.status, termStart: row.term_start, termEnd: row.term_end }),
  }
}
