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
  getReviewLibrary,
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
    <article className="group panel-interactive p-8 sm:p-10 lg:p-12">
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

      <p className="text-sm text-foreground/70 leading-relaxed mt-5 mb-5 max-w-4xl">
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
  const [documents, reviewLibrary] = await Promise.all([
    getPublishedPublications(),
    getReviewLibrary(),
  ])

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <div className="max-w-5xl lg:max-w-6xl mx-auto px-6 py-20 sm:py-28">
        {/* Hero */}
        <header className="mb-28 sm:mb-36">
          {/*
            One line on a wide screen, and no forced break.

            The size is set so the full name fits the measure rather than being
            snapped in two by a <br>: a hard break puts the fold in the same
            place at every width, which is what made it read like a typeset
            document. It still wraps on a narrow screen, where it has to.
          */}
          <h1 className="font-serif text-3xl sm:text-4xl lg:text-5xl text-foreground mb-8 leading-[1.1] tracking-[-0.02em]">
            Athena Political &amp; Regulatory Intelligence
          </h1>

          <p className="text-lg sm:text-xl text-foreground/70 leading-relaxed mb-12 max-w-4xl">
            Independent political, regulatory and political-economy intelligence for
            organisations operating, investing and making strategic decisions in Nigeria.
          </p>

          <div className="flex flex-col sm:flex-row items-start gap-4">
            {/*
              Goes to the library itself, not to a sign-in form. A subscriber
              whose device has already been verified lands in their library
              without an email step; anyone else is redirected to sign-in, which
              issues a link only to an activated subscriber and answers everyone
              else with the same neutral message. So this is safe to offer
              publicly: it grants nothing on its own.
            */}
            <Link
              href="/portal"
              className="btn-primary"
            >
              Access Subscriber Library
            </Link>
            <Link
              href="/services"
              className="btn-secondary"
            >
              Request a Briefing
            </Link>
          </div>
        </header>

        {/* Complimentary Review preview */}
        {reviewLibrary && (
          <section className="mb-24 scroll-mt-28">
            <div className="mb-10">
              <h2 className="font-serif text-2xl sm:text-3xl text-foreground section-head mb-6 tracking-tight">
                Complimentary Review
              </h2>
              <p className="text-base text-foreground/70 leading-relaxed max-w-4xl mt-4">
                Selected sample publications for prospective subscribers.
                Verified email access is required.
              </p>
            </div>
            <div className="space-y-4">
              {reviewLibrary.items.map((card, i) => (
                <Link
                  key={i}
                  href="/publications#complimentary-review"
                  className="group panel-interactive block p-6 sm:p-8"
                >
                  <span className="text-xs font-medium uppercase tracking-wider text-accent block mb-2">
                    {card.publicationType}
                  </span>
                  <h3 className="font-serif text-lg text-foreground group-hover:text-accent transition-colors">
                    {card.pubTitle}
                  </h3>
                  <p className="text-sm text-foreground/70 leading-relaxed mt-3 max-w-4xl line-clamp-2">
                    {card.description}
                  </p>
                  <span className="inline-flex items-center text-sm font-medium text-accent mt-4 group-hover:translate-x-1 transition-transform">
                    View review library &rarr;
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Publications */}
        <section id="publications" className="mb-24 scroll-mt-28">
          <div className="mb-14">
            <h2 className="font-serif text-2xl sm:text-3xl text-foreground section-head mb-6 tracking-tight">
              Publications &amp; Briefings
            </h2>
            {/*
              "political-economy" is hyphenated wherever it modifies a noun,
              which it does here and in the hero. It was unhyphenated in one
              place and hyphenated in the other.
            */}
            <p className="text-base text-foreground/70 leading-relaxed max-w-4xl mt-8">
              APRI publishes written intelligence on Nigeria&rsquo;s political, regulatory
              and political-economy environment, issued to subscribers and authorised
              readers.
            </p>
          </div>

          {documents.length === 0 ? null : (
            <div className="space-y-16">
              {PUBLICATION_SECTIONS.map((section) => {
                const items = documents.filter((doc) => doc.section === section)
                if (items.length === 0) return null

                return (
                  <div key={section}>
                    <h3 className="eyebrow mb-8 pb-4 border-b border-hairline block">
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

        <div className="rule-soft mb-24" />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-16 lg:gap-24 mb-28">
          <section>
            <h2 className="font-serif text-xl sm:text-2xl text-foreground section-head mb-8 tracking-tight">
              What APRI Tracks
            </h2>
            <ul className="space-y-4 text-sm text-foreground/80">
              {[
                'Political Power & Coalition Dynamics',
                'Executive & Legislative Watch',
                'Government & Regulatory Intelligence',
                'Policy Implementation & Institutional Behaviour',
                'Sector Exposure & Operating Risk',
                'State-Level Political Risk',
                'Election & Transition Risk',
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
            <h2 className="font-serif text-xl sm:text-2xl text-foreground section-head mb-8 tracking-tight">
              Built for consequential decisions.
            </h2>
            <p className="text-sm text-foreground/80 leading-relaxed mb-8">
              For boards and executives responsible for strategy, risk, investment,
              government relations and regulated operations in Nigeria.
            </p>
            <Link
              href="/services"
              className="inline-flex items-center text-sm font-medium text-accent hover:text-accent-hover transition-colors"
            >
              Services &amp; Briefings <span className="ml-2 opacity-70">&rarr;</span>
            </Link>
          </section>
        </div>

        {/* The APRI Approach */}
        <section className="mb-24 pt-16 border-t border-border">
          <h2 className="font-serif text-2xl sm:text-3xl text-foreground section-head mb-4 tracking-tight">
            The APRI Approach
          </h2>
          <p className="font-serif text-base sm:text-lg text-foreground/70 italic mb-8">
            Signal. Interpretation. Implication.
          </p>
          <p className="text-sm text-foreground/80 leading-relaxed mb-10 max-w-4xl">
            APRI distinguishes political noise from developments that can materially
            affect regulation, capital allocation, market access and corporate strategy.
            Our analysis combines political intelligence, regulatory monitoring,
            institutional analysis and sector-specific assessment.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wider text-accent mb-3">What changed</h3>
            </div>
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wider text-accent mb-3">Why it matters</h3>
            </div>
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wider text-accent mb-3">What to watch</h3>
            </div>
          </div>
        </section>

        {/* Subscription Access */}
        <section id="access" className="mb-24 pt-16 border-t border-border scroll-mt-28">
          <h2 className="font-serif text-2xl text-foreground mb-4">Subscription Access</h2>
          <p className="text-sm text-foreground/70 leading-relaxed mb-10 max-w-4xl">
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
            <p className="text-sm text-muted-foreground leading-relaxed max-w-4xl">
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
          <p className="text-sm text-foreground/80 leading-relaxed mb-8 max-w-4xl">
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
