import Link from "next/link"
import {
  requirePortalPrincipal,
  getLibraryFor,
  touchLastViewed,
  type CurrentSubscriber,
} from "@/lib/subscriber-dal"
import { seriesLabel, tierDisplayName } from "@/lib/entitlements"
import { subscriberSignOut } from "@/app/actions/subscriber-auth"
import SiteFooter from "@/components/SiteFooter"
import PortalHeader from "@/components/PortalHeader"
import PapermarkEmbed from "@/components/PapermarkEmbed"
import { subscriberLibraryEmbedUrl } from "@/lib/papermark-embed"
import { recordClientEvent } from "@/lib/client-engagement"
import {
  getPreviousPortalVisit,
  getSyncedClientDocuments,
  getDataRoomDocumentsForSubscriber,
  groupDataRoomByCategory,
  type DataRoomDocument,
  type SyncedClientDocument,
} from "@/lib/papermark-client-library"
import { SECTION_LABELS, LIBRARY_SECTIONS } from "@/lib/papermark-contract"
import {
  PORTAL_CATEGORIES,
  portalCategoryLabel,
  type PortalCategoryKey,
} from "@/lib/papermark-dataroom-contract"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Your Library · APRI",
  robots: { index: false, follow: false },
}

const CONTACT = "intelligence@athenacentre.org"

const SHELL = "w-full max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 xl:px-12"

export default async function PortalPage() {
  const principal = await requirePortalPrincipal()

  const previousVisit = await getPreviousPortalVisit(principal)
  try {
    await recordClientEvent({ type: "subscriber", id: principal.id }, "portal_opened", {
      dedupeMinutes: 30,
    })
  } catch {}

  if (!principal.hasAccess) {
    return <LockedLibrary name={principal.fullName} />
  }

  const drContext = await getDataRoomDocumentsForSubscriber(principal.id, { previousVisit })

  if (drContext) {
    return (
      <DataRoomPortal
        principal={principal}
        documents={drContext.documents}
        linkUrl={drContext.linkUrl}
        allowDownload={drContext.allowDownload}
        previousVisit={previousVisit}
      />
    )
  }

  return <LegacyPortal principal={principal} previousVisit={previousVisit} />
}

// ---------------------------------------------------------------------------
// Data Room portal — the new pipeline
// ---------------------------------------------------------------------------

async function DataRoomPortal({
  principal,
  documents,
  linkUrl,
  allowDownload,
  previousVisit,
}: {
  principal: CurrentSubscriber
  documents: DataRoomDocument[]
  linkUrl: string
  allowDownload: boolean
  previousVisit: string | null
}) {
  await touchLastViewed(principal.id)

  const categories = groupDataRoomByCategory(documents)
  const latest = documents.filter((d) => d.badge === "new" || d.badge === "updated")
  const latestToShow = latest.length > 0 ? latest : documents.slice(0, 6)
  const total = documents.length

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <PortalHeader
        shell={SHELL}
        name={principal.fullName}
        organisation={principal.organisation}
        tier={tierDisplayName(principal.publicTier)}
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

        <PortalSection title="Latest Publications">
          {latestToShow.length === 0 ? (
            <p className="text-sm text-foreground/60 border border-border bg-card/30 p-6">
              No documents have been added to your library yet.
            </p>
          ) : (
            <DataRoomGrid documents={latestToShow} />
          )}
        </PortalSection>

        {PORTAL_CATEGORIES.filter(({ key }) => key !== "OTHER").map(({ key }) =>
          categories[key as PortalCategoryKey].length === 0 ? null : (
            <PortalSection key={key} title={portalCategoryLabel(key as PortalCategoryKey)}>
              <DataRoomGrid documents={categories[key as PortalCategoryKey]} />
            </PortalSection>
          ),
        )}

        {categories.OTHER.length > 0 && (
          <PortalSection title={portalCategoryLabel("OTHER")}>
            <DataRoomGrid documents={categories.OTHER} />
          </PortalSection>
        )}

        <PortalFooter />
      </main>

      <div className={`${SHELL} pb-10`}>
        <SiteFooter />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Legacy portal — for subscribers not yet migrated to Data Rooms
// ---------------------------------------------------------------------------

async function LegacyPortal({
  principal,
  previousVisit,
}: {
  principal: CurrentSubscriber
  previousVisit: string | null
}) {
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
        shell={SHELL}
        name={principal.fullName}
        organisation={principal.organisation}
        tier={tierDisplayName(principal.publicTier)}
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

        {latest.length > 0 && (
          <PortalSection title="Latest updates">
            <LegacyDocumentGrid documents={latest} />
          </PortalSection>
        )}

        {LIBRARY_SECTIONS.map((section) =>
          sections[section].length === 0 ? null : (
            <PortalSection key={section} title={SECTION_LABELS[section]}>
              <LegacyDocumentGrid documents={sections[section]} />
            </PortalSection>
          ),
        )}

        {documents.length === 0 && embedUrl && (
          <PortalSection title="Your private library">
            <PapermarkEmbed src={embedUrl} title="Your private library" />
          </PortalSection>
        )}

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

        <PortalFooter />
      </main>

      <div className={`${SHELL} pb-10`}>
        <SiteFooter />
      </div>
    </div>
  )
}

function groupBySection(
  documents: SyncedClientDocument[],
): Record<string, SyncedClientDocument[]> {
  const grouped: Record<string, SyncedClientDocument[]> = {
    PLM: [], AEO: [], AIU: [], MIN: [], QIB: [], OTHER: [],
  }
  for (const doc of documents) grouped[doc.section]?.push(doc)
  return grouped
}

// ---------------------------------------------------------------------------
// Shared components
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

function PortalFooter() {
  return (
    <div className="mt-8 pt-8 border-t border-border">
      <p className="text-xs text-muted-foreground leading-relaxed max-w-4xl">
        Your access is personal to you and every view is logged. APRI intelligence
        is issued for the exclusive use of authorised readers and may not be
        redistributed.
        Questions:{" "}
        <a
          href={`mailto:${CONTACT}`}
          className="text-accent hover:text-accent-hover transition-colors"
        >
          {CONTACT}
        </a>
        .
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Data Room document cards (new pipeline)
// ---------------------------------------------------------------------------

function DataRoomGrid({ documents }: { documents: DataRoomDocument[] }) {
  return (
    <ul className="grid grid-cols-1 gap-4">
      {documents.map((doc) => (
        <li key={doc.id}>
          <DataRoomCard document={doc} />
        </li>
      ))}
    </ul>
  )
}

function DataRoomCard({ document }: { document: DataRoomDocument }) {
  const date = document.papermarkUpdatedAt || document.papermarkCreatedAt
  return (
    <div className="w-full max-w-none border border-border bg-card/30 p-5 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-3 mb-2">
            <span className="text-xs uppercase tracking-wider text-muted-foreground truncate">
              {document.categoryLabel}
            </span>
            {document.badge && (
              <span className={`shrink-0 border text-[0.65rem] uppercase tracking-wider px-2 py-0.5 ${
                document.badge === "new"
                  ? "border-accent/50 text-accent"
                  : "border-foreground/30 text-foreground/60"
              }`}>
                {document.badge === "new" ? "New" : "Updated"}
              </span>
            )}
          </div>
          <h3 className="font-serif text-lg text-foreground leading-snug break-words">
            {document.title}
          </h3>
          <div className="flex items-center gap-3 mt-2">
            {document.numPages && (
              <span className="text-xs text-muted-foreground">
                {document.numPages} {document.numPages === 1 ? "page" : "pages"}
              </span>
            )}
            {date && (
              <span className="text-xs text-muted-foreground">
                {formatDate(date)}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-3 shrink-0 mt-4 sm:mt-0 pt-4 sm:pt-0 border-t sm:border-t-0 border-border">
          <Link
            href={`/portal/document/${encodeURIComponent(document.id)}/download`}
            className="text-sm font-medium text-foreground/60 hover:text-foreground transition-colors py-2 sm:py-1"
          >
            Download
          </Link>
          <Link
            href={`/portal/document/${encodeURIComponent(document.id)}`}
            className="text-sm font-medium text-accent hover:text-accent-hover transition-colors py-2 sm:py-1"
          >
            View <span aria-hidden>&rarr;</span>
          </Link>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Legacy document cards (old folder-sync pipeline)
// ---------------------------------------------------------------------------

function LegacyDocumentGrid({ documents }: { documents: SyncedClientDocument[] }) {
  return (
    <ul className="grid grid-cols-1 gap-4">
      {documents.map((document) => (
        <li key={document.id}>
          <LegacyDocumentCard document={document} />
        </li>
      ))}
    </ul>
  )
}

function LegacyDocumentCard({ document }: { document: SyncedClientDocument }) {
  return (
    <Link
      href={`/portal/document/${encodeURIComponent(document.id)}`}
      className="flex h-full flex-col justify-between border border-border bg-card/30 p-5 sm:p-6 hover:border-accent transition-colors group min-h-[9rem]"
    >
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-3 mb-3">
          <span className="text-xs uppercase tracking-wider text-muted-foreground truncate">
            {document.typeLabel}
          </span>
          {document.isNew && (
            <span className="shrink-0 border border-accent/50 text-accent text-[0.65rem] uppercase tracking-wider px-2 py-0.5">
              New
            </span>
          )}
        </div>
        <h3 className="font-serif text-lg text-foreground leading-snug group-hover:text-accent transition-colors break-words">
          {document.title}
        </h3>
      </div>
      <div className="flex items-center justify-between gap-3 mt-5">
        <span className="text-xs text-muted-foreground truncate">
          {document.changedAt ? formatDate(document.changedAt) : ""}
        </span>
        <span className="text-sm font-medium text-accent shrink-0">
          View <span aria-hidden>&rarr;</span>
        </span>
      </div>
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Legacy publication rows (copies/entitlement)
// ---------------------------------------------------------------------------

type Item = Awaited<ReturnType<typeof getLibraryFor>>[number]

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

function LockedLibrary({ name }: { name: string }) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border">
        <div className="max-w-md mx-auto px-4 sm:px-6 h-20 flex items-center justify-between">
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

      <main className="flex-1 max-w-md w-full mx-auto px-4 sm:px-6 py-16">
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

      <div className="max-w-md w-full mx-auto px-4 sm:px-6 pb-10">
        <SiteFooter />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

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
