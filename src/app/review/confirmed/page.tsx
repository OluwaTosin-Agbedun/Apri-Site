import type { Metadata } from "next"
import SiteHeader from "@/components/SiteHeader"
export const metadata: Metadata = {
  title: "Email confirmation | APRI",
  robots: { index: false, follow: false },
}
export default async function Confirmed({
  searchParams,
}: {
  searchParams: Promise<{ result?: string }>
}) {
  const ok = (await searchParams).result === "confirmed"
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="max-w-3xl mx-auto px-6 py-24">
        {ok ? (
          <div className="space-y-5">
            <h1 className="font-serif text-4xl">
              Your email has been confirmed.
            </h1>
            <p>
              Thank you for your interest in Athena Political &amp; Regulatory
              Intelligence.
            </p>
            <p>
              We are preparing your complimentary review access. You will
              receive a separate email shortly with a secure link to the APRI
              Review Library.
            </p>
            <p>
              Access is personal to the email address you submitted and the
              review materials are provided on a confidential,
              non-redistribution basis.
            </p>
            <p>Please look out for an email from APRI.</p>
          </div>
        ) : (
          <div>
            <h1 className="font-serif text-4xl mb-6">
              This confirmation link is unavailable.
            </h1>
            <p className="text-foreground/70">
              It may have expired or already been used. Return to the review
              request page to request a fresh confirmation email. For your
              security, we cannot confirm whether an address exists.
            </p>
            <a className="btn-primary mt-8" href="/review">
              Return to review request
            </a>
          </div>
        )}
      </main>
    </div>
  )
}
