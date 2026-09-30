import "server-only"
import { getSql } from "./db"
import { getEligibleRoomDocumentsForSubscriber, getLiveDocumentLinksForSubscriber, markDocumentLinkRevoked } from "./dataroom-dal"
import { ensureAllDocumentLinks } from "./document-links"
import { readSubscriberDocumentLink, revokeDataRoomLink } from "./papermark-datarooms"
import { linksToRevoke } from "./access-reconciliation-rules"

export type ReconciliationResult={state:"complete"|"failed"|"superseded";message:string;created:number;revoked:number}

export async function queueSubscriberAccessReconciliation(subscriberId:string):Promise<number>{
  const sql=getSql()
  const rows=await sql`insert into subscriber_access_reconciliations(subscriber_id,generation,state,requested_at)
    values(${subscriberId}::uuid,1,'pending',now()) on conflict(subscriber_id) do update
    set generation=subscriber_access_reconciliations.generation+1,state='pending',requested_at=now(),completed_at=null
    returning generation` as {generation:number}[]
  return Number(rows[0]?.generation??0)
}

/** Replaces broad room access with a verified set of exact-document links. */
export async function reconcileSubscriberAccess(subscriberId:string,options:{allowPending?:boolean;attempt?:number}={}):Promise<ReconciliationResult>{
  const sql=getSql()
  const snapshots=(await sql`select r.generation,coalesce(s.papermark_dataroom_override,s.papermark_dataroom_id) as room_id
    from subscriber_access_reconciliations r join subscribers s on s.id=r.subscriber_id
    where r.subscriber_id=${subscriberId}::uuid`) as {generation:number;room_id:string|null}[]
  const snapshot=snapshots[0]
  if(!snapshot?.room_id)return {state:"failed",message:"No assigned Data Room to reconcile.",created:0,revoked:0}
  const eligible=await getEligibleRoomDocumentsForSubscriber(subscriberId,snapshot.room_id,options.allowPending===true)
  const allowed=new Set(eligible.map((d)=>d.papermarkDocumentId))
  let revoked=0
  const superseded=async()=>{
    const rows=await sql`select generation from subscriber_access_reconciliations where subscriber_id=${subscriberId}::uuid` as {generation:number}[]
    return Number(rows[0]?.generation)!==Number(snapshot.generation)
  }
  const restart=async():Promise<ReconciliationResult>=>options.attempt===2
    ? {state:"superseded",message:"Access changed repeatedly during reconciliation; retry the newest decision.",created:0,revoked}
    : reconcileSubscriberAccess(subscriberId,{...options,attempt:(options.attempt??0)+1})
  const fail=async(message:string):Promise<ReconciliationResult>=>{
    await sql`update subscriber_access_reconciliations set state='failed',detail=${message},completed_at=null
      where subscriber_id=${subscriberId}::uuid and generation=${snapshot.generation}`
    return {state:"failed",message,created:0,revoked}
  }

  // Revoke only this subscriber's excluded exact links and verify they are gone.
  const liveDocuments=await getLiveDocumentLinksForSubscriber(subscriberId)
  const excluded=linksToRevoke(subscriberId,allowed,liveDocuments.map((link)=>({ownerId:link.subscriberId,kind:"document" as const,documentId:link.papermarkDocumentId})))
  for(const planned of excluded){
    const link=liveDocuments.find((candidate)=>candidate.papermarkDocumentId===planned.documentId)!
    if(await superseded())return restart()
    const removed=await revokeDataRoomLink(link.papermarkLinkId)
    if(!removed.ok)return fail("Papermark refused an excluded document-link revocation; retry is required.")
    const verified=await readSubscriberDocumentLink(link.papermarkLinkId)
    if(verified.state!=="gone")return fail("An excluded document URL could not be verified as inaccessible.")
    await markDocumentLinkRevoked(link.id);revoked++
  }

  if(await superseded())return restart()
  const prepared=eligible.length===0?null:await ensureAllDocumentLinks(subscriberId,{verify:true,allowPending:options.allowPending===true})
  if(eligible.length>0&&(prepared?.state!=="prepared"||!prepared.report.complete))return fail("Eligible exact-document links are not fully verified.")

  // A broad Data Room URL would bypass per-edition policy, so retire every one
  // owned by this subscriber only, after exact links are ready.
  const roomLinks=(await sql`select id,papermark_link_id from papermark_dataroom_links
    where subscriber_id=${subscriberId}::uuid and revoke_state='live'`) as {id:string;papermark_link_id:string}[]
  for(const link of roomLinks){
    if(await superseded())return restart()
    const removed=await revokeDataRoomLink(link.papermark_link_id)
    if(!removed.ok)return fail("Papermark refused the unrestricted room-link revocation; retry is required.")
    const verified=await readSubscriberDocumentLink(link.papermark_link_id)
    if(verified.state!=="gone")return fail("The unrestricted room URL could not be verified as inaccessible.")
    await sql`update papermark_dataroom_links set revoke_state='revoked',revoked_at=now(),updated_at=now() where id=${link.id}::uuid`;revoked++
  }

  // Generation fencing prevents a stale run from blessing a newer decision.
  const completed=await sql`update subscriber_access_reconciliations set state='complete',detail=null,completed_at=now()
    where subscriber_id=${subscriberId}::uuid and generation=${snapshot.generation} returning subscriber_id`
  if(!completed[0])return restart()
  const created=prepared?.state==="prepared"?prepared.report.created+prepared.report.repaired:0
  return {state:"complete",message:eligible.length===0?"Verified: no publication links are accessible for this subscriber.":`Verified ${eligible.length} allowed publication link${eligible.length===1?"":"s"}.`,created,revoked}
}
