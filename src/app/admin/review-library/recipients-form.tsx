"use client"

import { Busy } from "@/components/Spinner"
import { useActionState, useState } from "react"
import { useRouter } from "next/navigation"
import {
  saveApprovedRecipients,
  updateSlotPublicationTitle,
} from "@/app/actions/review-library"
import type { FormState } from "@/lib/definitions"

const field =
  "w-full border border-border bg-background p-3 text-sm focus:outline-none focus:border-accent"
const label =
  "block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2"
const btnSecondary =
  "border border-border px-4 py-2 text-sm hover:bg-black/5 transition-colors disabled:opacity-50 cursor-pointer"

/**
 * The approved-people address book.
 *
 * This list no longer grants anything by itself. Each edition's recipients are
 * chosen in that edition's own panel, and those are the only lists ever written
 * to Papermark. The one remaining use of this list is as the reference for
 * editions that were published before the changeover and have not been adopted
 * yet -- which is why the server refuses to change it until every published
 * edition is adopted. The read-only field here only reflects that rule.
 *
 * The addresses arrive as a prop from the owner-only server page. They are
 * never fetched by client JavaScript and never appear on a public page.
 */
export function ApprovedRecipientsSection({
  emails,
  legacyEditionCount,
}: {
  emails: string[]
  legacyEditionCount: number
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    saveApprovedRecipients,
    {},
  )

  return (
    <div className="border border-border bg-card/30 p-6">
      <h3 className="font-serif text-lg text-foreground mb-2">
        Approved people (address book)
      </h3>
      <p className="text-sm text-foreground/70 mb-4 max-w-3xl">
        People you are willing to offer Complimentary Review access. Saving this
        list <strong>grants no access</strong>: choose who can open each edition in
        that edition&rsquo;s own panel below, then preview and apply it there.
      </p>
      {legacyEditionCount > 0 ? (
        <p className="text-xs text-amber-700 mb-4 max-w-3xl">
          Locked: {legacyEditionCount} published edition{legacyEditionCount === 1 ? " is" : "s are"} still
          checked against this list because {legacyEditionCount === 1 ? "it has" : "they have"} not
          been adopted, and changing it would put APRI and Papermark out of step for{" "}
          {legacyEditionCount === 1 ? "it" : "them"}. Adopt every published edition below; this list
          then becomes an address book only and can be edited freely.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground mb-4 max-w-3xl">
          Every published edition manages its own list, so editing this address book
          changes no one&rsquo;s access.
        </p>
      )}

      <form action={action} className="space-y-4">
        <div>
          <label className={label} htmlFor="recipients">
            Approved people ({emails.length} saved)
          </label>
          <textarea
            id="recipients"
            name="recipients"
            rows={6}
            defaultValue={emails.join("\n")}
            placeholder={"reader@example.org\nanother@example.org"}
            readOnly={legacyEditionCount > 0}
            className={`${field} font-mono text-xs`}
          />
        </div>
        <button type="submit" disabled={pending || legacyEditionCount > 0} className={btnSecondary}>
          <Busy pending={pending} idle={"Save address book"} busy={"Saving..."} />
        </button>
        {state?.message && (
          <p className={`text-sm ${state.ok ? "text-accent" : "text-red-600"}`}>
            {state.message}
          </p>
        )}
      </form>
    </div>
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
          <Busy pending={busy} idle={"Save title"} busy={"Saving..."} />
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
