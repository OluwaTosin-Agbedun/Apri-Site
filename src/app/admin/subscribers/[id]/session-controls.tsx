"use client"

import { useActionState } from "react"
import { signOutSubscriberEverywhere } from "@/app/actions/subscribers"
import { Busy } from "@/components/Spinner"

/** Admin's view of where a subscriber is signed in, and the one control to end it. */
export default function SessionControls({
  subscriberId,
  open,
  lastSeenAt,
}: {
  subscriberId: string
  open: number
  lastSeenAt: string | null
}) {
  const [state, action, pending] = useActionState(signOutSubscriberEverywhere, undefined)
  const last = lastSeenAt
    ? new Date(lastSeenAt).toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" })
    : null
  return (
    <div className="mt-4 pt-4 border-t border-border">
      <p className="text-xs text-muted-foreground leading-relaxed">
        {open === 0
          ? "Not signed in on any browser. After their first sign-in they stay signed in on that browser."
          : `Signed in on ${open} ${open === 1 ? "browser" : "browsers"}${last ? `, last used ${last}` : ""}. Access Subscriber Library takes them straight in there.`}
      </p>
      {open > 0 && (
        <form action={action} className="mt-3">
          <input type="hidden" name="subscriberId" value={subscriberId} />
          <button type="submit" className="btn-secondary text-xs" disabled={pending} aria-busy={pending}>
            <Busy pending={pending} idle="Sign out of all browsers" busy="Signing out…" />
          </button>
        </form>
      )}
      {state?.message && (
        <p className={`mt-2 text-xs ${state.ok ? "text-foreground/80" : "text-red-700"}`} role="status">
          {state.message}
        </p>
      )}
    </div>
  )
}
