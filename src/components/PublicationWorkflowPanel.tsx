import {getSql} from '@/lib/db'
import {workflowSchemaReady,loadWorkflow,publicationRecord} from '@/lib/publication-workflow'
import {type PublicationKind,WORKFLOW_MIGRATION} from '@/lib/publication-workflow-policy'
import {currentEditionPath} from '@/lib/publication-corrections'
import {siteOrigin} from '@/lib/site-config'
import PublicationWorkflowForm from './PublicationWorkflowForm'
import AccessJobRefresh from './AccessJobRefresh'
import {kickVersionRetirements} from '@/lib/publication-corrections'
export default async function PublicationWorkflowPanel({kind,id,owner}:{kind:PublicationKind;id:string;owner:boolean}){
  const sql=getSql()
  if(!(await workflowSchemaReady(sql)))return <section className="my-6 border border-border p-6"><h2 className="font-serif text-xl">Editorial review and versions</h2><p className="text-sm mt-2">New releases require {WORKFLOW_MIGRATION}. Existing reader access is unchanged.</p></section>
  const w=await loadWorkflow(kind,id,sql),record=await publicationRecord(kind,id,sql)
  const history=w?await sql`select action,actor_name,reason,created_at from publication_workflow_events where workflow_id=${w.id}::uuid order by created_at desc,id desc limit 30`:[]
  const rows=w?await sql`select id,kind,state,confirmation_method,confirmed_by,checked_by,last_error from publication_version_retirements where workflow_id=${w.id}::uuid order by id`:[]
  const pending=owner&&Boolean(w)&&rows.some(r=>['pending','running'].includes(String(r.state)))
  if(pending&&w)kickVersionRetirements(w.id)
  return <section className="my-6 border border-border bg-card/20 p-6 space-y-5"><AccessJobRefresh active={pending}/><h2 className="font-serif text-xl">Editorial review and versions</h2><PublicationWorkflowForm kind={kind} id={id} workflow={w} owner={owner} sourceId={record?.papermark_document_id?String(record.papermark_document_id):''} issueDate={record?.issue_date?String(record.issue_date):''} currentUrl={siteOrigin()+currentEditionPath(kind,id)} retirements={rows.map(r=>({id:String(r.id),kind:String(r.kind),state:String(r.state),method:r.confirmation_method?String(r.confirmation_method):null,first:r.confirmed_by?String(r.confirmed_by):null,second:r.checked_by?String(r.checked_by):null,error:r.last_error?String(r.last_error):null}))}/>{history.length>0&&<details><summary className="cursor-pointer text-sm font-medium">Recorded decisions and version history</summary><ol className="mt-3 space-y-3 text-sm">{history.map((h,i)=><li key={i}><p className="font-medium">{String(h.action).replaceAll('_',' ')} · {String(h.actor_name)} · {new Date(String(h.created_at)).toLocaleString('en-GB',{timeZone:'Africa/Lagos'})} (Lagos)</p><p>{String(h.reason)}</p></li>)}</ol></details>}</section>
}
