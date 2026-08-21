import { requireAdmin } from '@/lib/dal'
import { getSql } from '@/lib/db'
import AdminShell from '@/components/AdminShell'

export const metadata = { title: 'Briefing Requests · APRI' }
export const dynamic = 'force-dynamic'

type Row = {
  id: string
  name: string
  organization: string
  role_title: string
  email: string
  phone: string
  briefing_type: string
  format: string
  timeline: string
  sector: string
  description: string
  audience_size: string
  location: string
  status: string
  created_at: string
}

export default async function AdminBriefingsPage() {
  const admin = await requireAdmin()
  const sql = getSql()

  const requests = (await sql`
    select id, name, organization, role_title, email, phone, briefing_type,
           format, timeline, sector, description, audience_size, location,
           status, created_at
    from briefing_requests
    order by created_at desc
    limit 500
  `) as Row[]

  return (
    <AdminShell
      admin={admin}
      current="/admin/briefings"
      title="Briefing Requests"
      description="Private briefing enquiries from the Services & Briefings page."
    >
      {requests.length === 0 ? (
        <div className="border border-border bg-card/30 p-12 text-center text-sm text-muted-foreground">
          No briefing requests yet.
        </div>
      ) : (
        <div className="space-y-4">
          {requests.map((r) => (
            <article key={r.id} className="border border-border bg-card/30 p-6">
              <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
                <div>
                  <p className="font-medium text-foreground">
                    {r.name}
                    {r.role_title && (
                      <span className="text-foreground/60 font-normal"> · {r.role_title}</span>
                    )}
                  </p>
                  <p className="text-sm text-foreground/70 mt-0.5">{r.organization}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                      r.status === 'New'
                        ? 'bg-accent/10 text-accent'
                        : 'bg-muted text-muted-foreground border border-border'
                    }`}
                  >
                    {r.status}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleDateString('en-GB')}
                  </span>
                </div>
              </div>

              {r.briefing_type && (
                <p className="text-sm text-foreground mb-4">{r.briefing_type}</p>
              )}

              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 text-xs mb-5">
                {[
                  ['Email', r.email],
                  ['Phone', r.phone],
                  ['Format', r.format],
                  ['Timeline', r.timeline],
                  ['Sector', r.sector],
                  ['Audience', r.audience_size],
                  ['Location', r.location],
                ].map(([k, v]) =>
                  v ? (
                    <div key={k}>
                      <dt className="uppercase tracking-wider text-muted-foreground mb-1">
                        {k}
                      </dt>
                      <dd className="text-foreground/80 break-words">{v}</dd>
                    </div>
                  ) : null
                )}
              </dl>

              {r.description && (
                <p className="text-sm text-foreground/70 leading-relaxed pt-4 border-t border-border/60 whitespace-pre-wrap">
                  {r.description}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </AdminShell>
  )
}
