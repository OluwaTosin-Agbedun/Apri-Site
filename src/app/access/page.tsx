import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import AccessForm from '@/app/access-form'
import { accessNotice, BRIEFINGS_SEPARATE_NOTICE } from '@/lib/delivery'
import { TIER_DESCRIPTIONS, tierDisplayName } from '@/lib/entitlements'

export const metadata = {
  title: 'Subscription Access · APRI',
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
const SUBSCRIPTION_LEVELS = [
  'Individual Access',
  'Professional Team Access',
  'Political Monitor',
  'Executive Intelligence',
  'Board Briefing',
] as const

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
}: {
  // Next 16: searchParams is a promise.
  searchParams: Promise<{ level?: string | string[] }>
}) {
  const params = await searchParams
  const requested = Array.isArray(params.level) ? params.level[0] : params.level
  const defaultLevel =
    requested && SUBSCRIPTION_LEVELS.some((l) => tierDisplayName(l) === requested || l === requested)
      ? requested
      : ''

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <div className="max-w-5xl lg:max-w-6xl mx-auto px-6 py-20 sm:py-28">
        <header className="mb-16">
          <h1 className="font-serif text-4xl sm:text-5xl text-foreground mb-8 leading-[1.1] tracking-[-0.02em]">
            Subscription Access
          </h1>
          <p className="text-lg sm:text-xl text-foreground/70 leading-relaxed max-w-4xl">
            Access to APRI intelligence products is available through tiered subscriptions
            designed for individuals, teams and organisations that require regular political
            and regulatory intelligence on Nigeria.
          </p>
        </header>

        <section className="mb-16">
          <h2 className="font-serif text-2xl sm:text-3xl text-foreground section-head mb-10 tracking-tight">Subscription Levels</h2>

          {/*
            Each block is the call to action for its own level. Someone who has
            read a tier and decided should be able to act on that tier, rather
            than scroll past the remaining four and then pick it again from a
            dropdown -- so the level travels with the click.
          */}
          <div className="space-y-6">
            {SUBSCRIPTION_LEVELS.map((storedName, index) => {
              const displayName = tierDisplayName(storedName)
              return (
                <a
                  key={storedName}
                  href={`/access?level=${encodeURIComponent(storedName)}#subscribe`}
                  className="group panel-interactive block p-8 sm:p-10 lg:p-12"
                >
                  <div className="flex items-baseline gap-4 mb-3">
                    <span className="text-xs text-accent tabular-nums">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <h3 className="font-serif text-xl text-foreground group-hover:text-accent transition-colors">
                      {displayName}
                    </h3>
                  </div>
                  <p className="text-sm text-foreground/70 leading-relaxed max-w-4xl ml-8">
                    {TIER_DESCRIPTIONS[storedName] ?? ''}
                  </p>
                  <span className="inline-flex items-center text-sm font-medium text-accent mt-6 ml-8 group-hover:translate-x-1 transition-transform">
                    Request Access &rarr;
                  </span>
                </a>
              )
            })}
          </div>
        </section>

        <section id="subscribe" className="mb-16 pt-16 border-t border-border scroll-mt-24">
          <h2 className="font-serif text-2xl sm:text-3xl text-foreground section-head mb-8 tracking-tight">Request Access</h2>
          <p className="text-base text-foreground/70 leading-relaxed mb-10 max-w-4xl">
            Send us your details below. If we can help, we will reply within one business day
            to agree terms and issue your access.
          </p>

          <AccessForm defaultLevel={defaultLevel} />

          <div className="mt-10 pt-8 border-t border-border">
            <p className="text-sm text-muted-foreground leading-relaxed max-w-4xl">
              <span className="font-medium text-foreground">Access note:</span>{' '}
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
