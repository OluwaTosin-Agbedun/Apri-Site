import 'server-only'
import {getSql} from './db'
import {workflowSchemaReady} from './publication-workflow'
import {type PublicationKind,uuid} from './publication-workflow-policy'
type Sql=ReturnType<typeof getSql>
export type VersionInfo={recordId:string;familyId:string;ordinal:number;label:string;state:string;noticeReady:boolean;currentId:string|null}
export async function publicationVersions(kind:PublicationKind,ids:readonly string[],sql:Sql=getSql()):Promise<Map<string,VersionInfo>>{
  const valid=ids.filter(x=>uuid.test(x))
  if(!valid.length||!(await workflowSchemaReady(sql)))return new Map()
  const rows=await sql`select coalesce(w.document_id,w.review_edition_id) as record_id,w.family_id,w.ordinal,w.version_label,w.state,w.notice_verified_at,
    coalesce(current.document_id,current.review_edition_id) as current_id
    from publication_workflows w join publication_families f on f.id=w.family_id left join publication_workflows current on current.id=f.current_workflow_id
    where ((${kind}='paid' and w.document_id=any(${valid}::uuid[])) or (${kind}='review' and w.review_edition_id=any(${valid}::uuid[]))) and w.ever_published`
  return new Map(rows.map(r=>[String(r.record_id),{recordId:String(r.record_id),familyId:String(r.family_id),ordinal:Number(r.ordinal),label:String(r.version_label),state:String(r.state),noticeReady:Boolean(r.notice_verified_at),currentId:r.current_id?String(r.current_id):null}]))
}
/** Only collapse an already authorised list. A family relationship grants nothing. */
export function latestEntitledVersions<T>(items:readonly T[],id:(item:T)=>string,versions:ReadonlyMap<string,VersionInfo>):T[]{
  const selected=new Map<string,T>()
  for(const item of items){const v=versions.get(id(item));if(!v)continue
    const previous=selected.get(v.familyId),p=previous?versions.get(id(previous)):null
    if(!p||v.ordinal>p.ordinal)selected.set(v.familyId,item)
  }
  return items.filter(item=>{const v=versions.get(id(item));return !v||selected.get(v.familyId)===item})
}
/** A history list includes only records already permitted by the caller. */
export function familyHistory<T>(items:readonly T[],id:(item:T)=>string,requested:string,versions:ReadonlyMap<string,VersionInfo>):T[]{
  const v=versions.get(requested);if(!v)return items.filter(x=>id(x)===requested)
  return items.filter(x=>versions.get(id(x))?.familyId===v.familyId).sort((a,b)=>(versions.get(id(b))?.ordinal??0)-(versions.get(id(a))?.ordinal??0))
}

export async function noticeSources(sql:Sql=getSql()):Promise<Map<string,string>>{
  if(!(await workflowSchemaReady(sql)))return new Map()
  const rows=await sql`select document_id,notice_document_id from publication_workflows where document_id is not null and notice_verified_at is not null`
  return new Map(rows.map(r=>[String(r.document_id),String(r.notice_document_id)]))
}

/** Metadata only. The caller must still select from its own access-policy list. */
export async function formerNoticePublication(rowId:string,sql:Sql=getSql()):Promise<string|null>{
  if(!uuid.test(rowId)||!(await workflowSchemaReady(sql)))return null
  const [former]=await sql`select w.document_id from papermark_dataroom_documents dd join publication_workflows w on w.document_id=dd.publication_id
    where dd.id=${rowId}::uuid and w.notice_verified_at is not null and dd.papermark_document_id=any(w.original_source_ids)`
  return former?.document_id?String(former.document_id):null
}

/** Routing only after the shared policy supplied an allowed candidate list. */
export async function latestPaidPublicationFor(subscriberId:string,publicationId:string):Promise<string|null>{
  const {loadSubscriberAccess}=await import('./access-policy-dal')
  const access=await loadSubscriberAccess(subscriberId)
  if(access.state!=='ok')return null
  const items=access.documents.filter(d=>d.publicationId&&d.decision.outcome==='allowed')
  if(!items.some(d=>d.publicationId===publicationId))return null
  const versions=await publicationVersions('paid',items.map(d=>d.publicationId!))
  const latest=latestEntitledVersions(familyHistory(items,d=>d.publicationId!,publicationId,versions),d=>d.publicationId!,versions)[0]
  return latest?.publicationId??null
}
