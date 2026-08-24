import Link from 'next/link'
import { requireAdmin } from '@/lib/dal'
import { getSql } from '@/lib/db'
import AdminShell from '@/components/AdminShell'
import { levelLabelOrDash } from '@/lib/entitlements'
import SeatActions from './seat-actions'

export const metadata = { title: 'Subscribers · APRI' }
export const dynamic = 'force-dynamic'

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
  active: 'bg-accent/10 text-accent',
  pending: 'bg-muted text-muted-foreground border border-border',
  lapsed: 'bg-muted text-foreground/50 border border-border',
  suspended: 'bg-red-50 text-red-700 border border-red-200',
}

export default async function AdminSubscribersPage() {
  const admin = await requireAdmin()
  const sql = getSql()

  const subscribers = (await sql`
    select id, full_name, name, organization, email, public_tier, level,
           seats, term_end, status, library_link_url, created_at
    from subscribers
    order by
      case lower(status) when 'active' then 0 when 'pending' then 1 else 2 end,
      created_at desc
    limit 500
  `) as Row[]

  const active = subscribers.filter((s) => s.status.toLowerCase() === 'active').length
  const pending = subscribers.filter((s) => s.status.toLowerCase() === 'pending').length

  return (
    <AdminShell
      admin={admin}
      current="/admin/subscribers"
      title="Subscribers"
      description={`${active} active, ${pending} awaiting activation. One row per named person.`}
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
                <th className="font-medium p-4">Tier</th>
                <th className="font-medium p-4">Level</th>
                <th className="font-medium p-4">Term ends</th>
                <th className="font-medium p-4">Link</th>
                <th className="font-medium p-4">Status</th>
                <th className="font-medium p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {subscribers.map((sub) => {
                const status = sub.status.toLowerCase()
                const name = sub.full_name || sub.name || '—'
                return (
                  <tr key={sub.id} className="hover:bg-black/5 transition-colors">
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
                    <td className="p-4 text-foreground/70">{sub.organization || '—'}</td>
                    <td className="p-4 text-foreground/70">
                      {sub.public_tier || '—'}
                      {sub.seats > 1 && (
                        <span className="text-xs text-muted-foreground"> ({sub.seats} seats)</span>
                      )}
                    </td>
                    <td className="p-4 text-foreground/70">
                      {levelLabelOrDash(sub.level, sub.seats)}
                    </td>
                    <td className="p-4 text-foreground/70">
                      {sub.term_end
                        ? new Date(sub.term_end).toLocaleDateString('en-GB')
                        : '—'}
                    </td>
                    <td className="p-4">
                      {sub.library_link_url ? (
                        <span className="text-xs text-accent">Set</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not set</span>
                      )}
                    </td>
                    <td className="p-4">
                      <span
                        className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                          STATUS_STYLE[status] ??
                          'bg-muted text-muted-foreground border border-border'
                        }`}
                      >
                        {status}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <SeatActions
                        id={sub.id}
                        status={status}
                        hasLevel={Boolean(sub.level)}
                        hasTermEnd={Boolean(sub.term_end)}
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
        Activating a seat sets it live and emails the subscriber a working sign-in link. It
        needs an access level and a term end date first. Access closes on its own after the
        term end date.
      </p>
    </AdminShell>
  )
}
