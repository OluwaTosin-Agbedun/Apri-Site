import type { Metadata } from "next"
import Link from "next/link"
import SiteHeader from "@/components/SiteHeader"
import ReadingLinkForm from "./reading-link-form"

export const dynamic = "force-dynamic"
export const metadata: Metadata = {
  title: "Your Review Library | APRI",
  robots: { index: false, follow: false },
}

/** For a browser APRI does not yet recognise: email the reader their personal link. */
export default async function ReadingLinkRequest({ searchParams }: { searchParams: Promise<{ unavailable?: string }> }) {
  const { unavailable } = await searchParams
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="max-w-md mx-auto px-6 py-20">
        <h1 className="font-serif text-3xl mb-4">Complimentary Review Library</h1>
        {unavailable && (
          <div className="border border-border bg-accent/5 p-5 mb-8" role="status">
            <p className="text-sm text-foreground/80 leading-relaxed">
              Your Review Library is not available on this link right now. Request a fresh link below; if it
              keeps happening, reply to your review access email.
            </p>
          </div>
        )}
        <p className="text-sm text-foreground/70 leading-relaxed mb-8">
          Approved readers: enter the email address your review editions were issued to and we will email your
          personal reading link. APRI&rsquo;s secure viewer then confirms your address with one code, which opens
          all your editions on that browser for about a day.
        </p>
        <ReadingLinkForm />
        <p className="text-sm text-muted-foreground leading-relaxed mt-12 pt-8 border-t border-border">
          Not yet approved?{" "}
          <Link href="/review" className="text-accent hover:text-accent-hover">Request a complimentary review</Link>.
        </p>
      </main>
    </div>
  )
}
