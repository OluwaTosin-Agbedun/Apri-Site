"use server"
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { requireAdmin,requireOwner } from '@/lib/dal'
import { confirmStaffPassword } from '@/lib/staff-password'
import { getSql } from '@/lib/db'
import { startPublicationWorkflow,saveWorkflowDetails,transitionPublicationWorkflow,workflowSchemaReady } from '@/lib/publication-workflow'
import { correctionPreview,prepareCorrection,recordNoticeProof,verifyNoticeProof,attestManualRetirement,attestLegacyNoticeCopy,drainVersionRetirements,type CorrectionPreview } from '@/lib/publication-corrections'
import { uuid,WORKFLOW_MIGRATION,type PublicationKind } from '@/lib/publication-workflow-policy'
import { validateEditorialMetadata } from '@/lib/publication-metadata'
export type WorkflowFormState={ok?:boolean;message:string;preview?:CorrectionPreview}|undefined
function refresh(kind:PublicationKind,id:string){
  revalidatePath(`/admin/documents/${id}`);revalidatePath(`/admin/review-library/${id}/workflow`)
  revalidatePath('/admin/review-library');revalidatePath('/admin/datarooms');revalidatePath('/portal');revalidatePath('/review/library');revalidatePath('/');revalidatePath('/publications')
}
export async function changePublicationWorkflow(kind:PublicationKind,id:string,_previous:WorkflowFormState,form:FormData):Promise<WorkflowFormState>{
  const admin=await requireAdmin()
  if(!['paid','review'].includes(kind)||!uuid.test(id))return {message:'Unknown publication.'}
  if(!(await workflowSchemaReady()))return {message:`Apply ${WORKFLOW_MIGRATION}. Existing readers are unaffected.`}
  const intent=String(form.get('intent')??''),reason=String(form.get('reason')??'').trim()
  const revision=Number(form.get('revision'))
  const sensitive=['approve','prepareCorrection','noticePrepared','noticeVerified','manualRetirement','legacyNoticeCopy'].includes(intent)
  if(sensitive||['previewCorrection','retireBatch'].includes(intent))await requireOwner()
  if(sensitive&&!(await confirmStaffPassword(admin.id,form.get('password'))))return {message:'Confirm your password, or try again after the re-authentication limit clears.'}
  try {
    if(intent==='start'){
      await startPublicationWorkflow(kind,id,admin,reason);refresh(kind,id);return {ok:true,message:'Editorial record started. Existing publication access was not changed.'}
    }
    if(intent==='details'){
      const parsed=validateEditorialMetadata({authorEditor:form.get('author'),coveredPeriodStart:form.get('start'),coveredPeriodEnd:form.get('end'),informationCutoff:form.get('cutoff'),readingMinutes:form.get('minutes')})
      if(kind==='review'&&!parsed.ok)return {message:'Check the author, covered period, cut-off and reading time.'}
      const day=String(form.get('issueDate')??'')
      if(kind==='review'&&day&&(!/^\d{4}-\d{2}-\d{2}$/.test(day)||Number.isNaN(new Date(day).getTime())||new Date(day).toISOString().slice(0,10)!==day))return {message:'Enter a real issue date.'}
      const m=parsed.ok?parsed.value:null
      const sourceId=String(form.get('sourceId')??'').trim()
      if(sourceId&&!/^[A-Za-z0-9_-]{1,200}$/.test(sourceId))return {message:'Enter the Papermark document ID, not a share link or a filename.'}
      const ok=await saveWorkflowDetails(kind,id,admin,revision,{version:String(form.get('version')??''),provenance:String(form.get('provenance')??''),author:m?.authorEditor??'',start:m?.coveredPeriodStart??'',end:m?.coveredPeriodEnd??'',cutoff:m?.informationCutoff??'',minutes:m?.readingMinutes??null,issueDate:day,sourceId})
      refresh(kind,id);return {ok,message:ok?'Draft details saved; submit the updated version for review.':'Nothing saved. This draft changed or was already published; reload.'}
    }
    if(['submit','rework','approve'].includes(intent)){
      if(!Number.isSafeInteger(revision)||revision<0)return {message:'Reload this editorial record.'}
      const result=await transitionPublicationWorkflow(kind,id,admin,revision,intent,reason);refresh(kind,id);return result
    }
    if(intent==='previewCorrection'){
      await requireOwner();const target=String(form.get('targetId')??'')
      await startPublicationWorkflow(kind,id,admin,'Existing publication adopted to preview a separately identified correction')
      await startPublicationWorkflow(kind,target,admin,'Unreleased correction draft prepared for an exact audience preview')
      const preview=await correctionPreview(kind,id,target);refresh(kind,id)
      return {ok:true,message:'Preview only. Preparing will replace the target draft’s plan/exception or recipient list with this exact source audience. Terms and personal links are not copied.',preview}
    }
    if(intent==='prepareCorrection'){
      const target=String(form.get('targetId')??'')
      await prepareCorrection(kind,id,target,String(form.get('fingerprint')??''),admin,reason);refresh(kind,id);refresh(kind,target)
      return {ok:true,message:'Correction family and exact audience inheritance recorded. Complete the new draft’s review. Before release, prepare and verify the earlier PDF’s notice and retire its old raw links.'}
    }
    if(intent==='noticePrepared'){
      if(form.get('checked')!=='yes')return {message:'Inspect the first-page notice, every footer, current link, PDF readability and personalised download protection before recording proof.'}
      await recordNoticeProof(kind,id,admin,{documentId:String(form.get('documentId')??'').trim(),sourceHash:String(form.get('sourceHash')??'').trim(),noticeHash:String(form.get('noticeHash')??'').trim(),pages:Number(form.get('pages')),currentUrl:String(form.get('currentUrl')??'')},reason);refresh(kind,id)
      return {ok:true,message:'Notice proof saved as a manual observation. A different owner must independently inspect the uploaded copy; it is not yet verified or used.'}
    }
    if(intent==='noticeVerified'){
      if(form.get('checked')!=='yes')return {message:'Confirm the independent PDF, page and security checks first.'}
      await verifyNoticeProof(kind,id,admin,revision,reason);refresh(kind,id)
      return {ok:true,message:'Independent notice check recorded and notice source selected. Old-link retirement jobs are saved. Prepare secure access to this notice copy and finish all retirement checks before releasing the correction.'}
    }
    if(intent==='manualRetirement'){
      if(form.get('checked')!=='yes')return {message:'Check the provider and existing copies, then confirm the manual evidence.'}
      await attestManualRetirement(String(form.get('jobId')??''),admin,reason);refresh(kind,id)
      return {ok:true,message:'Manual observation recorded. Read the status: it is confirmed only after two different owners have checked it.'}
    }
    if(intent==='legacyNoticeCopy'){
      if(kind!=='paid'||form.get('checked')!=='yes')return {message:'Check the subscriber’s own protected notice copy first.'}
      await attestLegacyNoticeCopy(id,String(form.get('subscriberId')??''),admin,reason);refresh(kind,id)
      return {ok:true,message:'Legacy notice-copy check recorded. The history copy opens only once a different owner checks the exact same copy.'}
    }
    if(intent==='retireBatch'){
      await requireOwner();after(async()=>{await drainVersionRetirements({maxJobs:2,deadline:Date.now()+15000}).catch(()=>{});refresh(kind,id)})
      return {ok:true,message:'A bounded old-link check has started. Unconfirmed jobs remain saved for the hourly worker.'}
    }
    return {message:'Choose an available editorial action.'}
  }catch(error){
    return {message:error instanceof Error?error.message.slice(0,500):'Nothing completed. Reload and check the editorial record.'}
  }
}
