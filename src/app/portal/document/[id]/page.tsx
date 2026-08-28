import Link from "next/link"
import { notFound } from "next/navigation"
import { requirePortalPrincipal } from "@/lib/subscriber-dal"
import { tierDisplayName } from "@/lib/entitlements"
import {
  getSyncedClientDocument,
  getDataRoomDocumentForSubscriber,
} from "@/lib/papermark-client-library"
import { papermarkEmbedUrl } from "@/lib/papermark-embed"
import { recordClientEvent } from "@/lib/client-engagement"
import PapermarkEmbed from "@/components/PapermarkEmbed"
import SiteFooter from "@/components/SiteFooter"
import PortalHeader from "@/components/PortalHeader"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Document · APRI",
  robots: { index: false, follow: false },
}

const SHELL = "w-full max-w-[1600px] mx-auto px-6 sm:px-8"

/**
 * One document, read inside APRI.
 *
 * Tries the Data Room pipeline first (for subscribers with an active DR link),
 * then falls back to the legacy folder-synced pipeline. In both cases the
 * query is scoped to the authenticated principal's own database id, so a
 * subscriber who pastes another client's document id gets a 404.
 */
export default async function PortalDocumentPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const principal = await requirePortalPrincipal()
  if (!principal.hasAccess) notFound()

  const { id } = await params
  const decodedId = decodeURIComponent(id)

  if (principal.type === "subscriber") {
    const drResult = await getDataRoomDocumentForSubscriber(principal.id, decodedId)
    if (drResult) {
      return (
        <DataRoomDocumentView
          principal={principal}
          title={drResult.document.title}
          categoryLabel={drResult.document.categoryLabel}
          numPages={drResult.document.numPages}
          linkUrl={drResult.linkUrl}
          dataroomDocumentId={drResult.document.dataroomDocumentId}
        />
      )
    }
  }

  const document = await getSyncedClientDocument(principal, decodedId)
  if (!document) notFound()

  const embedUrl = papermarkEmbedUrl(
    document.shareUrl,
    process.env.PAPERMARK_CUSTOM_DOMAIN,
  )

  try {
    await recordClientEvent(
      { type: principal.type, id: principal.id },
      "private_link_opened",
    )
  } catch {}

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <PortalHeader
        shell={SHELL}
        name={principal.fullName}
        organisation={principal.organisation}
        tier={tierDisplayName(principal.publicTier)}
        termEnd={principal.termEnd}
      />

      <main className={`flex-1 ${SHELL} py-8 sm:py-10`}>
        <Link
          href="/portal"
          className="text-sm text-foreground/60 hover:text-foreground transition-colors"
        >
          <span aria-hidden>&larr;</span> Back to your library
        </Link>

        <div className="mt-5 mb-6 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
              {document.typeLabel}
            </p>
            <h1 className="font-serif text-2xl sm:text-3xl text-foreground leading-tight tracking-tight">
              {document.title}
            </h1>
          </div>

          {embedUrl && (
            <a
              href={embedUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-foreground/60 hover:text-accent transition-colors shrink-0"
            >
              Open in a new tab
            </a>
          )}
        </div>

        {embedUrl ? (
          <>
            <PapermarkEmbed src={embedUrl} title={document.title} />
            <p className="mt-4 text-xs text-muted-foreground leading-relaxed max-w-4xl">
              This copy was issued to you by name. If the viewer asks you to confirm your
              email address, that is Papermark&rsquo;s own document-security check on the
              copy: it verifies that the person reading it is the person it was issued to.
              You will not be asked to sign in to APRI again.
            </p>
          </>
        ) : (
          <div className="border border-border bg-card/30 p-8" role="alert">
            <p className="text-sm text-foreground/70 leading-relaxed">
              This document cannot be opened at the moment. Please contact APRI and we
              will check its secure link.
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

/**
 * Document viewer for Data Room documents.
 *
 * Deep-links to the exact document within the subscriber's personal Data Room
 * link by appending `?documentId={dataroomDocumentId}` — the parameter
 * Papermark's data room viewer uses to navigate directly to a document.
 */
async function DataRoomDocumentView({
  principal,
  title,
  categoryLabel,
  numPages,
  linkUrl,
  dataroomDocumentId,
}: {
  principal: Awaited<ReturnType<typeof requirePortalPrincipal>>
  title: string
  categoryLabel: string
  numPages: number | null
  linkUrl: string
  dataroomDocumentId: string | null
}) {
  try {
    await recordClientEvent(
      { type: principal.type, id: principal.id },
      "private_link_opened",
    )
  } catch {}

  const targetUrl = buildDataRoomDocumentUrl(linkUrl, dataroomDocumentId)
  const embedUrl = papermarkEmbedUrl(targetUrl, process.env.PAPERMARK_CUSTOM_DOMAIN)

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <PortalHeader
        shell={SHELL}
        name={principal.fullName}
        organisation={principal.organisation}
        tier={tierDisplayName(principal.publicTier)}
        termEnd={principal.termEnd}
      />

      <main className={`flex-1 ${SHELL} py-8 sm:py-10`}>
        <Link
          href="/portal"
          className="text-sm text-foreground/60 hover:text-foreground transition-colors"
        >
          <span aria-hidden>&larr;</span> Back to your library
        </Link>

        <div className="mt-5 mb-6 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
              {categoryLabel}
            </p>
            <h1 className="font-serif text-2xl sm:text-3xl text-foreground leading-tight tracking-tight">
              {title}
            </h1>
            {numPages && (
              <p className="text-xs text-muted-foreground mt-2">
                {numPages} {numPages === 1 ? "page" : "pages"}
              </p>
            )}
          </div>

          {embedUrl && (
            <a
              href={embedUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-foreground/60 hover:text-accent transition-colors shrink-0"
            >
              Open in a new tab
            </a>
          )}
        </div>

        {embedUrl ? (
          <>
            <PapermarkEmbed src={embedUrl} title={title} />
            <p className="mt-4 text-xs text-muted-foreground leading-relaxed max-w-4xl">
              This copy was issued to you by name and every view is logged. If the viewer asks
              you to confirm your email address, that is Papermark&rsquo;s document-security check:
              it verifies that the person reading it is the person it was issued to.
            </p>
          </>
        ) : (
          <div className="border border-border bg-card/30 p-8" role="alert">
            <p className="text-sm text-foreground/70 leading-relaxed">
              This document cannot be opened at the moment. Please contact APRI and we
              will check its secure link.
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

/**
 * Constructs the deep-link URL for a specific document within a Data Room.
 *
 * Papermark's data room viewer accepts `?documentId=` to navigate directly to
 * one document. When `dataroomDocumentId` is null the base link is returned —
 * the subscriber lands on the room's document list rather than an error page.
 */
function buildDataRoomDocumentUrl(
  linkUrl: string,
  dataroomDocumentId: string | null,
): string {
  if (!dataroomDocumentId) return linkUrl
  try {
    const url = new URL(linkUrl)
    url.searchParams.set("documentId", dataroomDocumentId)
    return url.toString()
  } catch {
    return linkUrl
  }
}
