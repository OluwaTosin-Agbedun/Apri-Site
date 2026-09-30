import "server-only"
import { getSql } from "./db"
import { prepareRoomLinks, describeRoomLinks } from "./document-links"
import {
  queueSubscriberAccessReconciliation,
  subscribersAssignedToRoom,
  type ReconcileTrigger,
} from "./subscriber-access-reconciliation"

/** Subscribers reconciled inline after a release change; beyond this they are queued for the batch tool. */
const INLINE_LIMIT = 60

/**
 * After an edition's paid release changes, reconciles everyone served from a
 * Data Room that holds it. Bounded: a very large set is queued (its
 * generation moves on, so nothing stale is recorded) for
 * scripts/reconcile-subscriber-document-links.mjs instead of running here.
 */
export async function reconcileRoomsHoldingPublication(
  publicationId: string,
  trigger: ReconcileTrigger,
): Promise<{ complete: boolean; message: string }> {
  const sql = getSql()
  const rooms = (await sql`
    select distinct papermark_dataroom_id as id
    from papermark_dataroom_documents
    where publication_id = ${publicationId}::uuid and is_present = true
  `) as { id: string }[]
  if (rooms.length === 0) return { complete: true, message: "No Data Room holds this edition, so no subscriber access changed." }

  let subscribers = 0
  for (const room of rooms) subscribers += (await subscribersAssignedToRoom(room.id)).length
  if (subscribers > INLINE_LIMIT) {
    for (const room of rooms) {
      for (const id of await subscribersAssignedToRoom(room.id)) await queueSubscriberAccessReconciliation(id, trigger)
    }
    return {
      complete: false,
      message: `${subscribers} subscribers are affected and have been queued. Run scripts/reconcile-subscriber-document-links.mjs to apply the change to them.`,
    }
  }

  const messages: string[] = []
  let complete = true
  for (const room of rooms) {
    const summary = await prepareRoomLinks(room.id, { trigger })
    if (!summary.complete) complete = false
    messages.push(describeRoomLinks(summary))
  }
  return { complete, message: messages.join(" ") }
}
