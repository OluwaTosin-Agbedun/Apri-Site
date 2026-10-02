import type { Metadata } from "next"
import Link from "next/link"
import SiteHeader from "@/components/SiteHeader"
import SubmitButton from "@/components/SubmitButton"
import { forgetReviewReader } from "@/app/actions/review-reader"
import { readRoomHint } from "@/lib/review-room-entry"
import { maskEmail } from "@/lib/review-email-attempts"
import OpenLibraryForm from "./open-library-form"

export const dynamic = "force-dynamic"
export const metadata: Metadata = {
  title: "Your Review Library | APRI",
  robots: { index: false, follow: false },
}

/**
 * Where a Complimentary Review card leads when this browser is not yet known:
 * the reader gives the address their editions were issued to, and an approved
 * address goes straight to its personal Papermark room. Papermark then emails
 * that address its one code.
 */
export default async function OpenReviewLibrary({
  searchParams,
}: {
  searchParams: Promise<{ not_approved?: string; preparing?: string; unavailable?: string; busy?: string }>
}) {
  const q = await searchParams
  const remembered = await readRoomHint()
  const notice = q.preparing
    ? "Your Review Library is being updated with your latest editions. Please try again in a minute."
    : q.unavailable
      ? "Your Review Library is not available just now. Please try again later, or reply to your review access email."
      : q.busy
        ? "Too many attempts from this network. Please try again later."
        : q.not_approved
          ? "No Complimentary Review editions are assigned to that address now."
          : null
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="max-w-md mx-auto px-4 sm:px-6 py-14 sm:py-20">
        <h1 className="font-serif text-3xl mb-4">Complimentary Review Library</h1>
        {notice && (
          <div className="border border-border bg-accent/5 p-5 mb-8" role="status">
            <p className="text-sm text-foreground/80 leading-relaxed">{notice}</p>
            {q.preparing && (
              <a href="/review/read" className="inline-block mt-3 text-sm text-accent underline">
                Try again
              </a>
            )}
          </div>
        )}
        <ol className="text-sm text-foreground/70 leading-relaxed mb-8 space-y-2 list-decimal pl-5">
          <li>Enter the email address your review editions were issued to.</li>
          <li>You continue to the secure viewer, hosted by Papermark. Papermark (not APRI) emails that address one verification code; copy it from that email and paste it into the Papermark screen.</li>
          <li>Your editions open. Opening another of your editions in the same session needs no new code.</li>
        </ol>
        <p className="text-xs text-muted-foreground leading-relaxed mb-8">
          The viewer&rsquo;s session lasts about a day on this browser. After that, or on another browser or device, it
          asks for a fresh code. Access is personal, confidential and not for redistribution.
        </p>
        {remembered && (
          <form action={forgetReviewReader} className="mb-6 text-xs text-muted-foreground">
            This browser opens the Review Library for {maskEmail(remembered)}.{" "}
            <SubmitButton busy="Forgetting…" className="underline text-accent inline-flex items-center gap-1">
              Not you? Use a different email
            </SubmitButton>
          </form>
        )}
        <OpenLibraryForm />
        <p className="text-sm text-muted-foreground leading-relaxed mt-12 pt-8 border-t border-border">
          Not yet approved?{" "}
          <Link href="/review" className="text-accent hover:text-accent-hover">
            Request a complimentary review
          </Link>
          . Requesting and confirming your email do not give access by themselves: APRI approves each reader.
        </p>
      </main>
    </div>
  )
}
