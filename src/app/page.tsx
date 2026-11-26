import Link from "next/link"
import Image from "next/image"
import type { Metadata } from "next"
import { CONTACT_EMAIL } from "@/config"
import { BOARDROOM_OFFERINGS } from "@/data/services"
import { CLIENT_ENGAGEMENTS, INSIGHT_STREAMS, PUBLICATION_VISUALS } from "@/data/editorial"
import { currentBrandCopy } from "@/lib/brand"
import { publicMetadata } from "@/lib/seo"
import { accessNotice } from "@/lib/delivery"
import { reviewEntryMode } from "@/lib/review-reader"
import { getPublishedPublications, getReviewLibrary, type Publication } from "@/lib/publications"
import { AccessActionInline, AccessBadge } from "@/components/PublicationAccess"
import SiteHeader from "@/components/SiteHeader"
import SiteFooter from "@/components/SiteFooter"
import TrackedAccessLink from "@/components/TrackedAccessLink"
import styles from "./home.module.css"

export const revalidate = 300
export const metadata: Metadata = publicMetadata("/")
const boardBriefingHref = `/request-briefing?type=${encodeURIComponent("Board Political & Regulatory Risk Briefing")}`
const issueDate = (date: string) => new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
}).format(new Date(`${date}T12:00:00Z`))

function PublicationCard({ doc }: { doc: Publication }) {
  const visual = PUBLICATION_VISUALS[doc.id] ?? PUBLICATION_VISUALS[doc.slug]
  return (
    <article className={styles.edition}>
      {visual && <Image src={visual.src} alt={visual.alt} width={160} height={220} className={styles.cover} unoptimized />}
      <div className={styles.editionCopy}>
        <div className={styles.editionMeta}>
          <span>{currentBrandCopy(doc.kicker || doc.productLine)}</span>
          {doc.editionDate && <time dateTime={doc.editionDate}>{issueDate(doc.editionDate)}</time>}
          <AccessBadge visibility={doc.visibility} />
        </div>
        <h3><Link href={`/publications/${doc.slug}`}>{doc.title}</Link></h3>
        <p className={styles.excerpt}>{currentBrandCopy(doc.description)}</p>
        <div className={styles.editionActions}>
          <Link href={`/publications/${doc.slug}`}>Publication details</Link>
          {/* Preserve the public gate. No subscriber document URL is rendered. */}
          <AccessActionInline visibility={doc.visibility} openLinkUrl={doc.openLinkUrl} />
        </div>
        {doc.attribution && <p className={styles.credit}>{currentBrandCopy(doc.attribution)}</p>}
      </div>
    </article>
  )
}

export default async function HomePage() {
  const [documents, reviewLibrary, entryMode] = await Promise.all([
    getPublishedPublications(), getReviewLibrary(), reviewEntryMode(),
  ])
  const latest = [...documents].sort((a, b) => (b.editionDate ?? "").localeCompare(a.editionDate ?? "")).slice(0, 3)
  // These are only the owner's explicitly offered, verified review editions.
  // A homepage limit does not withdraw editions: the complete archive stays linked.
  const reviewEditions = [...(reviewLibrary?.items ?? [])]
    .sort((a, b) => (b.editionDate ?? "").localeCompare(a.editionDate ?? "")).slice(0, 3)
  const engagements = CLIENT_ENGAGEMENTS.filter(item => item.approved)
  return (
    <div className={`min-h-screen bg-background ${styles.home}`}>
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className={styles.main}>
        <header className={styles.hero}>
          <div>
            <h1>Built for consequential decisions.</h1>
            <p className={styles.positioning}>Understanding power. Informing strategy.</p>
          </div>
          <div className={styles.heroCopy}>
            <p>Independent political, regulatory and political-economy intelligence for boards, executives, investors and institutions operating in Nigeria.</p>
            <p>Continuing intelligence subscriptions. Confidential, bespoke advisory.</p>
            <div className={styles.heroActions}>
              <Link href="/publications" className={styles.primaryButton}>Explore Our Intelligence</Link>
              <Link href={boardBriefingHref} className={styles.textLink}>Request a Board Briefing</Link>
            </div>
          </div>
        </header>

        <section id="publications" aria-labelledby="latest-intelligence" className={styles.section}>
          <div className={styles.sectionHeading}>
            <h2 id="latest-intelligence">Latest Intelligence</h2>
            <Link href="/publications" className={styles.textLink}>All publications</Link>
          </div>
          {documents.length === 0 ? null : (
            <div id="subscriber-intelligence">{latest.map(doc => <PublicationCard key={doc.id} doc={doc} />)}</div>
          )}
          {reviewLibrary && (
            <div id="review-editions">
              {reviewEditions.map((card) => {
                const visual = PUBLICATION_VISUALS[card.id]
                return (
                  <article key={card.slotKey} className={styles.edition}>
                    {visual && <Image src={visual.src} alt={visual.alt} width={160} height={220} className={styles.cover} unoptimized />}
                    <div className={styles.editionCopy}>
                      <div className={styles.editionMeta}>
                        <span>Complimentary review copy</span>
                        <span>{card.slotKey === "PLM" ? "Athena Election Observatory" : card.publicationType}</span>
                        {card.editionDate ? <time dateTime={card.editionDate}>{issueDate(card.editionDate)}</time> : card.editionLabel && <span>{card.editionLabel}</span>}
                      </div>
                      <h3>{card.pubTitle}</h3>
                      <p className={styles.excerpt}>{currentBrandCopy(card.description)}</p>
                      <TrackedAccessLink
                        href={entryMode === "library" ? `/review/library?edition=${card.id}` : card.secureUrl}
                        eventType="review_access_clicked"
                        slotKey={card.slotKey}
                        publicationId={card.id}
                        papermarkDocumentId={card.papermarkDocumentId}
                        newTab
                        className={styles.textLink}
                      >Access review copy</TrackedAccessLink>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
          {latest.length === 0 && reviewEditions.length === 0 && <p className={styles.body}>Explore our publications and subscription options, or contact the intelligence team about current editions.</p>}
        </section>

        <section id="boardroom" aria-labelledby="boardroom-heading" className={styles.boardroom}>
          <div className={styles.sectionHeading}>
            <h2 id="boardroom-heading">Intelligence for the Boardroom</h2>
            <span className={styles.confidential}>Private &amp; confidential</span>
          </div>
          <p className={styles.boardIntro}>Political and regulatory insight, tailored to the decisions facing your organisation.</p>
          <div className={styles.boardroomList}>
            {BOARDROOM_OFFERINGS.map(offering => (
              <article key={offering.briefingType}>
                <h3>{offering.title}</h3>
                <p>{offering.description}</p>
                <Link href={`/request-briefing?type=${encodeURIComponent(offering.briefingType)}`}>{offering.ctaLabel}</Link>
              </article>
            ))}
          </div>
          <Link href="/services" className={styles.darkLink}>All board and advisory services</Link>
        </section>

        {engagements.length > 0 && (
          <section id="client-engagements" aria-labelledby="engagements-heading" className={styles.section}>
            <div className={styles.sectionHeading}><h2 id="engagements-heading">Selected Client Engagements</h2></div>
            <div className={styles.engagements}>
              {engagements.map(item => (
                <article key={item.id}>
                  <h3>{item.title}</h3><p className={styles.body}>{item.description}</p>
                  <Link href={`/request-briefing?type=${encodeURIComponent(item.briefingType)}`} className={styles.textLink}>Commission a similar briefing</Link>
                </article>
              ))}
            </div>
          </section>
        )}

        <section id="open-insights" aria-labelledby="open-insights-heading" className={styles.section}>
          <div className={styles.sectionHeading}>
            <h2 id="open-insights-heading">Open Insights</h2>
            <Link href="/open-insights" className={styles.textLink}>Explore public research</Link>
          </div>
          <div className={styles.streams}>
            {INSIGHT_STREAMS.map(stream => (
              <div key={stream.id}>
                <h3><Link href={`/open-insights#${stream.id}`}>{stream.title}</Link></h3>
                <p>{stream.attribution}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="athena-approach" aria-labelledby="approach-heading" className={styles.section}>
          <div className={styles.sectionHeading}>
            <h2 id="approach-heading">The Athena Approach</h2>
            <p className={styles.positioning}>Signal. Interpretation. Implication.</p>
          </div>
          <div className={styles.approach}>
            <div><h3>What changed</h3><p>Identify material political, policy and regulatory developments.</p></div>
            <div><h3>Why it matters</h3><p>Assess their implications for institutions, sectors and businesses.</p></div>
            <div><h3>What to watch</h3><p>Identify emerging risks, scenarios and indicators of change.</p></div>
          </div>
          <div id="intelligence-team" className={styles.team}>
            <div><h3>Our Intelligence Team</h3><p>Experience across government, public policy, economics and elections.</p></div>
            <Link href="/team" className={styles.textLink}>Meet the team</Link>
          </div>
        </section>

        <section id="complimentary-review" aria-labelledby="complimentary-review-heading" className={styles.review}>
          <div>
            <h2 id="complimentary-review-heading">Complimentary Review</h2>
            <p className={styles.body}>Experience our intelligence through a selection of publications, with verified access for approved readers.</p>
            <Link href="/publications" className={styles.textLink}>Browse review editions</Link>
          </div>
          <Link href="/review" className={styles.secondaryButton}>Request Complimentary Review Access</Link>
        </section>

        <section id="access" aria-labelledby="subscription-heading" className={styles.section}>
          <div className={styles.contact}>
            <div>
              <h2 id="subscription-heading">Subscriptions</h2>
              <p className={styles.body}>Regular intelligence, an archive of assigned publications and secure access for individually named readers.</p>
              <Link href="/access" className={styles.textLink}>Discuss a subscription</Link>
            </div>
            <div id="contact">
              <h2>Contact Athena Strategic Advisory</h2>
              <p className={styles.body}>Speak with our team about intelligence subscriptions or a bespoke briefing.</p>
              <a href={`mailto:${CONTACT_EMAIL}`} className={styles.textLink}>{CONTACT_EMAIL}</a>
            </div>
          </div>
          <details className={styles.accessNote}>
            <summary>Reader access and confidentiality</summary>
            <p>{accessNotice()}</p>
          </details>
        </section>
        <SiteFooter />
      </main>
    </div>
  )
}
