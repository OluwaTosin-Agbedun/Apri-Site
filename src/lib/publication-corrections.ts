import "server-only"
import { createHash, randomUUID } from "node:crypto"
import { getSql } from "./db"
import { siteOrigin } from "./site-config"
import { loadWorkflow, startPublicationWorkflow, subjectLock, workflowSchemaReady, type WorkflowActor } from "./publication-workflow"
import { uuid, type PublicationKind } from "./publication-workflow-policy"
import { readSubscriberDocumentLink, revokeDataRoomLink } from "./papermark-datarooms"
import { queueReviewRooms } from "./review-room-jobs"
import {after} from 'next/server'
import type {PapermarkLinkRead} from './personal-links'
type Sql = ReturnType<typeof getSql>
const reasonOk = (reason:string) => reason.trim().length >= 10 && reason.length <= 500
const digest = (value:unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")

export type CorrectionPreview = { fingerprint:string; sourceId:string; targetId:string; sourceTitle:string; targetTitle:string; originalDate:string; plans:number; exceptions:number; readers:number; sourceAudience:unknown; targetAudience:unknown }

/** Admin-only DTO. It contains no reading URLs, tokens or transferred sessions. */
export async function correctionPreview(kind:PublicationKind,sourceId:string,targetId:string,sql:Sql=getSql()):Promise<CorrectionPreview> {
  if(!uuid.test(sourceId)||!uuid.test(targetId)||sourceId===targetId)throw new Error("Choose two distinct publication records.")
  if(!(await workflowSchemaReady(sql)))throw new Error("Apply the publishing workflow migration first.")
  const [source]=await sql`select publication_content_snapshot(${kind},${sourceId}::uuid) as content,publication_audience_snapshot(${kind},${sourceId}::uuid) as audience`
  const [target]=await sql`select publication_content_snapshot(${kind},${targetId}::uuid) as content,publication_audience_snapshot(${kind},${targetId}::uuid) as audience`
  if(!source?.content||!target?.content)throw new Error("One of the publication records no longer exists.")
  const a=source.content as Record<string,unknown>, b=target.content as Record<string,unknown>
  if(!a.issueDate||a.issueDate!==b.issueDate||a.series!==b.series||a.visibility!==b.visibility)throw new Error("A correction must keep the original issue date, category and audience level. A different issue is a new publication.")
  const aSources=a.sources as string[], bSources=b.sources as string[]
  if(!aSources?.length||!bSources?.length||bSources.some(x=>aSources.includes(x)))throw new Error("Upload the correction as a separate PDF and link its own draft record. Do not overwrite the earlier master.")
  const sw=await loadWorkflow(kind,sourceId,sql),tw=await loadWorkflow(kind,targetId,sql)
  if(sw&&!sw.everPublished)throw new Error("The earlier version must have been published.")
  if(tw?.everPublished)throw new Error("The correction is already released; create a new draft version.")
  const [live]=kind==='paid'?await sql`select status='published' or coalesce(paid_release_state='released',false) as live from documents where id=${targetId}::uuid`:await sql`select publication_state='published' as live from review_publication_editions where id=${targetId}::uuid`
  if(live?.live)throw new Error("Only an unreleased draft can become a correction.")
  const audience=source.audience as {plans?:unknown[];exceptions?:unknown[];emails?:unknown[]}
  return {fingerprint:digest([kind,sourceId,targetId,a,b,source.audience,target.audience,sw?.revision??null,tw?.revision??null]),sourceId,targetId,sourceTitle:String(a.title),targetTitle:String(b.title),originalDate:String(a.issueDate),plans:audience.plans?.length??0,exceptions:audience.exceptions?.length??0,readers:audience.emails?.length??0,sourceAudience:source.audience,targetAudience:target.audience}
}

/** Exact, explicit audience inheritance. No subscription period, token or link is copied. */
export async function prepareCorrection(kind:PublicationKind,sourceId:string,targetId:string,expected:string,actor:WorkflowActor,reason:string,sql:Sql=getSql()) {
  if(actor.role!=='owner'||!reasonOk(reason))throw new Error("An owner and a recorded correction reason are required.")
  await startPublicationWorkflow(kind,sourceId,actor,"Existing publication adopted for a separately identified correction",sql)
  await startPublicationWorkflow(kind,targetId,actor,"New correction draft started; no publication or access released",sql)
  const preview=await correctionPreview(kind,sourceId,targetId,sql)
  if(preview.fingerprint!==expected)throw new Error("The preview changed. Review a fresh preview before copying permissions.")
  const source=await loadWorkflow(kind,sourceId,sql),target=await loadWorkflow(kind,targetId,sql)
  if(!source?.everPublished||!target)throw new Error("Start the source and target editorial records, then preview again.")
  const family=source.familyId??randomUUID()
  // A transaction-level function verifies the exact audience and content under
  // both publication locks. The SQL driver uses one HTTP transaction.
  const audienceLocks=kind==='paid'?[sql`select publication_id from publication_plans where publication_id=any(${[sourceId,targetId]}::uuid[]) for update`,sql`select publication_id from subscriber_publication_exceptions where publication_id=any(${[sourceId,targetId]}::uuid[]) for update`]:[sql`select edition_id from review_edition_recipients where edition_id=any(${[sourceId,targetId]}::uuid[]) for update`,sql`select key from app_settings where key='review_approved_recipients' for update`]
  const queries=[subjectLock(sql,kind,sourceId),subjectLock(sql,kind,targetId),...audienceLocks,sql`select assert_correction_inputs(${kind},${sourceId}::uuid,${targetId}::uuid,${source.currentHash},${target.currentHash},${JSON.stringify(preview.sourceAudience)}::jsonb,${JSON.stringify(preview.targetAudience)}::jsonb)`,
    sql`insert into publication_families(id,kind,original_issue_date,current_workflow_id,created_by) values(${family}::uuid,${kind},${preview.originalDate}::date,${source.id}::uuid,${actor.id}::uuid) on conflict do nothing`,
    sql`update publication_workflows set family_id=${family}::uuid,ordinal=coalesce(ordinal,1) where id=${source.id}::uuid and (family_id is null or family_id=${family}::uuid)`,
    sql`update publication_workflows set family_id=${family}::uuid,ordinal=${(source.ordinal??1)+1},revision=revision+1,state='draft',approved_hash=null,submitted_hash=null,approved_by=null,approved_at=null,updated_at=now() where id=${target.id}::uuid and ever_published=false and (family_id is null or family_id=${family}::uuid)`]
  if(kind==='paid') {
    queries.push(sql`delete from publication_plans where publication_id=${targetId}::uuid`,sql`insert into publication_plans(publication_id,public_tier,source) select ${targetId}::uuid,public_tier,'correction' from publication_plans where publication_id=${sourceId}::uuid`,
      sql`delete from subscriber_publication_exceptions where publication_id=${targetId}::uuid`,sql`insert into subscriber_publication_exceptions(subscriber_id,publication_id,decision,reason,administrator_id) select subscriber_id,${targetId}::uuid,decision,reason,${actor.id}::uuid from subscriber_publication_exceptions where publication_id=${sourceId}::uuid`)
  } else {
    queries.push(sql`update review_publication_editions set recipient_mode='edition',recipients_verified_hash=null,recipients_verified_at=null,updated_at=now() where id=${targetId}::uuid`,
      sql`update review_edition_recipients set revoked_at=now(),revoked_by=${actor.id}::uuid where edition_id=${targetId}::uuid and revoked_at is null`,
      sql`insert into review_edition_recipients(edition_id,email,source,granted_by) select ${targetId}::uuid,email,'owner',${actor.id}::uuid from jsonb_array_elements_text(${JSON.stringify((preview.sourceAudience as {emails:string[]}).emails)}::jsonb) email
        on conflict(edition_id,email) where revoked_at is null do nothing`)
  }
  queries.push(sql`insert into publication_correction_access(workflow_id,source_workflow_id,source_hash,target_hash,snapshot,inherited_by)
    values(${target.id}::uuid,${source.id}::uuid,md5(publication_audience_snapshot(${kind},${sourceId}::uuid)::text),md5(publication_audience_snapshot(${kind},${targetId}::uuid)::text),${JSON.stringify(preview)}::jsonb,${actor.id}::uuid)
    on conflict(workflow_id) do update set source_workflow_id=excluded.source_workflow_id,source_hash=excluded.source_hash,target_hash=excluded.target_hash,snapshot=excluded.snapshot,inherited_by=excluded.inherited_by,inherited_at=now()`,
    sql`insert into publication_workflow_events(workflow_id,action,next_state,revision,actor_id,actor_name,reason,snapshot) select id,'correction_prepared','draft',revision,${actor.id}::uuid,${actor.name},${reason.trim()},${JSON.stringify(preview)}::jsonb from publication_workflows where id=${target.id}::uuid`)
  await sql.transaction(queries)
  return {familyId:family,sourceWorkflow:source.id}
}

export function currentEditionPath(kind:PublicationKind,recordId:string){return kind==='paid'?`/portal/publication/${recordId}`:`/review/library/current/${recordId}`}

/** Proof is manual because this integration has no PDF upload/read-file scope. */
export async function recordNoticeProof(kind:PublicationKind,id:string,actor:WorkflowActor,proof:{documentId:string;sourceHash:string;noticeHash:string;pages:number;currentUrl:string},reason:string,sql:Sql=getSql()) {
  const w=await loadWorkflow(kind,id,sql)
  if(actor.role!=='owner'||!w?.everPublished||!w.familyId||!reasonOk(reason))throw new Error("Prepare the correction family first; an owner must record the notice proof.")
  if(!/^[a-f0-9]{64}$/.test(proof.sourceHash)||!/^[a-f0-9]{64}$/.test(proof.noticeHash)||proof.sourceHash===proof.noticeHash||!Number.isSafeInteger(proof.pages)||proof.pages<1||proof.pages>2000||!proof.documentId.trim()||proof.documentId.length>200)throw new Error("Enter the output PDF's proof report, a distinct notice-copy document id and its page count.")
  const expected=siteOrigin()+currentEditionPath(kind,id)
  if(proof.currentUrl!==expected)throw new Error("The embedded current-edition URL must be the access-checked URL shown here.")
  const [,rows]=await sql.transaction([subjectLock(sql,kind,id),sql`with changed as(update publication_workflows set notice_document_id=${proof.documentId},notice_source_sha256=${proof.sourceHash},notice_sha256=${proof.noticeHash},notice_page_count=${proof.pages},notice_current_url=${expected},notice_prepared_by=${actor.id}::uuid,notice_prepared_at=now(),notice_verified_by=null,notice_verified_at=null,revision=revision+1
      where id=${w.id}::uuid and revision=${w.revision} and notice_verified_at is null and not (${proof.documentId}=any(original_source_ids)) returning id,revision),
    history as(insert into publication_workflow_events(workflow_id,action,next_state,revision,actor_id,actor_name,reason) select id,'notice_proof_prepared','published',revision,${actor.id}::uuid,${actor.name},${reason} from changed) select id from changed`])
  if(!rows.length)throw new Error("The notice proof changed, is already verified, or points at the original PDF. Reload.")
}

export async function verifyNoticeProof(kind:PublicationKind,id:string,actor:WorkflowActor,expected:number,reason:string,sql:Sql=getSql()) {
  const w=await loadWorkflow(kind,id,sql)
  if(actor.role!=='owner'||!w?.noticeDocumentId||!reasonOk(reason))throw new Error("A second owner must inspect the uploaded notice copy and record the result.")
  if(kind==='paid') {
    const [existing]=await sql`select 1 from papermark_dataroom_documents where publication_id=${id}::uuid and is_present limit 1`
    if(existing){ const [notice]=await sql`select 1 from papermark_dataroom_documents where papermark_document_id=${w.noticeDocumentId} and is_present and (publication_id is null or publication_id=${id}::uuid) limit 1`;if(!notice)throw new Error("Upload the notice PDF into the paid Data Room and sync it first; do not replace the original master.") }
  }
  // The proof fields, preparer and revision must still be the ones inspected.
  const commands=[subjectLock(sql,kind,id),sql`select assert_notice_verification(${w.id}::uuid,${actor.id}::uuid,${expected})`,
    sql`update publication_workflows set notice_verified_by=${actor.id}::uuid,notice_verified_at=now(),revision=revision+1 where id=${w.id}::uuid`,
    sql`insert into publication_workflow_events(workflow_id,action,next_state,revision,actor_id,actor_name,reason) select id,'notice_manually_verified',state,revision,${actor.id}::uuid,${actor.name},${reason} from publication_workflows where id=${w.id}::uuid`]
  if(kind==='paid') commands.push(sql`update documents set papermark_document_id=${w.noticeDocumentId},updated_at=now() where id=${id}::uuid`,sql`update papermark_dataroom_documents set publication_id=${id}::uuid where papermark_document_id=${w.noticeDocumentId} and (publication_id is null or publication_id=${id}::uuid)`)
  else commands.push(sql`update review_publication_editions set papermark_document_id=${w.noticeDocumentId},secure_link_id=null,secure_link_url='',secure_link_verified_at=null,secure_link_document_id=null,updated_at=now() where id=${id}::uuid`)
  // Capture the old link ids BEFORE clearing the edition's link above.
  const jobs=await retirementCandidates(kind,id,w.id,sql)
  for(const job of jobs)commands.splice(2,0,sql`insert into publication_version_retirements(workflow_id,link_id,identity_hash,expected_document_ids,kind,subscriber_id,state,legacy_link_hash) values(${w.id}::uuid,${job.linkId},${job.identity},${job.documentIds}::text[],${job.kind},${job.subscriberId}::uuid,${job.linkId?'pending':'awaiting_manual'},${job.legacyHash??null}) on conflict do nothing`)
  if(kind==='paid')commands.push(sql`update subscriber_access_reconciliations set generation=generation+1,state='pending',requested_at=now(),updated_at=now() where subscriber_id in(select subscriber_id from papermark_subscriber_document_links where papermark_document_id=any(${jobs[0]!.documentIds}::text[]))`)
  await sql.transaction(commands)
  if(kind==='review') {
    const emails=jobs.filter(x=>x.email).map(x=>x.email!)
    await queueReviewRooms(emails,{changed:true})
  }
}

type Candidate={linkId:string|null;identity:string;documentIds:string[];kind:string;subscriberId:string|null;email?:string;legacyHash?:string}
async function retirementCandidates(kind:PublicationKind,id:string,workflowId:string,sql:Sql):Promise<Candidate[]> {
  const [w]=await sql`select original_source_ids from publication_workflows where id=${workflowId}::uuid`
  const sources=(w?.original_source_ids??[]) as string[]
  const out:Candidate[]=[{linkId:null,identity:digest(['unmanaged',workflowId]),documentIds:sources,kind:'manual',subscriberId:null}]
  if(kind==='paid') {
    const personal=await sql`select papermark_link_id,subscriber_id from papermark_subscriber_document_links where papermark_document_id=any(${sources}::text[]) and revoke_state='live'`
    for(const r of personal)out.push({linkId:String(r.papermark_link_id),identity:digest(['paid',r.papermark_link_id]),documentIds:sources,kind:'paid_personal',subscriberId:String(r.subscriber_id)})
    const legacy=await sql`select subscriber_id,link_url,papermark_link_id,md5(link_url) as link_hash from publication_access where publication_id=${id}::uuid and revoke_state='live'`
    for(const r of legacy)out.push({linkId:r.papermark_link_id?String(r.papermark_link_id):null,identity:digest(['legacy',r.subscriber_id,r.link_url]),documentIds:sources,kind:'legacy_copy',subscriberId:String(r.subscriber_id),legacyHash:String(r.link_hash)})
  } else {
    const [edition]=await sql`select secure_link_id from review_publication_editions where id=${id}::uuid`
    if(edition?.secure_link_id)out.push({linkId:String(edition.secure_link_id),identity:digest(['edition',edition.secure_link_id]),documentIds:sources,kind:'review_edition',subscriberId:null})
    // Include removed readers whose last verified room still held this edition.
    // Unknown old room snapshots are included conservatively; unrelated rooms
    // with a confirmed document map are not interrupted.
    const rooms=await sql`select email,papermark_link_id from review_reader_rooms where papermark_link_id is not null
      and (room_documents is null or room_documents ? ${id} or position(${id} in coalesce(verified_editions,''))>0)`
    for(const r of rooms)out.push({linkId:String(r.papermark_link_id),identity:digest(['room',r.papermark_link_id]),documentIds:sources,kind:'review_rooms',subscriberId:null,email:String(r.email)})
  }
  return out
}

/** Bounded continuation on the existing shared provider budget. DELETE alone is not proof. */
export async function drainVersionRetirements(options:{maxJobs?:number;deadline?:number;workflowId?:string;readLink?:(id:string)=>Promise<PapermarkLinkRead>;revokeLink?:typeof revokeDataRoomLink}={},sql:Sql=getSql()) {
  const result={confirmed:0,waiting:0}
  if(!(await workflowSchemaReady(sql)))return result
  const deadline=options.deadline??Date.now()+8000
  const readLink=options.readLink??readSubscriberDocumentLink,revokeLink=options.revokeLink??revokeDataRoomLink
  for(let i=0;i<(options.maxJobs??1)&&Date.now()<deadline;i++) {
    const token=randomUUID()
    const [job]=await sql`with candidate as(select id from publication_version_retirements where state in ('pending','running') and next_attempt_at<=now() and (lease_until is null or lease_until<now()) and (${options.workflowId??null}::uuid is null or workflow_id=${options.workflowId??null}::uuid) order by next_attempt_at,id for update skip locked limit 1)
      update publication_version_retirements j set state='running',lease_token=${token}::uuid,lease_until=now()+interval '3 minutes',attempts=attempts+1 from candidate c where c.id=j.id returning j.*`
    if(!job)break
    let confirmed=false,retryAt=Date.now()+60000
    if(job.link_id) {
      const read=await readLink(String(job.link_id))
      if(read.state==='gone')confirmed=true
      else if(read.state==='found') {
        // A reused id now targeting another object must be inspected manually.
        const expected=job.expected_document_ids as string[]
        if(job.kind==='review_rooms'||job.kind==='legacy_copy'||(read.documentId&&expected.includes(read.documentId))) {
          const revoked=await revokeLink(String(job.link_id))
          if(revoked.ok)confirmed=(await readLink(String(job.link_id))).state==='gone'
          else retryAt=revoked.retryAt??retryAt
        }
      } else retryAt=read.retryAt??retryAt
    }
    const commands=[sql`update publication_version_retirements set state=${confirmed?'confirmed':'pending'},confirmation_method=${confirmed?'provider':null},confirmed_at=case when ${confirmed} then now() else null end,next_attempt_at=${new Date(Math.max(retryAt,Date.now()+Math.min(3600000,60000*2**Math.min(Number(job.attempts),5)))).toISOString()}::timestamptz,lease_token=null,lease_until=null,last_error=${confirmed?null:'Earlier link retirement is not confirmed. Retry saved; inspect Papermark if it persists.'} where id=${job.id}::uuid and lease_token=${token}::uuid returning id`]
    if(confirmed) {
      if(job.kind==='paid_personal')commands.push(sql`update papermark_subscriber_document_links set revoke_state='revoked' where papermark_link_id=${job.link_id} and papermark_document_id=any(${job.expected_document_ids}::text[]) and exists(select 1 from publication_version_retirements where id=${job.id}::uuid and state='confirmed')`)
      if(job.kind==='legacy_copy')commands.push(sql`update publication_access set revoke_state='revoked' where papermark_link_id=${job.link_id} and md5(link_url)=${job.legacy_link_hash} and exists(select 1 from publication_version_retirements where id=${job.id}::uuid and state='confirmed')`)
      if(job.kind==='review_rooms')commands.push(sql`update review_reader_rooms set papermark_link_id=null,link_url=null,state='updating',verified_at=null,verified_visible=null,verified_editions=null,link_open_until=null,updated_at=now() where papermark_link_id=${job.link_id} and exists(select 1 from publication_version_retirements where id=${job.id}::uuid and state='confirmed')`)
    }
    const [saved]=await sql.transaction(commands)
    if(confirmed&&saved.length)result.confirmed++
    else {result.waiting++;break}
  }
  return result
}

/** Manual evidence is labelled as such and needs two DIFFERENT active owners. */
export async function attestManualRetirement(jobId:string,actor:WorkflowActor,reason:string,sql:Sql=getSql()) {
  if(actor.role!=='owner'||!uuid.test(jobId)||!reasonOk(reason))throw new Error("An owner and an exact verification note are required.")
  const [job]=await sql`select * from publication_version_retirements where id=${jobId}::uuid`
  if(!job||job.state==='confirmed')throw new Error("This retirement is missing or already confirmed.")
  if(job.link_id)throw new Error("Known provider link ids require provider confirmation, not a manual override.")
  if(job.confirmed_by===actor.id)throw new Error("A different owner must independently check this manual evidence.")
  const second=Boolean(job.confirmed_by)
  const rows=await sql`update publication_version_retirements set confirmed_by=coalesce(confirmed_by,${actor.id}::uuid),checked_by=case when ${second} then ${actor.id}::uuid else null end,confirmation_reason=coalesce(confirmation_reason||E'\n','')||${actor.name+': '+reason},state=${second?'confirmed':'awaiting_manual'},confirmation_method=case when ${second} then 'two_person_manual' else null end,confirmed_at=case when ${second} then now() else null end where id=${jobId}::uuid and confirmed_by is not distinct from ${job.confirmed_by}::uuid returning id`
  if(!rows.length)throw new Error('This check changed. Reload before recording your observation.')
  if(second&&job.kind==='legacy_copy')await sql`update publication_access set revoke_state='revoked' where subscriber_id=${job.subscriber_id}::uuid and publication_id=(select document_id from publication_workflows where id=${job.workflow_id}::uuid) and md5(link_url)=${job.legacy_link_hash}`
}

/** Old legacy history stays held until the CURRENT own copy is checked twice. */
export async function attestLegacyNoticeCopy(id:string,subscriberId:string,actor:WorkflowActor,reason:string,sql:Sql=getSql()){
  const w=await loadWorkflow('paid',id,sql)
  if(actor.role!=='owner'||!w?.noticeReady||!uuid.test(subscriberId)||!reasonOk(reason))throw new Error('Choose a subscriber and an independently verified notice version.')
  const [copy]=await sql`select md5(pa.link_url||coalesce(pa.papermark_link_id,'')) as link_hash,w.notice_sha256 from publication_access pa join publication_workflows w on w.document_id=pa.publication_id where pa.publication_id=${id}::uuid and pa.subscriber_id=${subscriberId}::uuid and pa.revoke_state='live' and pa.link_url<>''`
  if(!copy)throw new Error('Record the new personally protected notice copy in Copies first. A general or shared link does not qualify.')
  const [prior]=await sql`select * from publication_legacy_notice_proofs where workflow_id=${w.id}::uuid and subscriber_id=${subscriberId}::uuid`
  const unchanged=prior?.link_hash===copy.link_hash&&prior?.notice_hash===copy.notice_sha256
  if(unchanged&&prior.prepared_by===actor.id)throw new Error('A different owner must check this exact new legacy notice copy.')
  if(unchanged&&prior.checked_at)throw new Error('This unchanged notice copy is already checked.')
  if(unchanged)await sql`update publication_legacy_notice_proofs set checked_by=${actor.id}::uuid,checked_at=now(),reason=reason||E'\n'||${actor.name+': '+reason} where workflow_id=${w.id}::uuid and subscriber_id=${subscriberId}::uuid and link_hash=${copy.link_hash} and notice_hash=${copy.notice_sha256} and prepared_by<>${actor.id}::uuid and checked_at is null`
  else await sql`insert into publication_legacy_notice_proofs(workflow_id,subscriber_id,link_hash,notice_hash,prepared_by,reason) values(${w.id}::uuid,${subscriberId}::uuid,${copy.link_hash},${copy.notice_sha256},${actor.id}::uuid,${actor.name+': '+reason}) on conflict(workflow_id,subscriber_id) do update set link_hash=excluded.link_hash,notice_hash=excluded.notice_hash,prepared_by=excluded.prepared_by,prepared_at=now(),checked_by=null,checked_at=null,reason=excluded.reason`
}

/** Continue only previously authorised jobs, never create a retirement on a GET. */
export function kickVersionRetirements(workflowId:string){
  if(!uuid.test(workflowId))return
  after(async()=>{await drainVersionRetirements({workflowId,maxJobs:2,deadline:Date.now()+10000}).catch(()=>{})})
}
