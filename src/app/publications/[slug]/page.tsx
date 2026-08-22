import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPublicationBySlug } from '@/lib/publications'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'

export const dynamic = 'force-dynamic'

export default async function PublicationDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const doc = await getPublicationBySlug(slug)

  if (!doc) return notFound()

  const coverageAreas = doc.coverageAreas
    ? doc.coverageAreas.split('\n').map((s) => s.trim()).filter(Boolean)
    : []
  const isRequest = doc.ctaMode === 'request'
  const hasLink = Boolean(doc.papermarkLink)

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <div className="max-w-3xl mx-auto px-6 py-20 sm:py-28">
        <header className="mb-16">
          <span className="text-xs font-medium uppercase tracking-wider text-accent mb-4 block">
            {doc.kicker || doc.productLine}
          </span>

          <h1 className="font-serif text-3xl sm:text-4xl text-foreground mb-6 leading-tight tracking-tight">
            {doc.title}
          </h1>

          {doc.strapline && (
            <p className="font-serif text-lg text-foreground/70 italic leading-relaxed">
              {doc.strapline}
            </p>
          )}
        </header>

        <section className="mb-16">
          <p className="text-sm text-foreground/80 leading-relaxed max-w-2xl">
            {doc.description}
          </p>
        </section>

        {coverageAreas.length > 0 && (
          <section className="mb-16">
            <h2 className="font-serif text-xl text-foreground mb-6">Coverage Areas</h2>
            <ul className="space-y-3 text-sm text-foreground/80">
              {coverageAreas.map((area) => (
                <li key={area} className="flex gap-3">
                  <span className="text-accent">&mdash;</span>
                  {area}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mb-16">
          <dl className="grid grid-cols-1 sm:grid-cols-[7rem_1fr] gap-x-6 gap-y-3 text-sm leading-relaxed">
            <dt className="uppercase tracking-wider text-xs text-muted-foreground">Frequency</dt>
            <dd className="text-foreground/70">{doc.frequency}</dd>
            <dt className="uppercase tracking-wider text-xs text-muted-foreground">Audience</dt>
            <dd className="text-foreground/70">{doc.audience}</dd>
          </dl>
        </section>

        <div className="mb-16">
          {isRequest ? (
            <Link
              href="/access"
              className="inline-flex items-center bg-foreground text-background px-8 py-3.5 text-sm font-medium tracking-wide hover:bg-foreground/90 transition-colors"
            >
              {doc.ctaLabel}
            </Link>
          ) : hasLink ? (
            <a
              href={doc.papermarkLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center bg-foreground text-background px-8 py-3.5 text-sm font-medium tracking-wide hover:bg-foreground/90 transition-colors"
            >
              {doc.ctaLabel}
            </a>
          ) : (
            <span className="inline-flex items-center text-sm font-medium text-muted-foreground">
              {doc.ctaLabel} &mdash; link pending
            </span>
          )}
        </div>

        {doc.attribution && (
          <div className="mb-16 pt-8 border-t border-border">
            <p className="text-xs text-muted-foreground leading-relaxed max-w-xl">
              {doc.attribution}
            </p>
          </div>
        )}

        <SiteFooter />
      </div>
    </div>
  )
}
