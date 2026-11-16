/** Editorial state is separate from paid release and review assignments. */
export type WorkflowState="draft"|"in_review"|"approved"|"published"|"withdrawn"|"archived"
export type PublicationKind="paid"|"review"
export const WORKFLOW_MIGRATION="20261115_stage3_publishing_workflow.sql"
export const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function workflowTransition(state:WorkflowState,intent:string,role:"owner"|"editor"):{ok:true;next:WorkflowState}|{ok:false;reason:string}{
  if(intent==="submit"&&(state==="draft"||state==="withdrawn"))return {ok:true,next:"in_review"}
  if(intent==="rework"&&(state==="in_review"||state==="approved"))return {ok:true,next:"draft"}
  if(intent==="approve"&&state==="in_review"&&role==="owner")return {ok:true,next:"approved"}
  if(intent==="release"&&(state==="approved"||state==="published")&&role==="owner")return {ok:true,next:"published"}
  return {ok:false,reason:"That change is not available from the current editorial stage or with this account's role."}
}
export function workflowLabel(state:WorkflowState):string{return ({draft:"Draft",in_review:"In review",approved:"Approved",published:"Published",withdrawn:"Withdrawn",archived:"Archived"})[state]}
export function validVersionLabel(value:string):boolean{return /^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,59}$/.test(value)}
