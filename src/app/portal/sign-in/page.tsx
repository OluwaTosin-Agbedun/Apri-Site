import Link from "next/link"
import { redirect } from "next/navigation"
import { getCurrentSubscriber } from "@/lib/subscriber-dal"
import SiteFooter from "@/components/SiteFooter"
import SignInForm from "./sign-in-form"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Subscriber Sign In · APRI",
  // Never index a sign-in page for a confidential service.
  robots: { index: false, follow: false },
}

export default async function SignInPage({
  searchParams,
  // Next 16: searchParams is a promise.
}: {
  searchParams: Promise<{ expired?: string; reason?: string }>
}) {
  // Already signed in: go straight to the library rather than asking again.
  const subscriber = await getCurrentSubscriber()
  if (subscriber) redirect("/portal")

  const { expired, reason } = await searchParams
  const message =
    reason === "used"
      ? "That sign-in link has already been used. Request a fresh link below."
      : reason === "expired"
        ? "That sign-in link has expired. Links expire after 15 minutes; request a fresh one below."
        : reason === "inactive"
          ? "This APRI account is not active. Contact APRI if you believe this is incorrect."
          : reason === "subscription-expired"
            ? "This subscription has expired. Contact APRI to renew access."
            : "That sign-in link is invalid. Request a fresh link below."

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border">
        <div className="max-w-md mx-auto px-6 h-20 flex items-center">
          <Link href="/" className="group">
            <span className="font-serif text-base text-foreground tracking-tight">
              APRI
            </span>
            <span className="hidden sm:inline text-xs text-muted-foreground ml-3 pl-3 border-l border-border">
              Athena Political &amp; Regulatory Intelligence
            </span>
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-md w-full mx-auto px-6 py-16">
        <h1 className="font-serif text-2xl sm:text-3xl text-foreground mb-4 leading-tight tracking-tight">
          Sign in
        </h1>
        <p className="text-sm text-foreground/70 leading-relaxed mb-8">
          Enter the email address on your subscription.
        </p>

        {(expired || reason) && (
          <div className="border border-border bg-accent/5 p-5 mb-8">
            <p className="text-sm text-foreground/80 leading-relaxed">
              {message}
            </p>
          </div>
        )}

        <SignInForm />

        <div className="mt-12 pt-8 border-t border-border">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Not yet a subscriber?{" "}
            <Link
              href="/access"
              className="text-accent hover:text-accent-hover transition-colors"
            >
              Request access
            </Link>
            .
          </p>
        </div>
      </main>

      <div className="max-w-md w-full mx-auto px-6 pb-10">
        <SiteFooter />
      </div>
    </div>
  )
}
