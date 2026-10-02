import type { Metadata } from "next"
import Link from "next/link"
import { cookies } from "next/headers"
import { READER_LINK_COOKIE, inspectReaderToken } from "@/lib/review-reader"
import { reviewLibraryContinueHere } from "@/app/actions/review-reader"
import SiteHeader from "@/components/SiteHeader"
import SubmitButton from "@/components/SubmitButton"

export const dynamic = "force-dynamic"
export const metadata: Metadata = {
  title: "Continue to the Review Library | APRI",
  robots: { index: false, follow: false },
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A Review Library link opened in a browser that did not ask for it. Nothing is spent by arriving. */
export default async function ReaderContinuePage({ searchParams }: { searchParams: Promise<{ edition?: string; retry?: string }> }) {
  const { edition, retry } = await searchParams
  const token = (await cookies()).get(READER_LINK_COOKIE)?.value ?? ""
  let usable = false
  try {
    usable = token ? (await inspectReaderToken(token, null)).usable : false
  } catch {
    usable = Boolean(token)
  }
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="max-w-md mx-auto px-6 py-20">
        <h1 className="font-serif text-3xl mb-4">{usable ? "Continue to your Review Library" : "This sign-in link has been used"}</h1>
        {usable ? (
          <>
            {retry && <p className="text-sm border border-border bg-accent/5 p-4 mb-6">Signing in could not be finished a moment ago. Your link still works: try again.</p>}
            <p className="text-sm text-foreground/70 leading-relaxed mb-6">
              This link was opened in a browser that did not ask for it &mdash; often the browser inside an email app.
            </p>
            <form action={reviewLibraryContinueHere} className="mb-10">
              {UUID.test(edition ?? "") && <input type="hidden" name="edition" value={edition} />}
              <SubmitButton busy="Opening…" className="w-full bg-foreground text-background px-6 py-4 text-base font-medium hover:bg-foreground/90 disabled:opacity-60 cursor-pointer">
                Continue on this browser
              </SubmitButton>
            </form>
            <p className="text-sm text-foreground/70 leading-relaxed border-t border-border pt-6">
              Usually read in another browser? Open the Review Library sign-in page there and enter your email address
              and the 8-digit code from the same email, so you stay signed in there.
            </p>
          </>
        ) : (
          <p className="text-sm text-foreground/70">
            <Link href="/review/library/sign-in" className="text-accent">Request a fresh sign-in email</Link>.
          </p>
        )}
      </main>
    </div>
  )
}
