"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  adoptEditionAccess,
  applyEditionRecipients,
  checkEditionAddress,
  previewEditionRecipients,
  saveEditionRecipients,
  type EditionPreview,
} from "@/app/actions/review-edition-access"
import {
  sameSelection,
  selectAll,
  selectableAddresses,
  selectionGuard,
  selectionSummary,
  toggleAddress,
  unselectAll,
} from "@/lib/recipient-selection"

/**
 * One edition's Complimentary Review access, managed on its own.
 *
 * Choose recipients, save them, preview the difference against the live
 * Papermark link, then apply to this edition only and read it back. Every step
 * is a separate owner-only server action; this component decides nothing about
 * access itself, it only asks.
 *
 * The addresses shown come from the owner-only Admin page. Nothing here is
 * logged, stored in the browser, or sent anywhere but those actions.
 */

export type EditionAccessStatus =
  | "legacy_shared"
  | "no_recipients"
  | "awaiting_link"
  | "in_sync"
  | "pending_apply"

export type EditionAccess = {
  mode: "shared_legacy" | "edition"
  recipients: string[]
  status: EditionAccessStatus
  verifiedAt: string | null
  adoptedAt: string | null
}

const STATUS_TEXT: Record<EditionAccessStatus, string> = {
  legacy_shared: "Still checked against the shared list (not yet adopted)",
  no_recipients: "No recipients chosen — this edition cannot be linked or granted yet",
  awaiting_link: "Recipients chosen — the link has not been prepared yet",
  in_sync: "Papermark matches this edition's list",
  pending_apply: "Changes not yet applied and verified in Papermark",
}

const STATUS_TONE: Record<EditionAccessStatus, string> = {
  legacy_shared: "text-amber-700",
  no_recipients: "text-amber-700",
  awaiting_link: "text-muted-foreground",
  in_sync: "text-accent",
  pending_apply: "text-amber-700",
}

const secondary =
  "border border-border px-3 py-1.5 text-xs hover:bg-black/5 disabled:opacity-40 cursor-pointer"
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function EditionAccessPanel({
  editionId,
  editionName,
  published,
  withdrawn = false,
  hasLink,
  access,
  addressBook,
}: {
  editionId: string
  editionName: string
  published: boolean
  /** Withdrawn from Complimentary Review: managed through re-offering. */
  withdrawn?: boolean
  hasLink: boolean
  access: EditionAccess
  addressBook: string[]
}) {
  const router = useRouter()
  // This panel's own selection. Nothing here is shared with another edition's
  // panel, and nothing is saved until Save.
  const [selection, setSelection] = useState<Set<string>>(() => new Set(access.recipients))
  const [added, setAdded] = useState<string[]>([])
  const [extra, setExtra] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [preview, setPreview] = useState<EditionPreview | null>(null)
  const [probe, setProbe] = useState("")
  const [probeResult, setProbeResult] = useState<{ ok: boolean; text: string } | null>(null)

  const dirty = !sameSelection(selection, access.recipients)
  const candidates = selectableAddresses(addressBook, access.recipients, [...added, ...selection])
  const guard = selectionGuard({ selectedCount: selection.size, hasLink, published })

  /** Changes this panel's on-screen selection only. */
  function choose(next: Set<string>) {
    setSelection(next)
    setPreview(null)
    setMessage(null)
  }

  async function act<T extends { ok: boolean; message: string }>(
    fn: () => Promise<T>,
    after?: (result: T) => void,
  ) {
    setBusy(true)
    setMessage(null)
    try {
      const result = await fn()
      setMessage({ ok: result.ok, text: result.message })
      after?.(result)
      if (result.ok) router.refresh()
    } catch {
      setMessage({ ok: false, text: "The request failed. Nothing is assumed to have changed; reload and check." })
    } finally {
      setBusy(false)
    }
  }

  // --- Pre-changeover edition: adoption only ------------------------------
  if (access.mode === "shared_legacy") {
    return (
      <section className="border border-amber-200 bg-amber-50/40 p-4 mb-6">
        <h4 className="text-sm font-medium mb-1">Access for this edition</h4>
        <p className={`text-xs mb-3 ${STATUS_TONE.legacy_shared}`}>{STATUS_TEXT.legacy_shared}</p>
        <p className="text-xs text-foreground/70 mb-3 max-w-3xl">
          Adoption reads this edition&rsquo;s live Papermark link, verifies its document
          and security policy, and records exactly the addresses on it as this
          edition&rsquo;s own list. It never changes Papermark, and no reader gains or loses
          access. If anything cannot be verified, it stops and reports why.
        </p>
        {withdrawn ? (
          <p className="text-xs text-foreground/70">
            Withdrawn from Complimentary Review, so there is no live link to adopt. Offering it again gives it
            its own list of recipients, chosen from scratch.
          </p>
        ) : published && hasLink ? (
          <button
            type="button"
            className={secondary}
            disabled={busy}
            onClick={() => {
              if (!window.confirm(`Adopt the live Papermark access of ${editionName}?\n\nPapermark will not be changed.`)) return
              void act(() => adoptEditionAccess(editionId))
            }}
          >
            {busy ? "Checking Papermark..." : "Adopt current Papermark access"}
          </button>
        ) : (
          <p className="text-xs text-red-600">
            This edition has no published link to adopt. Manual review is required.
          </p>
        )}
        {message && (
          <p className={`text-xs mt-3 ${message.ok ? "text-accent" : "text-red-600"}`}>{message.text}</p>
        )}
      </section>
    )
  }

  // --- Edition-mode: choose, save, preview, apply, verify ------------------
  return (
    <section className="border border-border/60 bg-background p-4 mb-6">
      <h4 className="text-sm font-medium mb-1">Access for this edition</h4>
      <p className={`text-xs mb-1 ${STATUS_TONE[access.status]}`}>{STATUS_TEXT[access.status]}</p>
      <p className="text-xs text-muted-foreground mb-3">
        {access.recipients.length} recipient{access.recipients.length === 1 ? "" : "s"} saved
        {access.verifiedAt ? ` · last verified ${new Date(access.verifiedAt).toLocaleString("en-GB", { timeZone: "Africa/Lagos" })}` : ""}
        {access.adoptedAt ? ` · adopted ${new Date(access.adoptedAt).toLocaleString("en-GB", { timeZone: "Africa/Lagos" })}` : ""}
      </p>

      <fieldset className="mb-3">
        <legend className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
          Who may open this edition
        </legend>
        {candidates.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No approved people yet. Add an address below, or add people to the address book.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              {/* On-screen only: neither button saves anything or touches Papermark. */}
              <button
                type="button"
                className={secondary}
                disabled={busy || selection.size === candidates.length}
                onClick={() => choose(selectAll(candidates))}
                aria-label={`Select every address for ${editionName}`}
              >
                Select all
              </button>
              <button
                type="button"
                className={secondary}
                disabled={busy || selection.size === 0}
                onClick={() => choose(unselectAll())}
                aria-label={`Unselect every address for ${editionName}`}
              >
                Unselect all
              </button>
              <span className="text-xs text-muted-foreground" aria-live="polite">
                {selectionSummary(selection.size, candidates.length)}
                {dirty ? " · not saved yet" : ""}
              </span>
            </div>
            <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1 max-h-60 overflow-y-auto">
              {candidates.map((email) => (
                <li key={email}>
                  <label className="flex items-center gap-2 text-xs font-mono">
                    <input
                      type="checkbox"
                      checked={selection.has(email)}
                      onChange={(ev) => choose(toggleAddress(selection, email, ev.target.checked))}
                    />
                    {email}
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
      </fieldset>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          type="email"
          value={extra}
          onChange={(ev) => setExtra(ev.target.value)}
          placeholder="another@example.org"
          className="border border-border bg-background px-2 py-1.5 text-xs font-mono"
          aria-label="Add an address to this edition"
        />
        <button
          type="button"
          className={secondary}
          disabled={!EMAIL_SHAPE.test(extra.trim())}
          onClick={() => {
            const email = extra.trim().toLowerCase()
            if (!EMAIL_SHAPE.test(email)) return
            setAdded([...added, email])
            choose(toggleAddress(selection, email, true))
            setExtra("")
          }}
        >
          Add to this edition
        </button>
      </div>

      {guard.warning && (
        <p className={`text-xs mb-2 ${guard.canSave ? "text-amber-700" : "text-red-600"}`} role="status">
          {guard.warning}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={secondary}
          disabled={busy || !dirty || !guard.canSave}
          onClick={() => void act(() => saveEditionRecipients(editionId, [...selection]), () => setPreview(null))}
        >
          Save recipients
        </button>
        {hasLink && (
          <button
            type="button"
            className={secondary}
            disabled={busy || dirty}
            title={dirty ? "Save your changes before previewing." : undefined}
            onClick={() =>
              void act(
                async () => {
                  const result = await previewEditionRecipients(editionId)
                  return result
                },
                (result) => setPreview(result.ok ? result : null),
              )
            }
          >
            Preview against Papermark
          </button>
        )}
      </div>

      {preview && (
        <div className="mt-3 border border-border p-3 text-xs space-y-1">
          <p>
            <strong>Would add ({preview.toAdd.length}):</strong>{" "}
            <span className="font-mono">{preview.toAdd.join(", ") || "none"}</span>
          </p>
          <p>
            <strong>Would remove ({preview.toRemove.length}):</strong>{" "}
            <span className="font-mono">{preview.toRemove.join(", ") || "none"}</span>
          </p>
          <p>Unchanged: {preview.unchanged}</p>
          <p>Exact document: {preview.documentMatches ? "yes" : "NO — manual review required"}</p>
          <p>Security policy: {preview.policyProblem ? preview.policyProblem : "compliant"}</p>
          <button
            type="button"
            className={`${secondary} mt-2`}
            disabled={busy || (preview.listMatches && access.status === "in_sync") || !preview.documentMatches}
            onClick={() => {
              if (
                !window.confirm(
                  `Apply this list to ${editionName} only?\n\n` +
                    `Adds ${preview.toAdd.length}, removes ${preview.toRemove.length}. ` +
                    "Only the permitted-address list of this one link changes; it is read back afterwards.",
                )
              )
                return
              void act(() => applyEditionRecipients(editionId, preview.previewHash), () => setPreview(null))
            }}
          >
            Apply to this edition only
          </button>
        </div>
      )}

      {message && (
        <p className={`text-xs mt-3 ${message.ok ? "text-accent" : "text-red-600"}`}>{message.text}</p>
      )}

      {hasLink && (
        <div className="mt-4 pt-3 border-t border-border/50">
          <p className="text-xs text-muted-foreground mb-2">
            Check one address against the live Papermark link (read-only).
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="email"
              value={probe}
              onChange={(ev) => setProbe(ev.target.value)}
              placeholder="address to check"
              className="border border-border bg-background px-2 py-1.5 text-xs font-mono"
              aria-label="Address to check against this edition"
            />
            <button
              type="button"
              className={secondary}
              disabled={busy || !EMAIL_SHAPE.test(probe.trim())}
              onClick={async () => {
                setProbeResult(null)
                try {
                  const result = await checkEditionAddress(editionId, probe)
                  setProbeResult({ ok: result.ok && result.allowedLive === true, text: result.message })
                } catch {
                  setProbeResult({ ok: false, text: "The check failed; nothing is assumed." })
                }
              }}
            >
              Check address
            </button>
          </div>
          {probeResult && (
            <p className={`text-xs mt-2 ${probeResult.ok ? "text-accent" : "text-red-600"}`}>{probeResult.text}</p>
          )}
        </div>
      )}
    </section>
  )
}
