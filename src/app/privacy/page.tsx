import Link from 'next/link'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import { CONTACT_EMAIL } from '@/config'

export const metadata = {
  title: 'Privacy · APRI',
  description:
    'What APRI collects, why, who processes it, and how long it is kept.',
}

/** Shown at the top so a reader can tell whether they have seen this version. */
const LAST_UPDATED = 'September 2026'

/**
 * The privacy notice.
 *
 * Written to describe what the system actually does rather than in general
 * terms, because several things here are unusual enough that a reader would not
 * assume them: every copy is stamped with the address it was issued to, every
 * opening is recorded against that person, every download is recorded
 * separately, and clicks on a publication card are recorded against an
 * anonymous cookie. All of it is disclosed plainly -- a tracking arrangement a
 * subscriber only discovers later is a breach of trust whatever the notice
 * said.
 *
 * Keep this page in step with the code. Three statements here were wrong for a
 * time because the implementation moved and the notice did not: it claimed
 * documents could not be downloaded after downloads were enabled, claimed the
 * watermark carried the reader's name after it was changed to their email
 * address, and described "open publications" after those were replaced by the
 * Complimentary Review. If you change what is collected, change this page in
 * the same commit.
 */
export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <div className="max-w-4xl mx-auto px-6 py-20 sm:py-28">
        <header className="mb-14">
          <h1 className="font-serif text-3xl sm:text-4xl text-foreground mb-4 leading-tight tracking-tight">
            Privacy
          </h1>
          <p className="text-sm text-muted-foreground">
            Athena Political &amp; Regulatory Intelligence (APRI), a service of Athena
            Centre. Last updated {LAST_UPDATED}.
          </p>
        </header>

        <div className="space-y-12">
          <Section title="In short">
            <P>
              We collect the details you give us in an enquiry, and &mdash; if you become a
              subscriber &mdash; a record of which publications you open and download. We do
              not sell your information, we do not share it for advertising, and we do not
              build profiles for anyone else.
            </P>
            <P>
              Three things are worth stating plainly, because you would not assume them:{' '}
              <strong className="text-foreground">
                each document is stamped with the email address it was issued to
              </strong>
              ,{' '}
              <strong className="text-foreground">
                each time a document is opened or downloaded is recorded
              </strong>
              , and{' '}
              <strong className="text-foreground">
                we set one anonymous cookie to count clicks on publication cards
              </strong>
              . The first two exist to protect the confidentiality of paid research. All
              three are described below.
            </P>
          </Section>

          <Section title="What we collect, and why">
            <Definition term="When you make an enquiry">
              Your name, work email address, organisation, role, how many people would need
              access, the level you are interested in, and anything you choose to add. We
              use it to reply to you and to prepare a subscription or a briefing. Nothing
              else.
            </Definition>

            <Definition term="If you become a subscriber">
              The above, plus your access level, the number of seats, your subscription
              term dates, and an internal reference for the invoice. This is the record of
              what you are entitled to read.
            </Definition>

            <Definition term="When you open a document">
              The date and time, which publication, how long it was open, and how much of it
              was reached where our document host reports that. This is recorded against
              you by name.
              <br />
              <br />
              It exists for two reasons. It tells us whether a subscription is being used,
              so we can offer help rather than let a subscription lapse unnoticed. And
              because each copy is stamped with the address it was issued to, it is how a
              document that appears somewhere it should not can be traced back.
            </Definition>

            <Definition term="When you download a document">
              Each download is recorded separately from each opening, including repeat
              downloads of the same document. Downloading is permitted; what the terms
              prohibit is passing the file on.
              <br />
              <br />
              We record downloads separately because a single yes-or-no flag cannot show
              that a document was returned to four times, and that pattern is exactly what
              tells us a publication is being used rather than glanced at.
            </Definition>

            <Definition term="When you click a publication card on this site">
              Which publication or review card you clicked, the page you clicked it on, the
              time, and a random identifier from a cookie described below. No email address,
              document link or account identifier is sent from your browser when this
              happens.
              <br />
              <br />
              A click is not a reading. It records that someone chose to open something, not
              that they read it, and we keep the two figures apart rather than adding them
              together into a single misleading total.
            </Definition>

            <Definition term="When you read a Complimentary Review copy">
              The Complimentary Review offers a small number of sample publications to
              prospective subscribers. Access is limited to email addresses we have
              approved in advance, and our document host verifies the address before the
              document opens.
              <br />
              <br />
              We keep that verified address, and a record of the openings and downloads
              made with it, so we know whether the sample was of interest. A Complimentary
              Review reader has no account and is not a subscriber. Ask us to remove your
              address and we will.
            </Definition>

            <Definition term="When we email you">
              Whether a message was delivered, whether it was opened, and whether a link in
              it was clicked. Our email supplier reports this and we keep it against your
              record. We use it to tell a message that failed from one that was ignored,
              because chasing the first is helpful and chasing the second is not.
            </Definition>

            <Definition term="Visitors to the public site">
              We use Vercel Web Analytics to count visits, page views, referrers, countries
              and device types across the public pages. These are anonymous estimates. They
              carry no email address, no subscriber identifier, no document identifier and
              no document link, and they are excluded entirely from the admin area, the
              subscriber portal, sign-in pages and anything carrying a token.
              <br />
              <br />
              We do not combine these numbers with the document records above. One is an
              anonymous estimate of traffic and the other is a verified record of who read
              what; presenting them as one figure would be wrong in both directions.
            </Definition>
          </Section>

          <Section title="Cookies">
            <P>
              We set one cookie of our own, and it is not used for advertising.
            </P>
            <ul className="space-y-3 mt-4">
              <Bullet>
                <strong className="text-foreground">apri_vid</strong>{' '}&mdash; a random value
                with no meaning outside this site, used to tell one visitor&rsquo;s clicks on
                publication cards from another&rsquo;s. It is not linked to your name or
                email address. It cannot be read by JavaScript in your browser, is sent only
                to this site, and lasts one year.
              </Bullet>
              <Bullet>
                <strong className="text-foreground">A session cookie</strong>{' '}when you sign
                in to the subscriber portal, so that you stay signed in. It ends when your
                session does.
              </Bullet>
            </ul>
            <P>
              Vercel Web Analytics does not set a cookie and does not track you between
              sites.
            </P>
          </Section>

          <Section title="IP addresses">
            <P>
              We do not store IP addresses in any of the reading or click records described
              above. Those records hold no IP address at all, and the watermark on a
              document does not show one.
            </P>
            <P>
              There is one exception, and it is a security one: when someone tries to sign
              in, we keep the address the attempt came from alongside the outcome, so that
              repeated failed attempts against an account can be slowed down. Without it,
              guessing at sign-in links would be unlimited.
            </P>
            <P>
              Our document host keeps its own access logs, which may include IP addresses,
              under its own terms. We do not copy those into our records or show them
              anywhere on this site.
            </P>
          </Section>

          <Section title="Who else handles it">
            <P>
              We use four suppliers, each for one purpose. None of them is permitted to use
              your information for their own ends.
            </P>
            <ul className="space-y-3 mt-4">
              <Bullet>
                <strong className="text-foreground">Papermark</strong>{' '}hosts the documents
                and verifies the email address of whoever opens one. It records the openings
                and downloads described above, and keeps its own access logs.
              </Bullet>
              <Bullet>
                <strong className="text-foreground">Resend</strong>{' '}delivers our email
                &mdash; sign-in links, new-edition notices and replies &mdash; and reports
                delivery, opens and clicks.
              </Bullet>
              <Bullet>
                <strong className="text-foreground">Neon</strong>{' '}hosts the database holding
                subscriber records and the reading and click records.
              </Bullet>
              <Bullet>
                <strong className="text-foreground">Vercel</strong>{' '}hosts this website and
                provides the anonymous visitor statistics described above.
              </Bullet>
            </ul>
            <P>
              These suppliers process data outside Nigeria. Where that is the case, we rely
              on their contractual data-protection terms.
            </P>
          </Section>

          <Section title="How documents are protected">
            <P>
              Access is issued to a named individual and verified by their email address. It
              is not transferable, and a document opens only for the person it was issued
              to.
            </P>
            <P>
              Each copy carries the email address of the person it was issued to on every
              page, together with the date and time it was opened, so a copy that circulates
              can be identified. The watermark shows an email address rather than a name,
              and never an IP address.
            </P>
            <P>
              Downloading is permitted for subscribers and for approved Complimentary Review
              readers. A downloaded file keeps its watermark. The terms of use set out what
              you may then do with it, and passing it on is not among them.
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
              Reading, download and click records are kept while they remain useful for
              understanding how publications are used and for tracing a copy that has
              circulated. Sign-in security records are kept only as long as they are useful
              for slowing down repeated attempts.
            </P>
            <P>
              Ask us to remove your details and we will, except where we are required to
              keep a record.
            </P>
          </Section>

          <Section title="Times and dates">
            <P>
              We store every time in UTC and show it in West Africa Time (Africa/Lagos), so
              a time on a report means the same thing to everyone reading it.
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
              If we change how any of this works, we will change this page and the date at
              the top of it. Where a change materially affects subscribers, we will tell them
              by email rather than expect them to notice.
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
    <p className="text-sm text-foreground/80 leading-relaxed max-w-4xl">{children}</p>
  )
}

function Definition({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="border-l-2 border-border pl-5">
      <p className="text-xs font-medium uppercase tracking-wider text-accent mb-2">
        {term}
      </p>
      <p className="text-sm text-foreground/80 leading-relaxed max-w-4xl">{children}</p>
    </div>
  )
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3 text-sm text-foreground/80 leading-relaxed max-w-4xl">
      <span className="text-accent shrink-0">&mdash;</span>
      <span>{children}</span>
    </li>
  )
}
