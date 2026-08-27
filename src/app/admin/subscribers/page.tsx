import Link from "next/link"
import { requireAdmin } from "@/lib/dal"
import { getSql } from "@/lib/db"
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

export default async function AdminSubscribersPage() {
  const admin = await requireAdmin()
  const sql = getSql()

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

  const active = subscribers.filter(
    (subscriber) => subscriber.status.toLowerCase() === "active",
  ).length
  const pending = subscribers.filter(
    (subscriber) => subscriber.status.toLowerCase() === "pending",
  ).length
  const needRevoking = subscribers.filter(
    (subscriber) =>
      subscriber.status.toLowerCase() !== "active" &&
      Number(subscriber.live_links ?? 0) > 0,
  ).length

  return (
    <AdminShell
      admin={admin}
      current="/admin/subscribers"
      title="Subscribers"
      description={
        needRevoking > 0
          ? `${active} active, ${pending} awaiting activation — and ${needRevoking} no longer active but still holding working links. Revoke those now.`
          : `${active} active, ${pending} awaiting activation. One row per named person.`
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
              {subscribers.map((subscriber) => {
                const status = subscriber.status.toLowerCase()
                const name = subscriber.full_name || subscriber.name || "—"
                return (
                  <tr key={subscriber.id} className="hover:bg-black/5 transition-colors">
                    <td className="p-4">
                      <Link
                        href={`/admin/subscribers/${subscriber.id}`}
                        className="font-medium text-foreground hover:text-accent transition-colors"
                      >
                        {name}
                      </Link>
                      <span className="block text-xs text-muted-foreground mt-0.5">
                        {subscriber.email}
                      </span>
                    </td>
                    <td className="p-4 text-foreground/70">
                      {subscriber.organization || "—"}
                    </td>
                    <td className="p-4 text-foreground/70">
                      {subscriber.public_tier || "—"}
                      {subscriber.seats > 1 && (
                        <span className="text-xs text-muted-foreground">
                          {" "}({subscriber.seats} seats)
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-foreground/70">
                      {subscriber.term_end
                        ? new Date(subscriber.term_end).toLocaleDateString("en-GB")
                        : "—"}
                    </td>
                    <td className="p-4">
                      {subscriber.library_link_url ? (
                        <span className="text-xs text-accent">Set</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not set</span>
                      )}
                    </td>
                    <td className="p-4">
                      <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                        STATUS_STYLE[status] ??
                        "bg-muted text-muted-foreground border border-border"
                      }`}>
                        {status}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <SeatActions
                        id={subscriber.id}
                        status={status}
                        hasLevel={Boolean(subscriber.level)}
                        hasTermEnd={Boolean(subscriber.term_end)}
                        hasLibraryLink={Boolean(subscriber.library_link_url)}
                        liveLinks={Number(subscriber.live_links ?? 0)}
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
        Pending means the person has requested access but cannot sign in yet.
        Complete their subscription access level, term end date and personal
        Papermark library link, save the record, then activate it.
      </p>
    </AdminShell>
  )
}
