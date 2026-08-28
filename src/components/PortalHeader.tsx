import Link from 'next/link'
import { subscriberSignOut } from '@/app/actions/subscriber-auth'

/**
 * The portal's own header.
 *
 * Its own file rather than an export from the portal page: a Next 16 page
 * module may export only the framework's own names, so sharing a component out
 * of one is a build error.
 *
 * The shell width is passed in so the header lines up with the content beneath
 * it, whichever portal page is rendering.
 */
export default function PortalHeader({
  name,
  organisation,
  tier,
  termEnd,
  shell,
}: {
  name: string
  organisation: string
  tier: string
  termEnd: string | null
  shell: string
}) {
  const line = [organisation, tier].filter(Boolean).join(' · ')

  return (
    <header className="border-b border-border">
      <div className={`${shell} py-5 flex items-start justify-between gap-4`}>
        <div className="min-w-0">
          <Link href="/" className="font-serif text-base text-foreground tracking-tight">
            APRI
          </Link>
          <p className="text-xs text-muted-foreground mt-1 truncate">
            {name}
            {line && <span className="hidden sm:inline"> &middot; {line}</span>}
          </p>
          {termEnd && (
            <p className="text-xs text-muted-foreground/70 mt-0.5">
              Access until {formatDate(termEnd)}
            </p>
          )}
        </div>

        <form action={subscriberSignOut}>
          <button
            type="submit"
            className="text-xs text-foreground/50 hover:text-foreground transition-colors cursor-pointer shrink-0 py-2"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  )
}

function formatDate(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}
