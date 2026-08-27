import Link from "next/link"
import {
  requirePortalPrincipal,
  getLibraryFor,
  touchLastViewed,
} from "@/lib/subscriber-dal"
import { seriesLabel } from "@/lib/entitlements"
import { portalNotice, BRIEFINGS_SEPARATE_NOTICE } from "@/lib/delivery"
import { subscriberSignOut } from "@/app/actions/subscriber-auth"
import SiteFooter from "@/components/SiteFooter"
import PapermarkEmbed from "@/components/PapermarkEmbed"
import { subscriberLibraryEmbedUrl } from "@/lib/papermark-embed"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Your Library · APRI",
  // A subscriber's library must never be indexed or cached by a crawler.
  robots: { index: false, follow: false },
}

const CONTACT = "intelligence@athenacentre.org"

export default async function PortalPage() {
  const subscriber = await requirePortalPrincipal()

  if (subscriber.type === "briefing") {
    return <BriefingPortal client={subscriber} />
  }

  // Lapsed and suspended seats reach here on purpose: the brief requires a
  // locked library that explains itself, not a 404 that looks like a fault.
  if (!subscriber.hasAccess) {
    return <LockedLibrary name={subscriber.fullName} />
  }

  const library = await getLibraryFor(subscriber)
  await touchLastViewed(subscriber.id)

  const grouped = groupBySeries(library)
  const embedUrl = subscriberLibraryEmbedUrl({
    authenticatedSubscriberId: subscriber.id,
    subscriberId: subscriber.id,
    status: subscriber.status,
    termEnd: subscriber.termEnd,
    libraryLinkUrl: subscriber.libraryLinkUrl,
    customDomain: process.env.PAPERMARK_CUSTOM_DOMAIN,
  })

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <PortalHeader
        name={subscriber.fullName}
        organisation={subscriber.organisation}
        tier={subscriber.publicTier}
        termEnd={subscriber.termEnd}
      />

      <main className="flex-1 max-w-3xl w-full mx-auto px-5 sm:px-6 py-10 sm:py-14">
        <h1 className="font-serif text-2xl sm:text-3xl text-foreground mb-2 leading-tight tracking-tight">
          Your library
        </h1>
        <p className="text-sm text-foreground/60 mb-10">
          {library.length === 0
            ? "No editions published yet."
            : `${library.length} ${
                library.length === 1 ? "edition" : "editions"
              } available.`}
        </p>

        {embedUrl ? (
          <section className="mb-10" aria-labelledby="private-library-heading">
            <h2 id="private-library-heading" className="sr-only">
              Private Papermark library
            </h2>
            <PapermarkEmbed src={embedUrl} />
            <p className="mt-3 text-xs text-muted-foreground">
              This library is unique to you. Downloads are controlled by its Papermark settings.
            </p>
          </section>
        ) : (
          <div className="border border-border bg-card/30 p-8 mb-10" role="alert">
            <p className="text-sm text-foreground/70">
              Your private library is not available. Please contact APRI so we can verify its secure Papermark link.
            </p>
          </div>
        )}

        {library.length === 0 ? (
          <div className="border border-border bg-card/30 p-8">
            <p className="text-sm text-foreground/70 leading-relaxed">
              Your subscription is active. New editions will appear here as they
              are published, and we will email you each time one is issued.
            </p>
          </div>
        ) : (
          <div className="space-y-12">
            {grouped.map(([series, items]) => (
              <section key={series}>
                <h2 className="text-xs font-medium uppercase tracking-wider text-accent mb-5">
                  {seriesLabel(series)}
                </h2>
                <ul className="space-y-3">
                  {items.map((item) => (
                    <li key={item.id}>
                      <PublicationRow item={item} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        <div className="mt-16 pt-8 border-t border-border">
          <p className="text-xs text-muted-foreground leading-relaxed">
            {BRIEFINGS_SEPARATE_NOTICE} {portalNotice()} Questions:{" "}
            <a
              href={`mailto:${CONTACT}`}
              className="text-accent hover:text-accent-hover transition-colors"
            >
              {CONTACT}
            </a>
            .
          </p>
        </div>
      </main>

      <div className="max-w-3xl w-full mx-auto px-5 sm:px-6 pb-10">
        <SiteFooter />
      </div>
    </div>
  )
}

function BriefingPortal({
  client,
}: {
  client: Extract<Awaited<ReturnType<typeof requirePortalPrincipal>>, {
    type: "briefing"
  }>
}) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <PortalHeader
        name={client.fullName}
        organisation={client.organisation}
        tier="Private briefing"
        termEnd={null}
      />
      <main className="flex-1 max-w-3xl w-full mx-auto px-5 sm:px-6 py-10 sm:py-14">
        <h1 className="font-serif text-2xl sm:text-3xl text-foreground mb-3">
          Your private briefing
        </h1>
        <p className="text-sm text-foreground/60 mb-8">
          This link is unique to you. Please do not share it.
        </p>
        {client.hasAccess ? (
          <a
            href={client.privateLinkUrl}
            target="_blank"
            rel="noreferrer"
            className="block border border-border bg-card/30 p-6 hover:border-accent transition-colors"
          >
            <span className="font-serif text-lg">Open your briefing</span>
            <span className="float-right text-accent" aria-hidden>
              &rarr;
            </span>
          </a>
        ) : (
          <LockedLibrary name={client.fullName} />
        )}
      </main>
    </div>
  )
}

// ---------------------------------------------------------------------------

type Item = Awaited<ReturnType<typeof getLibraryFor>>[number]

/**
 * One publication. The whole row is the tap target on a phone, and it opens the
 * document directly in a new tab -- no interstitial, per the brief.
 */
function PublicationRow({ item }: { item: Item }) {
  const meta = [formatDate(item.editionDate), item.code]
    .filter(Boolean)
    .join(" · ")

  if (!item.linkUrl) {
    return (
      <div className="block border border-border bg-card/30 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="font-serif text-lg text-foreground leading-snug">
              {item.title}
            </h3>
            {item.summary && (
              <p className="text-sm text-foreground/60 leading-relaxed mt-2">
                {item.summary}
              </p>
            )}
            {meta && (
              <p className="text-xs text-muted-foreground mt-3">{meta}</p>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-4 pt-4 border-t border-border">
          Access being prepared — we will email you when it is ready.
        </p>
      </div>
    )
  }

  return (
    <a
      href={item.linkUrl}
      target="_blank"
      rel="noreferrer"
      className="block border border-border bg-card/30 p-5 sm:p-6 hover:border-accent transition-colors group"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-serif text-lg text-foreground leading-snug group-hover:text-accent transition-colors">
            {item.title}
          </h3>
          {item.summary && (
            <p className="text-sm text-foreground/60 leading-relaxed mt-2">
              {item.summary}
            </p>
          )}
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-3">
            {meta && <span>{meta}</span>}
            {item.pageCount && (
              <>
                {meta && <span className="text-border">|</span>}
                <span>{item.pageCount} pages</span>
              </>
            )}
          </div>
        </div>
        <span
          aria-hidden
          className="shrink-0 text-accent text-lg mt-1 group-hover:translate-x-0.5 transition-transform"
        >
          &rarr;
        </span>
      </div>
    </a>
  )
}

function PortalHeader({
  name,
  organisation,
  tier,
  termEnd,
}: {
  name: string
  organisation: string
  tier: string
  termEnd: string | null
}) {
  const line = [organisation, tier].filter(Boolean).join(" · ")

  return (
    <header className="border-b border-border">
      <div className="max-w-3xl mx-auto px-5 sm:px-6 py-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href="/"
            className="font-serif text-base text-foreground tracking-tight"
          >
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

function LockedLibrary({ name }: { name: string }) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border">
        <div className="max-w-md mx-auto px-6 h-20 flex items-center justify-between">
          <Link
            href="/"
            className="font-serif text-base text-foreground tracking-tight"
          >
            APRI
          </Link>
          <form action={subscriberSignOut}>
            <button
              type="submit"
              className="text-xs text-foreground/50 hover:text-foreground transition-colors cursor-pointer py-2"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="flex-1 max-w-md w-full mx-auto px-6 py-16">
        <h1 className="font-serif text-2xl sm:text-3xl text-foreground mb-4 leading-tight tracking-tight">
          Your access has ended
        </h1>
        <p className="text-sm text-foreground/70 leading-relaxed mb-4">
          {name ? `Thank you, ${name}. ` : ""}Your subscription term has come to
          an end, so your library is closed for now.
        </p>
        <p className="text-sm text-foreground/70 leading-relaxed mb-8">
          We would be glad to continue. Get in touch and we will arrange
          renewal.
        </p>

        <a
          href={`mailto:${CONTACT}?subject=APRI%20renewal`}
          className="inline-flex items-center bg-foreground text-background px-8 py-4 text-base font-medium tracking-wide hover:bg-foreground/90 transition-colors"
        >
          Contact us about renewal
        </a>
      </main>

      <div className="max-w-md w-full mx-auto px-6 pb-10">
        <SiteFooter />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

/** Groups items by series, preserving the newest-first order within each. */
function groupBySeries(items: Item[]): [string, Item[]][] {
  const map = new Map<string, Item[]>()
  for (const item of items) {
    const key = item.series || "Other"
    const list = map.get(key)
    if (list) list.push(item)
    else map.set(key, [item])
  }
  return [...map.entries()]
}

function formatDate(value: string | null): string {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}
