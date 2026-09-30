"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  offerReviewEdition,
  previewReviewEditionWithdrawal,
  reofferWithdrawnEdition,
  withdrawReviewEdition,
  type WithdrawalPreview,
} from "@/app/actions/review-withdrawal"
import { proposedReplacement } from "@/lib/review-withdrawal"

/**
 * Withdrawing one edition from Complimentary Review, and choosing which edition
 * its series offers.
 *
 * Every step is an owner-only server action; this component decides nothing.
 * Withdrawal always starts with a read-only preview of exactly what will
 * happen -- the edition, its Papermark document, the one APRI link that will be
 * revoked, and what else can open the same PDF -- and the confirmation is bound
 * to that preview. For the edition a series offers, the owner must choose
 * another edition to offer, or no replacement, before confirming.
 */

export type EditionWithdrawal = {
  /** Whether db/migrations/20260929_review_edition_withdrawal.sql has run. */
  ready: boolean
  offered: boolean
  state: "revoking" | "revoked" | null
  linkId: string | null
  requestedAt: string | null
  withdrawnAt: string | null
  events: { eventType: string; detail: string; createdAt: string }[]
}

const secondary =
  "border border-border px-3 py-1.5 text-xs hover:bg-black/5 disabled:opacity-40 cursor-pointer"
const danger =
  "border border-red-300 text-red-700 px-3 py-1.5 text-xs hover:bg-red-50 disabled:opacity-40 cursor-pointer"

const EVENT_LABEL: Record<string, string> = {
  withdrawal_started: "Withdrawal started",
  withdrawal_unconfirmed: "Revocation not confirmed",
  withdrawal_completed: "Withdrawal completed",
  featured: "Offered on the homepage",
  unfeatured: "No longer offered",
  reoffered: "Returned to draft to be offered again",
}

const when = (value: string | null) => (value ? new Date(value).toLocaleString("en-GB", { timeZone: "Africa/Lagos" }) : "")

export function EditionWithdrawalPanel({
  editionId,
  editionName,
  publicationState,
  withdrawal,
}: {
  editionId: string
  editionName: string
  publicationState: string
  withdrawal: EditionWithdrawal
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<WithdrawalPreview | null>(null)
  const [choice, setChoice] = useState<string>("")
  const [result, setResult] = useState<{ ok: boolean; text: string; paths: string[] } | null>(null)

  async function act(fn: () => Promise<{ ok: boolean; message: string; accessPaths?: string[] }>) {
    setBusy(true)
    setResult(null)
    try {
      const r = await fn()
      setResult({ ok: r.ok, text: r.message, paths: r.accessPaths ?? [] })
      setPreview(null)
      setChoice("")
      router.refresh()
    } catch {
      setResult({ ok: false, text: "The request failed. Nothing is assumed to have changed; reload and check.", paths: [] })
    } finally {
      setBusy(false)
    }
  }

  const history =
    withdrawal.events.length > 0 ? (
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-muted-foreground">History</summary>
        <ul className="mt-2 space-y-1">
          {withdrawal.events.map((ev, i) => (
            <li key={`${ev.createdAt}-${i}`}>
              <span className="text-muted-foreground">{when(ev.createdAt)}</span> ·{" "}
              {EVENT_LABEL[ev.eventType] ?? ev.eventType}
              {ev.detail ? ` — ${ev.detail}` : ""}
            </li>
          ))}
        </ul>
      </details>
    ) : null

  const resultBlock = result && (
    <div className={`mt-3 text-xs ${result.ok ? "text-accent" : "text-red-700"}`} role="status">
      <p>{result.text}</p>
      {result.paths.length > 0 && (
        <ul className="list-disc pl-5 mt-2 text-foreground/80 space-y-1">
          {result.paths.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  )

  if (!withdrawal.ready) {
    return (
      <section className="border border-border/60 p-4 mb-6 text-xs text-muted-foreground">
        Withdrawing an edition and choosing which edition a series offers need the database migration{" "}
        <code>db/migrations/20260929_review_edition_withdrawal.sql</code>.
      </section>
    )
  }

  // --- A withdrawal that has not been confirmed yet ------------------------
  if (publicationState === "withdrawn" && withdrawal.state !== "revoked") {
    return (
      <section className="border border-red-300 bg-red-50/60 p-4 mb-6">
        <h4 className="text-sm font-medium mb-1 text-red-800">Withdrawal not complete</h4>
        <p className="text-xs text-red-800 mb-3 max-w-3xl">
          {editionName} is hidden from every public page, but Papermark has not confirmed that its complimentary
          link{withdrawal.linkId ? ` (${withdrawal.linkId})` : ""} no longer opens, so anyone holding that link may
          still be able to read it. Complete withdrawal revokes that one link again if needed, confirms it with
          Papermark and records the result. It never creates or restores any access.
        </p>
        <button
          type="button"
          className={danger}
          disabled={busy}
          onClick={() => void act(() => withdrawReviewEdition(editionId, "", "none"))}
        >
          {busy ? "Checking Papermark..." : "Complete withdrawal"}
        </button>
        {resultBlock}
        {history}
      </section>
    )
  }

  // --- Withdrawn and confirmed ------------------------------------------------
  if (publicationState === "withdrawn") {
    return (
      <section className="border border-border bg-card/30 p-4 mb-6">
        <h4 className="text-sm font-medium mb-1">Withdrawn from Complimentary Review</h4>
        <p className="text-xs text-foreground/70 mb-3 max-w-3xl">
          Withdrawn {when(withdrawal.withdrawnAt)}. Papermark confirmed its complimentary link
          {withdrawal.linkId ? ` (${withdrawal.linkId})` : ""} no longer opens. Its document, details, recipient
          history and history below are kept; the PDF was not deleted.
        </p>
        <button
          type="button"
          className={secondary}
          disabled={busy}
          onClick={() => {
            if (
              !window.confirm(
                `Offer ${editionName} again?\n\nIt returns to draft. It stays private until you choose its recipients, ` +
                  "prepare and verify a new link (the revoked one is never reused) and publish it.",
              )
            )
              return
            void act(() => reofferWithdrawnEdition(editionId))
          }}
        >
          Offer this edition again
        </button>
        {resultBlock}
        {history}
      </section>
    )
  }

  if (publicationState !== "published") return history ? <section className="mb-6">{history}</section> : null

  // --- Published: offer it, or preview a withdrawal -------------------------
  return (
    <section className="border border-border/60 p-4 mb-6">
      <h4 className="text-sm font-medium mb-1">Complimentary Review offer</h4>
      <p className="text-xs text-foreground/70 mb-3">
        {withdrawal.offered
          ? "This is the edition its series offers on the homepage."
          : "Published, but not the edition its series offers on the homepage."}
      </p>
      <div className="flex flex-wrap gap-2">
        {!withdrawal.offered && (
          <button
            type="button"
            className={secondary}
            disabled={busy}
            onClick={() => {
              if (!window.confirm(`Offer ${editionName} on the homepage in place of its series' current edition?`)) return
              void act(() => offerReviewEdition(editionId))
            }}
          >
            Offer on the homepage
          </button>
        )}
        <button
          type="button"
          className={danger}
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setResult(null)
            try {
              const p = await previewReviewEditionWithdrawal(editionId)
              setPreview(p.ok ? p : null)
              setChoice(p.ok && p.replacementRequired ? proposedReplacement(p.candidates) : "")
              if (!p.ok) setResult({ ok: false, text: p.message, paths: [] })
            } catch {
              setResult({ ok: false, text: "The preview failed. Nothing was changed.", paths: [] })
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy && !preview ? "Reading Papermark..." : "Withdraw from Complimentary Review…"}
        </button>
      </div>

      {preview && preview.status === "published" && (
        <div className="mt-4 border border-red-200 p-4 text-xs space-y-2">
          <p className="font-medium text-sm">Withdraw {preview.label}?</p>
          <dl className="grid sm:grid-cols-[12rem_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">Edition</dt>
            <dd>
              {preview.label} · {preview.stateLabel}
              {preview.offered ? " · offered on the homepage" : ""}
            </dd>
            <dt className="text-muted-foreground">Papermark document</dt>
            <dd className="font-mono break-all">
              {preview.documentId}
              {preview.filename ? ` (${preview.filename})` : ""}
            </dd>
            <dt className="text-muted-foreground">Link to be revoked</dt>
            <dd className="font-mono break-all">
              {preview.linkId}
              {preview.linkUrl ? ` · ${preview.linkUrl}` : ""}
            </dd>
            <dt className="text-muted-foreground">Papermark now</dt>
            <dd>{preview.linkLive}</dd>
            <dt className="text-muted-foreground">Who can open it</dt>
            <dd>
              {preview.recipientMode === "shared_legacy"
                ? "The shared list (not adopted). Adoption is not needed to withdraw."
                : `${preview.recipientCount} recipient${preview.recipientCount === 1 ? "" : "s"} of its own, kept as history.`}
            </dd>
          </dl>

          <div>
            <p className="font-medium mt-2">Other ways to open this PDF</p>
            <ul className="list-disc pl-5 mt-1 space-y-1">
              {preview.accessPaths.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="text-muted-foreground mt-1">
              Withdrawal revokes only this edition&rsquo;s complimentary link. Paid subscriber access and every other
              edition are left as they are.
            </p>
          </div>

          {preview.replacementRequired && (
            <fieldset className="mt-2">
              <legend className="font-medium">Offer instead on the homepage (required)</legend>
              <ul className="mt-1 space-y-1">
                {preview.candidates.map((c) => (
                  <li key={c.id}>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`replacement-${editionId}`}
                        value={c.id}
                        checked={choice === c.id}
                        onChange={() => setChoice(c.id)}
                      />
                      {c.label}
                    </label>
                  </li>
                ))}
                <li>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={`replacement-${editionId}`}
                      value="none"
                      checked={choice === "none"}
                      onChange={() => setChoice("none")}
                    />
                    No replacement: this series offers no edition until you choose one
                  </label>
                </li>
              </ul>
              {preview.candidates.length === 0 && (
                <p className="text-muted-foreground mt-1">
                  No eligible replacement exists. You can still choose No replacement and withdraw this edition.
                </p>
              )}
            </fieldset>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              className={danger}
              disabled={busy || (preview.replacementRequired && !choice)}
              onClick={() => {
                const replacement = preview.replacementRequired ? choice : "none"
                if (
                  !window.confirm(
                    `Withdraw ${preview.label} from Complimentary Review?\n\n` +
                      `Its complimentary link ${preview.linkId} will be revoked in Papermark, so it stops opening even for ` +
                      "anyone who already has it. The edition leaves the homepage, /publications, the prospect library and " +
                      "future grants. No other edition and no paid access changes.",
                  )
                )
                  return
                void act(() => withdrawReviewEdition(editionId, preview.previewKey, replacement))
              }}
            >
              {busy ? "Withdrawing..." : "Confirm withdrawal"}
            </button>
            <button type="button" className={secondary} disabled={busy} onClick={() => setPreview(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {resultBlock}
      {history}
    </section>
  )
}
