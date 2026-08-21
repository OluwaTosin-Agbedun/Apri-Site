import React, { useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router';

type NavItem = { label: string; to: string };

/**
 * Site navigation, in the order given by the publication brief. Publications,
 * Subscription Access and Contact are sections of the home page; Services &
 * Briefings is a separate page, because the brief asks for it to sit apart from
 * the written publications.
 */
const NAV_ITEMS: NavItem[] = [
  { label: 'Home', to: '/' },
  { label: 'Publications', to: '/#publications' },
  { label: 'Services & Briefings', to: '/services' },
  { label: 'Subscription Access', to: '/#access' },
  { label: 'Contact', to: '/#contact' }
];

export default function SiteHeader() {
  const { pathname, hash } = useLocation();
  const [isOpen, setIsOpen] = useState(false);

  const isCurrent = (to: string) => {
    const [path, target] = to.split('#');
    const normalisedPath = path || '/';
    if (normalisedPath !== pathname) return false;
    if (target) return hash === `#${target}`;
    return !hash;
  };

  const linkClass = (to: string) =>
    `text-sm tracking-wide transition-colors ${
      isCurrent(to)
        ? 'text-foreground border-b border-accent pb-0.5'
        : 'text-foreground/60 hover:text-foreground'
    }`;

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-sm">
      <div className="max-w-5xl lg:max-w-6xl mx-auto px-6">
        <div className="flex items-center justify-between h-20">
          <Link to="/" className="group" onClick={() => setIsOpen(false)}>
            <span className="font-serif text-base text-foreground tracking-tight">APRI</span>
            <span className="hidden sm:inline text-xs text-muted-foreground ml-3 pl-3 border-l border-border">
              Athena Political &amp; Regulatory Intelligence
            </span>
          </Link>

          <nav className="hidden lg:flex items-center gap-8">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} className={linkClass(item.to)}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <button
            type="button"
            onClick={() => setIsOpen((open) => !open)}
            aria-expanded={isOpen}
            aria-label="Toggle navigation"
            className="lg:hidden text-sm text-foreground/70 hover:text-foreground transition-colors cursor-pointer"
          >
            {isOpen ? 'Close' : 'Menu'}
          </button>
        </div>

        {isOpen && (
          <nav className="lg:hidden pb-6 flex flex-col gap-4 border-t border-border pt-6">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setIsOpen(false)}
                className={linkClass(item.to)}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        )}
      </div>
    </header>
  );
}
