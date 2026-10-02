import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { currentReviewReader } from "@/lib/review-reader"
import SiteHeader from "@/components/SiteHeader"
import ReaderSignInForm from "./sign-in-form"

export const dynamic = "force-dynamic"
export const metadata: Metadata = {
  title: "Review Library sign-in | APRI",
  robots: { index: false, follow: false },
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Sign-in for approved Complimentary Review readers -- separate from paid
 * subscriber sign-in. A visitor who is not yet approved is pointed to the
 * existing request process at /review.
 */
export default async function ReaderSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ edition?: string; reason?: string; signed_out?: string }>
}) {
  const { edition, reason, signed_out } = await searchParams
  const target = UUID.test(edition ?? "") ? edition! : null
  if (await currentReviewReader()) redirect(target ? `/review/library?edition=${target}` : "/review/library")
  const message = signed_out
    ? "You have signed out of the Review Library on this browser."
    : reason === "no_editions"
      ? "No Complimentary Review editions are assigned to that address at the moment."
      : reason === "code_only"
        ? "Sign-in now uses a code instead of a link. Enter your email below and we will send one."
        : null
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="max-w-md mx-auto px-4 sm:px-6 py-14 sm:py-20">
        <h1 className="font-serif text-3xl mb-4">Complimentary Review Library</h1>
        <p className="text-sm text-foreground/70 leading-relaxed mb-8">
          Approved readers: enter the email address your review publications were issued to. We will email
          you one code. Enter it here, and this browser opens your library, and every publication in it, for
          24 hours without another code.
        </p>
        {message && (
          <div className="border border-border bg-accent/5 p-5 mb-8" role="status">
            <p className="text-sm text-foreground/80 leading-relaxed">{message}</p>
          </div>
        )}
        <ReaderSignInForm edition={target} />
        <div className="mt-12 pt-8 border-t border-border">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Not yet approved for the Complimentary Review?{" "}
            <Link href="/review" className="text-accent hover:text-accent-hover">
              Request a complimentary review
            </Link>
            . Paid subscribers sign in at{" "}
            <Link href="/portal" className="text-accent hover:text-accent-hover">
              the subscriber library
            </Link>
            .
          </p>
        </div>
      </main>
    </div>
  )
}
