"use client"

import { useEffect, useRef, useState } from "react"

/**
 * Copies the stable portal sign-in page for one subscriber's onboarding
 * message.
 *
 * Clipboard only. It calls no server action, creates no link and sends no
 * email: the URL is the public sign-in page, rendered by the server, which
 * carries no token and grants nothing until the subscriber proves their own
 * address. The subscriber's name and address are shown so the owner can see
 * whose record this is before pasting it anywhere.
 */
export default function CopyPortalLink({
  url,
  subscriberName,
  subscriberEmail,
}: {
  url: string
  subscriberName: string
  subscriberEmail: string
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle")
  const reset = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (reset.current) clearTimeout(reset.current)
  }, [])

  async function copy() {
    if (reset.current) clearTimeout(reset.current)
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable")
      await navigator.clipboard.writeText(url)
      setState("copied")
      reset.current = setTimeout(() => setState("idle"), 2500)
    } catch {
      // Denied permission, an insecure context or an old browser. Fall back to
      // a selectable field rather than claiming a copy that did not happen.
      setState("failed")
    }
  }

  const who = subscriberName || subscriberEmail

  return (
    <div className="mt-4 pt-4 border-t border-border">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
        Portal link for onboarding
      </p>
      <p className="text-sm text-foreground/80 mb-1">
        For <strong>{subscriberName || "this subscriber"}</strong>
        {subscriberEmail ? <> ({subscriberEmail})</> : null}
      </p>
      <p className="text-xs text-muted-foreground mb-3 max-w-xl leading-relaxed">
        The APRI portal sign-in page. It carries no sign-in token: the subscriber
        enters their own email address there and receives their own one-time
        link. Copying it sends nothing and changes nothing.
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy portal link for ${who}`}
          className="border border-border px-4 py-2 text-sm hover:bg-black/5 transition-colors cursor-pointer"
        >
          Copy portal link
        </button>
        <span aria-live="polite" className="text-xs text-accent">
          {state === "copied" ? "Copied" : ""}
        </span>
      </div>
      {state === "failed" && (
        <div className="mt-3">
          <p className="text-xs text-red-600 mb-1">
            Could not copy automatically. Select the link below and copy it.
          </p>
          <input
            readOnly
            value={url}
            aria-label={`Portal link for ${who}`}
            onFocus={(event) => event.currentTarget.select()}
            className="w-full max-w-xl border border-border bg-background p-2 text-xs font-mono"
          />
        </div>
      )}
    </div>
  )
}
