import Link from "next/link"
import Image from "next/image"
import SiteHeader from "@/components/SiteHeader"
import SiteFooter from "@/components/SiteFooter"
import { CONTACT_EMAIL } from "@/config"
import { INSIGHT_STREAMS, OPEN_INSIGHTS } from "@/data/editorial"
import { publicMetadata } from "@/lib/seo"

export const metadata = publicMetadata("/open-insights")

export default function OpenInsightsPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className="max-w-6xl mx-auto px-5 sm:px-8 py-12 sm:py-16">
        <header className="max-w-3xl mb-10">
          <h1 className="font-serif text-4xl sm:text-5xl leading-tight">Open Insights</h1>
          <p className="mt-5 text-lg leading-relaxed text-foreground/80">Public research, analysis and perspectives from across the Athena ecosystem.</p>
          <p className="mt-3 text-base leading-relaxed text-foreground/80">Political Landscape Monitor and Election Matters are produced by the Athena Election Observatory. OsitaInsight videos are from ClearPath Media. Each publication retains its originating institution's identity.</p>
        </header>
        <nav aria-label="Insight streams" className="flex flex-wrap gap-x-6 gap-y-3 border-y border-border py-5 mb-8 text-base">
          {INSIGHT_STREAMS.map(stream => <Link key={stream.id} href={`#${stream.id}`} className="underline underline-offset-4">{stream.title}</Link>)}
        </nav>
        {INSIGHT_STREAMS.map(stream => {
          const items = OPEN_INSIGHTS.filter(item => item.approved && item.stream === stream.id)
          return (
            <section key={stream.id} id={stream.id} aria-labelledby={`${stream.id}-heading`} className="py-8 border-b border-border scroll-mt-28">
              <h2 id={`${stream.id}-heading`} className="font-serif text-3xl">{stream.title}</h2>
              <p className="mt-2 text-sm text-accent">{stream.attribution}</p>
              <p className="mt-4 text-base leading-relaxed max-w-3xl text-foreground/80">{stream.description}</p>
              {items.length > 0 && <div className="mt-7 grid sm:grid-cols-2 gap-8">
                {items.map(item => (
                  <article key={item.id}>
                    <Image src={item.visual.src} alt={item.visual.alt} width={640} height={400} className="w-full aspect-[8/5] object-cover" unoptimized />
                    <p className="mt-2 text-sm text-foreground/75">{item.visual.credit}</p>
                    <h3 className="mt-4 font-serif text-2xl"><a href={item.href} className="hover:underline underline-offset-4">{item.title}</a></h3>
                    <p className="mt-2 text-sm text-foreground/75"><time dateTime={item.date}>{item.date}</time> · {item.attribution}</p>
                    <p className="mt-3 text-base leading-relaxed text-foreground/80">{item.description}</p>
                    <a href={item.href} className="mt-4 inline-block text-base font-medium text-accent underline underline-offset-4">{stream.id === "ositainsight" ? "Watch analysis" : "Read the publication"}</a>
                  </article>
                ))}
              </div>}
            </section>
          )
        })}
        <p className="my-10 max-w-3xl text-base leading-relaxed text-foreground/80">For available public editions and publication enquiries, contact <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent">{CONTACT_EMAIL}</a>. Subscriber publications and confidential review copies remain in their <Link href="/publications" className="text-accent">separate publication library</Link>.</p>
        <SiteFooter />
      </main>
    </div>
  )
}
