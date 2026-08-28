import { requireAdmin } from "@/lib/dal"
import AdminShell from "@/components/AdminShell"
import { getClientEngagementDashboard } from "@/lib/client-engagement"

export const metadata = { title: "Engagement · APRI" }
export const dynamic = "force-dynamic"

export default async function EngagementPage({searchParams}:{searchParams:Promise<{type?:string;status?:string;never?:string;failure?:string;activity?:string;from?:string;to?:string}>}) {
  const admin = await requireAdmin()
  const filters = await searchParams
  const {summary,rows} = await getClientEngagementDashboard()
  const visible = (rows as any[]).filter((row) =>
    (!filters.type || row.client_type===filters.type) &&
    (!filters.status || row.status.toLowerCase()===filters.status) &&
    (filters.never!=="1" || Number(row.signins)===0) &&
    (filters.failure!=="1" || Number(row.failures)>0) &&
    (filters.activity!=="recent" || (row.last_activity && new Date(row.last_activity)>=new Date(Date.now()-30*86400000))) &&
    (filters.activity!=="none" || !row.last_activity) &&
    (!filters.from || (row.last_activity && new Date(row.last_activity)>=new Date(filters.from))) &&
    (!filters.to || (row.last_activity && new Date(row.last_activity)<new Date(`${filters.to}T23:59:59.999Z`))))
  const neverSubscribers=(rows as any[]).filter(r=>r.client_type==="Subscriber"&&Number(r.signins)===0).length
  const neverBriefings=(rows as any[]).filter(r=>r.client_type==="Briefing"&&Number(r.signins)===0).length
  const cards=[
    ["Active subscribers",summary?.active_subscribers??0],
    ["Active briefing clients",summary?.active_briefings??0],
    ["Portal visitors (30d)",summary?.visitors_30d??0],
    ["Subscribers never signed in",neverSubscribers],
    ["Briefings never signed in",neverBriefings],
    ["Sign-in emails delivered",summary?.delivered??0],
    ["Sign-in-link clicks",summary?.clicked??0],
    ["Failed or bounced",summary?.failed??0],
  ]
  return <AdminShell admin={admin} current="/admin/engagement" title="Engagement" description="Subscriber and briefing activity, kept as separate principals.">
    <p className="border border-border bg-card/30 p-4 mb-6 text-xs text-muted-foreground">Email-open information is approximate and may be affected by email privacy protection. Papermark analytics display as Not available until the API and saved link type expose them.</p>
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">{cards.map(([label,value])=><div key={String(label)} className="border border-border p-5"><p className="text-xs text-muted-foreground">{label}</p><p className="font-serif text-2xl mt-2">{value}</p></div>)}</div>
    <form className="flex flex-wrap gap-3 mb-6 text-sm">
      <select name="type" defaultValue={filters.type??""} className="border p-2"><option value="">All clients</option><option>Subscriber</option><option>Briefing</option></select>
      <select name="status" defaultValue={filters.status??""} className="border p-2"><option value="">All statuses</option><option value="active">Active</option><option value="pending">Pending</option><option value="new">New</option></select>
      <label className="p-2"><input type="checkbox" name="never" value="1" defaultChecked={filters.never==="1"}/> Never signed in</label>
      <label className="p-2"><input type="checkbox" name="failure" value="1" defaultChecked={filters.failure==="1"}/> Email failure</label>
      <select name="activity" defaultValue={filters.activity??""} className="border p-2"><option value="">Any activity</option><option value="recent">Active in 30 days</option><option value="none">No activity</option></select>
      <input aria-label="Activity from" type="date" name="from" defaultValue={filters.from??""} className="border p-2"/>
      <input aria-label="Activity to" type="date" name="to" defaultValue={filters.to??""} className="border p-2"/>
      <button className="bg-foreground text-background px-4">Filter</button>
    </form>
    <div className="overflow-x-auto border border-border"><table className="w-full text-sm"><thead><tr className="border-b"><th className="p-3 text-left">Client</th><th>Type</th><th>Status</th><th>Last portal visit</th><th>Visits</th><th>Last activity</th><th>Papermark analytics</th></tr></thead><tbody>{visible.map((r:any)=><tr key={`${r.client_type}-${r.id}`} className="border-b"><td className="p-3"><div>{r.name}</div><div className="text-xs text-muted-foreground">{r.email}</div></td><td>{r.client_type}</td><td>{r.status}</td><td>{format(r.last_portal_visit)}</td><td>{r.portal_visits}</td><td>{format(r.last_activity)}</td><td>Not available</td></tr>)}</tbody></table></div>
  </AdminShell>
}
function format(value:unknown){return value?new Date(String(value)).toLocaleString("en-GB"):"Never"}
