import "server-only"
import { getSql } from "./db"
import {
  queueSubscriberAccessReconciliation,
  reconcileSubscriberAccess,
  type ReconcileTrigger,
} from "./subscriber-access-reconciliation"

/** Subscribers reconciled inline after an edition changes; beyond this they are queued for the batch tool. */
const INLINE_LIMIT = 60

/**
 * After an edition's plans or On/Off change, reconciles every subscriber it
 * can affect: on one of the given plans, with an individual exception for it,
 * or holding a live link to one of its files. Bounded: a large set is queued
 * (its generation moves on, so nothing stale is recorded) for
 * scripts/reconcile-subscriber-document-links.mjs instead of running here.
 */
export async function reconcileSubscribersForPublication(
  publicationId: string,
  plans: readonly string[],
  trigger: ReconcileTrigger,
): Promise<{ complete: boolean; message: string }> {
  const sql = getSql()
  const rows = (await sql`
    select s.id from subscribers s
    where s.client_type = 'subscriber'
      and (s.public_tier = any(${[...plans]}::text[])
        or exists (select 1 from subscriber_publication_exceptions x where x.subscriber_id = s.id and x.publication_id = ${publicationId}::uuid)
        or exists (
          select 1 from papermark_subscriber_document_links dl
          join papermark_dataroom_documents dd on dd.papermark_document_id = dl.papermark_document_id
          where dl.subscriber_id = s.id and dl.revoke_state = 'live' and dd.publication_id = ${publicationId}::uuid))
    order by s.id
  `) as { id: string }[]
  if (rows.length === 0) return { complete: true, message: "No subscriber is affected." }
  if (rows.length > INLINE_LIMIT) {
    for (const r of rows) await queueSubscriberAccessReconciliation(r.id, trigger)
    return {
      complete: false,
      message: `${rows.length} subscribers are affected and have been queued. Run scripts/reconcile-subscriber-document-links.mjs to apply the change to them.`,
    }
  }
  let done = 0
  const problems: string[] = []
  for (const r of rows) {
    await queueSubscriberAccessReconciliation(r.id, trigger)
    const result = await reconcileSubscriberAccess(r.id, { trigger })
    if (result.state === "complete" || result.state === "not_applicable") done++
    else problems.push(result.message)
  }
  return {
    complete: problems.length === 0,
    message: problems.length === 0
      ? `Access updated for ${done} subscriber${done === 1 ? "" : "s"}.`
      : `Access updated for ${done} of ${rows.length} subscribers. Not ready: ${problems.slice(0, 2).join(" ")}${problems.length > 2 ? ` And ${problems.length - 2} more.` : ""}`,
  }
}
