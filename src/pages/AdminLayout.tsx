import React from 'react';
import { NavLink, Outlet } from 'react-router';

const ADMIN_NAV = [
  { label: 'Dashboard', to: '/admin', end: true },
  { label: 'Documents', to: '/admin/documents' },
  { label: 'Subscribers', to: '/admin/subscribers' },
  { label: 'Briefing Requests', to: '/admin/briefings' }
];

export default function AdminLayout() {
  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar Navigation */}
      <aside className="w-64 border-r border-border bg-card/30 flex flex-col">
        <div className="p-6 border-b border-border">
          <h2 className="font-serif text-lg text-foreground tracking-tight">APRI</h2>
          <p className="text-xs text-muted-foreground mt-1">Intelligence Platform</p>
        </div>
        
        <nav className="flex-1 p-4 space-y-1">
          {ADMIN_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center px-3 py-2 text-sm font-medium rounded-sm transition-colors ${
                  isActive
                    ? 'bg-foreground text-background'
                    : 'text-foreground/70 hover:bg-black/5 hover:text-foreground'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        
        <div className="p-4 border-t border-border">
          <button className="w-full flex items-center px-3 py-2 text-sm font-medium text-foreground/70 hover:bg-black/5 rounded-sm transition-colors cursor-pointer">
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="h-16 border-b border-border flex items-center justify-between px-8 bg-background">
          <div className="flex items-center gap-4">
            <h1 className="text-sm font-medium text-foreground">Content Management</h1>
          </div>
          <div className="flex items-center gap-4 text-sm text-foreground/80">
            <span>Admin User</span>
            <div className="w-8 h-8 rounded-full bg-border flex items-center justify-center text-xs font-serif text-foreground">
              A
            </div>
          </div>
        </header>
        <div className="flex-1 overflow-auto p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
