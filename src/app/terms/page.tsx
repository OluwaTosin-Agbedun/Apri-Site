import Link from 'next/link'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import { CONTACT_EMAIL } from '@/config'

export const metadata = {
  title: 'Terms of Use · APRI',
  description:
    'The terms on which APRI publications and briefings are provided.',
}

/**
 * Terms of use.
 *
 * Kept to what actually governs the relationship: access is personal, documents
 * are view-only and identified, and the analysis is not advice. Written in plain
 * sentences rather than legal register -- a term a board member cannot follow is
 * a term they will breach without meaning to.
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
            Centre.
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

          <Section title="Documents are view-only and identified">
            <P>
              Publications are provided to read on screen. This service provides no
              download, and documents must not be copied, printed to file, re-hosted or
              forwarded.
            </P>
            <P>
              Every copy carries the name of the person it was issued to on each page, and
              every time a document is opened is recorded. A copy found outside the person
              it was issued to can therefore be traced. We mention this not as a threat but
              so that nobody forwards a document assuming it is anonymous.
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

          <Section title="Open publications">
            <P>
              Some publications are published openly and require only that you verify an
              email address. They may be read and shared freely unless the document itself
              says otherwise. The restrictions above apply to subscription publications, not
              to these.
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
