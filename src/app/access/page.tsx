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

export default function AccessPage() {
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
          <div className="space-y-6">
            {SUBSCRIPTION_LEVELS.map((level, index) => (
              <article
                key={level.title}
                className="border border-border p-8 sm:p-10 bg-card/30"
              >
                <div className="flex items-baseline gap-4 mb-3">
                  <span className="text-xs text-accent tabular-nums">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <h3 className="font-serif text-xl text-foreground">{level.title}</h3>
                </div>
                <p className="text-sm text-foreground/70 leading-relaxed max-w-2xl ml-8">
                  {level.description}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="mb-16 pt-16 border-t border-border">
          <h2 className="font-serif text-2xl text-foreground mb-4">Request Access</h2>
          <p className="text-sm text-foreground/70 leading-relaxed mb-10 max-w-2xl">
            Submit your details below and a secure access link will be issued if approved.
          </p>

          <AccessForm />

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
