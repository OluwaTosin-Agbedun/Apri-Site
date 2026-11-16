"use client"
import { useActionState, useId, type ReactNode } from "react"
import SubmitButton from "@/components/SubmitButton"
import { saveOperationsSettings, recordOperationsCheckpoint, saveRetentionPolicy, previewPrivacyCleanup, confirmPrivacyCleanup, type OperationsFormState } from "@/app/actions/operations"

const input = "block w-full min-h-11 rounded border border-border px-3 py-2 bg-background text-sm"
function Field({name,label,type="text",...props}:{name:string;label:string;type?:string;required?:boolean;min?:number;max?:number;maxLength?:number;defaultValue?:string|number}) {
  const id = useId()
  return <label htmlFor={id} className="block text-sm space-y-1"><span>{label}</span><input id={id} name={name} type={type} className={input} {...props} /></label>
}
function Form({action,children,label}:{action:(state:OperationsFormState,form:FormData)=>Promise<OperationsFormState>;children:ReactNode;label:string}) {
  const [state,submit] = useActionState(action,undefined)
  return <div className="space-y-3"><form action={submit} className="space-y-3 max-w-lg">{children}
    {state && <p role={state.ok?"status":"alert"} className="text-sm">{state.message}</p>}
    <SubmitButton busy="Working…" className="min-h-11 rounded bg-foreground text-background px-4 py-2 text-sm disabled:opacity-60">{label}</SubmitButton>
  </form>{state?.preview && <div className="border border-border rounded p-4 space-y-3"><p className="text-sm">{state.preview.label}: {state.preview.count} records before {new Date(state.preview.cutoff).toLocaleString("en-GB")}. A run removes at most 1,000. This preview expires in 15 minutes.</p>
    <Form action={confirmPrivacyCleanup} label="Confirm bounded cleanup"><input type="hidden" name="preview" value={state.preview.token} />
      <label className="flex gap-2 text-sm"><input type="checkbox" name="confirm" value="yes" required />I reviewed this preview and approve removing these old records.</label><Field name="password" label="Your current password" type="password" required maxLength={200} />
    </Form></div>}</div>
}
type Staff = {id:string;name:string}
export function OperationsSettingsForm({staff,settings}:{staff:Staff[];settings:{ownerId:string;deputyId:string;enabled:boolean;poll:number;queue:number}}) {
  return <Form action={saveOperationsSettings} label="Save operations settings">
    <label className="block text-sm space-y-1"><span>Incident owner</span><select name="ownerId" defaultValue={settings.ownerId} className={input} required><option value="">Choose staff</option>{staff.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <label className="block text-sm space-y-1"><span>Deputy</span><select name="deputyId" defaultValue={settings.deputyId} className={input} required><option value="">Choose different staff</option>{staff.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <Field name="pollHours" label="Analytics poll overdue after (hours)" type="number" defaultValue={settings.poll} min={1} max={168} required />
    <Field name="queueHours" label="Saved access jobs overdue after (hours)" type="number" defaultValue={settings.queue} min={1} max={168} required />
    <label className="flex gap-2 text-sm"><input type="checkbox" name="emailEnabled" value="yes" defaultChecked={settings.enabled} />Email internal alerts to these two staff. No subscriber emails are sent here.</label>
    <Field name="password" label="Your current password" type="password" required maxLength={200} />
  </Form>
}
export function CheckpointForm() {
  return <Form action={recordOperationsCheckpoint} label="Record evidence reference">
    <label className="block text-sm space-y-1"><span>Check completed</span><select className={input} name="kind"><option value="backup">Backup check</option><option value="restore">Restore rehearsal</option><option value="incident_exercise">Incident exercise</option></select></label>
    <label className="block text-sm space-y-1"><span>Result</span><select className={input} name="result"><option value="pass">Passed</option><option value="fail">Failed</option></select></label>
    <Field name="occurredAt" label="When it was checked (include timezone, e.g. 2026-11-15T14:00:00+01:00)" required maxLength={40} />
    <Field name="evidence" label="Internal evidence reference (no links or secrets)" required maxLength={160} />
  </Form>
}
export function RetentionForms({options}:{options:{key:string;label:string}[]}) {
  const select = <label className="block text-sm space-y-1"><span>Record type</span><select name="bucket" className={input}>{options.map(o=><option key={o.key} value={o.key}>{o.label}</option>)}</select></label>
  return <div className="space-y-5"><Form action={saveRetentionPolicy} label="Approve retention policy">{select}
    <Field name="days" label="Retain for at least (days, 7–3650)" type="number" min={7} max={3650} required />
    <Field name="reason" label="Approval reason" maxLength={300} required />
    <Field name="password" label="Your current password" type="password" maxLength={200} required />
  </Form><Form action={previewPrivacyCleanup} label="Preview cleanup only">{select}</Form></div>
}
