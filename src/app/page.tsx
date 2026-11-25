import { currentBrandCopy } from "@/lib/brand"
import { publicMetadata } from "@/lib/seo"
import Link from "next/link"
import type { Metadata } from "next"
import { CONTACT_EMAIL } from "@/config"
import { BOARDROOM_OFFERINGS } from "@/data/services"
import { TEAM_MEMBERS } from "@/data/team"
import SiteHeader from "@/components/SiteHeader"
import SiteFooter from "@/components/SiteFooter"
import { AccessBadge, AccessActionInline } from "@/components/PublicationAccess"
import { accessNotice } from "@/lib/delivery"
import TrackedAccessLink from "@/components/TrackedAccessLink"
import { reviewEntryMode } from "@/lib/review-reader"
import { getPublishedPublications, getReviewLibrary, type Publication } from "@/lib/publications"
import styles from "./home.module.css"

// Publishing revalidates this page; the five-minute cache is a backstop.
export const revalidate = 300
export const metadata: Metadata = publicMetadata("/")

const boardBriefingHref = `/request-briefing?type=${encodeURIComponent("Board Political & Regulatory Risk Briefing")}`
const issueDate = (date: string) => new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
}).format(new Date(`${date}T12:00:00Z`))

function PublicationCard({ doc }: { doc: Publication }) {
  return (
    <article className={styles.intelligenceCard}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className={styles.kicker}>{currentBrandCopy(doc.kicker || doc.productLine)}</p>
        <AccessBadge visibility={doc.visibility} />
      </div>
      {doc.editionDate && <time className={styles.date} dateTime={doc.editionDate}>{issueDate(doc.editionDate)}</time>}
      <h3 className="font-serif text-2xl sm:text-3xl leading-tight">
        <Link href={`/publications/${doc.slug}`} className={styles.titleLink}>{doc.title}</Link>
      </h3>
      <p className={styles.body}>{currentBrandCopy(doc.description)}</p>
      <div className="mt-auto flex flex-wrap items-center gap-x-6 gap-y-3 pt-5">
        <Link href={`/publications/${doc.slug}`} className={styles.textLink}>Publication details</Link>
        {/* Retain the shared gate; never render a subscriber document URL. */}
        <AccessActionInline visibility={doc.visibility} openLinkUrl={doc.openLinkUrl} />
      </div>
      {doc.attribution && <p className="mt-5 text-sm leading-relaxed text-foreground/75">{currentBrandCopy(doc.attribution)}</p>}
    </article>
  )
}

const openStreams = [
  { title: "Political Landscape Monitor", origin: "Athena Election Observatory", description: "Monthly assessments of Nigeria's political, democratic and electoral environment." },
  { title: "Election Matters", origin: "Athena Election Observatory", description: "Electoral developments, institutional assessments and evidence-based analysis." },
  { title: "Africa Watch", origin: "Africa and Comparative Perspectives", description: "Political, electoral and institutional developments across Africa and relevant international comparators." },
  { title: "OsitaInsight", origin: "ClearPath Media", description: "Selected video perspectives on policy, regulation, institutions and Nigeria's political economy." },
]

export default async function HomePage() {
  const [documents, reviewLibrary, entryMode] = await Promise.all([
    getPublishedPublications(), getReviewLibrary(), reviewEntryMode(),
  ])
  // Public-safe records only, ordered by editorial issue date, never upload time.
  const latest = [...documents]
    .sort((a, b) => (b.editionDate ?? "").localeCompare(a.editionDate ?? ""))
    .slice(0, 3)

  return (
    <div className={`min-h-screen bg-background ${styles.home}`}>
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className={styles.main}>
        <header className={styles.hero}>
          <p className={styles.kicker}>Built for consequential decisions</p>
          <h1 className={styles.headline}>Understanding power.<br />Informing strategy.</h1>
          <p className={styles.heroDescription}>
            Independent political, regulatory and political-economy intelligence for boards,
            executives, investors and institutions operating in Nigeria.
          </p>
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-start">
            <Link href="/publications" className={styles.secondaryButton}>Explore Our Intelligence</Link>
            <Link href={boardBriefingHref} className={styles.primaryButton}>Request a Board Briefing</Link>
          </div>
          <div className={styles.propositions}>
            <div>
              <p className={styles.kicker}>Intelligence subscriptions</p>
              <h2 className="font-serif text-2xl sm:text-3xl">Anticipate change.</h2>
              <p className={styles.body}>Continuing political and regulatory intelligence through regular publications, assessments and focused updates.</p>
              <Link href="/access" className={styles.textLink}>Explore subscriptions</Link>
            </div>
            <div>
              <p className={styles.kicker}>Bespoke advisory</p>
              <h2 className="font-serif text-2xl sm:text-3xl">Prepare for decisions.</h2>
              <p className={styles.body}>Confidential briefings for boards, executive teams and strategic planning retreats, tailored to the decisions ahead.</p>
              <Link href="/services" className={styles.textLink}>Explore advisory services</Link>
            </div>
          </div>
        </header>

        <section id="publications" aria-labelledby="latest-intelligence" className={styles.section}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.kicker}>Continuing intelligence</p>
              <h2 id="latest-intelligence" className={styles.heading}>Latest Intelligence</h2>
            </div>
            <Link href="/publications" className={styles.textLink}>View all publications</Link>
          </div>
          <p className={`${styles.body} max-w-3xl mb-7`}>
            Athena Strategic Advisory publishes written intelligence on Nigeria&rsquo;s political,
            regulatory and political-economy environment. Full subscriber reports remain available
            to authorised readers; complimentary review copies appear separately below.
          </p>
          {documents.length === 0 ? null : (
            <div className={styles.intelligenceGrid}>
              {latest.map((doc) => <PublicationCard key={doc.id} doc={doc} />)}
            </div>
          )}
        </section>

        <section id="boardroom" aria-labelledby="boardroom-heading" className={styles.boardroom}>
          <div>
            <p className={styles.darkKicker}>Private &amp; confidential</p>
            <h2 id="boardroom-heading" className={styles.heading}>Intelligence for the Boardroom</h2>
            <p className="mt-5 max-w-3xl text-base sm:text-lg leading-relaxed text-white/85">
              Bespoke political and regulatory assessments for organisations making consequential
              decisions about strategy, investment, market exposure and enterprise risk.
            </p>
          </div>
          <div className={styles.boardroomList}>
            {BOARDROOM_OFFERINGS.map((offering) => (
              <article key={offering.briefingType} className={styles.boardroomOffering}>
                <div>
                  <h3 className="font-serif text-2xl sm:text-3xl leading-tight">{offering.title}</h3>
                  <p className="mt-3 max-w-2xl text-base leading-relaxed text-white/85">{offering.description}</p>
                </div>
                <Link href={`/request-briefing?type=${encodeURIComponent(offering.briefingType)}`} className={styles.darkLink}>{offering.ctaLabel}</Link>
              </article>
            ))}
          </div>
          <Link href="/services" className={styles.darkLink}>View all board and advisory services</Link>
        </section>

        {/* Selected Client Engagements belongs here once the team approves its descriptions. */}

        <section id="open-insights" aria-labelledby="open-insights-heading" className={styles.section}>
          <p className={styles.kicker}>Research &amp; perspectives</p>
          <h2 id="open-insights-heading" className={styles.heading}>Open Insights</h2>
          <p className={`${styles.body} max-w-3xl mt-5 mb-8`}>
            Public research and perspectives from across the Athena ecosystem.
            Each stream retains the identity of its originating institution.
          </p>
          {/* Stage 1 introduces the streams. Stage 2 adds approved public editions and videos.
              A restricted PLM or Review copy must never become public through this section. */}
          <div className={styles.streamGrid}>
            {openStreams.map((stream) => (
              <article key={stream.title} className="border-t border-border pt-6">
                <p className={styles.kicker}>{stream.origin}</p>
                <h3 className="font-serif text-2xl sm:text-3xl">{stream.title}</h3>
                <p className={styles.body}>{stream.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="athena-approach" aria-labelledby="approach-heading" className={styles.section}>
          <div className={styles.sectionHeading}>
            <h2 id="approach-heading" className={styles.heading}>The Athena Approach</h2>
            <p className="font-serif text-lg sm:text-xl italic">Signal. Interpretation. Implication.</p>
          </div>
          <p className={`${styles.body} max-w-3xl mb-8`}>
            Athena Strategic Advisory distinguishes political noise from developments that can
            materially affect regulation, capital allocation, market access and corporate strategy.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-7">
            <div className="border-t border-accent pt-5">
              <h3 className={styles.kicker}>What changed</h3>
              <p className={styles.body}>Identify material political, policy and regulatory developments.</p>
            </div>
            <div className="border-t border-accent pt-5">
              <h3 className={styles.kicker}>Why it matters</h3>
              <p className={styles.body}>Assess their implications for institutions, sectors and businesses.</p>
            </div>
            <div className="border-t border-accent pt-5">
              <h3 className={styles.kicker}>What to watch</h3>
              <p className={styles.body}>Identify emerging risks, scenarios and indicators of change.</p>
            </div>
          </div>
          <details className="mt-8 border-y border-border py-5">
            <summary className="cursor-pointer text-base font-medium">What We Track</summary>
            <ul className="mt-5 grid gap-x-8 gap-y-3 text-base text-foreground/80 sm:grid-cols-2">
              {[
                "Political Power & Coalition Dynamics",
                "Executive & Legislative Watch",
                "Government & Regulatory Intelligence",
                "Policy Implementation & Institutional Behaviour",
                "Sector Exposure & Operating Risk",
                "State-Level Political Risk",
                "Election & Transition Risk",
                "Political Economy Outlook",
              ].map((item) => <li key={item}>{item}</li>)}
            </ul>
          </details>
        </section>

        <section id="intelligence-team" aria-labelledby="intelligence-team-heading" className={styles.section}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.kicker}>Who we are</p>
              <h2 id="intelligence-team-heading" className={styles.heading}>Our Intelligence Team</h2>
            </div>
            <Link href="/team" className={styles.textLink}>Meet the full team</Link>
          </div>
          <p className={`${styles.body} max-w-3xl mb-7`}>
            Practitioners, political scientists, economists, governance researchers and election
            analysts. Our intelligence combines continuous monitoring, structured analysis and
            internal editorial review.
          </p>
          <div className="grid gap-7 sm:grid-cols-3">
            {TEAM_MEMBERS.slice(0, 3).map((member) => (
              <article key={member.key} className="border-t border-border pt-5">
                <h3 className="font-serif text-xl sm:text-2xl">{member.name}</h3>
                <p className="mt-3 text-base leading-relaxed text-foreground/80">{member.apriRole}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="complimentary-review" aria-labelledby="complimentary-review-heading" className={styles.review}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.kicker}>For prospective readers</p>
              <h2 id="complimentary-review-heading" className={styles.heading}>Complimentary Review</h2>
            </div>
            <Link href="/review" className={styles.secondaryButton}>Request Complimentary Review Access</Link>
          </div>
          <p className={`${styles.body} max-w-3xl mb-7`}>
            Request verified access to a confidential selection of our publications. Existing
            approved review readers can open their assigned editions below using their registered email.
          </p>
          {reviewLibrary && (
            <div className="grid gap-5 md:grid-cols-2">
              {reviewLibrary.items.map((card) => (
                <TrackedAccessLink
                  key={card.slotKey}
                  href={entryMode === "library" ? `/review/library?edition=${card.id}` : card.secureUrl}
                  eventType="review_access_clicked"
                  slotKey={card.slotKey}
                  publicationId={card.id}
                  papermarkDocumentId={card.papermarkDocumentId}
                  newTab
                  className={styles.reviewCard}
                >
                  <span className={styles.kicker}>Complimentary review copy</span>
                  <span className="block mt-1 text-sm text-foreground/75">{card.publicationType}</span>
                  <h3 className="font-serif text-2xl leading-tight mt-3">{card.pubTitle}</h3>
                  {(card.editionLabel || card.editionDate) && (
                    <p className="text-sm text-foreground/75 mt-3">
                      {card.editionLabel}{card.editionLabel && card.editionDate ? " · " : ""}
                      {card.editionDate && <time dateTime={card.editionDate}>{issueDate(card.editionDate)}</time>}
                    </p>
                  )}
                  <p className={styles.body}>{currentBrandCopy(card.description)}</p>
                  <span className={`${styles.textLink} inline-block mt-5`}>Access review copy</span>
                </TrackedAccessLink>
              ))}
            </div>
          )}
        </section>

        <section id="access" aria-labelledby="subscription-heading" className={styles.section}>
          <div className={styles.contactGrid}>
            <div>
              <p className={styles.kicker}>Continuing access</p>
              <h2 id="subscription-heading" className={styles.heading}>Intelligence for your organisation</h2>
              <p className={styles.body}>
                Subscribing organisations receive regular political and regulatory analysis,
                an archive of assigned publications and secure access for individually named readers.
                Our intelligence supports strategy, risk assessment and investment decisions.
              </p>
              <div className="mt-6 flex flex-col items-start gap-5">
                <Link href="/access" className={styles.primaryButton}>Explore subscription options</Link>
                <Link href="/portal" className={styles.textLink}>Existing reader? Open your subscriber library.</Link>
              </div>
            </div>
            <div id="contact">
              <p className={styles.kicker}>Contact</p>
              <h2 className="font-serif text-2xl sm:text-3xl">About Athena Strategic Advisory</h2>
              <p className={styles.body}>
                For boards, executives, diplomatic missions and institutional decision-makers
                responsible for strategy, risk, investment, policy, country assessment,
                government relations and regulated operations in Nigeria.
              </p>
              <p className={styles.body}>Bespoke advisory and board briefings are separately commissioned.</p>
              <a href={`mailto:${CONTACT_EMAIL}`} className={`${styles.textLink} mt-5 inline-block break-all`}>{CONTACT_EMAIL}</a>
              <p className="mt-5"><Link href="/request-briefing" className={styles.textLink}>Request a Briefing</Link></p>
            </div>
          </div>
          <p className="mt-8 pt-6 border-t border-border text-sm leading-relaxed text-foreground/75">
            <span className="font-medium text-foreground">Access note:</span> {accessNotice()}
          </p>
        </section>
        <SiteFooter />
      </main>
    </div>
  )
}
