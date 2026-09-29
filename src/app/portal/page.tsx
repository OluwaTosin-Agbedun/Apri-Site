import Link from "next/link"
import TrackedAccessLink from "@/components/TrackedAccessLink"
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
import { PORTAL_SERIES, editionsBySeries, isPortalSeries, newestEdition, type PortalSeries } from "@/lib/portal-library"

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

  const editions = documents.filter((document) => PORTAL_SERIES.includes(document.series as PortalSeries))
  const libraries = editionsBySeries(editions)
  const latest = newestEdition(editions)
  const total = editions.length

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

        <PortalSection title="Latest">
          {latest ? <DataRoomGrid documents={[latest]} featured /> : <EmptyLibrary />}
        </PortalSection>

        <LibraryNavigation counts={Object.fromEntries(PORTAL_SERIES.map((series) => [series, libraries[series].length])) as Record<PortalSeries, number>} />

        {PORTAL_SERIES.map((series) => (
          <section key={series} id={`library-${series.toLowerCase()}`} className="mb-16 scroll-mt-24">
            <div className="flex items-end justify-between gap-4 border-b border-border pb-4 mb-6">
              <div><p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-accent mb-2">{series}</p>
                <h2 className="font-serif text-xl sm:text-2xl text-foreground">{seriesLabel(series)}</h2></div>
              <span className="text-xs text-muted-foreground">{libraries[series].length} {libraries[series].length === 1 ? "edition" : "editions"}</span>
            </div>
            {libraries[series].length ? <DataRoomGrid documents={libraries[series]} /> : <p className="text-sm text-muted-foreground py-5">No editions are currently available to you in this library.</p>}
          </section>
        ))}

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
  const library = await getLibraryFor(principal)
  await touchLastViewed(principal.id)

  const portalLibrary = library.filter((item) => isPortalSeries(item.series))
  const grouped = editionsBySeries(portalLibrary)
  const total = portalLibrary.length

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

        <PortalSection title="Latest">
          {portalLibrary.length > 0 ? <ul className="grid grid-cols-1 gap-4"><li><PublicationRow item={newestEdition(portalLibrary)!} /></li></ul> : <EmptyLibrary />}
        </PortalSection>

        {portalLibrary.length > 0 && (
          <PortalSection title="Published editions">
            <LibraryNavigation counts={Object.fromEntries(PORTAL_SERIES.map((series) => [series, grouped[series].length])) as Record<PortalSeries, number>} />
            <div className="space-y-12">
              {PORTAL_SERIES.map((series) => (
                <section key={series} id={`library-${series.toLowerCase()}`} className="scroll-mt-24">
                  <h3 className="text-xs font-medium uppercase tracking-wider text-accent mb-5">
                    {seriesLabel(series)}
                  </h3>
                  <ul className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {grouped[series].map((item) => (
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

function DataRoomGrid({ documents, featured = false }: { documents: DataRoomDocument[]; featured?: boolean }) {
  return (
    <ul className="grid grid-cols-1 gap-4">
      {documents.map((doc) => (
        <li key={doc.id}>
          <DataRoomCard document={doc} featured={featured} />
        </li>
      ))}
    </ul>
  )
}

function DataRoomCard({ document, featured = false }: { document: DataRoomDocument; featured?: boolean }) {
  const date = document.editionDate
  return (
    <div className={`w-full max-w-none border bg-card/30 p-5 sm:p-7 ${featured ? "border-accent/50 shadow-[0_12px_40px_rgba(20,39,34,0.06)]" : "border-border"}`}>
      <div className="flex flex-col sm:flex-row sm:gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-3 mb-2">
            <span className="text-xs uppercase tracking-wider text-muted-foreground truncate">
              {document.categoryLabel}
            </span>
            <ActivityStatus document={document} />
          </div>
          <h3 className="font-serif text-lg text-foreground leading-snug break-words">
            {document.displayTitle}
          </h3>
          {document.kicker && (
            <p className="text-sm text-foreground/70 mt-1">{document.kicker}</p>
          )}
          {document.summary && (
            <p className="text-sm text-foreground/60 leading-relaxed mt-2 line-clamp-3">
              {document.summary}
            </p>
          )}
          <div className="flex items-center gap-3 mt-3">
            {date && (
              <span className="text-xs text-muted-foreground">
                {formatDate(date)}
              </span>
            )}
            {document.numPages && (
              <>
                {date && <span className="text-xs text-border">&middot;</span>}
                <span className="text-xs text-muted-foreground">
                  {document.numPages} {document.numPages === 1 ? "page" : "pages"}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex gap-3 shrink-0 mt-4 sm:mt-0 pt-4 sm:pt-0 border-t sm:border-t-0 border-border sm:items-start sm:pt-1">
          <TrackedAccessLink
            href={`/portal/document/${encodeURIComponent(document.id)}`}
            eventType="subscriber_document_view_clicked"
            papermarkDocumentId={document.papermarkDocumentId}
            internal
            className="text-sm font-medium text-accent hover:text-accent-hover transition-colors py-2 sm:py-1"
          >
            View <span aria-hidden>&rarr;</span>
          </TrackedAccessLink>
        </div>
      </div>
      {/* Only a view Papermark recorded for this subscriber counts. Opening the
          card is a click, not a view, and is never shown here. */}
      {document.viewedBySubscriber && (
        <p className="mt-3 text-right text-[0.7rem] text-muted-foreground">Viewed</p>
      )}
    </div>
  )
}

/** A download Papermark recorded for this subscriber and this exact document. */
function ActivityStatus({ document }: { document: DataRoomDocument }) {
  if (!document.downloadedBySubscriber) return null
  return (
    <span className="ml-auto flex shrink-0 items-center gap-2 text-muted-foreground">
      <span className="inline-flex" title="Downloaded by you" aria-label="Downloaded by you"><svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 20h16" /></svg></span>
    </span>
  )
}

function LibraryNavigation({ counts }: { counts: Record<PortalSeries, number> }) {
  return (
    <nav aria-label="Publication libraries" className="mb-16">
      <p className="text-xs font-medium uppercase tracking-wider text-accent mb-5">Browse libraries</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {PORTAL_SERIES.map((series) => <a key={series} href={`#library-${series.toLowerCase()}`} className="group border border-border bg-card/20 p-5 hover:border-accent transition-colors"><span className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-accent">{series}</span><span className="mt-2 block font-serif text-lg leading-snug group-hover:text-accent transition-colors">{seriesLabel(series)}</span><span className="mt-3 block text-xs text-muted-foreground">{counts[series]} {counts[series] === 1 ? "edition" : "editions"} <span aria-hidden>→</span></span></a>)}
      </div>
    </nav>
  )
}

function EmptyLibrary() {
  return <div className="border border-border bg-card/30 px-5 py-10 sm:px-8"><h3 className="font-serif text-lg text-foreground">Your library is ready</h3><p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">No PLM, MIN or AIU editions are currently assigned to your subscription. New authorised editions will appear here when issued.</p></div>
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
        <div className="flex items-start gap-3"><h3 className="font-serif text-lg text-foreground leading-snug">{item.title}</h3><LegacyActivityStatus item={item} /></div>
        {item.summary && (
          <p className="text-sm text-foreground/60 leading-relaxed mt-2">{item.summary}</p>
        )}
        {meta && <p className="text-xs text-muted-foreground mt-3">{meta}</p>}
        <p className="text-xs text-muted-foreground mt-4 pt-4 border-t border-border">
          Access being prepared — we will email you when it is ready.
        </p>
        <LegacyViewed item={item} />
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
          <div className="flex items-start gap-3"><h3 className="font-serif text-lg text-foreground leading-snug group-hover:text-accent transition-colors">{item.title}</h3><LegacyActivityStatus item={item} /></div>
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
      <LegacyViewed item={item} />
    </a>
  )
}

/** A download Papermark recorded for this subscriber. */
function LegacyActivityStatus({ item }: { item: Item }) {
  if (!item.downloadedBySubscriber) return null
  return <span className="ml-auto flex shrink-0 items-center gap-2 text-muted-foreground"><span title="Downloaded by you" aria-label="Downloaded by you">↓</span></span>
}

/** "Viewed", bottom right, only for a view Papermark recorded for this subscriber. */
function LegacyViewed({ item }: { item: Item }) {
  if (!item.viewedBySubscriber) return null
  return <p className="mt-3 text-right text-[0.7rem] text-muted-foreground">Viewed</p>
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
