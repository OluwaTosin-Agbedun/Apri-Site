"use client"

import { useActionState } from "react"
import { setReviewEntryMode } from "@/app/actions/review-reader"
import { Busy } from "@/components/Spinner"

/**
 * Where the public Complimentary Review cards lead. Reversible: switch back at
 * any time and the cards link straight to Papermark again.
 */
export default function EntryModeForm({ mode, ready }: { mode: "papermark" | "library"; ready: boolean }) {
  const [state, action, pending] = useActionState(setReviewEntryMode, undefined)
  return (
    <section className="mb-8 border border-border bg-card/30 p-6">
      <h3 className="text-xs font-medium uppercase tracking-wider text-accent mb-3">Where public review cards lead</h3>
      <p className="text-xs text-muted-foreground leading-relaxed mb-4 max-w-3xl">
        The cards on the homepage and Publications page. <strong>Papermark links</strong> is how it works today.
        <strong> APRI Review Library</strong> lets approved readers verify their email once on APRI and return on
        the same browser without verifying again; they see only the editions assigned to their email, checked on
        every open. Papermark still asks each reader to confirm their email when they open an edition, once a day per edition.
      </p>
      <form action={action} className="flex flex-wrap items-center gap-3">
        <select name="mode" defaultValue={mode} className="border border-border bg-background px-3 py-2 text-sm" aria-label="Where cards lead">
          <option value="papermark">Papermark links (current)</option>
          <option value="library" disabled={!ready}>APRI Review Library{ready ? "" : " (apply migration 20261008 first)"}</option>
        </select>
        <button type="submit" className="btn-primary text-xs" disabled={pending} aria-busy={pending}>
          <Busy pending={pending} idle="Save" busy="Saving…" />
        </button>
      </form>
      {state?.message && <p className={`mt-3 text-xs ${state.ok ? "text-foreground/80" : "text-red-700"}`} role="status">{state.message}</p>}
    </section>
  )
}
