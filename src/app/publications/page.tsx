import Link from 'next/link'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import { getAllPublications } from '@/lib/publications'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Publications · APRI',
}

export default async function PublicationsPage() {
  const publications = await getAllPublications()

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <div className="max-w-5xl lg:max-w-6xl mx-auto px-6 py-20 sm:py-28">
        <header className="mb-16">
          <h1 className="font-serif text-3xl sm:text-4xl text-foreground mb-6 leading-tight tracking-tight">
            Publications
          </h1>
          <p className="text-lg text-foreground/80 leading-relaxed max-w-2xl">
            APRI publishes written intelligence products on Nigeria&rsquo;s political,
            regulatory and political economy environment, issued to subscribers and
            authorised readers.
          </p>
        </header>

        <div className="space-y-8">
          {publications.map((doc) => (
            <Link
              key={doc.id}
              href={`/publications/${doc.slug}`}
              className="block group border border-border p-8 sm:p-10 hover:border-accent transition-colors bg-card/30"
            >
              <span className="text-xs font-medium uppercase tracking-wider text-accent mb-3 block">
                {doc.kicker || doc.productLine}
              </span>

              <h2 className="font-serif text-xl text-foreground group-hover:text-accent transition-colors">
                {doc.title}
              </h2>

              {doc.strapline && (
                <p className="font-serif text-base text-foreground/70 italic mt-2">
                  {doc.strapline}
                </p>
              )}

              <p className="text-sm text-foreground/70 leading-relaxed mt-4 max-w-2xl">
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
