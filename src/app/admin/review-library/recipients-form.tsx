"use client"

import { useActionState, useState } from "react"
import { useRouter } from "next/navigation"
import {
  saveApprovedRecipients,
  previewEmailRestrictions,
  applyEmailRestrictions,
  updateSlotPublicationTitle,
  type RestrictionPreview,
} from "@/app/actions/review-library"
import type { FormState } from "@/lib/definitions"

const field =
  "w-full border border-border bg-background p-3 text-sm focus:outline-none focus:border-accent"
const label =
  "block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2"
const btnSecondary =
  "border border-border px-4 py-2 text-sm hover:bg-black/5 transition-colors disabled:opacity-50 cursor-pointer"

/**
 * Approved Complimentary Review recipients.
 *
 * The list is passed in from the server component as a plain array of
 * addresses the owner has already entered. It is never fetched by client
 * JavaScript and never appears on a public page — the only reason it is in the
 * browser at all is so the owner can see and edit what they typed.
 */
export function ApprovedRecipientsSection({
  emails,
  slotsWithLinks,
}: {
  emails: string[]
  slotsWithLinks: number
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    saveApprovedRecipients,
    {},
  )

  return (
    <div className="border border-border bg-card/30 p-6">
      <h3 className="font-serif text-lg text-foreground mb-2">
        Approved Review Recipients
      </h3>
      <p className="text-sm text-foreground/70 mb-4 max-w-3xl">
        Only these addresses may open a Complimentary Review document. Paste them
        one per line or separated by commas; they are trimmed, lower-cased and
        de-duplicated on save, and anything that is not a valid address is
        reported rather than stored.
      </p>
      <p className="text-xs text-amber-700 mb-4 max-w-3xl">
        Saving this list does <strong>not</strong> change the three links. The
        restrictions currently applied in Papermark stay exactly as they are
        until you press &ldquo;Apply email restrictions&rdquo; below.
      </p>

      <form action={action} className="space-y-4">
        <div>
          <label className={label} htmlFor="recipients">
            Approved addresses ({emails.length} currently saved)
          </label>
          <textarea
            id="recipients"
            name="recipients"
            rows={8}
            defaultValue={emails.join("\n")}
            placeholder={"reader@example.org\nanother@example.org"}
            className={`${field} font-mono text-xs`}
          />
        </div>
        <button type="submit" disabled={pending} className={btnSecondary}>
          {pending ? "Saving..." : "Save approved recipients"}
        </button>
        {state?.message && (
          <p className={`text-sm ${state.ok ? "text-accent" : "text-red-600"}`}>
            {state.message}
          </p>
        )}
      </form>

      <div className="mt-6 pt-6 border-t border-border">
        <RestrictionApply approvedCount={emails.length} slotsWithLinks={slotsWithLinks} />
      </div>
    </div>
  )
}

/**
 * Preview then Apply, in that order and never combined.
 *
 * Preview reads each link's live allow list from Papermark, so the comparison
 * is against what is genuinely in force rather than what APRI last believed it
 * set.
 */
function RestrictionApply({
  approvedCount,
  slotsWithLinks,
}: {
  approvedCount: number
  slotsWithLinks: number
}) {
  const [preview, setPreview] = useState<RestrictionPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [applyMsg, setApplyMsg] = useState("")
  const [applyOk, setApplyOk] = useState(false)
  const router = useRouter()

  async function handlePreview() {
    setBusy(true)
    setApplyMsg("")
    setPreview(await previewEmailRestrictions())
    setBusy(false)
  }

  async function handleApply() {
    if (
      !window.confirm(
        `Apply the ${approvedCount} approved address${approvedCount === 1 ? "" : "es"} to ` +
          `${slotsWithLinks} review link${slotsWithLinks === 1 ? "" : "s"}?\n\n` +
          "Each link keeps its URL, id, document, watermark and download setting. " +
          "Only the permitted-address list changes.",
      )
    ) {
      return
    }
    setBusy(true)
    const result = await applyEmailRestrictions()
    setApplyMsg(result.message)
    setApplyOk(result.ok)
    setPreview(null)
    setBusy(false)
    router.refresh()
  }

  return (
    <>
      <h4 className="text-sm font-medium text-foreground mb-2">
        Apply email restrictions
      </h4>
      <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
        Updates the permitted-address list on the three existing links. Nothing is
        recreated, so the public URLs keep working.
      </p>

      {approvedCount === 0 && (
        <p className="text-xs text-red-600 mb-3">
          No approved addresses are saved. Applying is refused: an empty list would
          let anyone who can verify an address open the documents.
        </p>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={handlePreview}
          disabled={busy || approvedCount === 0}
          className={btnSecondary}
        >
          {busy && !applyMsg ? "Checking..." : "Preview restrictions"}
        </button>
        {preview?.ok && (
          <button
            type="button"
            onClick={handleApply}
            disabled={busy}
            className={btnSecondary}
          >
            Apply email restrictions
          </button>
        )}
      </div>

      {preview && (
        <div className="mt-4">
          <p className={`text-sm mb-3 ${preview.ok ? "text-foreground/80" : "text-red-600"}`}>
            {preview.message}
          </p>
          {preview.rows.length > 0 && (
            <div className="border border-border overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-black/5 text-foreground/70">
                  <tr>
                    <th className="font-medium p-2">Slot</th>
                    <th className="font-medium p-2">Currently permitted</th>
                    <th className="font-medium p-2">Would change</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {preview.rows.map((r) => (
                    <tr key={r.slotKey}>
                      <td className="p-2 font-medium">{r.slotKey}</td>
                      <td className="p-2">
                        {r.problem ? (
                          <span className="text-red-600">{r.problem}</span>
                        ) : r.currentAllowList.length === 0 ? (
                          <span className="text-amber-700">
                            Unrestricted &mdash; any verified address
                          </span>
                        ) : (
                          <span className="text-foreground/70">
                            {r.currentAllowList.length} address
                            {r.currentAllowList.length === 1 ? "" : "es"}
                          </span>
                        )}
                      </td>
                      <td className="p-2">
                        {r.problem ? "—" : r.willChange ? "Yes" : "No change"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {applyMsg && (
        <p className={`text-sm mt-3 ${applyOk ? "text-accent" : "text-red-600"}`}>
          {applyMsg}
        </p>
      )}
    </>
  )
}

/**
 * Renames the publication a slot points at.
 *
 * Touches `documents.title` only. The slug, status, Papermark document mapping
 * and secure link are all left alone, which is why this is a rename rather
 * than a re-publish.
 */
export function PublicationTitleEditor({
  slotKey,
  currentTitle,
  approvedTitle,
  slug,
}: {
  slotKey: string
  currentTitle: string
  approvedTitle: string | null
  slug: string
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(currentTitle)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState("")
  const [ok, setOk] = useState(false)
  const router = useRouter()

  async function handleSave() {
    setBusy(true)
    setMsg("")
    const result = await updateSlotPublicationTitle(slotKey, value)
    setMsg(result?.message ?? "")
    setOk(!!result?.ok)
    setBusy(false)
    if (result?.ok) {
      setOpen(false)
      router.refresh()
    }
  }

  const needsApproved =
    approvedTitle !== null && currentTitle.trim() !== approvedTitle.trim()

  if (!open) {
    return (
      <span className="inline-flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs text-accent hover:text-accent-hover transition-colors cursor-pointer"
        >
          Edit publication title
        </button>
        {needsApproved && (
          <span className="text-[0.7rem] text-amber-700">
            Approved title not yet applied
          </span>
        )}
        {msg && ok && <span className="text-[0.7rem] text-accent">{msg}</span>}
      </span>
    )
  }

  return (
    <div className="border border-border/50 bg-background p-4 mt-3">
      <label className={label}>Publication title</label>
      <p className="text-xs text-muted-foreground mb-2">
        Updates the publication record only. The slug stays{" "}
        <span className="font-mono">{slug}</span>, so no public URL moves, and the
        Papermark document and secure link are untouched.
      </p>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={field}
      />

      {approvedTitle && (
        <button
          type="button"
          onClick={() => setValue(approvedTitle)}
          className="text-xs text-accent hover:text-accent-hover transition-colors mt-2 cursor-pointer text-left"
        >
          Use the approved title: {approvedTitle}
        </button>
      )}

      <div className="flex items-center gap-3 mt-3 flex-wrap">
        <button type="button" onClick={handleSave} disabled={busy} className={btnSecondary}>
          {busy ? "Saving..." : "Save title"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setValue(currentTitle)
          }}
          className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>
      {msg && (
        <p className={`text-xs mt-2 ${ok ? "text-accent" : "text-red-600"}`}>{msg}</p>
      )}
    </div>
  )
}
