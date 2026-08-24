import Link from 'next/link'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import BriefingForm from './briefing-form'

export const metadata = {
  title: 'Request a Briefing · APRI',
  description:
    'Request a private political and regulatory intelligence briefing from APRI.',
}

export default async function RequestBriefingPage({
  searchParams,
}: {
  // In Next 16 searchParams is a promise and must be awaited.
  searchParams: Promise<{ type?: string }>
}) {
  const { type } = await searchParams

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <div className="max-w-5xl lg:max-w-6xl mx-auto px-6 py-20 sm:py-28">
        <header className="mb-16">
          <h1 className="font-serif text-3xl sm:text-4xl text-foreground mb-6 leading-tight tracking-tight">
            Request a Briefing
          </h1>
          <p className="text-lg text-foreground/80 leading-relaxed mb-4 max-w-2xl">
            Tell us the type of briefing you require, your preferred format and timeline,
            and we will respond to discuss scope and availability.
          </p>
          {/*
            Said plainly, because the two forms ask for similar details and a
            visitor who fills in the wrong one waits for a reply about something
            they did not want.
          */}
          <p className="text-sm text-foreground/70 leading-relaxed mb-8 max-w-2xl">
            This is a <strong>briefing request</strong> &mdash; a commissioned engagement
            for your organisation, not a subscription. It does not include the
            intelligence library. For ongoing access to published editions, use{' '}
            <Link href="/access" className="text-accent hover:text-accent-hover transition-colors">
              Subscription Access
            </Link>
            .
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
            APRI briefings are independent analytical sessions. They are not lobbying,
            political access brokerage, legal advice or investment advice.
          </p>
        </header>

        <BriefingForm initialType={type} />

        <div className="mt-24">
          <SiteFooter />
        </div>
      </div>
    </div>
  )
}
