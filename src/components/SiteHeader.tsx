"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

type NavItem = {
  label: string
  href: string
}

const NAV_ITEMS: NavItem[] = [
  { label: "Intelligence", href: "/publications" },
  { label: "Board & Advisory Services", href: "/services" },
  { label: "Open Insights", href: "/#open-insights" },
  { label: "Who We Are", href: "/team" },
  { label: "Subscriptions", href: "/access" },
]

export default function SiteHeader() {
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(false)
  const toggle = useRef<HTMLButtonElement>(null)
  function dismiss(event:React.KeyboardEvent) {
    if (event.key === "Escape" && isOpen) {setIsOpen(false);toggle.current?.focus()}
  }

  const isCurrent = (href: string) => {
    if (href === "/publications") return pathname.startsWith("/publications")
    if (href === "/team") return pathname.startsWith("/team")
    return pathname === href
  }

  const linkClass = (href: string) =>
    `text-base font-medium transition-colors ${
      isCurrent(href)
        ? "text-foreground border-b border-accent pb-0.5"
        : "text-foreground/80 hover:text-accent"
    }`

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 py-4 sm:py-5">
          <Link
            href="/"
            className="group flex min-w-0 basis-full flex-col sm:basis-auto"
            onClick={() => setIsOpen(false)}
          >
            <span className="font-serif text-2xl sm:text-3xl text-foreground tracking-tight leading-tight">
              Athena Strategic Advisory
            </span>
            <span className="text-sm sm:text-base text-foreground/75 leading-tight mt-1">
              Political &amp; Regulatory Intelligence
            </span>
          </Link>

          <div className="flex w-full items-center justify-between gap-4 sm:w-auto">
            {/* /portal preserves the existing verified-device journey. */}
            <Link href="/portal" onClick={() => setIsOpen(false)} className="inline-flex min-h-11 items-center justify-center bg-foreground px-5 py-3 text-sm sm:text-base font-medium text-background">
              Client Portal
            </Link>
            <button
              type="button"
              ref={toggle}
              onKeyDown={dismiss}
              onClick={() => setIsOpen((open) => !open)}
              aria-expanded={isOpen}
              aria-controls={isOpen?"mobile-navigation":undefined}
              aria-label={isOpen ? "Close navigation menu" : "Menu"}
              className="xl:hidden min-w-11 min-h-11 text-base font-medium text-foreground cursor-pointer"
            >
              {isOpen ? "Close" : "Menu"}
            </button>
          </div>
          <nav aria-label="Main navigation" className="hidden xl:flex w-full items-center gap-8 border-t border-hairline pt-4">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isCurrent(item.href)?"page":undefined}
                className={linkClass(item.href)}
              >
                {item.label}
              </Link>
            ))}
          </nav>

        </div>

        {isOpen && (
          <nav id="mobile-navigation" aria-label="Mobile navigation" onKeyDown={dismiss} className="xl:hidden pb-5 flex flex-col gap-1 border-t border-border pt-4">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isCurrent(item.href)?"page":undefined}
                onClick={() => setIsOpen(false)}
                className={`${linkClass(item.href)} min-h-11 flex items-center`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </header>
  )
}
