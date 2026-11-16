import { notFound, redirect } from 'next/navigation'
import { getPublicationBySlug, getPublishedPublications } from '@/lib/publications'
import {publicationVersions,familyHistory,latestEntitledVersions} from '@/lib/publication-versions'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import { AccessBadge, AccessAction } from '@/components/PublicationAccess'

export const revalidate = 300

export default async function PublicationDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const doc = await getPublicationBySlug(slug)

  if (!doc) return notFound()
  const visible=await getPublishedPublications()
  const candidates=visible.some(p=>p.id===doc.id)?visible:[doc,...visible]
  const versions=await publicationVersions('paid',candidates.map(p=>p.id))
  const latest=latestEntitledVersions(familyHistory(candidates,p=>p.id,doc.id,versions),p=>p.id,versions)[0]
  if(latest&&latest.id!==doc.id)redirect(`/publications/${latest.slug}`)

  if (doc.visibility === 'OPEN') {
    redirect('/publications#review-publications')
  }

  const coverageAreas = doc.coverageAreas
    ? doc.coverageAreas.split('\n').map((s) => s.trim()).filter(Boolean)
    : []

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <main id="main-content" tabIndex={-1} className="max-w-3xl mx-auto px-6 py-20 sm:py-28">
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
      </main>
    </div>
  )
}
