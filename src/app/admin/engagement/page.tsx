import Link from 'next/link'
import { requireAdmin } from '@/lib/dal'
import AdminShell from '@/components/AdminShell'
import {
  getEngagement,
  getEngagementWindow,
  getEngagementSummary,
  getUnmatchedViews,
  REGULAR_SERIES,
  type EngagementRow,
} from '@/lib/engagement'
import { deliverySummary } from '@/lib/delivery'
import { levelLabelOrDash } from '@/lib/entitlements'
import WindowForm from './window-form'

export const metadata = { title: 'Engagement · APRI' }
export const dynamic = 'force-dynamic'

/**
 * The attention list. Admin-only: gated by requireAdmin, and reachable only
 * from the admin navigation.
 */
export default async function EngagementPage() {
  const admin = await requireAdmin()

  const delivery = deliverySummary()
  const window = await getEngagementWindow()
  const [rows, summary, unmatched] = await Promise.all([
    getEngagement(window),
    getEngagementSummary(),
    getUnmatchedViews(25),
  ])

  const flagged = rows.filter((r) => r.flagged)
  const expiring = rows.filter(
    (r) => r.daysUntilTermEnd !== null && r.daysUntilTermEnd <= 30 && r.daysUntilTermEnd >= 0
  )

  return (
    <AdminShell
      admin={admin}
      current="/admin/engagement"
      title="Engagement"
      description={
        rows.length === 0
          ? 'No active subscribers yet.'
          : `${rows.length} active ${rows.length === 1 ? 'seat' : 'seats'}. ${flagged.length} flagged, ${expiring.length} ending within 30 days.`
      }
    >
      <div className="border border-border bg-card/30 p-6 mb-8">
        <h3 className="text-xs font-medium uppercase tracking-wider text-accent mb-4">
          Document delivery
        </h3>

        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-x-8 gap-y-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
              Watermarking
            </dt>
            <dd className="text-foreground/80">
              {delivery.watermarking === 'on' ? (
                <span className="text-accent">On &mdash; names are stamped</span>
              ) : (
                <span>Off &mdash; no name is stamped</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
              Downloads
            </dt>
            <dd className="text-foreground/80">
              {delivery.downloads === 'disabled' ? 'Disabled — view-only' : 'Enabled'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
              Catch-up poll
            </dt>
            <dd className="text-foreground/80">
              {summary.lastPollAt ? `Ran ${formatDateTime(summary.lastPollAt)}` : 'Not yet run'}
            </dd>
          </div>
        </dl>

        <p className="mt-4 text-xs text-muted-foreground leading-relaxed max-w-2xl">
          Access is issued to a named individual, gated on their email address, and every
          view is logged &mdash; which is what identifies a reader while watermarking is off.
          {delivery.watermarking === 'off' && (
            <>
              {' '}
              To turn watermarking on, set <code>WATERMARKING_ENABLED=&quot;true&quot;</code>{' '}
              and redeploy. All wording across the site and the emails follows that one
              value; nothing here needs editing.
            </>
          )}
        </p>
      </div>

      <div className="border border-border bg-card/30 p-6 mb-8">
        <h3 className="text-xs font-medium uppercase tracking-wider text-accent mb-4">
          Attention threshold
        </h3>
        <WindowForm current={window} />
        <p className="mt-4 text-xs text-muted-foreground leading-relaxed max-w-2xl">
          A seat is flagged when it has opened <strong>none</strong> of the last {window}{' '}
          editions it was entitled to. Only regular series count (
          {REGULAR_SERIES.join(', ')}) &mdash; board papers are ad hoc and excluded. Only
          editions published after the seat&rsquo;s term began are counted, and a seat with
          fewer than {window} such editions is never flagged.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="border border-border bg-card/30 p-12 text-center text-sm text-muted-foreground">
          No active subscribers to report on yet.
        </div>
      ) : (
        <div className="border border-border bg-card/30 overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="border-b border-border bg-black/5 text-foreground/70">
              <tr>
                <th className="font-medium p-4">Subscriber</th>
                <th className="font-medium p-4">Level</th>
                <th className="font-medium p-4">Term ends</th>
                <th className="font-medium p-4">Last opened</th>
                <th className="font-medium p-4 text-right">Opens (90d)</th>
                <th className="font-medium p-4 text-center">Recent editions</th>
                <th className="font-medium p-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <Row key={row.id} row={row} window={window} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="mt-12">
        <h3 className="font-serif text-lg text-foreground mb-2">Unmatched views</h3>
        <p className="text-xs text-muted-foreground leading-relaxed mb-5 max-w-2xl">
          Opens we could not tie to a subscriber. Usually a link issued without its
          Papermark link id recorded on the subscriber&rsquo;s record &mdash; add it and the
          next sighting will attribute itself.{' '}
          {summary.totalViews > 0 && (
            <>
              {summary.unmatchedViews} of {summary.totalViews} stored views are unmatched.
            </>
          )}
        </p>

        <div className="border border-border bg-card/30 overflow-x-auto">
          {unmatched.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Nothing unmatched. Every recorded open is tied to a subscriber.
            </div>
          ) : (
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="border-b border-border bg-black/5 text-foreground/70">
                <tr>
                  <th className="font-medium p-4">Viewed</th>
                  <th className="font-medium p-4">Viewer email</th>
                  <th className="font-medium p-4">Publication</th>
                  <th className="font-medium p-4">Link id</th>
                  <th className="font-medium p-4">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {unmatched.map((v) => (
                  <tr key={v.id} className="hover:bg-black/5 transition-colors">
                    <td className="p-4 text-foreground/70">{formatDateTime(v.viewedAt)}</td>
                    <td className="p-4 text-foreground/70">{v.viewerEmail ?? '—'}</td>
                    <td className="p-4 text-foreground/70">{v.publicationTitle ?? '—'}</td>
                    <td className="p-4">
                      <code className="text-xs text-muted-foreground">
                        {v.papermarkLinkId ?? '—'}
                      </code>
                    </td>
                    <td className="p-4 text-xs text-muted-foreground">{v.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <p className="mt-8 text-xs text-muted-foreground leading-relaxed max-w-2xl">
        Opens are recorded by the Papermark webhook, with a daily catch-up poll behind it.
        {summary.lastPollAt
          ? ` Last poll ran ${formatDateTime(summary.lastPollAt)}.`
          : ' The poll has not run yet — it needs PAPERMARK_API_TOKEN and CRON_SECRET.'}{' '}
        Until Papermark is connected this page will show no opens, and every active seat
        with enough editions behind it will read as flagged.
      </p>
    </AdminShell>
  )
}

function Row({ row, window }: { row: EngagementRow; window: number }) {
  return (
    <tr
      className={`hover:bg-black/5 transition-colors ${row.flagged ? 'bg-red-50/40' : ''}`}
    >
      <td className="p-4">
        <Link
          href={`/admin/subscribers/${row.id}`}
          className="font-medium text-foreground hover:text-accent transition-colors"
        >
          {row.fullName || '—'}
        </Link>
        <span className="block text-xs text-muted-foreground mt-0.5">
          {row.organisation || row.email}
        </span>
      </td>

      <td className="p-4 text-foreground/70">
        {levelLabelOrDash(row.level, row.seats)}
      </td>

      <td className="p-4 text-foreground/70">
        {row.termEnd ? formatDate(row.termEnd) : '—'}
        {row.daysUntilTermEnd !== null && (
          <span
            className={`block text-xs mt-0.5 ${
              row.daysUntilTermEnd <= 30 ? 'text-red-700' : 'text-muted-foreground'
            }`}
          >
            {row.daysUntilTermEnd < 0
              ? `${Math.abs(row.daysUntilTermEnd)} days ago`
              : `in ${row.daysUntilTermEnd} days`}
          </span>
        )}
      </td>

      <td className="p-4 text-foreground/70">
        {row.lastOpenedAt ? formatDate(row.lastOpenedAt) : (
          <span className="text-muted-foreground">Never</span>
        )}
      </td>

      <td className="p-4 text-right tabular-nums text-foreground/70">
        {row.opensLast90Days}
      </td>

      <td className="p-4 text-center tabular-nums text-foreground/70">
        {row.editionsConsidered === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <>
            {row.editionsOpened} / {row.editionsConsidered}
          </>
        )}
      </td>

      <td className="p-4">
        {row.flagged ? (
          <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-red-50 text-red-700 border border-red-200">
            Opened none of last {window}
          </span>
        ) : row.exemptReason === 'too-few-editions' ? (
          <span className="text-xs text-muted-foreground">
            Too few editions to judge
          </span>
        ) : (
          <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-accent/10 text-accent">
            Engaged
          </span>
        )}
      </td>
    </tr>
  )
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
