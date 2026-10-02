"use client"

import Link from "next/link"
import { useActionState } from "react"
import { openReviewLibrary } from "@/app/actions/review-reader"
import { Busy } from "@/components/Spinner"

/** One field: the address the reader's editions were issued to. No APRI email, no APRI code. */
export default function OpenLibraryForm() {
  const [state, action, pending] = useActionState(openReviewLibrary, undefined)
  return (
    <form action={action} className="border border-border bg-card/30 p-6 sm:p-8 space-y-5">
      <div>
        <label htmlFor="read-email" className="block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
          Your email address
        </label>
        <input
          id="read-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          className="w-full border border-border bg-background p-4 text-base focus:outline-none focus:border-accent"
        />
      </div>
      {state?.message && (
        <div className="text-sm border border-amber-300 bg-amber-50 text-amber-900 p-3 space-y-2" role="alert">
          <p>{state.message}</p>
          <p>
            <Link href="/review" className="underline">
              Request a complimentary review
            </Link>
          </p>
        </div>
      )}
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className="w-full bg-foreground text-background px-6 py-4 text-base font-medium hover:bg-foreground/90 disabled:opacity-60 cursor-pointer"
      >
        <Busy pending={pending} idle="Continue to my Review Library" busy="Checking…" />
      </button>
    </form>
  )
}
