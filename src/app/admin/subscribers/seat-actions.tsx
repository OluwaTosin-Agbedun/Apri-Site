"use client"

/**
 * The actions taken on one seat: activate it after payment, resend a sign-in
 * link, and withdraw access when the subscription ends.
 *
 * Activation is disabled until the record actually holds a level and a term end
 * date, so the button cannot create a seat that is entitled to nothing or has no
 * expiry. The server checks the same conditions again.
 *
 * Revoking is offered whenever live links exist, whatever the status: a seat can
 * be marked lapsed and still have working links if the automatic sweep has not
 * run, and every stamped document carries the reader's name.
 */
/** Live publication_access rows -- how many links would be withdrawn. */

/**
 * Confirmed first: withdrawing a link cannot be undone from here. A new copy
 * has to be provisioned to restore access.
 */ /*
        Stated whenever links are live on a seat that is no longer active. There
        is no scheduled sweep in this deployment, so the only thing that closes
        a lapsed subscriber's access is this button.
      */ /*
        Says when this is actually needed, because the welcome email at
        activation already carries a working link and the session then lasts 90
        days. Sending another is for a lost email or a new device, not routine.
      */

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { activateSubscriber, resendSignInLink } from "@/app/actions/subscribers"
import { revokeAccessFor } from "@/app/actions/copies"
import type { FormState } from "@/lib/definitions"
export default function SeatActions({
  id,
  status,
  hasLevel,
  hasTermEnd,
  hasLibraryLink,
  liveLinks = 0,
  compact = false,
}: {
  id: string
  status: string
  hasLevel: boolean
  hasTermEnd: boolean
  hasLibraryLink: boolean
  liveLinks?: number
  compact?: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  function run(fn: (id: string) => Promise<FormState>) {
    setMessage(null)
    startTransition(async () => {
      const result = await fn(id)
      setOk(Boolean(result?.ok))
      if (result?.message) setMessage(result.message)
      if (result?.ok) router.refresh()
    })
  }

  const isActive = status === "active"
  const ready = hasLevel && hasTermEnd && hasLibraryLink
  const blocked = !hasLevel
    ? "Set an access level first."
    : !hasTermEnd
      ? "Set a term end date first."
      : !hasLibraryLink
        ? "Set the unique private Papermark library link first."
        : null

  const button =
    "text-xs font-medium text-accent hover:text-accent-hover cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
  function revoke() {
    const ok = window.confirm(
      `Withdraw ${liveLinks} ${
        liveLinks === 1 ? "link" : "links"
      } for this subscriber?\n\n` +
        "Their documents stop opening immediately. The access record is kept, so you " +
        "can still see what they had.",
    )
    if (ok) run(revokeAccessFor)
  }

  if (compact) {
    return (
      <div className="flex flex-col items-end gap-1.5">
        <div className="flex items-center gap-3">
          {!isActive && (
            <button
              type="button"
              onClick={() => run(activateSubscriber)}
              disabled={pending || !ready}
              title={blocked ?? undefined}
              className={button}
            >
              Activate
            </button>
          )}
          {isActive && (
            <button
              type="button"
              onClick={() => run(resendSignInLink)}
              disabled={pending}
              className={button}
            >
              Send link
            </button>
          )}
          {liveLinks > 0 && (
            <button
              type="button"
              onClick={revoke}
              disabled={pending}
              className="text-xs font-medium text-red-700 hover:text-red-800 cursor-pointer disabled:opacity-40"
            >
              Revoke {liveLinks}
            </button>
          )}
        </div>
        {message && (
          <p
            className={`text-xs max-w-[18rem] text-right ${
              ok ? "text-foreground/70" : "text-red-700"
            }`}
          >
            {message}
          </p>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4">
        {!isActive ? (
          <button
            type="button"
            onClick={() => run(activateSubscriber)}
            disabled={pending || !ready}
            className="bg-foreground text-background px-6 py-2.5 text-sm font-medium tracking-wide hover:bg-foreground/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            {pending ? "Working…" : "Activate & send welcome"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => run(resendSignInLink)}
            disabled={pending}
            className="bg-foreground text-background px-6 py-2.5 text-sm font-medium tracking-wide hover:bg-foreground/90 disabled:opacity-50 transition-colors cursor-pointer"
          >
            {pending ? "Sending…" : "Send a new sign-in link"}
          </button>
        )}

        {liveLinks > 0 && (
          <button
            type="button"
            onClick={revoke}
            disabled={pending}
            className="border border-red-200 bg-red-50 text-red-700 px-6 py-2.5 text-sm font-medium tracking-wide hover:bg-red-100 disabled:opacity-50 transition-colors cursor-pointer"
          >
            {pending
              ? "Withdrawing…"
              : `Revoke access (${liveLinks} ${
                  liveLinks === 1 ? "link" : "links"
                })`}
          </button>
        )}

        {!isActive && blocked && (
          <p className="text-xs text-muted-foreground">{blocked}</p>
        )}
      </div>

      {}
      {}
      {isActive && (
        <p className="mt-3 text-xs text-muted-foreground leading-relaxed max-w-xl">
          Activation already sent them a working link, and signing in lasts 90
          days. Send another only if they lost the email or are on a new device.
        </p>
      )}

      {liveLinks > 0 && !isActive && (
        <p className="mt-4 text-xs text-red-700 leading-relaxed max-w-xl">
          This seat is <strong>{status}</strong> but still has {liveLinks}{" "}
          working {liveLinks === 1 ? "link" : "links"}. Their documents carry
          their name, so withdraw access now.
        </p>
      )}

      {message && (
        <p
          className={`mt-4 text-sm p-3 border ${
            ok
              ? "text-foreground border-border bg-accent/5"
              : "text-red-700 border-red-200 bg-red-50"
          }`}
        >
          {message}
        </p>
      )}
    </div>
  )
}
