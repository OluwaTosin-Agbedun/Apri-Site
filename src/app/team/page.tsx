import type { Metadata } from "next"
import SiteFooter from "@/components/SiteFooter"
import SiteHeader from "@/components/SiteHeader"
import { TEAM_MEMBERS } from "@/data/team"
import { getTeamImages } from "@/lib/team-images"

export const metadata: Metadata = {
  title:
    "Our Intelligence Team | Athena Political & Regulatory Intelligence (APRI)",
  description:
    "Meet the people behind APRI and learn how our independent political, regulatory and political-economy intelligence is produced and reviewed.",
}

export default async function TeamPage() {
  const images = await getTeamImages()
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="max-w-5xl lg:max-w-6xl mx-auto px-6 py-20 sm:py-28">
        <header className="mb-20 max-w-4xl">
          <p className="eyebrow mb-5">Our Intelligence Team</p>
          <h1 className="font-serif text-4xl sm:text-5xl text-foreground mb-8 leading-[1.1] tracking-[-0.02em] break-words">
            The People Behind the Intelligence
          </h1>
          <div className="space-y-5 text-base sm:text-lg text-foreground/70 leading-relaxed">
            <p>
              Athena Political &amp; Regulatory Intelligence brings together
              practitioners, political scientists, economists, governance
              researchers and election analysts with experience across
              government, public policy, institutional reform, elections,
              academia and research.
            </p>
            <p>
              Our intelligence is produced through continuous monitoring,
              structured analysis and internal review, drawing on the wider
              research and policy capabilities of the Athena Centre for Policy
              and Leadership.
            </p>
          </div>
        </header>

        <section aria-labelledby="team-members" className="mb-24">
          <h2 id="team-members" className="sr-only">
            Intelligence team members
          </h2>
          <div className="divide-y divide-border border-y border-border">
            {TEAM_MEMBERS.map((member) => {
              const image = images.get(member.key)
              const initials = member.name
                .split(/\s+/)
                .slice(0, 2)
                .map((part) => part[0])
                .join("")
              return (
                <article
                  key={member.key}
                  className="py-10 sm:py-14 grid sm:grid-cols-[180px_1fr] lg:grid-cols-[220px_1fr] gap-8 sm:gap-10"
                >
                  {image ? (
                    <img
                      src={image.imageUrl}
                      alt={image.altText}
                      width="440"
                      height="550"
                      loading="lazy"
                      className="aspect-[4/5] w-full object-cover bg-foreground/5"
                    />
                  ) : (
                    <div
                      className="aspect-[4/5] w-full bg-foreground/5 border border-border grid place-items-center font-serif text-3xl text-foreground/50"
                      aria-label={`No portrait supplied for ${member.name}`}
                    >
                      <span aria-hidden>{initials}</span>
                    </div>
                  )}
                  <div>
                    <h3 className="font-serif text-2xl sm:text-3xl text-foreground mb-5 break-words">
                      {member.name}
                    </h3>
                    <p className="text-sm font-medium text-accent leading-relaxed mb-1">
                      {member.apriRole}
                    </p>
                    <p className="text-sm text-muted-foreground leading-relaxed mb-7">
                      {member.athenaRole}
                    </p>
                    <div className="space-y-4 text-sm sm:text-base text-foreground/80 leading-relaxed">
                      {member.biography.map((paragraph) => (
                        <p key={paragraph}>{paragraph}</p>
                      ))}
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        </section>

        <section
          id="analytical-approach"
          className="scroll-mt-28 mb-20 pt-16 border-t border-border max-w-4xl"
        >
          <h2 className="font-serif text-2xl sm:text-3xl text-foreground section-head mb-8 tracking-tight">
            Our Analytical Approach
          </h2>
          <div className="space-y-5 text-sm sm:text-base text-foreground/80 leading-relaxed">
            <p>
              APRI combines continuous monitoring of political, electoral,
              regulatory and policy developments with structured analysis of
              official records, regulatory publications, electoral data, public
              statements, credible media reporting and consultations with
              informed stakeholders.
            </p>
            <p>
              Our analysts distinguish between verified developments, analytical
              judgements and forward-looking assessments. Intelligence products
              are subject to internal research and editorial review before
              publication.
            </p>
            <p>
              APRI is a subscription-based intelligence service. Subscribers
              receive access to our intelligence and briefings but do not
              determine our analytical conclusions or editorial judgements.
            </p>
            <p>
              APRI does not provide lobbying, political access brokerage, legal
              advice or investment advice.
            </p>
          </div>
        </section>

        <section className="mb-24 pt-16 border-t border-border max-w-4xl">
          <h2 className="font-serif text-2xl sm:text-3xl text-foreground section-head mb-8 tracking-tight">
            Institutional Foundation
          </h2>
          <p className="text-sm sm:text-base text-foreground/80 leading-relaxed mb-7">
            Athena Political &amp; Regulatory Intelligence is an intelligence
            service of the Athena Centre for Policy and Leadership, drawing on
            the Centre&rsquo;s wider work in governance, elections, public
            policy, institutional reform and political analysis.
          </p>
          <div className="flex flex-col gap-3 text-sm">
            <p>
              <span className="text-muted-foreground mr-2">APRI:</span>
              <a
                className="text-accent hover:text-accent-hover underline-offset-4 hover:underline"
                href="https://apri.athenacentre.org/"
              >
                apri.athenacentre.org
              </a>
            </p>
            <p>
              <span className="text-muted-foreground mr-2">Athena Centre:</span>
              <a
                className="text-accent hover:text-accent-hover underline-offset-4 hover:underline"
                href="https://www.athenacentre.org/"
              >
                www.athenacentre.org
              </a>
            </p>
          </div>
        </section>
        <SiteFooter />
      </main>
    </div>
  )
}
