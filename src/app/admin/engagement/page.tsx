import Link from "next/link"
import { requireAdmin } from "@/lib/dal"
import AdminShell from "@/components/AdminShell"
import { getEngagementSummary, getSubscriberEngagementRows } from "@/lib/client-engagement"
import { tierDisplayName } from "@/lib/entitlements"

export const metadata = { title: "Engagement · APRI" }
export const dynamic = "force-dynamic"

type Filters = {
  q?: string
  level?: string
  status?: string
  never?: string
  failure?: string
  viewed?: string
  from?: string
  to?: string
}

export default async function EngagementPage({ searchParams }: { searchParams: Promise<Filters> }) {
  const admin = await requireAdmin()
  const filters = await searchParams
  const summary = await getEngagementSummary()
  const allRows = await getSubscriberEngagementRows()

  const visible = allRows.filter((r) => {
    if (filters.q) {
      const q = filters.q.toLowerCase()
      if (!r.name.toLowerCase().includes(q) && !r.email.toLowerCase().includes(q)) return false
    }
    if (filters.level && r.publicTier !== filters.level) return false
    if (filters.status && r.status.toLowerCase() !== filters.status) return false
    if (filters.never === "1" && r.lastSignIn) return false
    if (filters.failure === "1" && r.emailFailures === 0) return false
    if (filters.viewed === "yes" && r.docsViewed === 0) return false
    if (filters.viewed === "no" && r.docsViewed > 0) return false
    if (filters.from && r.lastActivity && new Date(r.lastActivity) < new Date(filters.from)) return false
    if (filters.to && r.lastActivity && new Date(r.lastActivity) > new Date(`${filters.to}T23:59:59.999Z`)) return false
    if (filters.from && !r.lastActivity) return false
    return true
  })

  const tiers = [...new Set(allRows.map(r => r.publicTier).filter(Boolean))]

  const cards: [string, number, string?][] = [
    ["Active subscribers", summary.activeSubscribers],
    ["Signed in (30d)", summary.signedIn30d],
    ["Never signed in", summary.neverSignedIn, summary.neverSignedIn > 0 ? "text-amber-600" : undefined],
    ["Portal visitors (30d)", summary.portalVisitors30d],
    ["Portal opens", summary.portalOpens],
    ["APRI view clicks", summary.viewClicks],
    ["Papermark views", summary.papermarkViews],
    ["APRI download clicks", summary.downloadClicks],
    ["Papermark downloads", summary.papermarkDownloads],
    ["Emails sent", summary.emailsSent],
    ["Emails delivered", summary.emailsDelivered],
    ["Emails opened", summary.emailsOpened],
    ["Emails clicked", summary.emailsClicked],
    ["Failures", summary.emailFailures, summary.emailFailures > 0 ? "text-red-600" : undefined],
  ]

  return (
    <AdminShell admin={admin} current="/admin/engagement" title="Engagement" description="Subscriber activity, document views and email delivery.">

      <p className="border border-border bg-card/30 p-3 mb-5 text-xs text-muted-foreground leading-relaxed">
        Email-open counts are approximate and may be affected by email privacy protection. Papermark analytics display as counts from the document_views table.
      </p>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 mb-6">
        {cards.map(([label, value, color]) => (
          <div key={String(label)} className="border border-border p-4 rounded-sm">
            <p className="text-xs text-muted-foreground leading-tight">{label}</p>
            <p className={`font-serif text-xl mt-1 ${color ?? ""}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <form className="flex flex-wrap gap-2 mb-5 text-sm">
        <input type="text" name="q" placeholder="Search name or email" defaultValue={filters.q ?? ""} className="border border-border p-2 rounded-sm w-48" />
        <select name="level" defaultValue={filters.level ?? ""} className="border border-border p-2 rounded-sm">
          <option value="">All levels</option>
          {tiers.map(t => <option key={t} value={t}>{tierDisplayName(t)}</option>)}
        </select>
        <select name="status" defaultValue={filters.status ?? ""} className="border border-border p-2 rounded-sm">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="pending">Pending</option>
        </select>
        <label className="flex items-center gap-1 p-2"><input type="checkbox" name="never" value="1" defaultChecked={filters.never === "1"} /> Never signed in</label>
        <label className="flex items-center gap-1 p-2"><input type="checkbox" name="failure" value="1" defaultChecked={filters.failure === "1"} /> Email failure</label>
        <select name="viewed" defaultValue={filters.viewed ?? ""} className="border border-border p-2 rounded-sm">
          <option value="">Any docs</option>
          <option value="yes">Has viewed</option>
          <option value="no">Never viewed</option>
        </select>
        <input aria-label="Activity from" type="date" name="from" defaultValue={filters.from ?? ""} className="border border-border p-2 rounded-sm" />
        <input aria-label="Activity to" type="date" name="to" defaultValue={filters.to ?? ""} className="border border-border p-2 rounded-sm" />
        <button className="bg-foreground text-background px-4 py-2 rounded-sm text-sm">Filter</button>
      </form>

      {/* Subscriber table */}
      <div className="overflow-x-auto border border-border rounded-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-card/30 text-left">
              <th className="p-3 font-medium">Subscriber</th>
              <th className="p-3 font-medium">Level</th>
              <th className="p-3 font-medium">Status</th>
              <th className="p-3 font-medium text-right">Visits (30d)</th>
              <th className="p-3 font-medium text-right">Viewed</th>
              <th className="p-3 font-medium text-right">Downloaded</th>
              <th className="p-3 font-medium">Last sign-in</th>
              <th className="p-3 font-medium">Last activity</th>
              <th className="p-3 font-medium text-right">Email fails</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">No subscribers match the current filters.</td></tr>
            )}
            {visible.map((r) => (
              <tr key={r.id} className="border-b hover:bg-card/20 transition-colors">
                <td className="p-3">
                  <Link href={`/admin/engagement/${r.id}`} className="hover:underline">
                    <div className="font-medium">{r.name || "—"}</div>
                    <div className="text-xs text-muted-foreground">{r.email}</div>
                  </Link>
                </td>
                <td className="p-3 text-xs">{tierDisplayName(r.publicTier) || "—"}</td>
                <td className="p-3">
                  <span className={`text-xs px-1.5 py-0.5 rounded ${r.status.toLowerCase() === "active" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}`}>
                    {r.status}
                  </span>
                </td>
                <td className="p-3 text-right tabular-nums">{r.portalVisits30d}</td>
                <td className="p-3 text-right tabular-nums">{r.docsViewed}</td>
                <td className="p-3 text-right tabular-nums">{r.docsDownloaded}</td>
                <td className="p-3 text-xs text-muted-foreground">{fmt(r.lastSignIn)}</td>
                <td className="p-3 text-xs text-muted-foreground">{fmt(r.lastActivity)}</td>
                <td className="p-3 text-right tabular-nums">{r.emailFailures > 0 ? <span className="text-red-600">{r.emailFailures}</span> : 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground mt-3">{visible.length} of {allRows.length} subscribers shown. Click a row to see their full activity timeline.</p>
    </AdminShell>
  )
}

function fmt(value: string | null): string {
  if (!value) return "Never"
  const d = new Date(value)
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}
