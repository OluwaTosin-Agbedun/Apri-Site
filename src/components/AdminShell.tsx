import Link from 'next/link'
import { logout } from '@/app/actions/auth'
import type { CurrentAdmin } from '@/lib/dal'
import AdminSidebar from './AdminSidebar'

const NAV = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/documents', label: 'Publications' },
  { href: '/admin/subscribers', label: 'Subscribers' },
  { href: '/admin/engagement', label: 'Engagement' },
  { href: '/admin/briefings', label: 'Briefing Requests' },
  { href: '/admin/datarooms', label: 'Data Rooms' },
]

export default function AdminShell({
  admin,
  current,
  title,
  description,
  actions,
  children,
}: {
  admin: CurrentAdmin
  current: string
  title: string
  description?: string
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  const nav = admin.role === 'owner'
    ? [...NAV, { href: '/admin/review-library', label: 'Review Library' }, { href: '/admin/administrators', label: 'Administrators' }]
    : NAV

  return (
    <div className="min-h-screen bg-background flex">
      <AdminSidebar admin={admin} current={current} nav={nav} />

      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="h-14 border-b border-border flex items-center justify-between px-4 sm:px-8 bg-background shrink-0">
          <h1 className="text-sm font-medium text-foreground">Content Management</h1>
          <div className="flex items-center gap-3 text-sm text-foreground/80">
            <span className="text-xs text-muted-foreground uppercase tracking-wider hidden sm:inline">
              {admin.role}
            </span>
            <span className="hidden sm:inline">{admin.name}</span>
            <div className="w-8 h-8 rounded-full bg-border flex items-center justify-center text-xs font-serif text-foreground">
              {admin.name.trim().charAt(0).toUpperCase() || 'A'}
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-4 sm:p-8">
          <div className="max-w-6xl mx-auto">
            <div className="flex justify-between items-start mb-6 gap-4">
              <div>
                <h2 className="font-serif text-xl sm:text-2xl text-foreground mb-1">{title}</h2>
                {description && (
                  <p className="text-sm text-foreground/70">{description}</p>
                )}
              </div>
              {actions}
            </div>
            {children}
          </div>
        </div>
      </main>
    </div>
  )
}
