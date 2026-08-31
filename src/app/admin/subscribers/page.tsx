import Link from "next/link"
import { requireAdmin } from "@/lib/dal"
import { getSql } from "@/lib/db"
import { tierDisplayName } from "@/lib/entitlements"
import AdminShell from "@/components/AdminShell"
import SeatActions from "./seat-actions"

export const metadata = { title: "Subscribers · APRI" }
export const dynamic = "force-dynamic"

type Row = {
  id: string
  full_name: string | null
  name: string
  organization: string
  email: string
  public_tier: string
  level: string | null
  seats: number
  term_end: string | null
  status: string
  library_link_url: string | null
  created_at: string
}

const STATUS_STYLE: Record<string, string> = {
  active: "bg-accent/10 text-accent",
  pending: "bg-muted text-muted-foreground border border-border",
  lapsed: "bg-muted text-foreground/50 border border-border",
  suspended: "bg-red-50 text-red-700 border border-red-200",
}

export default async function AdminSubscribersPage({ searchParams }: {
  searchParams: Promise<{ deleted?: string }>
}) {
  const admin = await requireAdmin()
  const { deleted } = await searchParams
  const sql = getSql()

  const [counts] = (await sql`
    select count(*)::int as total,
      count(*) filter (where lower(status)='active')::int as active,
      count(*) filter (where lower(status)='pending')::int as pending
    from subscribers where client_type='subscriber'
  `) as { total:number; active:number; pending:number }[]

  const subscribers = (await sql`
    select s.id, s.full_name, s.name, s.organization, s.email, s.public_tier, s.level,
           s.seats, s.term_end, s.status, s.library_link_url, s.created_at,
           (select count(*)::int from publication_access pa
             where pa.subscriber_id = s.id and pa.revoke_state = 'live') as live_links
    from subscribers s
    where s.client_type = 'subscriber'
    order by
      case when lower(s.status) <> 'active'
            and exists (select 1 from publication_access pa
                        where pa.subscriber_id = s.id and pa.revoke_state = 'live')
           then 0 else 1 end,
      case lower(s.status) when 'active' then 0 when 'pending' then 1 else 2 end,
      s.created_at desc
    limit 500
  `) as (Row & { live_links: number })[]

  const active = counts?.active ?? 0
  const pending = counts?.pending ?? 0
  const total = counts?.total ?? 0

  // Seats that have stopped paying but can still open their documents. Nothing
  // closes these on a schedule in this deployment, so the count is stated in the
  // page header rather than left to be noticed row by row.
  const needRevoking = subscribers.filter(
    (s) => s.status.toLowerCase() !== "active" && Number(s.live_links ?? 0) > 0,
  ).length

  return (
    <AdminShell
      admin={admin}
      current="/admin/subscribers"
      title="Subscribers"
      description={
        needRevoking > 0
          ? `${total} subscribers: ${active} active, ${pending} awaiting activation — and ${needRevoking} no longer active but still holding working links.`
          : `${total} subscribers: ${active} active, ${pending} awaiting activation.`
      }
      actions={
        <Link
          href="/admin/subscribers/new"
          className="bg-accent text-white px-5 py-2.5 text-sm font-medium tracking-wide hover:bg-accent-hover transition-colors shrink-0"
        >
          New subscriber
        </Link>
      }
    >
      {deleted && <div className="mb-6 border border-accent/30 bg-accent/5 p-4 text-sm">Subscriber deleted from APRI. Revoke their Papermark link separately.</div>}
      <div className="border border-border bg-card/30 overflow-x-auto">
        {subscribers.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            No subscribers yet.
          </div>
        ) : (
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="border-b border-border bg-black/5 text-foreground/70">
              <tr>
                <th className="font-medium p-4">Name</th>
                <th className="font-medium p-4">Organisation</th>
                <th className="font-medium p-4">Subscription access level</th>
                <th className="font-medium p-4">Term ends</th>
                <th className="font-medium p-4">Library link</th>
                <th className="font-medium p-4">Status</th>
                <th className="font-medium p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {subscribers.map((sub) => {
                const status = sub.status.toLowerCase()
                const name = sub.full_name || sub.name || "—"
                return (
                  <tr
                    key={sub.id}
                    className="hover:bg-black/5 transition-colors"
                  >
                    <td className="p-4">
                      <Link
                        href={`/admin/subscribers/${sub.id}`}
                        className="font-medium text-foreground hover:text-accent transition-colors"
                      >
                        {name}
                      </Link>
                      <span className="block text-xs text-muted-foreground mt-0.5">
                        {sub.email}
                      </span>
                    </td>
                    <td className="p-4 text-foreground/70">
                      {sub.organization || "—"}
                    </td>
                    <td className="p-4 text-foreground/70">
                      {sub.public_tier ? tierDisplayName(sub.public_tier) : "—"}
                      {sub.seats > 1 && (
                        <span className="text-xs text-muted-foreground">
                          {" "}
                          ({sub.seats} seats)
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-foreground/70">
                      {sub.term_end
                        ? new Date(sub.term_end).toLocaleDateString("en-GB")
                        : "—"}
                    </td>
                    <td className="p-4">
                      {sub.library_link_url ? (
                        <span className="text-xs text-accent">Set</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Not set
                        </span>
                      )}
                    </td>
                    <td className="p-4">
                      <span
                        className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                          STATUS_STYLE[status] ??
                          "bg-muted text-muted-foreground border border-border"
                        }`}
                      >
                        {status}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <SeatActions
                        id={sub.id}
                        email={sub.email}
                        status={status}
                        hasLevel={Boolean(sub.public_tier && sub.level)}
                        hasTermEnd={Boolean(sub.term_end)}
                        liveLinks={Number(sub.live_links ?? 0)}
                        compact
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="mt-6 text-xs text-muted-foreground leading-relaxed max-w-2xl">
        Activating a seat sets it live and emails the subscriber a working
        sign-in link. It needs an access level and a term end date first. Access
        closes on its own after the term end date.
      </p>
    </AdminShell>
  )
}
