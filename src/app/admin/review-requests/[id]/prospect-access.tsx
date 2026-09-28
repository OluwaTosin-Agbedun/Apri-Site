"use client"

import { useActionState, type FormEvent } from "react"
import { grantProspectEditions } from "@/app/actions/review-edition-access"
import {
  sendSecureReviewAccessFromForm,
  type ReviewFormState,
} from "@/app/actions/review-funnel"
import type { FormState } from "@/lib/definitions"

/**
 * Granting a verified review prospect specific editions, then sending access.
 *
 * Nothing is pre-selected and there is no "grant everything": approval is an
 * explicit choice of editions, and an empty choice is refused by the server.
 * Granting writes the prospect to each chosen edition's Papermark list and
 * reads it back before recording it, so a grant shown here is one Papermark
 * enforces. Every edition that cannot be granted says why.
 */

export type ProspectEditionRow = {
  id: string
  name: string
  mode: "shared_legacy" | "edition"
  granted: boolean
  /** Granted and Papermark verified to match the edition's current list. */
  live: boolean
  hasLink: boolean
  /** A not-yet-adopted edition whose shared list already holds this prospect. */
  viaSharedList: boolean
}

export function ProspectAccess({
  prospectId,
  prospectName,
  prospectEmail,
  editions,
}: {
  prospectId: string
  prospectName: string
  prospectEmail: string
  editions: ProspectEditionRow[]
}) {
  const [grantState, grantAction, granting] = useActionState<FormState, FormData>(
    grantProspectEditions.bind(null, prospectId),
    {},
  )
  const [sendState, sendAction, sending] = useActionState<ReviewFormState, FormData>(
    sendSecureReviewAccessFromForm.bind(null, prospectId),
    {},
  )

  const grantable = editions.filter((e) => e.mode === "edition" && e.hasLink && !e.granted)
  const legacy = editions.filter((e) => e.mode === "shared_legacy")
  const liveCount = editions.filter((e) => (e.granted && e.live) || e.viaSharedList).length

  function confirmGrant(event: FormEvent<HTMLFormElement>) {
    const chosen = new FormData(event.currentTarget).getAll("editionId").length
    // An empty choice goes to the server, which refuses it and says why.
    if (chosen === 0) return
    const ok = window.confirm(
      `Add ${prospectEmail} to the Papermark list of the ${chosen} edition${chosen === 1 ? "" : "s"} you ticked?\n\n` +
        "Each edition is changed on its own and read back from Papermark before the grant is recorded. " +
        "No other edition is touched.",
    )
    if (!ok) event.preventDefault()
  }

  return (
    <section className="border border-border p-6">
      <h3 className="font-serif text-xl mb-2">Grant review access by edition</h3>
      <p className="text-sm text-foreground/70 mb-4">
        For {prospectName} ({prospectEmail}). Choose exactly which editions this
        prospect may open. Nothing is granted by default.
      </p>

      <ol className="list-decimal pl-5 space-y-1 text-sm mb-5">
        <li>
          Tick the editions and grant them. Each is added to that edition&apos;s Papermark
          list and read back before the grant counts.
        </li>
        <li>Send secure review access. It is refused unless every granted edition verifies live.</li>
      </ol>

      {editions.length > 0 && grantable.length === 0 && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-300 p-3 mb-4">
          {legacy.length === editions.length
            ? "No edition can be granted to one person yet: every published edition is still checked against the shared list. Adopt them in Review Library first."
            : "Nothing more can be granted here. Each edition below says why."}
        </p>
      )}

      {editions.length === 0 ? (
        <p className="text-sm text-muted-foreground mb-5">No edition is published yet.</p>
      ) : (
        <form action={grantAction} onSubmit={confirmGrant} className="space-y-2 mb-5">
          <ul className="space-y-2">
            {editions.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 text-sm">
                {e.mode === "shared_legacy" ? (
                  <>
                    <input type="checkbox" disabled aria-label={`${e.name} cannot be granted until it is adopted`} />
                    <span>{e.name}</span>
                    <span className="text-xs text-amber-700">
                      {e.viaSharedList
                        ? "Has access through the shared list. Adopt this edition in Review Library to manage it per person."
                        : "Adopt this edition in Review Library before it can be granted to one person."}
                    </span>
                  </>
                ) : e.granted ? (
                  <>
                    <input type="checkbox" checked disabled aria-label={`${e.name} is granted`} readOnly />
                    <span>{e.name}</span>
                    <span className={`text-xs ${e.live ? "text-accent" : "text-amber-700"}`}>
                      {e.live
                        ? "Granted — live in Papermark"
                        : "Granted, but Papermark is not in step — preview and apply it in Review Library"}
                    </span>
                  </>
                ) : !e.hasLink ? (
                  <>
                    <input type="checkbox" disabled aria-label={`${e.name} has no Papermark link`} />
                    <span>{e.name}</span>
                    <span className="text-xs text-amber-700">No Papermark link yet, so it cannot be granted.</span>
                  </>
                ) : (
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="editionId" value={e.id} />
                    <span>{e.name}</span>
                  </label>
                )}
              </li>
            ))}
          </ul>
          <button
            type="submit"
            className="btn-secondary mt-2"
            disabled={granting || grantable.length === 0}
          >
            {granting ? "Granting and checking Papermark..." : "Grant selected editions"}
          </button>
          {grantState?.message && (
            <p className={`text-sm ${grantState.ok ? "text-accent" : "text-red-600"}`} role="status">
              {grantState.message}
            </p>
          )}
        </form>
      )}

      <a className="btn-secondary inline-block mb-5" href="/admin/review-library">
        Open Review Library
      </a>

      <form action={sendAction} className="space-y-2 border-t border-border pt-5">
        <p className="text-sm mb-2">
          {liveCount} edition{liveCount === 1 ? " is" : "s are"} live for this prospect.
        </p>
        {[
          ["allowlist", "This prospect is on the live list of every edition granted to them"],
          ["mapped", "Every granted edition's link maps to its exact document"],
          ["email_auth", "Verified-email authentication enabled"],
          ["downloads", "Downloads disabled"],
          [
            "watermark",
            "Approved watermark applied; IP not visible; opacity 0.15; size 18",
          ],
        ].map(([value, text]) => (
          <label className="flex gap-2 text-sm" key={value}>
            <input type="checkbox" name="readiness" value={value} />
            {text}
          </label>
        ))}
        <button className="btn-primary mt-4" disabled={sending}>
          {sending ? "Checking Papermark..." : "Send secure review access"}
        </button>
        {sendState?.message && (
          <p className={`text-sm ${sendState.ok ? "text-accent" : "text-red-600"}`} role="status">
            {sendState.message}
          </p>
        )}
      </form>
    </section>
  )
}
