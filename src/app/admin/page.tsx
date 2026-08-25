import { redirect } from 'next/navigation'
import { getSql } from '@/lib/db'
import { isSetupComplete, requireAdmin } from '@/lib/dal'
import AdminShell from '@/components/AdminShell'
import SecurityFindings from '@/components/SecurityFindings'

export const metadata = { title: 'Overview · APRI' }
export const dynamic = 'force-dynamic'

export default async function AdminDashboardPage() {
  // First run: no owner account yet, so send the visitor to the one-time setup
  // screen instead of a login form they could never satisfy.
  if (!(await isSetupComplete())) redirect('/admin/setup')

  const admin = await requireAdmin()
  const sql = getSql()

  const [counts] = (await sql`
    select
      (select count(*)::int from documents where is_published)      as documents,
      (select count(*)::int from subscribers)                        as subscribers,
      (select count(*)::int from subscribers where status = 'Pending') as pending,
      (select count(*)::int from briefing_requests where status = 'New') as new_briefings
  `) as {
    documents: number
    subscribers: number
    pending: number
    new_briefings: number
  }[]

  const recent = (await sql`
    select id, title, kicker, papermark_link, cta_mode, created_at
    from documents
    order by sort_order asc, created_at desc
    limit 5
  `) as {
    id: string
    title: string
    kicker: string
    papermark_link: string
    cta_mode: string
    created_at: string
  }[]

  const metrics = [
    { label: 'Published Publications', value: counts?.documents ?? 0 },
    { label: 'Subscribers', value: counts?.subscribers ?? 0 },
    { label: 'Pending Access Requests', value: counts?.pending ?? 0 },
    { label: 'New Briefing Requests', value: counts?.new_briefings ?? 0 },
  ]

  return (
    <AdminShell
      admin={admin}
      current="/admin"
      title="Overview"
      description="Metrics and recent activity across the platform."
    >
      <SecurityFindings />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
        {metrics.map((m) => (
          <div key={m.label} className="border border-border p-6 bg-card/30">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-4">
              {m.label}
            </p>
            <p className="text-3xl font-serif text-foreground">{m.value}</p>
          </div>
        ))}
      </div>

      <h3 className="font-serif text-lg text-foreground mb-4">Publications</h3>
      <div className="border border-border bg-card/30">
        {recent.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No publications yet. Run <code className="font-mono">pnpm run db:seed</code> to
            load the four APRI publications, or add one under Publications.
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-black/5 text-foreground/70">
              <tr>
                <th className="font-medium p-4 w-1/2">Title</th>
                <th className="font-medium p-4">Added</th>
                <th className="font-medium p-4 text-right">Secure Link</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {recent.map((doc) => (
                <tr key={doc.id} className="hover:bg-black/5 transition-colors">
                  <td className="p-4">
                    <p className="font-medium text-foreground">{doc.title}</p>
                    {doc.kicker && (
                      <p className="text-xs text-foreground/50 mt-1">{doc.kicker}</p>
                    )}
                  </td>
                  <td className="p-4 text-foreground/70">
                    {new Date(doc.created_at).toLocaleDateString('en-GB')}
                  </td>
                  <td className="p-4 text-right">
                    {doc.cta_mode === 'request' ? (
                      <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-muted text-muted-foreground border border-border">
                        On request
                      </span>
                    ) : doc.papermark_link ? (
                      <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-accent/10 text-accent">
                        Assigned
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-muted text-muted-foreground border border-border">
                        Pending
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AdminShell>
  )
}
