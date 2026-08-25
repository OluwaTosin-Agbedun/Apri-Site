import Link from 'next/link'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import { CONTACT_EMAIL } from '@/config'

export const metadata = {
  title: 'Privacy · APRI',
  description:
    'What APRI collects, why, who processes it, and how long it is kept.',
}

/**
 * The privacy notice.
 *
 * Written to describe what the system actually does rather than in general
 * terms, because two things here are unusual enough that a reader would not
 * assume them: every copy is individually identified to the person it was issued
 * to, and every time a document is opened is recorded against that person. Both
 * are disclosed plainly -- a tracking arrangement a subscriber only discovers
 * later is a breach of trust whatever the notice said.
 */
export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <div className="max-w-3xl mx-auto px-6 py-20 sm:py-28">
        <header className="mb-14">
          <h1 className="font-serif text-3xl sm:text-4xl text-foreground mb-4 leading-tight tracking-tight">
            Privacy
          </h1>
          <p className="text-sm text-muted-foreground">
            Athena Political &amp; Regulatory Intelligence (APRI), a service of Athena
            Centre.
          </p>
        </header>

        <div className="space-y-12">
          <Section title="In short">
            <P>
              We collect the details you give us in an enquiry, and &mdash; if you become a
              subscriber &mdash; a record of which publications you open. We do not sell
              your information, we do not share it for advertising, and we do not build
              profiles for anyone else.
            </P>
            <P>
              Two things are worth stating plainly, because you would not assume them:{' '}
              <strong className="text-foreground">
                each document is individually identified to the person it was issued to
              </strong>
              , and{' '}
              <strong className="text-foreground">
                each time a document is opened is recorded
              </strong>
              . Both exist to protect the confidentiality of paid research, and both are
              described below.
            </P>
          </Section>

          <Section title="What we collect, and why">
            <Definition term="When you make an enquiry">
              Your name, work email address, phone number, organisation, role, how many
              people would need access, the level you are interested in, and anything you
              choose to add. We use it to reply to you and to prepare a subscription or a
              briefing. Nothing else.
            </Definition>

            <Definition term="If you become a subscriber">
              The above, plus your access level, the number of seats, your subscription
              term dates, and an internal reference for the invoice. This is the record of
              what you are entitled to read.
            </Definition>

            <Definition term="When you open a document">
              The date and time, which publication, and how long it was open. This is
              recorded against you by name.
              <br />
              <br />
              It exists for two reasons. It tells us whether a subscription is being used,
              so we can offer help rather than let a subscription lapse unnoticed. And
              because each copy is identified to one person, it is how a document that
              appears somewhere it should not can be traced back.
            </Definition>

            <Definition term="When you read an open publication">
              Open publications ask you to verify an email address at the document gate. We
              keep that address so we can tell you when related work is published. You have
              no account and no record beyond the address itself, and you can ask us to
              remove it at any time.
            </Definition>
          </Section>

          <Section title="Who else handles it">
            <P>
              We use three suppliers, each for one purpose. None of them is permitted to
              use your information for their own ends.
            </P>
            <ul className="space-y-3 mt-4">
              <Bullet>
                <strong className="text-foreground">Papermark</strong> hosts the documents
                and verifies the email address of whoever opens one. It records the views
                described above.
              </Bullet>
              <Bullet>
                <strong className="text-foreground">Resend</strong> delivers our email
                &mdash; sign-in links, new-edition notices and replies.
              </Bullet>
              <Bullet>
                <strong className="text-foreground">Neon</strong> hosts the database
                holding subscriber records.
              </Bullet>
            </ul>
            <P>
              These suppliers process data outside Nigeria. Where that is the case, we rely
              on their contractual data-protection terms.
            </P>
          </Section>

          <Section title="How documents are protected">
            <P>
              Access is issued to a named individual and verified by their email address.
              It is not transferable, and a document opens only for the person it was issued
              to.
            </P>
            <P>
              Documents are view-only &mdash; this service provides no download. Each copy
              carries the name of the person it was issued to on every page, so a copy that
              circulates can be identified.
            </P>
            <P>
              We do not ask for or store a password for the subscriber library. Signing in
              uses a single-use link sent to the address on your subscription.
            </P>
          </Section>

          <Section title="How long we keep it">
            <P>
              Enquiries that do not become subscriptions are kept while they may still be
              useful to answer, then removed. Subscriber records and the record of what you
              were entitled to read are kept after a subscription ends, because the question
              of who held access to a document outlives the access itself.
            </P>
            <P>
              Ask us to remove your details and we will, except where we are required to
              keep a record.
            </P>
          </Section>

          <Section title="Your rights">
            <P>
              Under the Nigeria Data Protection Act 2023 you may ask what we hold about you,
              ask us to correct it, ask us to delete it, and object to how we use it. Write
              to{' '}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="text-accent hover:text-accent-hover transition-colors"
              >
                {CONTACT_EMAIL}
              </a>{' '}
              and we will respond.
            </P>
          </Section>

          <Section title="Changes">
            <P>
              If we change how any of this works, we will change this page. Where a change
              materially affects subscribers, we will tell them by email rather than expect
              them to notice.
            </P>
          </Section>
        </div>

        <div className="mt-14 pt-8 border-t border-border">
          <p className="text-sm text-muted-foreground leading-relaxed">
            See also our{' '}
            <Link href="/terms" className="text-accent hover:text-accent-hover transition-colors">
              terms of use
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
    <p className="text-sm text-foreground/80 leading-relaxed max-w-2xl">{children}</p>
  )
}

function Definition({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="border-l-2 border-border pl-5">
      <p className="text-xs font-medium uppercase tracking-wider text-accent mb-2">
        {term}
      </p>
      <p className="text-sm text-foreground/80 leading-relaxed max-w-2xl">{children}</p>
    </div>
  )
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3 text-sm text-foreground/80 leading-relaxed max-w-2xl">
      <span className="text-accent shrink-0">&mdash;</span>
      <span>{children}</span>
    </li>
  )
}
