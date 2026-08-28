import Link from 'next/link'
import { logout } from '@/app/actions/auth'
import type { CurrentAdmin } from '@/lib/dal'

const NAV = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/documents', label: 'Publications' },
  { href: '/admin/subscribers', label: 'Subscribers' },
  { href: '/admin/engagement', label: 'Engagement' },
  { href: '/admin/briefings', label: 'Briefing Requests' },
]

/**
 * Chrome for the authenticated CMS. Rendered by each protected page rather than
 * by a shared layout: layouts do not re-render on client-side navigation, so an
 * auth check placed in one would not run again as the admin moves between
 * pages. Each page calls requireAdmin() itself and passes the result here.
 */
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
    ? [...NAV, { href: '/admin/administrators', label: 'Administrators' }]
    : NAV

  return (
    <div className="min-h-screen bg-background flex">
      <aside className="w-64 border-r border-border bg-card/30 flex flex-col shrink-0">
        <div className="p-6 border-b border-border">
          <h2 className="font-serif text-lg text-foreground tracking-tight">APRI</h2>
          <p className="text-xs text-muted-foreground mt-1">Intelligence Platform</p>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {nav.map((item) => {
            const isActive = current === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center px-3 py-2 text-sm font-medium rounded-sm transition-colors ${
                  isActive
                    ? 'bg-foreground text-background'
                    : 'text-foreground/70 hover:bg-black/5 hover:text-foreground'
                }`}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="p-4 border-t border-border">
          <form action={logout}>
            <button
              type="submit"
              className="w-full text-left px-3 py-2 text-sm font-medium text-foreground/70 hover:bg-black/5 rounded-sm transition-colors cursor-pointer"
            >
              Sign Out
            </button>
          </form>
        </div>
      </aside>

      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="h-16 border-b border-border flex items-center justify-between px-8 bg-background shrink-0">
          <h1 className="text-sm font-medium text-foreground">Content Management</h1>
          <div className="flex items-center gap-4 text-sm text-foreground/80">
            <span className="text-xs text-muted-foreground uppercase tracking-wider">
              {admin.role}
            </span>
            <span>{admin.name}</span>
            <div className="w-8 h-8 rounded-full bg-border flex items-center justify-center text-xs font-serif text-foreground">
              {admin.name.trim().charAt(0).toUpperCase() || 'A'}
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-8">
          <div className="max-w-5xl mx-auto">
            <div className="flex justify-between items-start mb-8 gap-6">
              <div>
                <h2 className="font-serif text-2xl text-foreground mb-2">{title}</h2>
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
