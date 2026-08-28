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
import { recordClientEvent } from "@/lib/client-engagement"
import {
  getPreviousPortalVisit,
  getSyncedClientDocuments,
  groupBySection,
  type SyncedClientDocument,
} from "@/lib/papermark-client-library"
import { SECTION_LABELS } from "@/lib/papermark-contract"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Your Library · APRI",
  // A subscriber's library must never be indexed or cached by a crawler.
  robots: { index: false, follow: false },
}

const CONTACT = "intelligence@athenacentre.org"

/**
 * The portal shell width.
 *
 * The public site is set to a reading measure, which is right for prose and
 * wrong for a working library: it left a document grid running in a single
 * narrow column with most of the screen empty. The portal gets the browser's
 * width up to 1600px, with gutters of 24px rising to 32px, and the viewer below
 * inherits the same container so a document is read at full width.
 */
const SHELL = "w-full max-w-[1600px] mx-auto px-6 sm:px-8"

export default async function PortalPage() {
  const principal = await requirePortalPrincipal()

  // Read before recording, so "since your last visit" means the visit before
  // this one rather than this one.
  const previousVisit = await getPreviousPortalVisit(principal)
  try {
    await recordClientEvent({ type: principal.type, id: principal.id }, "portal_opened", {
      dedupeMinutes: 30,
    })
  } catch {}

  if (principal.type === "briefing") {
    return <BriefingPortal client={principal} previousVisit={previousVisit} />
  }

  // Lapsed and suspended seats reach here on purpose: the brief requires a
  // locked library that explains itself, not a 404 that looks like a fault.
  if (!principal.hasAccess) {
    return <LockedLibrary name={principal.fullName} />
  }

  const [library, documents] = await Promise.all([
    getLibraryFor(principal),
    getSyncedClientDocuments(principal, { previousVisit }),
  ])
  await touchLastViewed(principal.id)

  const sections = groupBySection(documents)
  const latest = documents.filter((document) => document.isNew)
  const embedUrl = subscriberLibraryEmbedUrl({
    authenticatedSubscriberId: principal.id,
    subscriberId: principal.id,
    status: principal.status,
    termEnd: principal.termEnd,
    libraryLinkUrl: principal.libraryLinkUrl,
    customDomain: process.env.PAPERMARK_CUSTOM_DOMAIN,
  })
  const grouped = groupBySeries(library)
  const total = documents.length + library.length

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <PortalHeader
        name={principal.fullName}
        organisation={principal.organisation}
        tier={principal.publicTier}
        termEnd={principal.termEnd}
      />

      <main className={`flex-1 ${SHELL} py-10 sm:py-14`}>
        <h1 className="font-serif text-2xl sm:text-3xl text-foreground mb-2 leading-tight tracking-tight">
          Your library
        </h1>
        <p className="text-sm text-foreground/60 mb-12">
          {total === 0
            ? "Nothing has been issued to you yet."
            : `${total} ${total === 1 ? "document" : "documents"} issued to you.`}
        </p>

        {/* Latest Updates -- always present, so an empty week says so. */}
        <PortalSection title="Latest updates">
          {latest.length === 0 ? (
            <p className="text-sm text-foreground/60 border border-border bg-card/30 p-6">
              Nothing new since your last visit. Everything issued to you is below.
            </p>
          ) : (
            <DocumentGrid documents={latest} />
          )}
        </PortalSection>

        {(["MIN", "AIU", "OTHER"] as const).map((section) =>
          sections[section].length === 0 ? null : (
            <PortalSection key={section} title={SECTION_LABELS[section]}>
              <DocumentGrid documents={sections[section]} />
            </PortalSection>
          ),
        )}

        {/*
          The fallback for a subscriber whose library is one pasted Papermark
          link rather than a synchronised folder. It renders as the library
          itself, not as a button to go and find it elsewhere.
        */}
        {documents.length === 0 && (
          <PortalSection title="Your private library">
            {embedUrl ? (
              <>
                <PapermarkEmbed src={embedUrl} title="Your private library" />
                <p className="mt-4 text-xs text-muted-foreground leading-relaxed max-w-4xl">
                  This library is unique to you. If the viewer asks you to confirm your
                  email address, that is Papermark&rsquo;s own document-security check;
                  you will not be asked to sign in to APRI again.
                </p>
              </>
            ) : (
              <div className="border border-border bg-card/30 p-8" role="alert">
                <p className="text-sm text-foreground/70 leading-relaxed">
                  Your private library has not been prepared yet. Please contact APRI and
                  we will set it up.
                </p>
              </div>
            )}
          </PortalSection>
        )}

        {/* Entitlement-based editions, kept so nothing already issued is lost. */}
        {library.length > 0 && (
          <PortalSection title="Published editions">
            <div className="space-y-12">
              {grouped.map(([series, items]) => (
                <section key={series}>
                  <h3 className="text-xs font-medium uppercase tracking-wider text-accent mb-5">
                    {seriesLabel(series)}
                  </h3>
                  <ul className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {items.map((item) => (
                      <li key={item.id}>
                        <PublicationRow item={item} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </PortalSection>
        )}

        <div className="mt-8 pt-8 border-t border-border">
          <p className="text-xs text-muted-foreground leading-relaxed max-w-4xl">
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

      <div className={`${SHELL} pb-10`}>
        <SiteFooter />
      </div>
    </div>
  )
}

/**
 * A briefing client's portal.
 *
 * Deliberately shares nothing with the subscriber sections above. A briefing is
 * commissioned separately, so there are no series, no editions and no
 * subscriber categories here -- only the papers written for this client.
 */
async function BriefingPortal({
  client,
  previousVisit,
}: {
  client: Extract<Awaited<ReturnType<typeof requirePortalPrincipal>>, { type: "briefing" }>
  previousVisit: string | null
}) {
  const documents = await getSyncedClientDocuments(client, { previousVisit })

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <PortalHeader
        name={client.fullName}
        organisation={client.organisation}
        tier="Private briefing"
        termEnd={null}
      />
      <main className={`flex-1 ${SHELL} py-10 sm:py-14`}>
        <h1 className="font-serif text-2xl sm:text-3xl text-foreground mb-2">
          Your private briefing
        </h1>
        <p className="text-sm text-foreground/60 mb-12">
          Commissioned for you. Please do not share it.
        </p>

        {!client.hasAccess ? (
          <LockedLibrary name={client.fullName} />
        ) : documents.length > 0 ? (
          <DocumentGrid documents={documents} />
        ) : (
          <div className="border border-border bg-card/30 p-8">
            <p className="text-sm text-foreground/70 leading-relaxed">
              Your briefing is being prepared. We will email you as soon as it is ready.
            </p>
          </div>
        )}
      </main>

      <div className={`${SHELL} pb-10`}>
        <SiteFooter />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function PortalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-14">
      <h2 className="text-xs font-medium uppercase tracking-wider text-accent mb-5">
        {title}
      </h2>
      {children}
    </section>
  )
}

/** Multiple columns on a desktop, one on a phone, no horizontal scrolling. */
function DocumentGrid({ documents }: { documents: SyncedClientDocument[] }) {
  return (
    <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {documents.map((document) => (
        <li key={document.id}>
          <DocumentCard document={document} />
        </li>
      ))}
    </ul>
  )
}

/**
 * One document.
 *
 * The whole card is the link, and it opens inside APRI rather than throwing the
 * subscriber out to another site. The href carries a document id and nothing
 * else -- no share URL, no address, no token -- and the route it points at
 * checks that the document belongs to whoever is signed in before it renders.
 */
function DocumentCard({ document }: { document: SyncedClientDocument }) {
  return (
    <Link
      href={`/portal/document/${encodeURIComponent(document.id)}`}
      className="flex h-full flex-col justify-between border border-border bg-card/30 p-6 hover:border-accent transition-colors group min-h-[9rem]"
    >
      <div>
        <div className="flex items-start justify-between gap-3 mb-3">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            {document.typeLabel}
          </span>
          {document.isNew && (
            <span className="shrink-0 border border-accent/50 text-accent text-[0.65rem] uppercase tracking-wider px-2 py-0.5">
              New
            </span>
          )}
        </div>
        <h3 className="font-serif text-lg text-foreground leading-snug group-hover:text-accent transition-colors">
          {document.title}
        </h3>
      </div>
      <div className="flex items-center justify-between gap-3 mt-5">
        <span className="text-xs text-muted-foreground">
          {document.changedAt ? formatDate(document.changedAt) : ""}
        </span>
        <span className="text-sm font-medium text-accent">
          View <span aria-hidden>&rarr;</span>
        </span>
      </div>
    </Link>
  )
}

// ---------------------------------------------------------------------------

type Item = Awaited<ReturnType<typeof getLibraryFor>>[number]

/** One published edition from the entitlement library. */
function PublicationRow({ item }: { item: Item }) {
  const meta = [formatDate(item.editionDate), item.code].filter(Boolean).join(" · ")

  if (!item.linkUrl) {
    return (
      <div className="block h-full border border-border bg-card/30 p-5 sm:p-6">
        <h3 className="font-serif text-lg text-foreground leading-snug">{item.title}</h3>
        {item.summary && (
          <p className="text-sm text-foreground/60 leading-relaxed mt-2">{item.summary}</p>
        )}
        {meta && <p className="text-xs text-muted-foreground mt-3">{meta}</p>}
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
      className="block h-full border border-border bg-card/30 p-5 sm:p-6 hover:border-accent transition-colors group"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-serif text-lg text-foreground leading-snug group-hover:text-accent transition-colors">
            {item.title}
          </h3>
          {item.summary && (
            <p className="text-sm text-foreground/60 leading-relaxed mt-2">{item.summary}</p>
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

export function PortalHeader({
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
      <div className={`${SHELL} py-5 flex items-start justify-between gap-4`}>
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

function LockedLibrary({ name }: { name: string }) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border">
        <div className="max-w-md mx-auto px-6 h-20 flex items-center justify-between">
          <Link href="/" className="font-serif text-base text-foreground tracking-tight">
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
          {name ? `Thank you, ${name}. ` : ""}Your subscription term has come to an end, so
          your library is closed for now.
        </p>
        <p className="text-sm text-foreground/70 leading-relaxed mb-8">
          We would be glad to continue. Get in touch and we will arrange renewal.
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
