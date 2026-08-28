"use client"

import { useState } from "react"
import Link from "next/link"
import { logout } from "@/app/actions/auth"
import type { CurrentAdmin } from "@/lib/dal"

export default function AdminSidebar({
  admin,
  current,
  nav,
}: {
  admin: CurrentAdmin
  current: string
  nav: { href: string; label: string }[]
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Mobile toggle */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed top-3 left-3 z-50 lg:hidden w-10 h-10 flex items-center justify-center rounded border border-border bg-background text-foreground"
        aria-label="Open menu"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 5h14M3 10h14M3 15h14" />
        </svg>
      </button>

      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/30 z-40 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 border-r border-border bg-card/95 backdrop-blur flex flex-col shrink-0 transition-transform duration-200 lg:relative lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="p-5 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="font-serif text-lg text-foreground tracking-tight">APRI</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Intelligence Platform</p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="lg:hidden w-8 h-8 flex items-center justify-center rounded text-foreground/60 hover:text-foreground"
            aria-label="Close menu"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {nav.map((item) => {
            const isActive = current === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`flex items-center px-3 py-2 text-sm font-medium rounded-sm transition-colors ${
                  isActive
                    ? "bg-foreground text-background"
                    : "text-foreground/70 hover:bg-black/5 hover:text-foreground"
                }`}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="p-3 border-t border-border">
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
    </>
  )
}
