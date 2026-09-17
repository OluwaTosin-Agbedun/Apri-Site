import type { Metadata } from "next"
export const metadata: Metadata = {
  title: "Subscription request received | APRI",
  robots: { index: false, follow: false },
}
export default function Page() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-24 space-y-5">
      <h1 className="font-serif text-4xl">
        Thank you for your APRI subscription request.
      </h1>
      <p>
        We will send your subscription agreement and payment details shortly.
        Your secure subscriber access will be activated once the agreement has
        been completed and payment confirmed.
      </p>
      <a className="btn-secondary" href="/review/library">
        Return to the Review Library
      </a>
    </main>
  )
}
