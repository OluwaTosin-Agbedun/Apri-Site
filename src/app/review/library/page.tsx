import { currentBrandCopy } from "@/lib/brand"
import type { Metadata } from "next"
import AccessJobRefresh from "@/components/AccessJobRefresh"
import { readerRoomJob, kickReviewRoomWorker } from "@/lib/review-room-jobs"
import Link from "next/link"
import { redirect } from "next/navigation"
import { currentReviewReader, recordReaderEvent } from "@/lib/review-reader"
import { getReviewLibraryForEmail } from "@/lib/publications"
import { openWindowReady } from "@/lib/review-reader-rooms"
import { reviewLibrarySignOut } from "@/app/actions/review-reader"
import SiteHeader from "@/components/SiteHeader"
import SubmitButton from "@/components/SubmitButton"
import { categorySingularLabel } from "@/lib/publication-catalogue"
import { getPublicationCatalogue } from "@/lib/publication-catalogue-dal"
import {publicationVersions,latestEntitledVersions,familyHistory} from '@/lib/publication-versions'

export const dynamic = "force-dynamic"
export const maxDuration = 60
export const metadata: Metadata = {
  title: "Review Library | Athena Strategic Advisory",
  robots: { index: false, follow: false },
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const lagos = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
const editionDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "long", year: "numeric" }) : null

const NOTICE: Record<string, string> = {
  unavailable: "That edition is not available to your address. The editions available to you are listed below.",
  preparing: "Your copy is being prepared. Please press Read again in a minute.",
  busy: "Too many publications were opened from this network in the last hour. Please try again later.",
  repair: "That edition could not be opened just now. This is a problem on Athena Strategic Advisory's side, not with your address, and it is recorded for Athena Strategic Advisory to repair. Please try again later.",
}

/**
 * The approved reader's Complimentary Review Library: all and only the
 * published editions assigned to the email this browser verified with Athena Strategic Advisory's
 * code, decided afresh on every visit. Each Read goes through
 * /review/library/open/…, which checks the assignment again; no Papermark
 * address is ever on this page.
 */
export default async function Library({
  searchParams,
}: {
  searchParams: Promise<{ edition?: string; unavailable?: string; preparing?: string; repair?: string; busy?: string }>
}) {
  const params = await searchParams
  const chosen = UUID.test(params.edition ?? "") ? params.edition! : null
  const reader = await currentReviewReader()
  if (!reader) redirect(chosen ? `/review/library/sign-in?edition=${chosen}` : "/review/library/sign-in")
  const job = await readerRoomJob(reader.email)
  const waiting = Boolean(job && ["pending", "running"].includes(job.state))
  if (waiting) kickReviewRoomWorker(reader.email)
  const allEditions = await getReviewLibraryForEmail(reader.email)
  const versions=await publicationVersions('review',allEditions.map(e=>e.id))
  const editions = latestEntitledVersions(allEditions,e=>e.id,versions)
  // Labels only: which editions are listed is decided above, by assignment.
  const { categories } = await getPublicationCatalogue()
  const direct = Boolean(reader.sid) && (await openWindowReady())
  const notice = params.unavailable
    ? NOTICE.unavailable
    : params.preparing
      ? NOTICE.preparing
      : params.repair
        ? NOTICE.repair
        : params.busy
          ? NOTICE.busy
          : null
  await recordReaderEvent(reader.email, "library_opened")
  return (
    <div className="min-h-screen">
      <AccessJobRefresh active={waiting} />
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className="max-w-5xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
        <header className="mb-10 sm:mb-12">
          <p className="eyebrow">Complimentary Review</p>
          <div className="flex flex-wrap items-end justify-between gap-4 mt-3">
            <h1 className="font-serif text-3xl sm:text-4xl">Your review publications</h1>
            <form action={reviewLibrarySignOut}>
              <SubmitButton busy="Signing out…" className="text-xs text-foreground/60 hover:text-foreground transition-colors cursor-pointer py-2 inline-flex items-center gap-2">
                Sign out
              </SubmitButton>
            </form>
          </div>
          <p className="text-sm text-foreground/70 mt-4 max-w-2xl leading-relaxed">
            Signed in as <span className="text-foreground break-all">{reader.email}</span>
            {reader.until ? <> until {lagos(reader.until)} (Lagos time) on this browser.</> : <> on this browser.</>} Personal and
            confidential: not for redistribution.
          </p>
        </header>

        {notice && (
          <div className="text-sm border border-border p-4 mb-8 max-w-2xl" role="status">
            <p>{notice}</p>
            {params.repair && chosen && editions.some((e) => e.id === chosen) && (
              <a href={`/review/library/open/${chosen}?via=edition`} target="_blank" rel="noopener noreferrer" className="inline-block mt-3 text-accent hover:text-accent-hover">
                Open it with a Papermark code instead
              </a>
            )}
          </div>
        )}

        {editions.length === 0 ? (
          <p className="text-sm text-foreground/70 mb-12 max-w-2xl">
            No review publications are assigned to your address at the moment. If you expected one here, reply to your
            review access email and we will look into it.
          </p>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {editions.map((c) => {
              const date = editionDate(c.editionDate)
              return (
                <li key={c.id} className={`py-7 sm:py-8 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center ${c.id === chosen ? "bg-accent/5 -mx-4 px-4 sm:-mx-6 sm:px-6" : ""}`}>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-accent">
                      {c.slotKey ? categorySingularLabel(c.slotKey, categories) : c.publicationType}
                    </p>
                    <h2 className="font-serif text-xl sm:text-2xl mt-2">{c.pubTitle}</h2>
                    <p className="text-xs text-muted-foreground mt-1">
                      {[c.editionLabel, date].filter(Boolean).join(" · ")}
                    </p>
                    {c.description && <p className="text-sm text-foreground/75 mt-3 max-w-2xl leading-relaxed">{currentBrandCopy(c.description)}</p>}
                    {versions.has(c.id)&&<p className="text-xs mt-2 text-muted-foreground">Version {versions.get(c.id)!.label}</p>}
                    {familyHistory(allEditions,e=>e.id,c.id,versions).length>1&&<details className="mt-4 text-sm"><summary className="cursor-pointer">Earlier versions</summary><ul className="mt-3 space-y-3">{familyHistory(allEditions,e=>e.id,c.id,versions).filter(e=>e.id!==c.id).map(e=><li key={e.id}>{versions.get(e.id)?.noticeReady?<a className="underline" href={`/review/library/open/${e.id}?history=1`} target="_blank" rel="noopener noreferrer">{e.pubTitle} · {versions.get(e.id)?.label} · Superseded</a>:<span>{e.pubTitle} · Earlier protected copy being prepared</span>}</li>)}</ul></details>}
                  </div>
                  <a
                    href={`/review/library/open/${c.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-primary justify-center w-full sm:w-auto"
                  >
                    Read &amp; download
                  </a>
                </li>
              )
            })}
          </ul>
        )}

        <p className="text-xs text-muted-foreground mt-6 max-w-2xl leading-relaxed">
          {direct
            ? "Each publication opens in Athena Strategic Advisory's secure viewer, hosted by Papermark. The first time you open one on this browser each day, the viewer asks you to confirm your email address; no further code is needed. Use Download in the viewer to save your personally watermarked copy. Copies remain confidential and must not be redistributed."
            : "Each publication opens in Athena Strategic Advisory's secure viewer, hosted by Papermark, which asks for a code the first time you open each publication on this browser each day. Use Download in the viewer once Athena Strategic Advisory has enabled it for that edition. Copies carry your personal watermark and must not be redistributed."}
        </p>

        <section className="mt-16 sm:mt-20 grid md:grid-cols-2 gap-6">
          <article className="border border-border p-6 sm:p-8">
            <h2 className="font-serif text-2xl">Individual Access</h2>
            <p className="my-5">1 named authorised subscriber.</p>
            <Link className="btn-primary" href={`/review/subscribe?plan=Individual`}>
              Request Individual Access
            </Link>
          </article>
          <article className="border border-border p-6 sm:p-8">
            <h2 className="font-serif text-2xl">Professional Access</h2>
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
