import Link from 'next/link'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import { CONTACT_EMAIL } from '@/config'

export const metadata = {
  title: 'Terms of Use · APRI',
  description:
    'The terms on which APRI publications and briefings are provided.',
}

/** Shown at the top so a reader can tell whether they have seen this version. */
const LAST_UPDATED = 'September 2026'

/**
 * Terms of use.
 *
 * Kept to what actually governs the relationship: access is personal, each copy
 * is identified, the analysis is not advice. Written in plain sentences rather
 * than legal register -- a term a board member cannot follow is a term they will
 * breach without meaning to.
 *
 * Keep this page in step with the code. Two terms here were wrong for a time
 * because the implementation moved and the page did not: it forbade downloading
 * after downloading was enabled, and described freely shareable "open
 * publications" after those were replaced by a Complimentary Review restricted
 * to approved addresses. A prohibition nobody can comply with, or a permission
 * we did not mean to give, are both worse than silence.
 */
export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <div className="max-w-4xl mx-auto px-6 py-20 sm:py-28">
        <header className="mb-14">
          <h1 className="font-serif text-3xl sm:text-4xl text-foreground mb-4 leading-tight tracking-tight">
            Terms of Use
          </h1>
          <p className="text-sm text-muted-foreground">
            The terms on which APRI publications and briefings are provided, by Athena
            Centre. Last updated {LAST_UPDATED}.
          </p>
        </header>

        <div className="space-y-12">
          <Section title="Access is personal">
            <P>
              A subscription is issued to a named individual. It is not transferable, not
              shareable, and not a licence for an organisation. Where an organisation buys
              several seats, each seat belongs to one named person with their own sign-in.
            </P>
            <P>
              Do not share your sign-in link or let anyone else use your access. If someone
              else needs a subscription, tell us and we will arrange one.
            </P>
          </Section>

          <Section title="Every copy is identified to you">
            <P>
              Publications may be read on screen and downloaded for your own use. What is
              not permitted is passing a copy on: documents must not be re-hosted,
              forwarded, or given to anyone who does not hold their own access &mdash;
              including colleagues at your own organisation who are not named seats.
            </P>
            <P>
              Every copy carries the email address it was issued to on each page, together
              with the date and time it was opened. Every opening and every download is
              recorded against you. A copy found outside the person it was issued to can
              therefore be traced. We mention this not as a threat but so that nobody
              forwards a document assuming it is anonymous.
            </P>
            <P>
              A downloaded file keeps that watermark. Removing, obscuring or editing it is a
              breach of these terms.
            </P>
          </Section>

          <Section title="What you may do with the analysis">
            <P>
              Use it inside your organisation for your own decisions &mdash; that is what it
              is for. Quote it in internal papers and discussions.
            </P>
            <P>
              Do not republish it, sell it, or present it as your own work. Do not reproduce
              substantial extracts publicly or in material shared outside your organisation
              without asking us first. We are usually glad to agree; we would rather be
              asked.
            </P>
          </Section>

          <Section title="This is analysis, not advice">
            <P>
              APRI publications and briefings are independent political, regulatory and
              political-economy analysis. They are not legal advice, investment advice,
              lobbying, or political access brokerage, and they should not be relied on as
              a substitute for professional advice on your particular circumstances.
            </P>
            <P>
              Forward-looking assessments are judgements about an uncertain environment.
              They are made in good faith on the information available and may be overtaken
              by events.
            </P>
          </Section>

          <Section title="Briefings are separate">
            <P>
              A commissioned briefing is a separate engagement and is not part of a
              subscription. Its scope, format and timing are agreed with you in advance. A
              briefing does not include access to the subscription library, and a
              subscription does not include briefings.
            </P>
          </Section>

          <Section title="Subscription terms and fees">
            <P>
              Fees, term length and seat count are agreed privately with you before a
              subscription begins. Access runs for the term agreed and ends on the term end
              date unless renewed.
            </P>
            <P>
              When a term ends, access is withdrawn and the links issued to you stop
              working. Get in touch before your term ends if you want to continue.
            </P>
          </Section>

          <Section title="If terms are breached">
            <P>
              We may suspend or end access where these terms are breached &mdash; in
              particular where access is shared or a document is redistributed. We will tell
              you why, and we will discuss it with you first unless the breach is serious
              and ongoing.
            </P>
          </Section>

          <Section title="Complimentary Review copies">
            <P>
              We make a small number of sample publications available to prospective
              subscribers as Complimentary Review copies. Access is limited to email
              addresses approved in advance, and the address is verified before the document
              opens.
            </P>
            <P>
              A review copy is provided for your own assessment of whether to subscribe. It
              is confidential and not for redistribution: it carries the same watermark and
              the same restrictions as a subscription copy, and it is not open or public
              material. Being sent one does not make you a subscriber and grants no access
              to the subscription library.
            </P>
          </Section>

          <Section title="Changes and governing law">
            <P>
              We may update these terms. Where a change materially affects subscribers, we
              will tell them by email. These terms are governed by the laws of the Federal
              Republic of Nigeria.
            </P>
          </Section>
        </div>

        <div className="mt-14 pt-8 border-t border-border">
          <p className="text-sm text-muted-foreground leading-relaxed">
            See also our{' '}
            <Link
              href="/privacy"
              className="text-accent hover:text-accent-hover transition-colors"
            >
              privacy notice
            </Link>
            . Questions about any of this:{' '}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="text-accent hover:text-accent-hover transition-colors"
            >
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </div>

        <div className="mt-14">
          <SiteFooter />
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-serif text-xl text-foreground mb-4">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm text-foreground/80 leading-relaxed max-w-4xl">{children}</p>
  )
}
