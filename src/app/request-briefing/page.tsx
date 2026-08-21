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
          <p className="text-lg text-foreground/80 leading-relaxed mb-8 max-w-2xl">
            Tell us the type of briefing you require, your preferred format and timeline,
            and we will respond to discuss scope and availability.
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
