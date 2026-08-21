import { requireOwner } from '@/lib/dal'
import { getSql } from '@/lib/db'
import AdminShell from '@/components/AdminShell'
import InviteForm from './invite-form'

export const metadata = { title: 'Administrators · APRI' }
export const dynamic = 'force-dynamic'

type Row = {
  id: string
  name: string
  email: string
  role: string
  is_active: boolean
  created_at: string
  last_login_at: string | null
}

export default async function AdministratorsPage() {
  // Owners only. requireOwner redirects an editor back to the dashboard.
  const admin = await requireOwner()
  const sql = getSql()

  const admins = (await sql`
    select id, name, email, role, is_active, created_at, last_login_at
    from admins
    order by created_at asc
  `) as Row[]

  return (
    <AdminShell
      admin={admin}
      current="/admin/administrators"
      title="Administrators"
      description="Individual accounts, so you can see who changed what and revoke one person."
    >
      <InviteForm />

      <div className="border border-border bg-card/30 overflow-x-auto">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="border-b border-border bg-black/5 text-foreground/70">
            <tr>
              <th className="font-medium p-4">Name</th>
              <th className="font-medium p-4">Email</th>
              <th className="font-medium p-4">Role</th>
              <th className="font-medium p-4">Status</th>
              <th className="font-medium p-4 text-right">Last Sign-in</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {admins.map((row) => (
              <tr key={row.id} className="hover:bg-black/5 transition-colors">
                <td className="p-4 font-medium text-foreground">
                  {row.name}
                  {row.id === admin.id && (
                    <span className="text-xs text-muted-foreground font-normal"> (you)</span>
                  )}
                </td>
                <td className="p-4 text-foreground/70">{row.email}</td>
                <td className="p-4 text-foreground/70 uppercase text-xs tracking-wider">
                  {row.role}
                </td>
                <td className="p-4">
                  <span
                    className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                      row.is_active
                        ? 'bg-accent/10 text-accent'
                        : 'bg-muted text-muted-foreground border border-border'
                    }`}
                  >
                    {row.is_active ? 'Active' : 'Deactivated'}
                  </span>
                </td>
                <td className="p-4 text-right text-foreground/70">
                  {row.last_login_at
                    ? new Date(row.last_login_at).toLocaleDateString('en-GB')
                    : 'Never'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  )
}
