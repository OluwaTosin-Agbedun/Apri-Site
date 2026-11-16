"use server"
import { requireOwner } from "@/lib/dal"
import { getSql } from "@/lib/db"
import { revalidatePath } from "next/cache"
import { operationsReady, OPERATIONS_MIGRATION, refreshOperations } from "@/lib/operations"
import { confirmStaffPassword } from "@/lib/staff-password"
import { approveRetention, executeRetention, isRetentionBucket, previewRetention } from "@/lib/privacy-retention"
import { drainDeliveryInbox } from "@/lib/email-delivery-inbox"
import { isValidDay } from "@/lib/publication-metadata"

export type OperationsFormState = {ok?:boolean;message:string;preview?:{count:number;cutoff:string;token:string;label:string}}|undefined
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
async function ownerReady() {
  const owner = await requireOwner()
  if (!(await operationsReady())) throw new Error(`Apply ${OPERATIONS_MIGRATION} first.`)
  return owner
}

export async function checkOperations():Promise<void> {
  await ownerReady()
  await drainDeliveryInbox(25)
  await refreshOperations()
  revalidatePath("/admin/operations")
}
export async function acknowledgeOperation(form:FormData):Promise<void> {
  const owner = await ownerReady()
  const alert = form.get("alertKey")
  if (typeof alert!=="string" || !/^[a-z_]{1,80}$/.test(alert)) return
  await getSql()`update operations_alerts set acknowledged_at=now(),acknowledged_by=${owner.id}::uuid where alert_key=${alert} and resolved_at is null`
  revalidatePath("/admin/operations")
}
export async function saveOperationsSettings(_previous:OperationsFormState,form:FormData):Promise<OperationsFormState> {
  const owner = await ownerReady(); const sql = getSql()
  const lead = String(form.get("ownerId")??""); const deputy = String(form.get("deputyId")??"")
  const poll = Number(form.get("pollHours")); const queue = Number(form.get("queueHours"))
  const enabled = form.get("emailEnabled")==="yes"
  if (!uuid.test(lead)||!uuid.test(deputy)||lead===deputy||![poll,queue].every(n=>Number.isInteger(n)&&n>=1&&n<=168)) return {message:"Choose two different active staff and whole-hour thresholds between 1 and 168."}
  const staff = await sql`select id from admins where is_active=true and id in (${lead}::uuid,${deputy}::uuid)`
  if (staff.length!==2) return {message:"Both incident contacts must be active administrators."}
  if (!(await confirmStaffPassword(owner.id,form.get("password")))) return {message:"Your password could not be confirmed. Check it or try again in 15 minutes."}
  await sql`update operations_settings set incident_owner_id=${lead}::uuid,deputy_id=${deputy}::uuid,
    alerts_email_enabled=${enabled},poll_stale_hours=${poll},queue_stale_hours=${queue},updated_by=${owner.id}::uuid,updated_at=now() where singleton=true`
  if (enabled) await sql`update operations_alerts set notification_state='pending',next_notification_at=now()
    where notification_state='disabled' and resolved_at is null`
  await sql`insert into admin_security_events(actor_admin_id,event_type) values(${owner.id}::uuid,'operations_settings_saved')`
  revalidatePath("/admin/operations")
  return {ok:true,message:enabled ? "Saved. Internal alert emails will be processed by the operations worker." : "Saved. Internal alert emails are off."}
}
export async function recordOperationsCheckpoint(_previous:OperationsFormState,form:FormData):Promise<OperationsFormState> {
  const owner = await ownerReady()
  const kind = String(form.get("kind")); const result = String(form.get("result")); const evidence = String(form.get("evidence")??"").trim()
  const occurred=String(form.get("occurredAt")); const date = new Date(occurred)
  if (!["backup","restore","incident_exercise"].includes(kind)||!["pass","fail"].includes(result)||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(occurred)||!isValidDay(occurred.slice(0,10))||!Number.isFinite(date.getTime())||date.getTime()>Date.now()+300_000||evidence.length<3||evidence.length>160||/[\r\n]|https?:\/\/|@|[?&=]/i.test(evidence)) return {message:"Choose a completed check, a valid date with timezone, and a short internal evidence reference without links, addresses or secrets."}
  await getSql()`insert into operations_checkpoints(kind,result,evidence_ref,occurred_at,recorded_by)
    values(${kind},${result},${evidence},${date},${owner.id}::uuid)`
  revalidatePath("/admin/operations")
  return {ok:true,message:"Evidence reference recorded. This is a staff declaration, not an automated backup verification."}
}
export async function saveRetentionPolicy(_previous:OperationsFormState,form:FormData):Promise<OperationsFormState> {
  const owner = await ownerReady()
  const bucket = form.get("bucket"); const days = Number(form.get("days")); const reason = String(form.get("reason")??"").trim()
  if (!isRetentionBucket(bucket)||!Number.isInteger(days)||days<7||days>3650||reason.length<10||reason.length>300) return {message:"Choose a record type, 7–3650 days and an approval reason of 10–300 characters."}
  if (!(await confirmStaffPassword(owner.id,form.get("password")))) return {message:"Your password could not be confirmed. Check it or try again in 15 minutes."}
  await approveRetention(owner.id,bucket,days,reason)
  revalidatePath("/admin/operations")
  return {ok:true,message:"Policy recorded. Nothing was deleted and no automatic cleanup was enabled."}
}
export async function previewPrivacyCleanup(_previous:OperationsFormState,form:FormData):Promise<OperationsFormState> {
  const owner = await ownerReady(); const bucket = form.get("bucket")
  if (!isRetentionBucket(bucket)) return {message:"Choose a record type."}
  const preview = await previewRetention(owner.id,bucket)
  return preview ? {ok:true,message:"Preview only. Review the count before confirming a bounded cleanup.",preview} : {message:"Approve a retention policy for this record type first."}
}
export async function confirmPrivacyCleanup(_previous:OperationsFormState,form:FormData):Promise<OperationsFormState> {
  const owner = await ownerReady(); const token = form.get("preview")
  if (form.get("confirm")!=="yes"||typeof token!=="string") return {message:"Confirm that you reviewed the preview."}
  if (!(await confirmStaffPassword(owner.id,form.get("password")))) return {message:"Your password could not be confirmed. Check it or try again in 15 minutes."}
  const deleted = await executeRetention(owner.id,token)
  revalidatePath("/admin/operations")
  return deleted===null ? {message:"The preview expired or the records/policy changed. Generate a fresh preview."} : {ok:true,message:`Removed ${deleted} old records. Each run is limited to 1,000; generate a fresh preview before another run.`}
}
