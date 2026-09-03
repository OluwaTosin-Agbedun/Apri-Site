import Link from 'next/link'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import { AccessBadge } from '@/components/PublicationAccess'
import { getPublishedPublications, getReviewLibrary } from '@/lib/publications'
import TrackedAccessLink from '@/components/TrackedAccessLink'

export const revalidate = 300

export const metadata = {
  title: 'Publications · APRI',
}

export default async function PublicationsPage() {
  const [publications, library] = await Promise.all([
    getPublishedPublications(),
    getReviewLibrary(),
  ])

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <div className="max-w-5xl lg:max-w-6xl mx-auto px-6 py-20 sm:py-28">
        <header className="mb-16">
          <h1 className="font-serif text-4xl sm:text-5xl text-foreground mb-8 leading-[1.1] tracking-[-0.02em]">
            Publications
          </h1>
          <p className="text-lg sm:text-xl text-foreground/70 leading-relaxed max-w-4xl">
            Publications and analytical products available to APRI subscribers
            and authorised readers.
          </p>
        </header>

        {/* Complimentary Review section */}
        {library && (
          <section
            id="complimentary-review"
            className="mb-20 scroll-mt-28"
          >
            <div className="mb-10">
              <h2 className="font-serif text-2xl sm:text-3xl text-foreground mb-6 tracking-tight">
                APRI Complimentary Review Copy
              </h2>
              <p className="text-sm sm:text-base text-foreground/70 leading-relaxed max-w-4xl">
                This complimentary review provides prospective subscribers with
                selected examples of publications and analytical products
                available through APRI.
              </p>
              <div className="mt-4">
                <span className="inline-flex items-center px-2.5 py-1 text-xs font-medium tracking-wide bg-accent/10 text-accent">
                  Complimentary Review Copy — verified email required
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {library.items.map((card, i) => (
                <article
                  key={i}
                  className="border border-border bg-card/30 p-6 sm:p-8 flex flex-col"
                >
                  <span className="text-xs font-medium uppercase tracking-wider text-accent block mb-3">
                    {card.publicationType}
                  </span>

                  <h3 className="font-serif text-lg text-foreground">
                    {card.pubTitle}
                  </h3>

                  <p className="text-sm text-foreground/70 leading-relaxed mt-4 flex-1">
                    {card.description}
                  </p>

                  <div className="mt-5 flex items-center gap-4 text-xs text-muted-foreground">
                    <span>{card.frequency}</span>
                    {card.audience && (
                      <>
                        <span className="text-border">|</span>
                        <span>{card.audience}</span>
                      </>
                    )}
                  </div>

                  <div className="mt-6 pt-5 border-t border-border/50">
                    <p className="text-[0.7rem] text-muted-foreground leading-relaxed mb-4">
                      Verified email access is required. Documents are confidential
                      and not for redistribution.
                    </p>
                    <TrackedAccessLink
                      href={card.secureUrl}
                      eventType="review_access_clicked"
                      slotKey={card.slotKey}
                      newTab
                      className="inline-flex items-center bg-foreground text-background px-5 py-2.5 text-sm font-medium tracking-wide hover:bg-foreground/90 transition-colors"
                    >
                      Access review copy
                    </TrackedAccessLink>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {/* Subscriber publications */}
        <div className="space-y-8">
          {publications.length === 0 && !library ? (
            <p className="text-sm text-foreground/70 leading-relaxed max-w-4xl">
              Publications will be listed here once available. For enquiries, contact us
              or use <a href="/access" className="text-accent hover:text-accent-hover transition-colors">Request Access</a>.
            </p>
          ) : null}
          {publications.map((doc) => (
            <TrackedAccessLink
              key={doc.id}
              href={`/publications/${doc.slug}`}
              eventType="publication_details_clicked"
              publicationId={doc.id}
              internal
              className="group panel-interactive block p-8 sm:p-10 lg:p-12"
            >
              <div className="flex items-start justify-between gap-4 mb-3">
                <span className="text-xs font-medium uppercase tracking-wider text-accent">
                  {doc.kicker || doc.productLine}
                </span>
                <AccessBadge visibility={doc.visibility} />
              </div>

              <h2 className="font-serif text-xl text-foreground group-hover:text-accent transition-colors">
                {doc.title}
              </h2>

              {doc.strapline && (
                <p className="font-serif text-base text-foreground/70 italic mt-2">
                  {doc.strapline}
                </p>
              )}

              <p className="text-sm text-foreground/70 leading-relaxed mt-4 max-w-4xl">
                {doc.description}
              </p>

              <div className="mt-6 flex items-center gap-6 text-xs text-muted-foreground">
                <span>{doc.frequency}</span>
                <span className="text-border">|</span>
                <span>{doc.section}</span>
              </div>

              <span className="inline-flex items-center text-sm font-medium text-accent mt-6 group-hover:translate-x-1 transition-transform">
                View details &rarr;
              </span>
            </TrackedAccessLink>
          ))}
        </div>

        <div className="mt-16">
          <SiteFooter />
        </div>
      </div>
    </div>
  )
}
