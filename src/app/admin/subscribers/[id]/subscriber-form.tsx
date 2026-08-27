"use client"

import { useActionState, useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { deleteSubscriber, saveSubscriber } from "@/app/actions/subscribers"
import { PUBLIC_TIERS, seatsForPublicTier } from "@/lib/entitlements"
import type { FormState } from "@/lib/definitions"

export type SubscriberDraft = {
  id: string | null
  fullName: string
  organisation: string
  roleTitle: string
  email: string
  phone: string
  publicTier: string
  seats: number
  termStart: string
  termEnd: string
  status: string
  invoiceRef: string
  libraryLinkUrl: string
  note: string
}

const STATUS_COPY: Record<string, string> = {
  pending: "Awaiting activation — this person cannot enter the portal yet.",
  active: "Active — portal access is open until the term end date.",
  lapsed: "Lapsed — the subscription term has ended.",
  suspended: "Suspended — portal access is being withheld.",
}

const field =
  "w-full border border-border bg-background p-3 text-sm focus:outline-none focus:border-accent"
const label =
  "block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2"

export default function SubscriberForm({
  draft,
  canDelete,
}: {
  draft: SubscriberDraft
  canDelete: boolean
}) {
  const router = useRouter()
  const action = saveSubscriber.bind(null, draft.id)
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    action,
    undefined,
  )
  const [deletePending, startDeleteTransition] = useTransition()
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null)
  const [tier, setTier] = useState(draft.publicTier)
  const [seats, setSeats] = useState(String(draft.seats || 1))
  const isIndividual = tier === "Individual Access"

  useEffect(() => {
    if (state?.ok) router.refresh()
  }, [state?.ok, router])

  function onTierChange(nextTier: string) {
    setTier(nextTier)
    if (nextTier) setSeats(String(seatsForPublicTier(nextTier)))
  }

  function removeSubscriber() {
    if (!draft.id) return
    const confirmation = window.prompt(
      `Delete ${draft.fullName || draft.email} from APRI?\n\nThis removes their APRI portal account, sessions and access records. It does not delete their Papermark link; revoke that link in Papermark too.\n\nType their email address to confirm:`,
    )
    if (confirmation === null) return

    setDeleteMessage(null)
    startDeleteTransition(async () => {
      const result = await deleteSubscriber(draft.id!, confirmation)
      if (result?.ok) {
        router.push("/admin/subscribers")
        router.refresh()
        return
      }
      setDeleteMessage(result?.message ?? "The subscriber could not be deleted.")
    })
  }

  const err = (name: string) =>
    state?.errors?.[name] ? (
      <p className="mt-2 text-xs text-red-700">{state.errors[name][0]}</p>
    ) : null

  return (
    <form action={formAction} className="border border-border bg-card/30 p-8 space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div>
          <label htmlFor="fullName" className={label}>Full name</label>
          <input id="fullName" name="fullName" defaultValue={draft.fullName} required className={field} />
          {err("fullName")}
        </div>
        <div>
          <label htmlFor="email" className={label}>Email (their sign-in)</label>
          <input id="email" name="email" type="email" defaultValue={draft.email} required className={field} />
          {err("email")}
        </div>
        <div>
          <label htmlFor="organisation" className={label}>Organisation</label>
          <input id="organisation" name="organisation" defaultValue={draft.organisation} className={field} />
          {err("organisation")}
        </div>
        <div>
          <label htmlFor="roleTitle" className={label}>Role</label>
          <input id="roleTitle" name="roleTitle" defaultValue={draft.roleTitle} className={field} />
          {err("roleTitle")}
        </div>
        <div>
          <label htmlFor="phone" className={label}>Phone</label>
          <input id="phone" name="phone" type="tel" defaultValue={draft.phone} className={field} />
          {err("phone")}
        </div>
        <div>
          <label htmlFor="invoiceRef" className={label}>Invoice reference</label>
          <input id="invoiceRef" name="invoiceRef" defaultValue={draft.invoiceRef} className={field} />
          {err("invoiceRef")}
        </div>
      </div>

      <div className="pt-6 border-t border-border">
        <h3 className="text-xs font-medium uppercase tracking-wider text-accent mb-5">Subscription</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <label htmlFor="publicTier" className={label}>Subscription access level</label>
            <select
              id="publicTier"
              name="publicTier"
              value={tier}
              onChange={(event) => onTierChange(event.target.value)}
              className={field}
            >
              <option value="">Not set</option>
              {PUBLIC_TIERS.map((option) => (
                <option key={option.name} value={option.name}>{option.name}</option>
              ))}
            </select>
            <p className="mt-2 text-xs text-muted-foreground">
              This single choice decides which subscription they bought and what they may access.
            </p>
            {err("publicTier")}
          </div>

          <div>
            <label htmlFor="seats" className={label}>Seats</label>
            <input
              id="seats"
              name="seats"
              type="number"
              min={1}
              max={500}
              value={isIndividual ? "1" : seats}
              onChange={(event) => setSeats(event.target.value)}
              readOnly={isIndividual}
              className={`${field} ${isIndividual ? "bg-black/5 text-foreground/60 cursor-not-allowed" : ""}`}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              {isIndividual
                ? "Individual Access is always one seat."
                : "Set the number of named people covered by this subscription."}
            </p>
            {err("seats")}
          </div>

          <div>
            <span className={label}>Current status</span>
            <div className="border border-border bg-black/5 p-3 text-sm text-foreground/80 min-h-[46px]">
              {draft.status}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {STATUS_COPY[draft.status] ?? "Status is controlled by the activation workflow."}
            </p>
          </div>

          <div>
            <label htmlFor="termStart" className={label}>Term start</label>
            <input id="termStart" name="termStart" type="date" defaultValue={draft.termStart} className={field} />
            {err("termStart")}
          </div>
          <div>
            <label htmlFor="termEnd" className={label}>Term end</label>
            <input id="termEnd" name="termEnd" type="date" defaultValue={draft.termEnd} className={field} />
            <p className="mt-2 text-xs text-muted-foreground">Access closes automatically after this date.</p>
            {err("termEnd")}
          </div>
        </div>
      </div>

      <div className="pt-6 border-t border-border">
        <h3 className="text-xs font-medium uppercase tracking-wider text-accent mb-5">Library link</h3>
        <div>
          <label htmlFor="libraryLinkUrl" className={label}>Their personal Papermark library link</label>
          <input
            id="libraryLinkUrl"
            name="libraryLinkUrl"
            type="text"
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            defaultValue={draft.libraryLinkUrl}
            className={field}
            placeholder="https://docs.athenacentre.org/…"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Paste the subscriber&apos;s private Papermark link. Custom-domain links such as
            docs.athenacentre.org are accepted, with or without typing https:// first.
          </p>
          {err("libraryLinkUrl")}
        </div>
      </div>

      <div>
        <label htmlFor="note" className={label}>Internal note</label>
        <textarea id="note" name="note" rows={3} defaultValue={draft.note} className={field} />
        {err("note")}
      </div>

      {state?.message && (
        <p className={`text-sm p-3 border ${
          state.ok
            ? "text-foreground border-border bg-accent/5"
            : "text-red-700 border-red-200 bg-red-50"
        }`}>
          {state.message}
        </p>
      )}
      {deleteMessage && (
        <p className="text-sm p-3 border text-red-700 border-red-200 bg-red-50">{deleteMessage}</p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-border">
        <div>
          {draft.id && canDelete && (
            <button
              type="button"
              onClick={removeSubscriber}
              disabled={deletePending}
              className="border border-red-200 bg-red-50 text-red-700 px-4 py-2 text-sm font-medium hover:bg-red-100 disabled:opacity-50 transition-colors cursor-pointer"
            >
              {deletePending ? "Deleting…" : "Delete subscriber"}
            </button>
          )}
        </div>
        <div className="flex items-center gap-4">
          <Link href="/admin/subscribers" className="px-4 py-2 text-sm font-medium text-foreground/70 hover:text-foreground transition-colors">
            Back
          </Link>
          <button
            type="submit"
            disabled={pending || deletePending}
            className="bg-accent text-white px-6 py-2 text-sm font-medium tracking-wide hover:bg-accent-hover disabled:opacity-50 transition-colors cursor-pointer"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </form>
  )
}
