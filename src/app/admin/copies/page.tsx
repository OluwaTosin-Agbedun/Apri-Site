import Link from 'next/link'
import { requireAdmin } from '@/lib/dal'
import AdminShell from '@/components/AdminShell'
import SecurityFindings from '@/components/SecurityFindings'
import { getCopyGaps } from '@/lib/provisioning'
import { getManualRevocations } from '@/lib/revocation'
import { getHeldAlerts } from '@/lib/alerts'
import { levelLabel } from '@/lib/entitlements'
import RevokeActions from './revoke-actions'

export const metadata = { title: 'Copies · APRI' }
export const dynamic = 'force-dynamic'

/**
 * Three work queues, all of which should read as empty when things are well.
 *
 * Copies needed is the important one: under stamping, the thing that fails
 * silently is not a permission but a copy nobody made.
 */
export default async function CopiesPage() {
  const admin = await requireAdmin()

  const [gaps, manual, held] = await Promise.all([
    getCopyGaps(),
    getManualRevocations(),
    getHeldAlerts(),
  ])

  const overdue = gaps.filter((g) => g.ageDays >= 1)

  return (
    <AdminShell
      admin={admin}
      current="/admin/copies"
      title="Copies"
      description={
        gaps.length === 0
          ? 'Every entitled subscriber has a stamped copy of every edition.'
          : `${gaps.length} ${gaps.length === 1 ? 'copy' : 'copies'} to make${overdue.length > 0 ? `, ${overdue.length} overdue` : ''}.`
      }
    >
      <SecurityFindings />

      <section className="mb-12">
        <h3 className="font-serif text-lg text-foreground mb-2">Copies needed</h3>
        <p className="text-xs text-muted-foreground leading-relaxed mb-5 max-w-2xl">
          An entitled subscriber with no stamped copy sees nothing in their library, and no
          permission check catches it because nothing is being denied. A gap open longer
          than 24 hours is emailed to us.
        </p>

        <div className="border border-border bg-card/30 overflow-x-auto">
          {gaps.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              Nothing outstanding.
            </div>
          ) : (
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="border-b border-border bg-black/5 text-foreground/70">
                <tr>
                  <th className="font-medium p-4">Subscriber</th>
                  <th className="font-medium p-4">Level</th>
                  <th className="font-medium p-4">Publication</th>
                  <th className="font-medium p-4">Waiting</th>
                  <th className="font-medium p-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {gaps.map((gap) => (
                  <tr
                    key={`${gap.subscriberId}:${gap.publicationId}`}
                    className={`hover:bg-black/5 transition-colors ${gap.ageDays >= 1 ? 'bg-red-50/40' : ''}`}
                  >
                    <td className="p-4">
                      <span className="font-medium text-foreground">
                        {gap.subscriberName || '—'}
                      </span>
                      <span className="block text-xs text-muted-foreground mt-0.5">
                        {gap.organisation}
                      </span>
                    </td>
                    <td className="p-4 text-foreground/70">
                      {levelLabel(gap.level, gap.seats)}
                    </td>
                    <td className="p-4 text-foreground/70">
                      {gap.publicationTitle}
                      {gap.publicationCode && (
                        <span className="block text-xs text-muted-foreground mt-0.5">
                          {gap.publicationCode}
                        </span>
                      )}
                    </td>
                    <td className="p-4">
                      <span
                        className={
                          gap.ageDays >= 1 ? 'text-red-700 font-medium' : 'text-foreground/70'
                        }
                      >
                        {gap.ageDays === 0 ? 'today' : `${gap.ageDays}d`}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <Link
                        href={`/admin/copies/provision?s=${gap.subscriberId}&p=${gap.publicationId}`}
                        className="text-xs font-medium text-accent hover:text-accent-hover"
                      >
                        Provision &rarr;
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="mb-12">
        <h3 className="font-serif text-lg text-foreground mb-2">Alerts held</h3>
        <p className="text-xs text-muted-foreground leading-relaxed mb-5 max-w-2xl">
          Subscribers entitled to an edition that was announced before their copy existed.
          Each fires automatically the moment their copy is provisioned — held rather than
          skipped, so nobody simply never hears about an edition.
        </p>

        <div className="border border-border bg-card/30 overflow-x-auto">
          {held.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No alerts waiting.
            </div>
          ) : (
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="border-b border-border bg-black/5 text-foreground/70">
                <tr>
                  <th className="font-medium p-4">Subscriber</th>
                  <th className="font-medium p-4">Publication</th>
                  <th className="font-medium p-4">Held</th>
                  <th className="font-medium p-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {held.map((h) => (
                  <tr
                    key={`${h.subscriberId}:${h.publicationId}`}
                    className="hover:bg-black/5 transition-colors"
                  >
                    <td className="p-4">
                      <span className="font-medium text-foreground">{h.subscriberName}</span>
                      <span className="block text-xs text-muted-foreground mt-0.5">
                        {h.organisation}
                      </span>
                    </td>
                    <td className="p-4 text-foreground/70">
                      {h.publicationTitle}
                      {h.publicationCode && (
                        <span className="block text-xs text-muted-foreground mt-0.5">
                          {h.publicationCode}
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-foreground/70">
                      {h.ageDays === 0 ? 'today' : `${h.ageDays}d`}
                    </td>
                    <td className="p-4 text-right">
                      <Link
                        href={`/admin/copies/provision?s=${h.subscriberId}&p=${h.publicationId}`}
                        className="text-xs font-medium text-accent hover:text-accent-hover"
                      >
                        Provision &rarr;
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section>
        <h3 className="font-serif text-lg text-foreground mb-2">Revoke manually</h3>
        <p className="text-xs text-muted-foreground leading-relaxed mb-5 max-w-2xl">
          Links the API could not withdraw. Each carries someone&rsquo;s name, so a link
          still working after their term has ended is a leak we authored. Withdraw it in
          Papermark, then mark it done here. The access record is kept either way.
        </p>

        <div className="border border-border bg-card/30 overflow-x-auto">
          {manual.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              Nothing to withdraw.
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-black/5 text-foreground/70">
                <tr>
                  <th className="font-medium p-4">Subscriber</th>
                  <th className="font-medium p-4">Publication</th>
                  <th className="font-medium p-4">Link</th>
                  <th className="font-medium p-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {manual.map((m) => (
                  <tr key={m.id} className="hover:bg-black/5 transition-colors align-top">
                    <td className="p-4">
                      <span className="font-medium text-foreground">{m.subscriberName}</span>
                      <span className="block text-xs text-muted-foreground mt-0.5">
                        {m.organisation} · {m.status}
                      </span>
                    </td>
                    <td className="p-4 text-foreground/70">
                      {m.publicationCode ?? m.publicationTitle}
                    </td>
                    <td className="p-4">
                      <code className="text-xs text-muted-foreground break-all">
                        {m.linkUrl}
                      </code>
                    </td>
                    <td className="p-4 text-right">
                      <RevokeActions accessId={m.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </AdminShell>
  )
}
