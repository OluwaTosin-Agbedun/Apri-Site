import type { Metadata } from "next"
import SiteHeader from "@/components/SiteHeader"
import SiteFooter from "@/components/SiteFooter"
import ReviewForm from "./review-form"

export const metadata: Metadata = {
  title: "Complimentary Review | APRI",
  description: "Request complimentary access to selected APRI publications.",
}
export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const p = await searchParams,
    one = (k: string) => (typeof p[k] === "string" ? p[k].slice(0, 120) : "")
  const utm = {
    source: one("utm_source"),
    medium: one("utm_medium"),
    campaign: one("utm_campaign"),
    term: one("utm_term"),
    content: one("utm_content"),
  }
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="max-w-6xl mx-auto px-6 py-20 sm:py-28">
        <div className="grid lg:grid-cols-[1.1fr_.9fr] gap-16">
          <section>
            <p className="eyebrow mb-5">Complimentary Review</p>
            <h1 className="font-serif text-4xl sm:text-5xl leading-tight mb-7">
              Review Athena Political &amp; Regulatory Intelligence
            </h1>
            <p className="text-lg text-foreground/70 leading-relaxed">
              Complimentary access to selected APRI publications for
              professionals who want a clearer view of the political and
              regulatory signals shaping Nigeria.
            </p>
            <h2 className="font-serif text-2xl mt-12 mb-5">
              Selected review materials
            </h2>
            <ul className="space-y-4 text-foreground/80">
              <li>
                Nigeria Political &amp; Regulatory Environment — Monthly
                Intelligence Note
              </li>
              <li>Athena Intelligence Update</li>
              <li>Political Landscape Monitor</li>
            </ul>
          </section>
          <section className="border border-border bg-card/30 p-6 sm:p-9">
            <h2 className="font-serif text-2xl mb-7">
              Request Complimentary Review Access
            </h2>
            <ReviewForm utm={utm} />
          </section>
        </div>
      </main>
      <div className="max-w-6xl mx-auto px-6">
        <SiteFooter />
      </div>
    </div>
  )
}
