"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import styles from "./SiteHeader.module.css"

type NavItem = {
  label: string
  href: string
}

const NAV_ITEMS: NavItem[] = [
  { label: "Intelligence", href: "/publications" },
  { label: "Board & Advisory Services", href: "/services" },
  { label: "Open Insights", href: "/open-insights" },
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
    `${styles.navLink} ${
      isCurrent(href)
        ? "text-foreground border-b border-accent pb-0.5"
        : "text-foreground/80 hover:text-accent"
    }`

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <div className={styles.row}>
          <Link
            href="/"
            className={styles.brand}
            onClick={() => setIsOpen(false)}
          >
            <span className={styles.wordmark}>
              Athena Strategic Advisory
            </span>
            <span className={styles.descriptor}>
              Political &amp; Regulatory Intelligence
            </span>
          </Link>

          <nav aria-label="Main navigation" className={styles.desktopNav}>
            {NAV_ITEMS.map((item) => (
              <Link key={item.href} href={item.href} aria-current={isCurrent(item.href)?"page":undefined} className={linkClass(item.href)}>
                {item.label}
              </Link>
            ))}
          </nav>
          <div className={styles.actions}>
            {/* /portal preserves the existing verified-device journey. */}
            <Link href="/portal" onClick={() => setIsOpen(false)} className={styles.portal}>
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
              className={styles.menuButton}
            >
              {isOpen ? "Close" : "Menu"}
            </button>
          </div>
        </div>

        {isOpen && (
          <nav id="mobile-navigation" aria-label="Mobile navigation" onKeyDown={dismiss} className={styles.mobileNav}>
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
