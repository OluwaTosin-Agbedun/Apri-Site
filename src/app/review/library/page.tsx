import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { currentReviewReader, recordReaderEvent } from "@/lib/review-reader"
import { getReviewLibraryForEmail } from "@/lib/publications"
import { reviewLibrarySignOut } from "@/app/actions/review-reader"
import SiteHeader from "@/components/SiteHeader"
import SubmitButton from "@/components/SubmitButton"

export const dynamic = "force-dynamic"
export const metadata: Metadata = {
  title: "Review Library | APRI",
  robots: { index: false, follow: false },
}

/**
 * The approved reader's Complimentary Review Library: all and only the
 * published editions assigned to the email this browser verified, decided
 * afresh on every visit. Each edition opens through /review/library/open/…,
 * which checks the assignment again, so no Papermark link is on this page.
 */
export default async function Library({ searchParams }: { searchParams: Promise<{ unavailable?: string }> }) {
  const reader = await currentReviewReader()
  if (!reader) redirect("/review/library/sign-in")
  const { unavailable } = await searchParams
  const editions = await getReviewLibraryForEmail(reader.email)
  await recordReaderEvent(reader.email, "library_opened")
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="max-w-6xl mx-auto px-6 py-20">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
          <h1 className="font-serif text-4xl">APRI Review Library</h1>
          <form action={reviewLibrarySignOut}>
            <SubmitButton busy="Signing out…" className="text-xs text-foreground/50 hover:text-foreground transition-colors cursor-pointer py-2 inline-flex items-center gap-2">
              Sign out
            </SubmitButton>
          </form>
        </div>
        <p className="text-foreground/70 mb-3">
          Personal, confidential access. Review materials are not for redistribution.
        </p>
        <p className="text-xs text-muted-foreground mb-12 max-w-2xl">
          You stay signed in to this library on this browser. Each edition opens in APRI&rsquo;s secure
          viewer, which confirms your email address with a code the first time you open that edition each day.
        </p>
        {unavailable && (
          <p className="text-sm border border-border bg-accent/5 p-4 mb-10 max-w-2xl" role="status">
            That edition is not available to your address. The editions available to you are listed below.
          </p>
        )}
        {editions.length === 0 && (
          <p className="text-sm text-foreground/70 mb-12 max-w-2xl">
            No review publications are available to your address at the moment. If you expected to see one here,
            reply to your review access email and we will look into it.
          </p>
        )}
        <div className="grid md:grid-cols-3 gap-6">
          {editions.map((c) => (
            <article key={c.id} className="border border-border p-7 flex flex-col">
              <p className="eyebrow">{c.publicationType}</p>
              <h2 className="font-serif text-xl mt-3">{c.pubTitle}</h2>
              {c.editionLabel && <p className="text-xs text-muted-foreground mt-2">{c.editionLabel}</p>}
              <p className="text-sm text-foreground/70 my-5 flex-1">{c.description}</p>
              <a href={`/review/library/open/${c.id}`} target="_blank" rel="noopener noreferrer" className="btn-primary">
                Open secure publication
              </a>
            </article>
          ))}
        </div>
        <section className="mt-20 grid md:grid-cols-2 gap-6">
          <article className="border border-border p-8">
            <h2 className="font-serif text-2xl">Individual Access — ₦2 million annually</h2>
            <p className="my-5">1 named authorised subscriber.</p>
            <Link className="btn-primary" href={`/review/subscribe?plan=Individual`}>
              Request Individual Access
            </Link>
          </article>
          <article className="border border-border p-8">
            <h2 className="font-serif text-2xl">Professional Access — ₦5 million annually</h2>
            <p className="my-5">Up to 3 named authorised subscribers.</p>
            <Link className="btn-primary" href={`/review/subscribe?plan=Professional`}>
              Request Professional Access
            </Link>
          </article>
        </section>
      </main>
    </div>
  )
}
