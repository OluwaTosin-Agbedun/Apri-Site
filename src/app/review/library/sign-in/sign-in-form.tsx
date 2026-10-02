"use client"

import { useActionState, useState } from "react"
import { requestReviewLibrarySignIn, reviewLibrarySignInWithCode } from "@/app/actions/review-reader"
import { Busy } from "@/components/Spinner"

const field = "w-full border border-border bg-background p-4 text-base focus:outline-none focus:border-accent"
const label = "block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3"
const primary =
  "w-full bg-foreground text-background px-6 py-4 text-base font-medium tracking-wide hover:bg-foreground/90 disabled:opacity-60 transition-colors cursor-pointer"

/** Ask for an email, then use its code (or link) in this browser. */
export default function ReaderSignInForm({ edition }: { edition: string | null }) {
  const [requested, request, requesting] = useActionState(requestReviewLibrarySignIn, undefined)
  const [signedIn, signIn, signing] = useActionState(reviewLibrarySignInWithCode, undefined)
  const [email, setEmail] = useState("")
  const [haveCode, setHaveCode] = useState(false)
  const showCode = Boolean(requested?.ok) || haveCode

  if (!showCode) {
    return (
      <form action={request} className="border border-border bg-card/30 p-8 space-y-5">
        {edition && <input type="hidden" name="edition" value={edition} />}
        <div>
          <label htmlFor="reader-email" className={label}>Email address</label>
          <input id="reader-email" name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none"
            spellCheck={false} required value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
        </div>
        {requested?.message && !requested.ok && (
          <p className="text-sm text-red-700 border border-red-200 bg-red-50 p-3">{requested.message}</p>
        )}
        <button type="submit" disabled={requesting} aria-busy={requesting} className={primary}>
          <Busy pending={requesting} idle="Email me a sign-in link" busy="Sending…" />
        </button>
        <button type="button" onClick={() => setHaveCode(true)} className="text-xs text-accent hover:text-accent-hover cursor-pointer">
          I already have a code
        </button>
      </form>
    )
  }

  return (
    <div className="border border-border bg-card/30 p-8 space-y-6">
      {requested?.ok && (
        <div>
          <p className="font-serif text-xl mb-3">Check your email</p>
          <p className="text-sm text-foreground/80 leading-relaxed">{requested.message}</p>
        </div>
      )}
      <form action={signIn} className="space-y-5">
        {edition && <input type="hidden" name="edition" value={edition} />}
        <div>
          <label htmlFor="reader-code-email" className={label}>Email address</label>
          <input id="reader-code-email" name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none"
            spellCheck={false} required value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
        </div>
        <div>
          <label htmlFor="reader-code" className={label}>8-digit code from the email</label>
          <input id="reader-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{8,9}"
            maxLength={9} required placeholder="1234 5678" className={`${field} tracking-[0.3em] font-mono`} />
        </div>
        {signedIn?.message && (
          <p className="text-sm text-red-700 border border-red-200 bg-red-50 p-3" role="alert">{signedIn.message}</p>
        )}
        <button type="submit" disabled={signing} aria-busy={signing} className={primary}>
          <Busy pending={signing} idle="Open my Review Library" busy="Signing in…" />
        </button>
      </form>
      <p className="text-xs text-muted-foreground leading-relaxed">
        The link and code work once, for 15 minutes. If your email app opens the link in its own browser,
        type the code here instead, so you stay signed in on this browser.
      </p>
    </div>
  )
}
