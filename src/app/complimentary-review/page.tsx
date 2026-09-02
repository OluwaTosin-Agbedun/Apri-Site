import { notFound } from "next/navigation"
import SiteHeader from "@/components/SiteHeader"
import SiteFooter from "@/components/SiteFooter"
import { getSql } from "@/lib/db"

export const revalidate = 300

export const metadata = {
  title: "Complimentary Review Copy · APRI",
  robots: { index: false, follow: false },
}

type ReviewCard = {
  pubTitle: string
  publicationType: string
  description: string
  frequency: string
  audience: string
}

async function getReviewLibrary(): Promise<{
  enabled: boolean
  papermarkUrl: string
  items: ReviewCard[]
} | null> {
  try {
    const sql = getSql()

    const enabledRow = (await sql`
      select value from app_settings where key = 'review_library_enabled' limit 1
    `) as { value: string }[]

    if (enabledRow[0]?.value !== "true") return null

    const urlRow = (await sql`
      select value from app_settings where key = 'review_library_papermark_url' limit 1
    `) as { value: string }[]

    const papermarkUrl = urlRow[0]?.value ?? ""
    if (!papermarkUrl) return null

    const items = (await sql`
      select d.title as pub_title,
             ri.publication_type, ri.description, ri.frequency, ri.audience
      from complimentary_review_items ri
      join documents d on d.id = ri.publication_id
      where ri.is_active = true
      order by ri.display_order, ri.created_at
    `) as {
      pub_title: string
      publication_type: string
      description: string
      frequency: string
      audience: string
    }[]

    return {
      enabled: true,
      papermarkUrl,
      items: items.map((r) => ({
        pubTitle: r.pub_title,
        publicationType: r.publication_type,
        description: r.description,
        frequency: r.frequency,
        audience: r.audience,
      })),
    }
  } catch {
    return null
  }
}

export default async function ComplimentaryReviewPage() {
  const library = await getReviewLibrary()
  if (!library) notFound()

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <div className="max-w-5xl lg:max-w-6xl mx-auto px-6 py-20 sm:py-28">
        <header className="mb-16">
          <h1 className="font-serif text-4xl sm:text-5xl text-foreground mb-8 leading-[1.1] tracking-[-0.02em]">
            APRI Complimentary Review Copy
          </h1>
          <p className="text-lg sm:text-xl text-foreground/70 leading-relaxed max-w-4xl">
            This complimentary review page provides selected sample publications
            from Athena Political &amp; Regulatory Intelligence. It is intended
            to help prospective subscribers understand the structure, quality and
            range of APRI outputs. Access is restricted to authorised recipients
            and requires verified email access.
          </p>
          <div className="mt-6">
            <span className="inline-flex items-center px-2.5 py-1 text-xs font-medium tracking-wide bg-accent/10 text-accent">
              Complimentary Review Copy — verified email required
            </span>
          </div>
        </header>

        <div className="space-y-8">
          {library.items.map((card, i) => (
            <div
              key={i}
              className="border border-border bg-card/30 p-8 sm:p-10 lg:p-12"
            >
              <div className="flex items-start justify-between gap-4 mb-3">
                <span className="text-xs font-medium uppercase tracking-wider text-accent">
                  {card.publicationType}
                </span>
              </div>

              <h2 className="font-serif text-xl text-foreground">
                {card.pubTitle}
              </h2>

              <p className="text-sm text-foreground/70 leading-relaxed mt-4 max-w-4xl">
                {card.description}
              </p>

              <div className="mt-6 flex items-center gap-6 text-xs text-muted-foreground">
                <span>{card.frequency}</span>
                {card.audience && (
                  <>
                    <span className="text-border">|</span>
                    <span>{card.audience}</span>
                  </>
                )}
              </div>

              <a
                href={library.papermarkUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center bg-foreground text-background px-8 py-3.5 text-sm font-medium tracking-wide hover:bg-foreground/90 transition-colors mt-6"
              >
                Access review copy
              </a>
            </div>
          ))}

          {library.items.length === 0 && (
            <p className="text-sm text-foreground/70 leading-relaxed max-w-4xl">
              Review publications will appear here once configured.
            </p>
          )}
        </div>

        <div className="mt-16">
          <SiteFooter />
        </div>
      </div>
    </div>
  )
}
