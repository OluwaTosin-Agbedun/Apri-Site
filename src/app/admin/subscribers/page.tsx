import { requireAdmin } from '@/lib/dal'
import { getSql } from '@/lib/db'
import AdminShell from '@/components/AdminShell'

export const metadata = { title: 'Subscribers · APRI' }
export const dynamic = 'force-dynamic'

type Row = {
  id: string
  name: string
  organization: string
  email: string
  status: string
  created_at: string
}

export default async function AdminSubscribersPage() {
  const admin = await requireAdmin()
  const sql = getSql()

  const subscribers = (await sql`
    select id, name, organization, email, status, created_at
    from subscribers
    order by created_at desc
    limit 500
  `) as Row[]

  return (
    <AdminShell
      admin={admin}
      current="/admin/subscribers"
      title="Subscribers"
      description="Access requests to the intelligence library."
    >
      <div className="border border-border bg-card/30 overflow-x-auto">
        {subscribers.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            No access requests yet.
          </div>
        ) : (
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="border-b border-border bg-black/5 text-foreground/70">
              <tr>
                <th className="font-medium p-4">Name</th>
                <th className="font-medium p-4">Organisation</th>
                <th className="font-medium p-4">Email</th>
                <th className="font-medium p-4">Status</th>
                <th className="font-medium p-4 text-right">Date Requested</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {subscribers.map((sub) => (
                <tr key={sub.id} className="hover:bg-black/5 transition-colors">
                  <td className="p-4 font-medium text-foreground">{sub.name || '—'}</td>
                  <td className="p-4 text-foreground/70">{sub.organization || '—'}</td>
                  <td className="p-4 text-foreground/70">{sub.email}</td>
                  <td className="p-4">
                    <span
                      className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                        sub.status === 'Active'
                          ? 'bg-accent/10 text-accent'
                          : 'bg-muted text-muted-foreground border border-border'
                      }`}
                    >
                      {sub.status}
                    </span>
                  </td>
                  <td className="p-4 text-right text-foreground/70">
                    {new Date(sub.created_at).toLocaleDateString('en-GB')}
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
