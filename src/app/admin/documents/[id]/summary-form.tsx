"use client"

import { useActionState, useState } from "react"
import { useFormStatus } from "react-dom"
import { submitPublicationSummary } from "@/app/actions/publication-summaries"
import { Busy } from "@/components/Spinner"
import type { FormState } from "@/lib/definitions"
import { SUMMARY_TEXT_FIELDS, isCompleteSummary, type SummaryStatus, type SummaryText } from "@/lib/publication-metadata"

export type SummaryHistory = {
  status: SummaryStatus
  /** "Approved by Ada Obi on 8 October 2026", etc. Admin only. */
  notes: string[]
}

/** The text as the server will compare it: line endings unified, ends trimmed. */
const clean = (value: string) => value.replace(/\r\n?/g, "\n").trim()

function sameAsSaved(text: SummaryText, saved: SummaryText): boolean {
  return (
    SUMMARY_TEXT_FIELDS.every(({ key }) => clean(text[key]) === saved[key]) &&
    (text.sourceDate || null) === (saved.sourceDate || null)
  )
}

/**
 * The publication editor's protected-summary panel. Save draft for any
 * administrator; Approve (and Withdraw approval) only for owners, as separate
 * explicit buttons, and only for the saved text. The server re-checks every
 * rule, including the role and the revision this page was shown.
 */
export default function SummaryForm({
  id,
  saved,
  revision,
  history,
  ready,
  canApprove,
  pendingMessage,
  publicEdition,
}: {
  id: string
  saved: SummaryText
  /** The revision this page shows (0: none saved yet), sent back with every action. */
  revision: number
  history: SummaryHistory
  ready: boolean
  canApprove: boolean
  pendingMessage: string
  publicEdition: boolean
}) {
  const [state, action] = useActionState<FormState, FormData>(submitPublicationSummary.bind(null, id), undefined)
  const [text, setText] = useState<SummaryText>(saved)
  const [shownRevision, setShownRevision] = useState(revision)
  // After a save the page re-renders with the stored text and a new revision:
  // show that. A refused save keeps what was typed (the fields are controlled).
  if (shownRevision !== revision) {
    setShownRevision(revision)
    setText(saved)
  }

  const dirty = !sameAsSaved(text, saved)
  const complete = isCompleteSummary(text)
  const approved = history.status === "approved"
  const errors = state?.errors ?? {}
  const inputClass = "w-full border border-border bg-background p-3 text-sm leading-relaxed focus:outline-none focus:border-accent"

  return (
    <section aria-labelledby="protected-summary-title" className="mt-6 border border-border bg-card/30 p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id="protected-summary-title" className="font-serif text-xl">
          Protected summary for subscribers
        </h2>
        <StatusBadge status={history.status} />
      </div>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
        Optional, written by the research team. Subscribers see it on this edition&apos;s card, and can search its words,
        only after an owner approves exactly the saved text, and only when they may already read this edition. Changing
        approved text takes it down until an owner approves it again. It is separate from the public description and
        one-line summary above, and never appears on public or Complimentary Review pages, in emails or in page
        metadata. Saving or approving never publishes the edition, switches it On, or changes who receives it.
      </p>

      {history.notes.length > 0 && (
        <div className="mt-4 space-y-1 text-xs text-muted-foreground">
          {history.notes.map((note) => <p key={note}>{note}</p>)}
        </div>
      )}

      {!ready && (
        <p role="status" className="mt-4 border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {pendingMessage}
        </p>
      )}
      {ready && publicEdition && (
        <p className="mt-4 text-sm text-foreground/80">
          This edition is public (Open), so it never appears in the subscriber library and a summary here is not shown to anyone.
        </p>
      )}

      <form action={action} className="mt-6">
        <input type="hidden" name="revision" value={revision} />
        <fieldset disabled={!ready} className="space-y-6 disabled:opacity-60">
          <legend className="sr-only">Protected summary text</legend>
          {SUMMARY_TEXT_FIELDS.map(({ key, label, hint, max, required }) => {
            const length = clean(text[key]).length
            const describedBy = [`summary-${key}-hint`, `summary-${key}-count`, errors[key] ? `summary-${key}-error` : ""].filter(Boolean).join(" ")
            return (
              <div key={key}>
                <label htmlFor={`summary-${key}`} className="block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
                  {label}{required ? "" : " (optional)"}
                </label>
                <p id={`summary-${key}-hint`} className="text-xs text-muted-foreground mb-2">{hint}</p>
                <textarea
                  id={`summary-${key}`}
                  name={key}
                  rows={key === "uncertainty" ? 2 : 4}
                  maxLength={max}
                  value={text[key]}
                  onChange={(event) => setText((current) => ({ ...current, [key]: event.target.value }))}
                  aria-describedby={describedBy}
                  aria-invalid={errors[key] ? true : undefined}
                  className={inputClass}
                />
                <p id={`summary-${key}-count`} className="mt-1 text-right text-[0.7rem] text-muted-foreground">
                  {length.toLocaleString("en-GB")} / {max.toLocaleString("en-GB")}
                </p>
                {errors[key] && <p id={`summary-${key}-error`} className="mt-1 text-xs text-red-700">{errors[key][0]}</p>}
              </div>
            )
          })}
          <div className="max-w-xs">
            <label htmlFor="summary-sourceDate" className="block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
              Source date (optional)
            </label>
            <p id="summary-sourceDate-hint" className="text-xs text-muted-foreground mb-2">The date of the source the summary rests on.</p>
            <input
              id="summary-sourceDate"
              name="sourceDate"
              type="date"
              value={text.sourceDate ?? ""}
              onChange={(event) => setText((current) => ({ ...current, sourceDate: event.target.value || null }))}
              aria-describedby={`summary-sourceDate-hint${errors.sourceDate ? " summary-sourceDate-error" : ""}`}
              aria-invalid={errors.sourceDate ? true : undefined}
              className={inputClass}
            />
            {errors.sourceDate && <p id="summary-sourceDate-error" className="mt-1 text-xs text-red-700">{errors.sourceDate[0]}</p>}
          </div>

          {dirty && approved && (
            <p className="border border-accent/40 bg-accent/5 p-3 text-sm text-foreground/80">
              You have changed the approved text. Saving it as a draft takes the summary down for subscribers until an owner
              approves it again.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
            <IntentButton intent="draft" disabled={!dirty} className="bg-accent text-white hover:bg-accent-hover">
              Save draft
            </IntentButton>
            {canApprove ? (
              <>
                {/* Approval covers the saved text only: changed text is saved as a draft first. */}
                {!approved && !dirty && revision > 0 && (
                  <IntentButton intent="approve" disabled={!complete} className="bg-foreground text-background hover:bg-foreground/90">
                    Approve for subscribers
                  </IntentButton>
                )}
                {approved && !dirty && (
                  <IntentButton intent="withdraw" className="border border-border bg-background text-foreground hover:border-accent hover:text-accent">
                    Withdraw approval
                  </IntentButton>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Only an owner can approve a summary for subscribers.</p>
            )}
            {canApprove && dirty && <p className="text-xs text-muted-foreground">Save the change as a draft first, then approve it.</p>}
            {canApprove && !dirty && !complete && !approved && revision > 0 && (
              <p className="text-xs text-muted-foreground">Write the four main fields to approve.</p>
            )}
          </div>
        </fieldset>
        {/* A success message describes the saved text; once that text is edited again it no longer applies. */}
        {state?.message && !(state.ok && dirty) && (
          <p
            role="status"
            className={`mt-4 border p-3 text-sm ${state.ok ? "border-border bg-accent/5 text-foreground" : "border-red-200 bg-red-50 text-red-700"}`}
          >
            {state.message}
          </p>
        )}
      </form>
    </section>
  )
}

function StatusBadge({ status }: { status: SummaryStatus }) {
  const label =
    status === "approved"
      ? "Approved: shown to entitled subscribers"
      : status === "draft"
        ? "Draft: not shown to subscribers"
        : status === "changed"
          ? "Changed since approval: not shown"
          : "No summary"
  const tone =
    status === "approved" ? "border-accent/60 text-accent" : status === "changed" ? "border-red-200 text-red-700" : "border-border text-muted-foreground"
  return <span className={`border px-2.5 py-1 text-[0.7rem] font-medium uppercase tracking-wider ${tone}`}>{label}</span>
}

/** A submit button that says which action it is; shows the spinner only on the one pressed. */
function IntentButton({
  intent,
  disabled = false,
  className,
  children,
}: {
  intent: "draft" | "approve" | "withdraw"
  disabled?: boolean
  className: string
  children: React.ReactNode
}) {
  const { pending, data } = useFormStatus()
  const mine = pending && data?.get("intent") === intent
  const busy = intent === "approve" ? "Approving…" : intent === "withdraw" ? "Withdrawing…" : "Saving…"
  return (
    <button
      type="submit"
      name="intent"
      value={intent}
      disabled={disabled || pending}
      aria-busy={mine}
      className={`inline-flex min-h-10 items-center justify-center px-5 py-2 text-sm font-medium tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      <Busy pending={mine} idle={children} busy={busy} />
    </button>
  )
}
