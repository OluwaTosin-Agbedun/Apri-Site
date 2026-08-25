import Link from 'next/link'
import { CONTACT_EMAIL } from '@/config'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import { AccessBadge, AccessActionInline } from '@/components/PublicationAccess'
import { accessNotice } from '@/lib/delivery'
import AccessForm from './access-form'
import {
  PUBLICATION_SECTIONS,
  getPublishedPublications,
  type Publication,
} from '@/lib/publications'

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

function PublicationCard({ doc }: { doc: Publication }) {
  return (
    <article className="group border border-border p-8 sm:p-10 hover:border-accent transition-colors bg-card/30">
      <div className="flex items-start justify-between gap-4 mb-3">
        <span className="text-xs font-medium uppercase tracking-wider text-accent">
          {doc.kicker || doc.productLine}
        </span>
        <AccessBadge visibility={doc.visibility} />
      </div>

      <h3 className="font-serif text-xl text-foreground">
        <Link href={`/publications/${doc.slug}`} className="hover:text-accent transition-colors">
          {doc.title}
        </Link>
      </h3>

      {doc.strapline && (
        <p className="font-serif text-base text-foreground/70 italic mt-2">
          {doc.strapline}
        </p>
      )}

      <p className="text-sm text-foreground/70 leading-relaxed mt-5 mb-5 max-w-2xl">
        {doc.description}
      </p>

      <Link
        href={`/publications/${doc.slug}`}
        className="inline-flex items-center text-sm font-medium text-accent hover:text-accent-hover transition-colors mb-4"
      >
        Read more <span className="ml-2 opacity-70">&rarr;</span>
      </Link>

      <dl className="grid grid-cols-1 sm:grid-cols-[7rem_1fr] gap-x-6 gap-y-2 mb-8 text-xs leading-relaxed">
        <dt className="uppercase tracking-wider text-muted-foreground">Frequency</dt>
        <dd className="text-foreground/70">{doc.frequency}</dd>
        <dt className="uppercase tracking-wider text-muted-foreground">Audience</dt>
        <dd className="text-foreground/70">{doc.audience}</dd>
      </dl>

      {/* Shared gate. Never renders papermark_link -- see PublicationAccess. */}
      <AccessActionInline visibility={doc.visibility} openLinkUrl={doc.openLinkUrl} />

      {doc.attribution && (
        <p className="text-xs text-muted-foreground mt-8 pt-6 border-t border-border/60 max-w-xl leading-relaxed">
          {doc.attribution}
        </p>
      )}
    </article>
  )
}

export default async function HomePage() {
  const documents = await getPublishedPublications()

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <div className="max-w-5xl lg:max-w-6xl mx-auto px-6 py-20 sm:py-28">
        {/* Hero */}
        <header className="mb-24">
          <h1 className="font-serif text-3xl sm:text-4xl text-foreground mb-6 leading-tight tracking-tight">
            Athena Political &amp; Regulatory Intelligence
          </h1>
          <p className="text-lg sm:text-xl text-foreground/80 leading-relaxed mb-10 max-w-2xl">
            Independent political, regulatory and political-economy intelligence for
            organisations operating, investing and making strategic decisions in Nigeria.
          </p>

          <div className="flex flex-col sm:flex-row items-start gap-4">
            {/*
              Goes to sign-in, not to the enquiry form. Only an activated
              subscriber inside their term can actually get in -- the sign-in
              page issues a link only for those, and answers everyone else with
              the same neutral message either way. So this is safe to offer
              publicly: it grants nothing on its own.
            */}
            <Link
              href="/portal/sign-in"
              className="bg-foreground text-background px-8 py-3.5 text-sm font-medium tracking-wide hover:bg-foreground/90 transition-colors"
            >
              Access Subscriber Library
            </Link>
            <Link
              href="/services"
              className="border border-border px-8 py-3.5 text-sm font-medium tracking-wide text-foreground hover:border-accent transition-colors"
            >
              Request a Briefing
            </Link>
          </div>
        </header>

        {/* Publications */}
        <section id="publications" className="mb-24 scroll-mt-28">
          <div className="mb-12">
            <h2 className="font-serif text-2xl text-foreground mb-4">
              Publications &amp; Briefings
            </h2>
            <p className="text-sm text-foreground/70 leading-relaxed max-w-2xl">
              APRI publishes written intelligence products on Nigeria&rsquo;s political,
              regulatory and political economy environment, issued to subscribers and
              authorised readers.
            </p>
          </div>

          {documents.length === 0 ? (
            <p className="text-sm text-muted-foreground border border-border bg-card/30 p-8">
              No publications are currently listed.
            </p>
          ) : (
            <div className="space-y-16">
              {PUBLICATION_SECTIONS.map((section) => {
                const items = documents.filter((doc) => doc.section === section)
                if (items.length === 0) return null

                return (
                  <div key={section}>
                    <h3 className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground mb-6 pb-3 border-b border-border">
                      {section}
                    </h3>
                    <div className="space-y-6">
                      {items.map((doc) => (
                        <PublicationCard key={doc.id} doc={doc} />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-16 mb-24">
          <section>
            <h2 className="font-serif text-xl text-foreground mb-6">What APRI Tracks</h2>
            <ul className="space-y-4 text-sm text-foreground/80">
              {[
                'Political Power & Coalition Stability',
                'Government & Regulatory Watch',
                'Policy Implementation Tracker',
                'State-Level Political & Operating Risk',
                'Political Economy Outlook',
              ].map((item) => (
                <li key={item} className="flex gap-3">
                  <span className="text-accent">&mdash;</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="font-serif text-xl text-foreground mb-6">Designed For</h2>
            <p className="text-sm text-foreground/80 leading-relaxed mb-8">
              Boards, CEOs, strategy teams, risk officers, government relations teams,
              investors and regulated businesses.
            </p>
            <Link
              href="/services"
              className="inline-flex items-center text-sm font-medium text-accent hover:text-accent-hover transition-colors"
            >
              Services &amp; Briefings <span className="ml-2 opacity-70">&rarr;</span>
            </Link>
          </section>
        </div>

        {/* Subscription Access */}
        <section id="access" className="mb-24 pt-16 border-t border-border scroll-mt-28">
          <h2 className="font-serif text-2xl text-foreground mb-4">Subscription Access</h2>
          <p className="text-sm text-foreground/70 leading-relaxed mb-10 max-w-2xl">
            Access to the APRI subscriber library is granted to authorised recipients.
            Submit your details below and a secure access link will be issued if approved.
          </p>

          <AccessForm />

          <div className="mt-8">
            <Link
              href="/access"
              className="inline-flex items-center text-sm font-medium text-accent hover:text-accent-hover transition-colors"
            >
              View all subscription levels <span className="ml-2 opacity-70">&rarr;</span>
            </Link>
          </div>

          <div className="mt-10 pt-8 border-t border-border">
            <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
              <span className="font-medium text-foreground">Access note:</span>{' '}
              {accessNotice()}
            </p>
          </div>
        </section>

        {/* Contact */}
        <section id="contact" className="mb-24 pt-16 border-t border-border scroll-mt-28">
          <h2 className="font-serif text-xl text-foreground mb-6">
            About Athena Political &amp; Regulatory Intelligence
          </h2>
          <p className="text-sm text-foreground/80 leading-relaxed mb-8 max-w-2xl">
            Athena Political &amp; Regulatory Intelligence helps business leaders understand
            how shifts in political power, public policy, regulation and institutional
            behaviour may affect their operating environment, investment decisions and
            strategic outlook.
          </p>

          <div className="text-sm">
            <span className="text-muted-foreground mr-2">Contact:</span>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="text-foreground hover:text-accent transition-colors font-medium"
            >
              {CONTACT_EMAIL}
            </a>
          </div>
        </section>

        <SiteFooter />
      </div>
    </div>
  )
}
