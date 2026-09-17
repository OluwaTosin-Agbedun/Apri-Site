import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { readReviewSession } from "@/lib/review-security"
import { getReviewLibrary } from "@/lib/publications"
import SiteHeader from "@/components/SiteHeader"
import { getSql } from "@/lib/db"
export const dynamic = "force-dynamic"
export const metadata: Metadata = {
  title: "Review Library | APRI",
  robots: { index: false, follow: false },
}
export default async function Library() {
  const id = await readReviewSession()
  if (!id) redirect("/review")
  const authorised = await getSql()`select 1 from review_prospects where id=${id}::uuid and verified_at is not null and access_sent_at is not null limit 1`
  if (!authorised[0]) redirect("/review")
  const library = await getReviewLibrary()
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="max-w-6xl mx-auto px-6 py-20">
        <h1 className="font-serif text-4xl mb-4">APRI Review Library</h1>
        <p className="text-foreground/70 mb-12">
          Personal, confidential access. Review materials are not for
          redistribution.
        </p>
        <div className="grid md:grid-cols-3 gap-6">
          {library?.items.map((c) => (
            <article
              key={c.slotKey}
              className="border border-border p-7 flex flex-col"
            >
              <p className="eyebrow">{c.publicationType}</p>
              <h2 className="font-serif text-xl mt-3">{c.pubTitle}</h2>
              <p className="text-sm text-foreground/70 my-5 flex-1">
                {c.description}
              </p>
              <a
                href={c.secureUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary"
              >
                Open secure publication
              </a>
            </article>
          ))}
        </div>
        <section className="mt-20 grid md:grid-cols-2 gap-6">
          <article className="border border-border p-8">
            <h2 className="font-serif text-2xl">
              Individual Access — ₦2 million annually
            </h2>
            <p className="my-5">1 named authorised subscriber.</p>
            <a
              className="btn-primary"
              href={`/review/subscribe?plan=Individual`}
            >
              Request Individual Access
            </a>
          </article>
          <article className="border border-border p-8">
            <h2 className="font-serif text-2xl">
              Professional Access — ₦5 million annually
            </h2>
            <p className="my-5">Up to 3 named authorised subscribers.</p>
            <a
              className="btn-primary"
              href={`/review/subscribe?plan=Professional`}
            >
              Request Professional Access
            </a>
          </article>
        </section>
      </main>
    </div>
  )
}
