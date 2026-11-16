"use client"

/*
 * There is deliberately no Sign in link in this header.
 *
 * Subscribers reach their library through "Access Subscriber Library" on the
 * home page, which goes to /portal. A device that has already been verified
 * lands straight in the library; only a device with no session is asked for an
 * email address. A second Sign in control in the site chrome made that look
 * like a step everyone had to take every time.
 */

import { useRef, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

type NavItem = {
  label: string
  href: string
}

const NAV_ITEMS: NavItem[] = [
  { label: "Publications", href: "/publications" },
  { label: "Services & Briefings", href: "/services" },
  { label: "Our Intelligence Team", href: "/team" },
  { label: "Subscription Access", href: "/access" },
  { label: "Contact", href: "/#contact" },
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
    `text-sm tracking-wide transition-colors ${
      isCurrent(href)
        ? "text-foreground border-b border-accent pb-0.5"
        : "text-foreground/60 hover:text-foreground"
    }`

  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-background/90 backdrop-blur-md">
      <div className="max-w-5xl lg:max-w-6xl mx-auto px-6">
        <div className="flex items-center justify-between h-24">
          <Link
            href="/"
            className="group flex flex-col"
            onClick={() => setIsOpen(false)}
          >
            <span className="font-serif text-lg text-foreground tracking-tight leading-none">
              APRA
            </span>
            <span className="text-[10px] sm:text-xs text-muted-foreground tracking-wide leading-tight mt-0.5">
              Athena Political &amp; Regulatory Advisory
            </span>
          </Link>

          <nav aria-label="Main navigation" className="hidden xl:flex items-center gap-7">
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

          <button
            type="button"
            ref={toggle}
            onKeyDown={dismiss}
            onClick={() => setIsOpen((open) => !open)}
            aria-expanded={isOpen}
            aria-controls={isOpen?"mobile-navigation":undefined}
            aria-label={isOpen ? "Close navigation menu" : "Menu"}
            className="xl:hidden min-w-11 min-h-11 text-sm text-foreground/70 hover:text-foreground transition-colors cursor-pointer"
          >
            {isOpen ? "Close" : "Menu"}
          </button>
        </div>

        {isOpen && (
          <nav id="mobile-navigation" aria-label="Mobile navigation" onKeyDown={dismiss} className="xl:hidden pb-6 flex flex-col gap-2 border-t border-border pt-6">
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
