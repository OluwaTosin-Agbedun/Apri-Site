import Link from "next/link"
import { cookies } from "next/headers"
import { inspectToken } from "@/lib/magic-link"
import { LINK_COOKIE } from "@/lib/sign-in-cookies"
import { continueSignInHere } from "@/app/actions/subscriber-auth"
import SubmitButton from "@/components/SubmitButton"
import SiteFooter from "@/components/SiteFooter"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Continue to your library · APRI",
  robots: { index: false, follow: false },
}

/**
 * Where a sign-in link lands when it is opened in a browser that did not ask
 * for it: most often the browser built into an email app, or a mail scanner.
 *
 * Nothing is spent by arriving here. The subscriber chooses: continue in this
 * browser, or go back to the browser they normally use and type the code from
 * the same email there -- which is what keeps them signed in where they read.
 */
export default async function ContinueSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ retry?: string }>
}) {
  const { retry } = await searchParams
  const token = (await cookies()).get(LINK_COOKIE)?.value ?? ""
  let usable = false
  try {
    usable = token ? (await inspectToken(token, null)).usable : false
  } catch {
    usable = Boolean(token)
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border">
        <div className="max-w-md mx-auto px-6 h-20 flex items-center">
          <Link href="/" className="font-serif text-base text-foreground tracking-tight">
            APRI
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-md w-full mx-auto px-6 py-16">
        <h1 className="font-serif text-2xl sm:text-3xl text-foreground mb-4 leading-tight tracking-tight">
          {usable ? "Continue to your library" : "This sign-in link has been used"}
        </h1>

        {usable ? (
          <>
            {retry && (
              <div className="border border-border bg-accent/5 p-5 mb-6" role="status">
                <p className="text-sm text-foreground/80 leading-relaxed">
                  Signing in could not be finished a moment ago. Your link still works: try again.
                </p>
              </div>
            )}
            <p className="text-sm text-foreground/70 leading-relaxed mb-6">
              This link was opened in a browser that did not ask for it &mdash; often the browser
              inside an email app. Continue to sign in on this browser.
            </p>
            <form action={continueSignInHere} className="mb-10">
              <SubmitButton
                busy="Opening your library…"
                className="w-full bg-foreground text-background px-6 py-4 text-base font-medium tracking-wide hover:bg-foreground/90 disabled:opacity-60 transition-colors cursor-pointer"
              >
                Continue on this browser
              </SubmitButton>
            </form>
            <div className="border-t border-border pt-6">
              <p className="text-sm text-foreground font-medium mb-2">Usually read APRI in another browser?</p>
              <p className="text-sm text-foreground/70 leading-relaxed">
                Open the APRI sign-in page there, enter your email address and the 8-digit code from the same
                email. You will then stay signed in on that browser, and Access Subscriber Library takes you
                straight to your library next time.
              </p>
            </div>
          </>
        ) : (
          <p className="text-sm text-foreground/70 leading-relaxed">
            Each sign-in link works once and for 15 minutes.{" "}
            <Link href="/portal/sign-in" className="text-accent hover:text-accent-hover">
              Request a fresh link
            </Link>
            , or go straight to your library if you are already signed in on this browser.
          </p>
        )}
      </main>

      <div className="max-w-md w-full mx-auto px-6 pb-10">
        <SiteFooter />
      </div>
    </div>
  )
}
