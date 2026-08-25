import { notFound } from 'next/navigation'
import { getPublicationBySlug } from '@/lib/publications'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import { AccessBadge, AccessAction } from '@/components/PublicationAccess'

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

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <div className="max-w-3xl mx-auto px-6 py-20 sm:py-28">
        <header className="mb-16">
          <div className="flex items-start justify-between gap-4 mb-4">
            <span className="text-xs font-medium uppercase tracking-wider text-accent">
              {doc.kicker || doc.productLine}
            </span>
            <AccessBadge visibility={doc.visibility} />
          </div>

          <h1 className="font-serif text-4xl sm:text-5xl text-foreground mb-8 leading-[1.1] tracking-[-0.02em]">
            {doc.title}
          </h1>

          {doc.strapline && (
            <p className="font-serif text-lg text-foreground/70 italic leading-relaxed">
              {doc.strapline}
            </p>
          )}
        </header>

        <section className="mb-16">
          <p className="text-sm text-foreground/80 leading-relaxed max-w-4xl">
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

        {/*
          The action comes from the shared gate, which never emits
          papermark_link. That column is the subscriber-library address; a paid
          edition is reachable only after signing in.
        */}
        <div className="mb-16">
          <AccessAction visibility={doc.visibility} openLinkUrl={doc.openLinkUrl} />
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
