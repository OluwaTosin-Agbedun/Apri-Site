"use client"

import { useActionState } from "react"
import { requestReviewReadingLink } from "@/app/actions/review-reader"
import { Busy } from "@/components/Spinner"

export default function ReadingLinkForm() {
  const [state, action, pending] = useActionState(requestReviewReadingLink, undefined)
  if (state?.ok) {
    return (
      <div className="border border-border bg-card/30 p-8">
        <p className="font-serif text-xl mb-3">Check your email</p>
        <p className="text-sm text-foreground/80 leading-relaxed">{state.message}</p>
      </div>
    )
  }
  return (
    <form action={action} className="border border-border bg-card/30 p-8 space-y-5">
      <div>
        <label htmlFor="read-email" className="block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">Email address</label>
        <input id="read-email" name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required
          className="w-full border border-border bg-background p-4 text-base focus:outline-none focus:border-accent" />
      </div>
      {state?.message && <p className="text-sm text-red-700 border border-red-200 bg-red-50 p-3">{state.message}</p>}
      <button type="submit" disabled={pending} aria-busy={pending}
        className="w-full bg-foreground text-background px-6 py-4 text-base font-medium hover:bg-foreground/90 disabled:opacity-60 cursor-pointer">
        <Busy pending={pending} idle="Email me my reading link" busy="Sending…" />
      </button>
    </form>
  )
}
