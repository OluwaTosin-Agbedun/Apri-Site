import "server-only"
import { getSql } from "./db"
import { markDocumentLinkRevoked, getLiveDocumentLinksForSubscriber } from "./dataroom-dal"
import { revokeDataRoomLink, updateDataRoomLink } from "./papermark-datarooms"
import {
  queueSubscriberAccessReconciliation,
  reconcileSubscriberAccess,
  subscribersAssignedToRoom,
  type ReconcileResult,
  type ReconcileTrigger,
} from "./subscriber-access-reconciliation"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Personal document links for everyone served from one Data Room, and their
 * revocation and renewal.
 *
 * Preparing links is reconciliation's job (src/lib/subscriber-access-reconciliation.ts):
 * it decides from the access policy, verifies with Papermark and never sends
 * email. This module only fans one room out to its subscribers.
 */

// ---------------------------------------------------------------------------
// Every subscriber of one Data Room
// ---------------------------------------------------------------------------

export type RoomLinkSummary = {
  /** Subscribers whose library is this room. */
  subscribers: number
  outcomes: { subscriberId: string; result: ReconcileResult }[]
  /** Subscribers who could not be checked at all, for example a database fault. */
  errors: number
  complete: boolean
}

/**
 * Reconciles every subscriber whose library is this Data Room -- by override,
 * level or stored assignment, never by whether they hold a room share link --
 * after documents arrive, change or are released. One subscriber's failure
 * never stops the rest.
 */
export async function prepareRoomLinks(
  dataroomId: string,
  options: { trigger?: ReconcileTrigger } = {},
): Promise<RoomLinkSummary> {
  const trigger = options.trigger ?? "sync"
  let subscriberIds: string[] = []
  try {
    subscriberIds = await subscribersAssignedToRoom(dataroomId)
  } catch {
    return { subscribers: 0, outcomes: [], errors: 1, complete: false }
  }
  const outcomes: RoomLinkSummary["outcomes"] = []
  let errors = 0
  for (const subscriberId of subscriberIds) {
    try {
      await queueSubscriberAccessReconciliation(subscriberId, trigger)
      outcomes.push({ subscriberId, result: await reconcileSubscriberAccess(subscriberId, { trigger }) })
    } catch {
      errors++
    }
  }
  const settled = (r: ReconcileResult) => r.state === "complete" || r.state === "not_applicable"
  return {
    subscribers: subscriberIds.length,
    outcomes,
    errors,
    complete: errors === 0 && outcomes.every((o) => settled(o.result)),
  }
}

/** The administrator's account of a room-wide run. Counts only, never links. */
export function describeRoomLinks(summary: RoomLinkSummary): string {
  if (summary.subscribers === 0 && summary.errors === 0) {
    return "No subscriber is served from this Data Room, so no personal document links were needed."
  }
  const sum = (key: "created" | "repaired" | "revoked" | "unresolved") =>
    summary.outcomes.reduce((n, o) => n + o.result.counts[key], 0)
  const who = `${summary.subscribers} subscriber${summary.subscribers === 1 ? "" : "s"}`
  const done = [
    sum("created") ? `${sum("created")} created` : null,
    sum("repaired") ? `${sum("repaired")} repaired` : null,
    sum("revoked") ? `${sum("revoked")} withdrawn` : null,
  ].filter(Boolean)
  const waiting = sum("unresolved") ? ` ${sum("unresolved")} document decision${sum("unresolved") === 1 ? "" : "s"} still await a release decision or publication details.` : ""
  if (summary.complete) {
    return `Personal document links are ready for ${who}${done.length ? ` (${done.join(", ")})` : ""}.${waiting}`
  }
  const notReady = summary.outcomes.filter((o) => o.result.state !== "complete" && o.result.state !== "not_applicable")
  const shown = notReady.slice(0, 3).map((o) => o.result.message).join(" ")
  const more = notReady.length > 3 ? ` And ${notReady.length - 3} more.` : ""
  const errors = summary.errors ? ` ${summary.errors} subscriber${summary.errors === 1 ? "" : "s"} could not be checked. Try again shortly.` : ""
  return `Personal document links are not ready for every subscriber (${who} checked${done.length ? `; ${done.join(", ")}` : ""}). ${shown}${more}${errors}${waiting}`
}

// ---------------------------------------------------------------------------
// Revocation and renewal
// ---------------------------------------------------------------------------

/**
 * Revokes all live document links for a subscriber.
 *
 * Called on deactivation, expiry, or subscriber deletion. Revokes each link in
 * Papermark first, then marks locally.
 */
export async function revokeAllDocumentLinks(subscriberId: string): Promise<number> {
  if (!UUID.test(subscriberId)) return 0

  const links = await getLiveDocumentLinksForSubscriber(subscriberId)
  let count = 0

  for (const link of links) {
    await revokeDataRoomLink(link.papermarkLinkId)
    await markDocumentLinkRevoked(link.id)
    count++
  }

  return count
}

/**
 * Updates expiry on all live document links for a subscriber.
 *
 * Called on subscription renewal.
 */
export async function updateDocumentLinkExpiry(args: {
  subscriberId: string
  newTermEnd: string
}): Promise<number> {
  if (!UUID.test(args.subscriberId)) return 0
  const sql = getSql()

  const links = (await sql`
    select id, papermark_link_id, assigned_name, assigned_email, allow_download
    from papermark_subscriber_document_links
    where subscriber_id = ${args.subscriberId}::uuid and revoke_state = 'live'
  `) as { id: string; papermark_link_id: string; assigned_name: string; assigned_email: string; allow_download: boolean }[]

  let count = 0
  for (const link of links) {
    // A renewal changes the expiry only: the download setting stays as issued.
    const result = await updateDataRoomLink({
      linkId: link.papermark_link_id,
      assignedName: link.assigned_name,
      assignedEmail: link.assigned_email,
      expiresAt: args.newTermEnd,
      allowDownload: link.allow_download,
    })

    if (result.ok) {
      await sql`
        update papermark_subscriber_document_links
        set expires_at = ${args.newTermEnd}::timestamptz, updated_at = now()
        where id = ${link.id}::uuid
      `
      count++
    }
  }

  return count
}
