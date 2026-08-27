import Link from 'next/link'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import { AccessBadge } from '@/components/PublicationAccess'
import { getPublishedPublications } from '@/lib/publications'

/**
 * Cached, then revalidated -- not rendered for every visitor.
 *
 * force-dynamic meant one function invocation and a database round trip per
 * page view, which is the wrong cost for a public page whose content changes a
 * few times a month. Publishing calls revalidatePath, so an edit still appears
 * at once; the five-minute window is only a backstop for anything that changes
 * outside the CMS.
 */
export const revalidate = 300

export const metadata = {
  title: 'Publications · APRI',
}

export default async function PublicationsPage() {
  const publications = await getPublishedPublications()

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <div className="max-w-5xl lg:max-w-6xl mx-auto px-6 py-20 sm:py-28">
        <header className="mb-16">
          <h1 className="font-serif text-4xl sm:text-5xl text-foreground mb-8 leading-[1.1] tracking-[-0.02em]">
            Publications
          </h1>
          <p className="text-lg sm:text-xl text-foreground/70 leading-relaxed max-w-4xl">
            Open APRI editions available to authorised readers. Papermark
            verifies your email before a document opens.
          </p>
        </header>

        <div className="space-y-8">
          {publications.length === 0 && (
            <p className="border border-border bg-card/30 p-8 text-sm text-muted-foreground">
              No open publications are currently available.
            </p>
          )}
          {publications.map((doc) => (
            <Link
              key={doc.id}
              href={`/publications/${doc.slug}`}
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
            </Link>
          ))}
        </div>

        <div className="mt-16">
          <SiteFooter />
        </div>
      </div>
    </div>
  )
}
