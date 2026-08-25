import Link from 'next/link'
import { SERVICES, type ServiceItem } from '@/data/services'
import { BRIEFING_FORM_URL } from '@/config'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'

export const metadata = {
  title: 'Services & Briefings · APRI',
  description:
    'Private political and regulatory intelligence briefings for boards, executives and strategy teams.',
}

/**
 * Where a briefing request button leads. Once the external Microsoft Forms or
 * Google Forms page is supplied in config, every button points there; until then
 * requests are captured by the built-in form, which asks for the same fields.
 */
function RequestLink({
  type,
  label,
  variant,
}: {
  type?: string
  label: string
  variant: 'primary' | 'quiet'
}) {
  const className =
    variant === 'primary'
      ? 'inline-flex items-center bg-foreground text-background px-8 py-3.5 text-sm font-medium tracking-wide hover:bg-foreground/90 transition-colors'
      : 'inline-flex items-center text-sm font-medium text-accent hover:text-accent-hover transition-colors'

  const arrow = (
    <span className="ml-2 opacity-70 group-hover:translate-x-1 transition-transform">
      &rarr;
    </span>
  )

  if (BRIEFING_FORM_URL) {
    return (
      <a href={BRIEFING_FORM_URL} target="_blank" rel="noreferrer" className={className}>
        {label}
        {variant === 'quiet' && arrow}
      </a>
    )
  }

  const href = type
    ? `/request-briefing?type=${encodeURIComponent(type)}`
    : '/request-briefing'

  return (
    <Link href={href} className={className}>
      {label}
      {variant === 'quiet' && arrow}
    </Link>
  )
}

function ServiceCard({ service, index }: { service: ServiceItem; index: number }) {
  return (
    <article className="group panel-interactive p-8 sm:p-10 lg:p-12">
      <div className="flex items-baseline gap-4 mb-3">
        <span className="text-xs text-accent tabular-nums">
          {String(index + 1).padStart(2, '0')}
        </span>
        <span className="text-xs font-medium uppercase tracking-wider text-accent">
          {service.kind}
        </span>
      </div>

      <h3 className="font-serif text-xl text-foreground mb-5">{service.title}</h3>

      <p className="text-sm text-foreground/60 leading-relaxed mb-5 max-w-2xl">
        {service.designedFor}
      </p>

      <p className="text-sm text-foreground/80 leading-relaxed mb-8 max-w-2xl">
        {service.body}
      </p>

      <div className="mb-8">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-4">
          {service.listLabel}
        </p>
        <ul className="space-y-2.5 text-sm text-foreground/80">
          {service.listItems.map((item) => (
            <li key={item} className="flex gap-3">
              <span className="text-accent">&mdash;</span>
              {item}
            </li>
          ))}
        </ul>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-[6rem_1fr] gap-x-6 gap-y-2 mb-8 text-xs leading-relaxed">
        <dt className="uppercase tracking-wider text-muted-foreground">Format</dt>
        <dd className="text-foreground/70">{service.format}</dd>
        <dt className="uppercase tracking-wider text-muted-foreground">Delivery</dt>
        <dd className="text-foreground/70">{service.delivery}</dd>
      </dl>

      <RequestLink type={service.briefingType} label={service.ctaLabel} variant="quiet" />
    </article>
  )
}

export default function ServicesPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <div className="max-w-5xl lg:max-w-6xl mx-auto px-6 py-20 sm:py-28">
        <header className="mb-24">
          <h1 className="font-serif text-4xl sm:text-5xl text-foreground mb-8 leading-[1.1] tracking-[-0.02em]">
            Services &amp; Briefings
          </h1>
          <p className="text-lg text-foreground/80 leading-relaxed mb-10 max-w-2xl">
            Private political and regulatory intelligence briefings for boards, executives
            and strategy teams.
          </p>

          <p className="text-sm text-foreground/70 leading-relaxed mb-6 max-w-2xl">
            APRI provides private briefings for organisations that need to interpret
            Nigeria&rsquo;s political, regulatory and political-economy environment in
            relation to strategy, enterprise risk, investment decisions, sector exposure or
            board oversight.
          </p>
          <p className="text-sm text-foreground/70 leading-relaxed mb-10 max-w-2xl">
            Briefings may be delivered virtually or in person, subject to scope, audience,
            location and availability.
          </p>

          <RequestLink label="Request a Briefing" variant="primary" />

          <div className="mt-10 pt-8 border-t border-border">
            <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
              APRI briefings are independent analytical sessions. They are not lobbying,
              political access brokerage, legal advice or investment advice.
            </p>
          </div>
        </header>

        <section className="mb-24">
          <div className="space-y-6">
            {SERVICES.map((service, index) => (
              <ServiceCard key={service.id} service={service} index={index} />
            ))}
          </div>
        </section>

        <section className="mb-24 pt-16 border-t border-border">
          <h2 className="font-serif text-xl text-foreground mb-6">Request a Briefing</h2>
          <p className="text-sm text-foreground/70 leading-relaxed mb-10 max-w-2xl">
            Tell us the type of briefing you require, your preferred format and timeline,
            and we will respond to discuss scope and availability.
          </p>
          <RequestLink label="Request a Briefing" variant="primary" />
        </section>

        <SiteFooter />
      </div>
    </div>
  )
}
