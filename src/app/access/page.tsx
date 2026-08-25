import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import AccessForm from '@/app/access-form'
import { accessNotice, BRIEFINGS_SEPARATE_NOTICE } from '@/lib/delivery'

export const metadata = {
  title: 'Subscription Access · APRI',
}

const SUBSCRIPTION_LEVELS = [
  {
    title: 'Individual Access',
    description:
      'Personal access to the APRI subscriber library, including all published intelligence notes, briefings and updates.',
  },
  {
    title: 'Professional Team Access',
    description:
      'Multi-user access for teams requiring shared access to APRI intelligence products, with dedicated account management.',
  },
  {
    title: 'Political Monitor',
    description:
      "Access to the Political Landscape Monitor and Athena Election Observatory assessments, covering Nigeria’s democratic, electoral and political landscape.",
  },
  {
    title: 'Executive Intelligence',
    description:
      'Comprehensive access to all APRI publications including the Monthly Intelligence Note, Quarterly Outlook and Intelligence Updates, with priority briefing requests.',
  },
  {
    title: 'Board Briefing',
    description:
      'The highest tier of APRI access, designed for boards and board risk committees, including all publications, priority access to bespoke briefings and direct engagement with the intelligence team.',
  },
]

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
    requested && SUBSCRIPTION_LEVELS.some((l) => l.title === requested)
      ? requested
      : ''

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <div className="max-w-5xl lg:max-w-6xl mx-auto px-6 py-20 sm:py-28">
        <header className="mb-16">
          <h1 className="font-serif text-3xl sm:text-4xl text-foreground mb-6 leading-tight tracking-tight">
            Subscription Access
          </h1>
          <p className="text-lg text-foreground/80 leading-relaxed max-w-2xl">
            Access to APRI intelligence products is available through tiered subscriptions
            designed for individuals, teams and organisations that require regular political
            and regulatory intelligence on Nigeria.
          </p>
        </header>

        <section className="mb-16">
          <h2 className="font-serif text-2xl text-foreground mb-8">Subscription Levels</h2>

          {/*
            Each block is the call to action for its own level. Someone who has
            read a tier and decided should be able to act on that tier, rather
            than scroll past the remaining four and then pick it again from a
            dropdown -- so the level travels with the click.
          */}
          <div className="space-y-6">
            {SUBSCRIPTION_LEVELS.map((level, index) => (
              <a
                key={level.title}
                href={`/access?level=${encodeURIComponent(level.title)}#subscribe`}
                className="group block border border-border p-8 sm:p-10 bg-card/30 hover:border-accent transition-colors"
              >
                <div className="flex items-baseline gap-4 mb-3">
                  <span className="text-xs text-accent tabular-nums">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <h3 className="font-serif text-xl text-foreground group-hover:text-accent transition-colors">
                    {level.title}
                  </h3>
                </div>
                <p className="text-sm text-foreground/70 leading-relaxed max-w-2xl ml-8">
                  {level.description}
                </p>
                <span className="inline-flex items-center text-sm font-medium text-accent mt-6 ml-8 group-hover:translate-x-1 transition-transform">
                  Subscribe to {level.title} &rarr;
                </span>
              </a>
            ))}
          </div>
        </section>

        <section id="subscribe" className="mb-16 pt-16 border-t border-border scroll-mt-24">
          <h2 className="font-serif text-2xl text-foreground mb-4">Request Access</h2>
          <p className="text-sm text-foreground/70 leading-relaxed mb-10 max-w-2xl">
            Submit your details below and a secure access link will be issued if approved.
          </p>

          <AccessForm defaultLevel={defaultLevel} />

          <div className="mt-10 pt-8 border-t border-border">
            <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
              <span className="font-medium text-foreground">Access note:</span>{' '}
              {accessNotice()}
            </p>
            <p className="mt-3 text-sm text-muted-foreground leading-relaxed max-w-2xl">
              {BRIEFINGS_SEPARATE_NOTICE}
            </p>
          </div>
        </section>

        <SiteFooter />
      </div>
    </div>
  )
}
