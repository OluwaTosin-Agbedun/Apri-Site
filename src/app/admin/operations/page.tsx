import Link from "next/link"
import AdminShell from "@/components/AdminShell"
import SubmitButton from "@/components/SubmitButton"
import { requireOwner } from "@/lib/dal"
import { getSql } from "@/lib/db"
import { operationsReady, readOperations, OPERATIONS_MIGRATION } from "@/lib/operations"
import { recentEmailDiagnostics } from "@/lib/email-delivery-inbox"
import { maskEmail } from "@/lib/review-email-attempts"
import { retentionOptions } from "@/lib/privacy-retention"
import { checkOperations, acknowledgeOperation } from "@/app/actions/operations"
import { CheckpointForm, OperationsSettingsForm, RetentionForms } from "./operations-forms"

export const dynamic = "force-dynamic"
export const metadata = {title:"Operations · APRA",robots:{index:false,follow:false}}
const date = (value:unknown) => value ? new Date(String(value)).toLocaleString("en-GB",{timeZone:"Africa/Lagos"}) : "Not recorded"

export default async function OperationsPage() {
  const admin = await requireOwner(); const sql=getSql()
  if (!(await operationsReady())) return <AdminShell admin={admin} current="/admin/operations" title="Operations"><p>Apply {OPERATIONS_MIGRATION} to enable the health checks and evidence records.</p></AdminShell>
  const settings = await readOperations(sql)
  const [alerts,staff,checkpoints,policies,cleanups,heartbeat,emails] = await Promise.all([
    sql`select * from operations_alerts order by resolved_at nulls first,opened_at desc limit 30`,
    sql`select id,name from admins where is_active=true order by name,id`,
    sql`select kind,result,evidence_ref,occurred_at from operations_checkpoints order by occurred_at desc,id limit 10`,
    sql`select p.bucket,p.days,p.reason,p.approved_at,a.name from privacy_retention_policies p join admins a on a.id=p.approved_by order by p.bucket`,
    sql`select bucket,deleted_count,created_at from privacy_cleanup_events order by created_at desc,id limit 10`,
    sql`select value from app_settings where key='operations_last_worker_at'`,
    recentEmailDiagnostics(sql),
  ])
  return <AdminShell admin={admin} current="/admin/operations" title="Operations" description="Access-job health, email evidence and service ownership. Checks here make no Papermark calls.">
    <div className="space-y-8">
      <section className="space-y-3"><div className="flex flex-wrap gap-3 items-center justify-between"><h3 className="font-medium">Service health</h3><form action={checkOperations}><SubmitButton busy="Checking…" className="border border-border rounded px-4 py-2 text-sm">Check health and match delivery reports</SubmitButton></form></div>
        <p className="text-sm text-foreground/70">Last check: {date(settings.last_checked_at)} · Last operations-worker completion: {date(heartbeat[0]?.value)}. Times are Lagos time. A successful run does not prove every service is healthy.</p>
        {!alerts.length && <p className="text-sm">No check recorded yet. Run a check or configure the operations worker.</p>}
        <ul className="space-y-2">{alerts.map(a=><li key={String(a.alert_key)} className="border border-border rounded p-4 space-y-2"><p className="text-sm"><strong>{a.resolved_at ? "Resolved" : a.severity==="critical" ? "Action needed" : "Review needed"}:</strong> {String(a.message)}</p>
          <p className="text-xs text-muted-foreground">First seen {date(a.opened_at)} · Last seen {date(a.last_seen_at)} · Alert email: {String(a.notification_state)}{a.acknowledged_at ? ` · Acknowledged ${date(a.acknowledged_at)}` : ""}</p>
          {!a.resolved_at&&!a.acknowledged_at&&<form action={acknowledgeOperation}><input type="hidden" name="alertKey" value={String(a.alert_key)} /><SubmitButton busy="Saving…" className="text-sm underline">Acknowledge</SubmitButton></form>}
        </li>)}</ul>
        <p className="text-sm">Acknowledgement records responsibility; it does not clear an issue. <Link href="/admin/subscribers/access-health" className="underline">Subscriber access health</Link> · <Link href="/admin/review-library" className="underline">Review Library</Link> · <Link href="/admin/engagement" className="underline">Reader engagement</Link></p>
      </section>
      <section className="space-y-3"><h3 className="font-medium">Recent email outcomes</h3><p className="text-sm text-foreground/70">Provider acceptance is separate from delivery. Open/click tracking does not prove someone read a publication. Addresses are masked; codes, links and message bodies are never shown here.</p>
        <div className="overflow-x-auto"><table className="w-full text-sm text-left"><caption className="sr-only">Recent review and subscriber email outcomes</caption><thead><tr>{["Time (Lagos)","Service","Recipient","Evidence"].map(v=><th scope="col" key={v} className="p-2 border-b border-border">{v}</th>)}</tr></thead><tbody>{emails.map(e=><tr key={`${e.context}-${e.id}`}><td className="p-2 border-b border-border whitespace-nowrap">{date(e.createdAt)}</td><td className="p-2 border-b border-border">{e.context} · {e.kind.replaceAll("_"," ")}</td><td className="p-2 border-b border-border">{maskEmail(e.recipient)}</td><td className="p-2 border-b border-border">{e.status}</td></tr>)}</tbody></table></div>{!emails.length&&<p className="text-sm">No recorded attempts yet. Absence of a record does not prove delivery or failure.</p>}
      </section>
      <details className="border border-border rounded p-5"><summary className="cursor-pointer font-medium">Incident ownership and internal alerts</summary><div className="mt-4 space-y-3"><p className="text-sm">Alerts are off by default. Choose an incident owner and deputy, confirm the verified email sender, then enable them if required. The worker sends at most two alerts per run.</p><OperationsSettingsForm staff={staff.map(a=>({id:String(a.id),name:String(a.name)}))} settings={{ownerId:String(settings.incident_owner_id??""),deputyId:String(settings.deputy_id??""),enabled:settings.alerts_email_enabled===true,poll:Number(settings.poll_stale_hours),queue:Number(settings.queue_stale_hours)}} /></div></details>
      <details className="border border-border rounded p-5"><summary className="cursor-pointer font-medium">Backup, restore and incident evidence</summary><div className="mt-4 space-y-4"><p className="text-sm">Record a reference to completed checks kept in Athena's private records. These entries do not create backups or prove restoration. Agree recovery targets and confirm Neon backup settings separately.</p><ul className="space-y-2 text-sm">{checkpoints.map((c,i)=><li key={i}>{date(c.occurred_at)} · {String(c.kind)} · {String(c.result)} · {String(c.evidence_ref)}</li>)}</ul><CheckpointForm /></div></details>
      <details className="border border-border rounded p-5"><summary className="cursor-pointer font-medium">Privacy and bounded cleanup</summary><div className="mt-4 space-y-4"><p className="text-sm">No deletion runs automatically. Agree each period first. Only the listed old technical records can be removed; subscriptions, agreements, access rules, content, active sessions and audit records are excluded. Removing old matched webhook evidence reduces detailed delivery history.</p><ul className="text-sm space-y-2">{policies.map(p=><li key={String(p.bucket)}>{String(p.bucket)}: {Number(p.days)} days · approved by {String(p.name)} on {date(p.approved_at)} · {String(p.reason)}</li>)}</ul><RetentionForms options={retentionOptions} /><h4 className="font-medium text-sm">Recent cleanup activity</h4><ul className="text-sm">{cleanups.map((c,i)=><li key={i}>{date(c.created_at)} · {String(c.bucket)} · {Number(c.deleted_count)} removed</li>)}</ul></div></details>
    </div>
  </AdminShell>
}
