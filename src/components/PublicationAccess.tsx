import Link from 'next/link'
import { accessBadge, tierNameForVisibility, type Level, type Visibility } from '@/lib/entitlements'

/**
 * The public-facing access gate for one publication.
 *
 * The single place a public page decides what a visitor may click. Nothing here
 * ever renders `papermark_link`: that column holds the subscriber-library
 * address, and putting it in public HTML would hand a paid document to anyone
 * who viewed source. Only `open_link_url` -- the email-gated link an
 * administrator sets for a genuinely OPEN piece -- is ever emitted.
 */

export function AccessBadge({ visibility }: { visibility: Visibility }) {
  const isOpen = visibility === 'OPEN'

  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 text-xs font-medium tracking-wide ${
        isOpen
          ? 'bg-accent/10 text-accent'
          : 'bg-muted text-muted-foreground border border-border'
      }`}
    >
      {accessBadge(visibility)}
    </span>
  )
}

export function AccessAction({
  visibility,
  openLinkUrl,
  className,
}: {
  visibility: Visibility
  openLinkUrl: string | null
  className?: string
}) {
  const base =
    className ??
    'inline-flex items-center bg-foreground text-background px-8 py-3.5 text-sm font-medium tracking-wide hover:bg-foreground/90 transition-colors'

  if (visibility === 'OPEN' && openLinkUrl?.startsWith('https://')) {
    return (
      <a href={openLinkUrl} target="_blank" rel="noreferrer" className={base}>
        Access Review Copy
      </a>
    )
  }

  if (visibility === 'OPEN') {
    return (
      <Link href="/access" className={base}>
        Access Review Copy
      </Link>
    )
  }

  // Subscriber-only: always link to the access page with the minimum level
  // preselected. The public card never links to the portal -- a visitor who
  // is not yet a subscriber needs to request access, not see a sign-in wall.
  const level = encodeURIComponent(tierNameForVisibility(visibility as Level))
  return (
    <Link href={`/access?level=${level}#subscribe`} className={base}>
      Request Access &rarr;
    </Link>
  )
}

/** Quieter inline variant for list rows. */
export function AccessActionInline({
  visibility,
  openLinkUrl,
}: {
  visibility: Visibility
  openLinkUrl: string | null
}) {
  return (
    <AccessAction
      visibility={visibility}
      openLinkUrl={openLinkUrl}
      className="inline-flex items-center text-sm font-medium text-accent hover:text-accent-hover transition-colors"
    />
  )
}
