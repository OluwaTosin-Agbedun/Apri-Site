import type { Metadata } from "next"
import SiteHeader from "@/components/SiteHeader"
export const metadata: Metadata = {
  title: "Subscription request received | APRI",
  robots: { index: false, follow: false },
}
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>
}) {
  // A request from the public Subscription Access page has no Review Library
  // to return to, and its address still has to be confirmed.
  const fromAccess = (await searchParams).from === "access"
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="max-w-3xl mx-auto px-6 py-24 space-y-5">
        <h1 className="font-serif text-4xl">
          Thank you for your APRI subscription request.
        </h1>
        <p>
          We will send your subscription agreement and payment details shortly.
          Your secure subscriber access will be activated once the agreement has
          been completed and payment confirmed.
        </p>
        {fromAccess && (
          <p className="text-sm text-foreground/70">
            If your email address still needs confirming, we have sent you a
            link to do so. Please open it so we can prepare your agreement.
          </p>
        )}
        {fromAccess ? (
          <a className="btn-secondary" href="/access">
            Return to Subscription Access
          </a>
        ) : (
          <a className="btn-secondary" href="/review/library">
            Return to the Review Library
          </a>
        )}
      </main>
    </div>
  )
}
