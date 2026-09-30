import SiteHeader from "@/components/SiteHeader"
import SiteFooter from "@/components/SiteFooter"
import AccessForm from "@/app/access-form"
import { accessNotice, BRIEFINGS_SEPARATE_NOTICE } from "@/lib/delivery"
import { TIER_DESCRIPTIONS, tierDisplayName } from "@/lib/entitlements"
import { SUBSCRIPTION_CATALOGUE } from "@/lib/subscription-catalogue"

export const metadata = {
  title:
    "Subscription Access | Athena Political & Regulatory Intelligence (APRI)",
  description:
    "Subscription levels for APRI political, regulatory and political-economy intelligence, including the quarterly Subscriber Intelligence Briefing.",
}

/**
 * The five public tier names and their descriptions.
 *
 * Rewritten as complete sentences. Each was previously a noun phrase -- "Personal
 * access to the library, including all published notes" -- which reads as a
 * caption in a brochure rather than as something written for the reader.
 *
 * One was also wrong. Professional Team Access said "shared access", which
 * describes an arrangement this service does not offer: every seat is a named
 * person with their own sign-in and their own individually identified copy. A
 * buyer who read that would have expected one login to pass around.
 */
const SUBSCRIPTION_LEVELS = SUBSCRIPTION_CATALOGUE
// Compatible stored names include "Political Monitor", "Executive Intelligence", "Board Briefing".

/**
 * Read on the server and passed to the form as a prop, rather than read in the
 * browser with useSearchParams. That keeps the form free of a hook that would
 * need a Suspense boundary, and means the right level is selected in the first
 * paint rather than after a hydration pass.
 *
 * Validated against the five names: anything else is ignored, so a crafted
 * query string cannot inject an option into the form.
 */
export default async function AccessPage({
  searchParams,
  // Next 16: searchParams is a promise.
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const requested = Array.isArray(params.level) ? params.level[0] : params.level
  // Campaign attribution travels with the plan buttons into the form below,
  // and from there into the request.
  const utm = Object.fromEntries(
    ["source", "medium", "campaign", "term", "content"].map((k) => {
      const raw = params[`utm_${k}`]
      return [k, ((Array.isArray(raw) ? raw[0] : raw) ?? "").slice(0, 120)]
    }),
  )
  const utmQuery = Object.entries(utm)
    .map(([k, v]) => (v ? `&utm_${k}=${encodeURIComponent(v)}` : ""))
    .join("")
  const defaultLevel =
    requested &&
    SUBSCRIPTION_LEVELS.some(
      (l) => l.name === requested || l.storedName === requested,
    )
      ? requested
      : ""

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <div className="max-w-5xl lg:max-w-6xl mx-auto px-6 py-20 sm:py-28">
        <header className="mb-16">
          <h1 className="font-serif text-4xl sm:text-5xl text-foreground mb-8 leading-[1.1] tracking-[-0.02em]">
            Subscription Access
          </h1>
          <p className="text-lg sm:text-xl text-foreground/70 leading-relaxed max-w-4xl">
            Access to APRI intelligence products is available through tiered
            subscriptions designed for individuals, teams and organisations that
            require regular political and regulatory intelligence on Nigeria.
          </p>
        </header>

        <section id="plans" className="mb-16 scroll-mt-24">
          <h2 className="font-serif text-2xl sm:text-3xl text-foreground section-head mb-10 tracking-tight">
            Subscription levels
          </h2>

          {/*
            Each block is the call to action for its own level. Someone who has
            read a tier and decided should be able to act on that tier, rather
            than scroll past the remaining four and then pick it again from a
            dropdown -- so the level travels with the click.
          */}
          <div className="space-y-6">
            {SUBSCRIPTION_LEVELS.map((offering, index) => {
              const storedName = offering.storedName
              const displayName = tierDisplayName(storedName)
              return (
                <a
                  key={storedName}
                  href={`/access?level=${encodeURIComponent(storedName)}${utmQuery}#subscribe`}
                  className="group panel-interactive block p-8 sm:p-10 lg:p-12"
                >
                  <div className="flex items-baseline gap-4 mb-3">
                    <span className="text-xs text-accent tabular-nums">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <h3 className="font-serif text-xl text-foreground group-hover:text-accent transition-colors">
                      {displayName}
                    </h3>
                  </div>
                  <p className="text-sm text-foreground/70 leading-relaxed max-w-4xl ml-8">
                    {TIER_DESCRIPTIONS[storedName] ?? ""}
                  </p>
                  {offering.price && <p className="mt-3 text-sm text-foreground ml-8">{offering.price} · {offering.seats === 1 ? "One named authorised subscriber" : `Up to ${offering.seats} named authorised subscribers`}</p>}
                  <span className="inline-flex items-center text-sm font-medium text-accent mt-6 ml-8 group-hover:translate-x-1 transition-transform">
                    Request Access &rarr;
                  </span>
                </a>
              )
            })}
          </div>
          <p className="mt-6 text-sm text-muted-foreground leading-relaxed max-w-4xl">Each named subscriber receives their own secure sign-in. Individual and Professional access activates only after the agreement is signed and manual payment is confirmed.</p>
          <p className="mt-2 text-sm text-muted-foreground">Already a subscriber? <a className="text-accent" href="/portal/sign-in">Sign in to your library</a>.</p>
        </section>

        <section className="mb-16 border border-border bg-card/30 p-8 sm:p-10 lg:p-12">
          <p className="eyebrow mb-4">Included for subscribers</p>
          <h2 className="font-serif text-2xl sm:text-3xl text-foreground mb-6 tracking-tight">
            Quarterly Subscriber Intelligence Briefing
          </h2>
          <p className="text-base text-foreground/70 leading-relaxed max-w-4xl">
            APRI subscribers are invited to a quarterly virtual briefing on the
            political and regulatory outlook, with an opportunity to engage the
            intelligence team in Q&amp;A. Private or bespoke institutional
            briefings may be arranged separately.
          </p>
        </section>

        <section
          id="subscribe"
          className="mb-16 pt-16 border-t border-border scroll-mt-24"
        >
          <h2 className="font-serif text-2xl sm:text-3xl text-foreground section-head mb-8 tracking-tight">
            Request Access
          </h2>
          <p className="text-base text-foreground/70 leading-relaxed mb-10 max-w-4xl">
            Send us your details below. If we can help, we will reply within one
            business day to agree terms and issue your access.
          </p>

          <AccessForm defaultLevel={defaultLevel} utm={utm} />

          <div className="mt-10 pt-8 border-t border-border">
            <p className="text-sm text-muted-foreground leading-relaxed max-w-4xl">
              <span className="font-medium text-foreground">Access note:</span>{" "}
              {accessNotice()}
            </p>
            <p className="mt-3 text-sm text-muted-foreground leading-relaxed max-w-4xl">
              {BRIEFINGS_SEPARATE_NOTICE}
            </p>
          </div>
        </section>

        <SiteFooter />
      </div>
    </div>
  )
}
