import "server-only"
import { cache } from "react"
import { redirect } from "next/navigation"
import { getSql } from "./db"
import { readSubscriberSession } from "./subscriber-session"
import { isVisibility, type Visibility } from "./entitlements"
import { loadLegacyPublicationAccess } from "./access-policy-dal"
import { loadSessionSubscriber, type CurrentSubscriber } from "./subscriber-principal"

/**
 * The confidentiality boundary for the subscriber surface.
 *
 * Every function here is scoped to the signed-in subscriber's own id, taken
 * from their verified session and never from a route parameter or form field.
 * There is deliberately no "get subscriber by id" and no "list subscribers"
 * export in this module: a subscriber must be unable to see that another
 * subscriber exists, let alone read their row.
 */

export type { CurrentSubscriber } from "./subscriber-principal"

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
    if (session.principalType !== "subscriber") return null
    return loadSessionSubscriber(session.principalId, { sid: session.sid, iat: session.iat })
  },
)

/**
 * Whether this browser holds an open portal session.
 *
 * Used by the sign-in page so a signed-in browser goes straight to the
 * library. The same full check as the portal itself -- signature, session
 * record and subscriber -- so a signed-out or ended session never bounces
 * between the two pages.
 */
export async function hasPortalSession(): Promise<boolean> {
  return (await getCurrentSubscriber()) !== null
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
  viewedBySubscriber: boolean
  downloadedBySubscriber: boolean
}

/**
 * Every publication the given subscriber may read in the legacy library,
 * newest first -- or null when access could not be checked, which the portal
 * shows as a temporary problem rather than an empty library.
 *
 * The decision is the access policy's (src/lib/access-policy.ts), the same one
 * the Data Room library, provisioning and Admin use. OPEN pieces are excluded:
 * they are public reading and do not belong to a paid library.
 *
 * Resolution has no fallback: this subscriber's own live copy, or a link the
 * record explicitly marks as shared. There is deliberately no fall-through to
 * the subscriber's general library link. Every stamped copy carries one
 * person's name, so a fallback would eventually hand a subscriber a document
 * marked for someone else -- the exact failure stamping exists to prevent. A
 * missing copy reads as "being prepared".
 *
 * A briefing client is a person record with no level. They may hold
 * publication_access rows -- board papers issued to them by name -- and still
 * see no library, because publication_access grants one person one document
 * and cannot widen into level-based access.
 */
export async function getLibraryFor(
  subscriber: CurrentSubscriber,
): Promise<LibraryItem[] | null> {
  if (!subscriber.hasAccess || !subscriber.level) return []
  const access = await loadLegacyPublicationAccess(subscriber.id)
  if (access.state === "unavailable") return null
  if (access.state === "not_found") return []
  return access.items
    .filter((item) => item.delivery !== "hidden")
    .map((item) => ({
      id: item.publicationId,
      slug: item.slug,
      code: item.code,
      series: item.series,
      title: item.title,
      summary: item.summary,
      editionDate: item.editionDate,
      visibility: isVisibility(item.visibility) ? item.visibility : "L4",
      pageCount: item.pageCount,
      linkUrl: item.linkUrl,
      viewedBySubscriber: item.viewedBySubscriber,
      downloadedBySubscriber: item.downloadedBySubscriber,
    }))
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
