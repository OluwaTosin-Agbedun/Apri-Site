import Link from "next/link"
import { notFound } from "next/navigation"
import { requirePortalPrincipal } from "@/lib/subscriber-dal"
import { getSyncedClientDocument } from "@/lib/papermark-client-library"
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
 * The address in the URL is a Papermark document id and nothing else. No share
 * link, no email and no token is accepted from the query string, because a URL
 * is the one part of a request a reader can rewrite. The link is looked up from
 * the synchronised library using the signed-in principal's own database id, so
 * a subscriber who pastes another client's document id gets a 404 -- the query
 * simply does not match a row.
 */
export default async function PortalDocumentPage({
  params,
  // Next 16: params is a promise.
}: {
  params: Promise<{ id: string }>
}) {
  const principal = await requirePortalPrincipal()
  if (!principal.hasAccess) notFound()

  const { id } = await params
  const document = await getSyncedClientDocument(principal, decodeURIComponent(id))
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
        tier={principal.type === "briefing" ? "Private briefing" : principal.publicTier}
        termEnd={principal.type === "briefing" ? null : principal.termEnd}
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

          {/*
            A fallback, not the way in. Some browsers refuse a cross-origin
            frame outright, and a reader who hits that needs a way through
            rather than an empty box -- but it stays small and secondary.
          */}
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
