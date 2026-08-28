import "server-only"
import { cache } from "react"
import { redirect } from "next/navigation"
import { getSql } from "./db"
import { readSubscriberSession } from "./subscriber-session"
import {
  isLevel,
  isVisibility,
  visibilitiesForLevel,
  type Level,
  type Visibility,
} from "./entitlements"

/**
 * The confidentiality boundary for the subscriber surface.
 *
 * Every function here is scoped to the signed-in subscriber's own id, taken
 * from their verified session and never from a route parameter or form field.
 * There is deliberately no "get subscriber by id" and no "list subscribers"
 * export in this module: a subscriber must be unable to see that another
 * subscriber exists, let alone read their row.
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
  termEnd: string | null
  status: string
  libraryLinkUrl: string | null
  papermarkFolderId: string | null
  /** True when status is active and the term has not run out. */
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
  term_end: string | null
  status: string
  library_link_url: string | null
  papermark_folder_id: string | null
}

function toSubscriber(row: SubscriberRow): CurrentSubscriber {
  const status = row.status.toLowerCase()
  const termEnd = row.term_end

  // A term that has run out revokes access even while the row still says
  // active, so a lapsed subscription cannot outlive its end date by however
  // long it takes someone to notice and change the status by hand.
  const termCurrent = !termEnd || new Date(termEnd) >= startOfToday()

  return {
    type: "subscriber",
    id: row.id,
    fullName: row.full_name || row.name || "",
    organisation: row.organization,
    email: row.email,
    roleTitle: row.role_title,
    level: isLevel(row.level) ? row.level : null,
    publicTier: row.public_tier,
    termEnd,
    status,
    libraryLinkUrl: row.library_link_url,
    papermarkFolderId: row.papermark_folder_id,
    hasAccess: status === "active" && termCurrent,
  }
}

function startOfToday(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

/**
 * The signed-in subscriber's own row, or null.
 *
 * Re-read from the database on every request rather than trusted from the
 * cookie, so suspending a subscriber or ending their term takes effect at once
 * instead of whenever their 14-day token happens to expire. `cache` collapses
 * repeat lookups within a single render pass into one query.
 */
export const getCurrentSubscriber = cache(
  async (): Promise<CurrentSubscriber | null> => {
    const session = await readSubscriberSession()
    if (!session) return null

    const sql = getSql()
    if (session.principalType !== "subscriber") return null
    const rows = (await sql`
      select id, full_name, name, organization, email, role_title,
             level, public_tier, term_end, status, library_link_url, papermark_folder_id
      from subscribers
      where id = ${session.principalId}
      limit 1
    `) as SubscriberRow[]

    const row = rows[0]
    return row ? toSubscriber(row) : null
  },
)

/**
 * Whether this device already holds a valid portal session.
 *
 * Used by the sign-in page so a verified device is sent straight to the
 * library. Verification happens once per device: after the one-time link has
 * been used, the session lasts 90 days and the subscriber never meets the email
 * step again on that browser.
 */
export async function hasPortalSession(): Promise<boolean> {
  return (await readSubscriberSession()) !== null
}

export async function requirePortalPrincipal(): Promise<CurrentSubscriber> {
  const subscriber = await getCurrentSubscriber()
  if (!subscriber) redirect("/portal/sign-in")
  return subscriber
}

/**
 * Use in any portal page or action that must not be public.
 *
 * Note this admits a subscriber whose access has lapsed: the brief requires
 * that they see a locked library explaining access has ended, rather than a
 * 404 or a redirect loop. Check `hasAccess` before showing any document.
 */
export async function requireSubscriber(): Promise<CurrentSubscriber> {
  const subscriber = await getCurrentSubscriber()
  if (!subscriber) redirect("/portal/sign-in")
  return subscriber
}

// ---------------------------------------------------------------------------
// The subscriber's library
// ---------------------------------------------------------------------------

export type LibraryItem = {
  id: string
  slug: string
  code: string | null
  series: string
  title: string
  summary: string
  editionDate: string | null
  visibility: Visibility
  pageCount: number | null
  /** Resolved read link, or null when no link is available yet. */
  linkUrl: string | null
}

type LibraryRow = {
  id: string
  slug: string
  code: string | null
  series: string
  title: string
  summary: string
  description: string
  edition_date: string | null
  visibility: string
  page_count: number | null
  is_shared_copy: boolean
  shared_link: string | null
  /** Null when no row exists, or when the row has been revoked. */
  stamped_link: string | null
}

/**
 * Every publication the given subscriber is entitled to, newest first.
 *
 * The level filter is applied in SQL from the shared entitlement rule, so a
 * publication above the subscriber's level is never fetched, not merely hidden
 * after the fact. OPEN pieces are excluded: they are public reading and do not
 * belong to a paid library.
 *
 * Resolution is exactly two steps, with no fallback between them:
 *
 *   1. a live publication_access row for this subscriber and this publication
 *   2. otherwise nothing -- a quiet "being prepared" state
 *
 * The one exception is a publication explicitly marked is_shared_copy, where a
 * single unstamped link legitimately serves everyone.
 *
 * There is deliberately no fall-through to the subscriber's general library
 * link. Every stamped copy carries one person's name, so a fallback would
 * eventually hand a subscriber a document marked for someone else -- the exact
 * failure stamping exists to prevent. A missing copy must read as missing.
 */
export async function getLibraryFor(
  subscriber: CurrentSubscriber,
): Promise<LibraryItem[]> {
  /**
   * The guard on the whole arrangement: no level, no library.
   *
   * Entitlement is granted by level, and only a subscriber holds one. A
   * briefing client is a person record with no level. They may hold several
   * publication_access rows -- board papers issued to them by name -- and they
   * must still see no library, because publication_access grants one person one
   * document and cannot widen into level-based access.
   */
  if (!subscriber.hasAccess || !subscriber.level) return []

  const sql = getSql()

  // Parameterised: the level list is bound, not interpolated into the text.
  const rows = (await sql.query(
    `select d.id, d.slug, d.code, d.series, d.title, d.summary, d.description,
            d.edition_date, d.visibility, d.page_count,
            d.is_shared_copy,
            d.papermark_link as shared_link,
            case when pa.revoke_state = 'live' then pa.link_url else null end
              as stamped_link
     from documents d
     left join publication_access pa
       on pa.publication_id = d.id and pa.subscriber_id = $1
     where d.status = 'published'
       and d.visibility <> 'OPEN'
       and d.visibility = any($2::text[])
     order by d.edition_date desc nulls last, d.sort_order asc, d.created_at desc`,
    [subscriber.id, visibilitiesForLevel(subscriber.level)],
  )) as LibraryRow[]

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    code: row.code,
    series: row.series,
    title: row.title,
    summary: row.summary || row.description,
    editionDate: row.edition_date,
    visibility: isVisibility(row.visibility) ? row.visibility : "L4",
    pageCount: row.page_count,
    linkUrl: resolveLink(row),
  }))
}

/**
 * The only place a portal link is chosen.
 *
 * A stamped per-subscriber link wins. A shared link is used only when the
 * publication is explicitly flagged as one. Anything else -- an empty string, a
 * revoked row, a javascript: URL pasted into the admin by mistake -- resolves
 * to null and shows as "being prepared" rather than becoming a live target.
 */
function resolveLink(row: LibraryRow): string | null {
  if (https(row.stamped_link)) return row.stamped_link

  // Never reached for a stamped publication: without the flag, no shared link
  // is offered even when one is stored.
  if (row.is_shared_copy && https(row.shared_link)) return row.shared_link

  return null
}

function https(value: string | null): value is string {
  return Boolean(value && value.startsWith("https://"))
}

/** Records that the subscriber opened their library. Never fails the request. */
export async function touchLastViewed(subscriberId: string): Promise<void> {
  try {
    const sql = getSql()
    await sql`update subscribers set last_viewed_at = now() where id = ${subscriberId}`
  } catch {
    // Telemetry, not a precondition for reading. Swallow.
  }
}
