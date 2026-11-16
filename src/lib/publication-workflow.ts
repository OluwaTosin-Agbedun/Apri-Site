import "server-only"
import {getSql} from "./db"
import {workflowTransition,validVersionLabel,uuid,type WorkflowState,type PublicationKind,WORKFLOW_MIGRATION} from "./publication-workflow-policy"

export type WorkflowActor={id:string;name:string;role:"owner"|"editor"}
export type Workflow={id:string;recordId:string;kind:PublicationKind;state:WorkflowState;revision:number;versionLabel:string;provenance:string;legacy:boolean;everPublished:boolean;familyId:string|null;ordinal:number|null;approvedHash:string|null;currentHash:string|null;originalDate:string|null;noticeDocumentId:string|null;noticeReady:boolean;author:string;start:string;end:string;cutoff:string;minutes:number|null}
type Sql=ReturnType<typeof getSql>
export async function workflowSchemaReady(sql:Sql=getSql()):Promise<boolean>{const[row]=await sql`select to_regclass('public.publication_workflows') is not null and to_regclass('public.publication_workflow_events') is not null as ok`;return row?.ok===true}
export async function publicationRecord(kind:PublicationKind,id:string,sql:Sql=getSql()){
  if(!uuid.test(id))return null
  const[row]=kind==='paid'?await sql`select id,title,series,papermark_document_id,to_char(edition_date,'YYYY-MM-DD') as issue_date,
    (status='published' or to_jsonb(d)->>'paid_release_state'='released') as live from documents d where id=${id}::uuid`:
    await sql`select id,title,series,papermark_document_id,to_char(edition_date,'YYYY-MM-DD') as issue_date,publication_state='published' as live from review_publication_editions where id=${id}::uuid`
  return row??null
}
export async function loadWorkflow(kind:PublicationKind,id:string,sql:Sql=getSql()):Promise<Workflow|null>{
  if(!uuid.test(id)||!(await workflowSchemaReady(sql)))return null
  const[row]=await sql`select w.*,publication_content_hash(${kind},${id}::uuid) as current_hash,to_char(original_issue_date,'YYYY-MM-DD') as original_date
    from publication_workflows w where (${kind}='paid' and document_id=${id}::uuid) or (${kind}='review' and review_edition_id=${id}::uuid)`
  if(!row)return null
  return {id:String(row.id),recordId:id,kind,state:row.state as WorkflowState,revision:Number(row.revision),versionLabel:String(row.version_label),provenance:String(row.provenance),legacy:row.legacy_adoption===true,everPublished:row.ever_published===true,
    familyId:row.family_id?String(row.family_id):null,ordinal:row.ordinal?Number(row.ordinal):null,approvedHash:row.approved_hash?String(row.approved_hash):null,currentHash:row.current_hash?String(row.current_hash):null,originalDate:row.original_date?String(row.original_date):null,noticeDocumentId:row.notice_document_id?String(row.notice_document_id):null,noticeReady:Boolean(row.notice_verified_at),author:String(row.author_editor??''),start:row.covered_period_start?new Date(row.covered_period_start).toISOString().slice(0,10):'',end:row.covered_period_end?new Date(row.covered_period_end).toISOString().slice(0,10):'',cutoff:row.information_cutoff?new Date(row.information_cutoff).toISOString().slice(0,10):'',minutes:row.reading_time_minutes?Number(row.reading_time_minutes):null}
}
export function subjectLock(sql:Sql,kind:PublicationKind,id:string){return kind==='paid'?sql`select id from documents where id=${id}::uuid for update`:sql`select id from review_publication_editions where id=${id}::uuid for update`}

/** Explicit adoption records existing publication, never invented approval. */
export async function startPublicationWorkflow(kind:PublicationKind,id:string,actor:WorkflowActor,reason:string,sql:Sql=getSql()):Promise<Workflow|null>{
  if(!(await workflowSchemaReady(sql)))throw new Error(`Apply ${WORKFLOW_MIGRATION} first.`)
  const record=await publicationRecord(kind,id,sql);if(!record)return null
  if(record.live&&actor.role!=='owner')throw new Error("Only an owner can adopt an existing released publication.")
  if(record.live&&!record.issue_date)throw new Error('Add and verify the original issue date in the existing publication details before adopting this live record. Its readers remain unchanged.')
  if(reason.trim().length<10||reason.length>500)throw new Error("Record the reason for starting editorial review.")
  await sql.transaction([subjectLock(sql,kind,id),sql`with added as (insert into publication_workflows(document_id,review_edition_id,state,legacy_adoption,ever_published,first_released_at,original_issue_date,original_source_ids,frozen_snapshot)
    select ${kind==='paid'?id:null}::uuid,${kind==='review'?id:null}::uuid,case when ${record.live===true} then 'published' else 'draft' end,${record.live===true},${record.live===true},null::timestamptz,
      case when ${record.live===true} then ${record.issue_date}::date else null end,
      case when ${record.live===true} then array(select jsonb_array_elements_text(publication_content_snapshot(${kind},${id}::uuid)->'sources')) else '{}'::text[] end,
      case when ${record.live===true} then publication_content_snapshot(${kind},${id}::uuid) else null end
    on conflict do nothing returning id,state,revision),
    history as(insert into publication_workflow_events(workflow_id,action,next_state,revision,actor_id,actor_name,reason)
      select id,${record.live===true?'existing_publication_adopted':'review_started'},state,revision,${actor.id}::uuid,${actor.name},${reason.trim()} from added)
    select id from added`])
  return loadWorkflow(kind,id,sql)
}

export async function saveWorkflowDetails(kind:PublicationKind,id:string,actor:WorkflowActor,expected:number,details:{version:string;provenance:string;author:string;start:string;end:string;cutoff:string;minutes:number|null;issueDate?:string;sourceId?:string},sql:Sql=getSql()):Promise<boolean>{
  if(!validVersionLabel(details.version)||details.provenance.trim().length<10||details.provenance.length>1500)throw new Error("Add a version label and the publication's source/provenance (10–1500 characters).")
  const [,rows]=await sql.transaction([subjectLock(sql,kind,id),sql`with changed as(update publication_workflows set version_label=${details.version.trim()},provenance=${details.provenance.trim()},
    author_editor=${details.author.trim().slice(0,200)},covered_period_start=${details.start||null}::date,covered_period_end=${details.end||null}::date,information_cutoff=${details.cutoff||null}::date,reading_time_minutes=${details.minutes},
    state='draft',revision=revision+1,submitted_hash=null,approved_hash=null,approved_by=null,approved_at=null,updated_at=now()
    where ((${kind}='paid' and document_id=${id}::uuid) or (${kind}='review' and review_edition_id=${id}::uuid)) and revision=${expected}
      and (ever_published=false or (state in ('draft','withdrawn') and version_label=${details.version.trim()}))
    returning id,state,revision), history as(insert into publication_workflow_events(workflow_id,action,next_state,revision,actor_id,actor_name,reason)
      select id,'details_saved',state,revision,${actor.id}::uuid,${actor.name},'Draft version details saved; previous editorial approval cleared' from changed)
    ,issue_changed as(update review_publication_editions set edition_date=${details.issueDate||null}::date,papermark_document_id=case when ${Boolean(details.sourceId)} and exists(select 1 from publication_workflows where review_edition_id=${id}::uuid and ever_published=false) then ${details.sourceId??null} else papermark_document_id end,updated_at=now() where ${kind}='review' and id=${id}::uuid and exists(select 1 from changed)),
    paid_source as(update documents set papermark_document_id=${details.sourceId??null},updated_at=now() where ${kind}='paid' and ${Boolean(details.sourceId)} and id=${id}::uuid and exists(select 1 from changed) and exists(select 1 from publication_workflows where document_id=${id}::uuid and ever_published=false))
    select id from changed`])
  return rows.length===1
}

export async function workflowValidation(kind:PublicationKind,id:string,sql:Sql=getSql()):Promise<string[]>{
  const[row]=await sql`select publication_content_snapshot(${kind},${id}::uuid) as snapshot`
  const s=row?.snapshot as Record<string,unknown>|null; if(!s)return ['The publication no longer exists.']
  const missing:string[]=[]
  for(const[key,label]of [['title','Title'],['series','Publication category'],['issueDate','Original issue date'],['author','Author/editor'],['coveredStart','Covered period'],['coveredEnd','Covered period end'],['cutoff','Information cut-off'],['minutes','Reading time'],['provenance','Source/provenance']])if(!s[key])missing.push(label)
  if(!Array.isArray(s.sources)||!s.sources.length||s.sources.some(x=>typeof x!=='string'||!x))missing.push('Linked PDF source')
  return missing
}

export async function transitionPublicationWorkflow(kind:PublicationKind,id:string,actor:WorkflowActor,expected:number,intent:string,reason:string,sql:Sql=getSql()):Promise<{ok:boolean;message:string}>{
  const workflow=await loadWorkflow(kind,id,sql);if(!workflow)return {ok:false,message:'Start editorial review for this record first.'}
  if(workflow.revision!==expected)return {ok:false,message:'This review changed while the page was open. Reload before continuing.'}
  const move=workflowTransition(workflow.state,intent,actor.role)
  if(!move.ok)return {ok:false,message:move.reason}
  if(intent==='release')return {ok:false,message:'Use the separate publication/release control after approval. Completing review does not release anything.'}
  if(reason.trim().length<10||reason.length>500)return {ok:false,message:'Record the review decision or requested changes (10–500 characters).'}
  if(intent==='submit'||intent==='approve'){
    const missing=await workflowValidation(kind,id,sql);if(missing.length)return {ok:false,message:`Complete before review: ${missing.join(', ')}.`}
  }
  const [,rows]=await sql.transaction([subjectLock(sql,kind,id),sql`with changed as(update publication_workflows set state=${move.next},revision=revision+1,
    submitted_by=case when ${intent}='submit' then ${actor.id}::uuid else submitted_by end,submitted_at=case when ${intent}='submit' then now() else submitted_at end,
    submitted_hash=case when ${intent}='submit' then publication_content_hash(${kind},${id}::uuid) when ${intent}='rework' then null else submitted_hash end,
    approved_by=case when ${intent}='approve' then ${actor.id}::uuid else null end,approved_at=case when ${intent}='approve' then now() else null end,
    approved_hash=case when ${intent}='approve' then publication_content_hash(${kind},${id}::uuid) else null end,updated_at=now()
    where id=${workflow.id}::uuid and revision=${expected} and state=${workflow.state}
      and (${intent}<>'approve' or submitted_hash=publication_content_hash(${kind},${id}::uuid))
    returning id,revision),history as(insert into publication_workflow_events(workflow_id,action,previous_state,next_state,revision,actor_id,actor_name,reason,snapshot)
      select id,${intent},${workflow.state},${move.next},revision,${actor.id}::uuid,${actor.name},${reason.trim()},publication_content_snapshot(${kind},${id}::uuid) from changed)
    select id from changed`])
  return rows.length?{ok:true,message:move.next==='approved'?'Editorial review approved. Publication and reader access have not been released.':move.next==='in_review'?'Submitted for editorial review. Nothing has been published.':'Returned to draft with the recorded changes.'}:{ok:false,message:'The publication changed after submission. Reload and submit the updated record for review.'}
}

/** Legacy live records stay live. A new first release must have real approval. */
export async function publishingGate(kind:PublicationKind,id:string,actor:WorkflowActor,sql:Sql=getSql()):Promise<{ok:boolean;message?:string;workflow:Workflow|null}>{
  const record=await publicationRecord(kind,id,sql);if(!record)return {ok:false,message:'The publication no longer exists.',workflow:null}
  if(!(await workflowSchemaReady(sql)))return record.live?{ok:true,workflow:null}:{ok:false,message:`New publication releases require ${WORKFLOW_MIGRATION}. Existing reader access is unchanged.`,workflow:null}
  let workflow=await loadWorkflow(kind,id,sql)
  if(!workflow&&record.live)return {ok:true,workflow:null}
  if(!workflow)return {ok:false,message:'Start the editorial record, complete its details, submit it and obtain owner approval before release. Nothing was published.',workflow:null}
  if(actor.role!=='owner')return {ok:false,message:'Only an owner can release an approved publication.',workflow}
  if(workflow.state==='published'&&workflow.everPublished)return {ok:true,workflow}
  if(workflow.state!=='approved'||workflow.approvedHash!==workflow.currentHash)return {ok:false,message:'An unchanged, owner-approved editorial review is required before release. Reload and submit any changed content again.',workflow}
  return {ok:true,workflow}
}

/** Add to the SAME transaction as the guarded publication UPDATE. */
export function recordWorkflowRelease(sql:Sql,kind:PublicationKind,id:string,actor:WorkflowActor,workflow:Workflow|null){
  return sql`with changed as(update publication_workflows set state='published',ever_published=true,first_released_at=case when legacy_adoption then first_released_at else coalesce(first_released_at,now()) end,
    original_issue_date=coalesce(original_issue_date,(publication_content_snapshot(${kind},${id}::uuid)->>'issueDate')::date),
    original_source_ids=case when frozen_snapshot is null then array(select jsonb_array_elements_text(publication_content_snapshot(${kind},${id}::uuid)->'sources')) else original_source_ids end,
    frozen_snapshot=coalesce(frozen_snapshot,publication_content_snapshot(${kind},${id}::uuid)),revision=revision+1,updated_at=now()
    where id=${workflow?.id??null}::uuid and revision=${workflow?.revision??-1} and state in ('approved','published')
      and case when ${kind}='paid' then exists(select 1 from documents where id=${id}::uuid and (status='published' or paid_release_state='released')) else exists(select 1 from review_publication_editions where id=${id}::uuid and publication_state='published') end
    returning id,revision,family_id,ordinal),
    history as(insert into publication_workflow_events(workflow_id,action,previous_state,next_state,revision,actor_id,actor_name,reason)
      select id,'released',${workflow?.state??null},'published',revision,${actor.id}::uuid,${actor.name},'Approved publication released through its existing access controls' from changed)
    select id,advance_publication_family(id) from changed`
}

/** Lock, then recheck approval inside the write transaction, never only in UI. */
export function releasePreconditions(sql:Sql,kind:PublicationKind,id:string,actor:WorkflowActor,workflow:Workflow|null){
  const locks=[]
  if(workflow?.familyId&&Number(workflow.ordinal)>1){
    // Lock predecessor then target, matching preparation order. Parent locks
    // also fence new FK inserts; child locks fence edits/removals mid-release.
    locks.push(kind==='paid'?sql`select d.id from documents d join publication_workflows w on w.document_id=d.id where w.family_id=${workflow.familyId}::uuid and w.ordinal=${Number(workflow.ordinal)-1} for update of d`:sql`select e.id from review_publication_editions e join publication_workflows w on w.review_edition_id=e.id where w.family_id=${workflow.familyId}::uuid and w.ordinal=${Number(workflow.ordinal)-1} for update of e`)
  }
  locks.push(subjectLock(sql,kind,id))
  if(workflow?.familyId&&Number(workflow.ordinal)>1){
    if(kind==='paid')locks.push(sql`select p.publication_id from publication_plans p join publication_workflows w on w.document_id=p.publication_id where w.family_id=${workflow.familyId}::uuid and w.ordinal in (${workflow.ordinal},${Number(workflow.ordinal)-1}) for update of p`,sql`select x.publication_id from subscriber_publication_exceptions x join publication_workflows w on w.document_id=x.publication_id where w.family_id=${workflow.familyId}::uuid and w.ordinal in (${workflow.ordinal},${Number(workflow.ordinal)-1}) for update of x`)
    else locks.push(sql`select r.edition_id from review_edition_recipients r join publication_workflows w on w.review_edition_id=r.edition_id where w.family_id=${workflow.familyId}::uuid and w.ordinal in (${workflow.ordinal},${Number(workflow.ordinal)-1}) for update of r`,sql`select key from app_settings where key='review_approved_recipients' for update`)
  }
  locks.push(sql`select assert_publication_editorial_approval(${kind},${id}::uuid,${actor.id}::uuid,${workflow?.revision??null}::bigint)`)
  return locks
}
