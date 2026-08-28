"use client"
/** 'subscriber' holds a level and gets a library; 'engagement' holds neither. */

// The internal level follows from the public tier, so choosing a tier fills it
// in. It stays editable because a negotiated seat may sit outside the standard
// mapping, and the server validates whatever is submitted either way.

// A briefing client holds no level, so the subscription block is hidden
// rather than merely ignored -- leaving it on screen invites someone to fill
// it in and then wonder why it had no effect.

// A blank or half-typed seats field must not make the L2 label flicker to the
// wrong tier, so anything unparseable falls back to a single seat.
/*
        What this person is to us, chosen first because it decides whether the
        subscription fields below apply at all.
      */ /*
                LEVELS is already in L1..L4 order, so the list is never sorted
                alphabetically. The label follows the seat count being edited,
                so L2 reads as Individual or Professional Team as it is typed.
              */
import { useActionState, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { saveSubscriber } from "@/app/actions/subscribers"
import {
  PUBLIC_TIERS,
  seatsForPublicTier,
} from "@/lib/entitlements"
import type { FormState } from "@/lib/definitions"
import PapermarkFolderSelector from "@/components/PapermarkFolderSelector"
import type { PapermarkFolder } from "@/lib/papermark"

export type SubscriberDraft = {
  id: string | null
  clientType: string
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
  papermarkFolderId: string
}

const field =
  "w-full border border-border bg-background p-3 text-sm focus:outline-none focus:border-accent"
const label =
  "block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2"

export default function SubscriberForm({ draft, folders = [], folderError }: { draft: SubscriberDraft; folders?: PapermarkFolder[]; folderError?: string }) {
  const router = useRouter()
  const action = saveSubscriber.bind(null, draft.id)
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    action,
    undefined,
  )
  useEffect(() => {
    if (state?.ok) router.refresh()
  }, [state, router])
  const [publicTier, setPublicTier] = useState(draft.publicTier)
  const [seats, setSeats] = useState(String(draft.seats))

  function onTierChange(tier: string) {
    setPublicTier(tier)
    setSeats(String(seatsForPublicTier(tier)))
  }

  const err = (name: string) =>
    state?.errors?.[name] ? (
      <p className="mt-2 text-xs text-red-700">{state.errors[name][0]}</p>
    ) : null

  return (
    <form
      action={formAction}
      className="border border-border bg-card/30 p-8 space-y-6"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div>
          <label htmlFor="fullName" className={label}>
            Full name
          </label>
          <input
            id="fullName"
            name="fullName"
            defaultValue={draft.fullName}
            required
            className={field}
          />
          {err("fullName")}
        </div>
        <div>
          <label htmlFor="email" className={label}>
            Email (their sign-in)
          </label>
          <input
            id="email"
            name="email"
            type="email"
            defaultValue={draft.email}
            required
            className={field}
          />
          {err("email")}
        </div>
        <div>
          <label htmlFor="organisation" className={label}>
            Organisation
          </label>
          <input
            id="organisation"
            name="organisation"
            defaultValue={draft.organisation}
            className={field}
          />
          {err("organisation")}
        </div>
        <div>
          <label htmlFor="roleTitle" className={label}>
            Role
          </label>
          <input
            id="roleTitle"
            name="roleTitle"
            defaultValue={draft.roleTitle}
            className={field}
          />
          {err("roleTitle")}
        </div>
        <div>
          <label htmlFor="phone" className={label}>
            Phone
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            defaultValue={draft.phone}
            className={field}
          />
          {err("phone")}
        </div>
        <div>
          <label htmlFor="invoiceRef" className={label}>
            Invoice reference
          </label>
          <input
            id="invoiceRef"
            name="invoiceRef"
            defaultValue={draft.invoiceRef}
            className={field}
          />
          {err("invoiceRef")}
        </div>
      </div>

      <div className="pt-6 border-t border-border">
        <h3 className="text-xs font-medium uppercase tracking-wider text-accent mb-5">
          Subscription
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <label htmlFor="publicTier" className={label}>
              Subscription access level
            </label>
            <select
              id="publicTier"
              name="publicTier"
              value={publicTier}
              onChange={(e) => onTierChange(e.target.value)}
              className={field}
            >
              <option value="">Not set</option>
              {PUBLIC_TIERS.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
            {err("publicTier")}
          </div>

          <div>
            <label htmlFor="seats" className={label}>
              Seats
            </label>
            <input
              id="seats"
              name="seats"
              type="number"
              min={1}
              value={seats}
              onChange={(e) => setSeats(e.target.value)}
              readOnly={publicTier === "Individual Access"}
              className={field}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              {isIndividual
                ? "Individual Access is always one seat."
                : "Set the number of named people covered by this subscription."}
            </p>
            {err("seats")}
          </div>
          <div><span className={label}>Status</span><p className="text-sm font-medium capitalize">{draft.status}</p></div>
          <div>
            <label htmlFor="termStart" className={label}>
              Term start
            </label>
            <input
              id="termStart"
              name="termStart"
              type="date"
              defaultValue={draft.termStart}
              className={field}
            />
            {err("termStart")}
          </div>

          <div>
            <label htmlFor="termEnd" className={label}>
              Term end
            </label>
            <input
              id="termEnd"
              name="termEnd"
              type="date"
              defaultValue={draft.termEnd}
              className={field}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Access closes automatically after this date.
            </p>
            {err("termEnd")}
          </div>
        </div>
      </div>

      <div className="pt-6 border-t border-border">
        <h3 className="text-xs font-medium uppercase tracking-wider text-accent mb-5">
          Library link
        </h3>

        {draft.id && <div className="mb-6"><PapermarkFolderSelector kind="subscriber" id={draft.id} value={draft.papermarkFolderId} folders={folders} error={folderError} /></div>}
        <div>
          <label htmlFor="libraryLinkUrl" className={label}>
            Private Papermark share link
          </label>
          <label htmlFor="libraryLinkUrl" className={label}>Their personal Papermark library link</label>
          <input
            id="libraryLinkUrl"
            name="libraryLinkUrl"
            type="text"
            defaultValue={draft.libraryLinkUrl}
            className={field}
            placeholder="https://docs.athenacentre.org/…"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Use a document link when this person should see one document. Use a multi-file
            share link when they should see a library containing several documents.
            Uploading another document into the same Papermark folder does not automatically
            add it to an existing single-document link.
          </p>
          {err("libraryLinkUrl")}
        </div>
      </div>

      <div>
        <label htmlFor="note" className={label}>
          Internal note
        </label>
        <textarea
          id="note"
          name="note"
          rows={3}
          defaultValue={draft.note}
          className={field}
        />
        {err("note")}
      </div>

      {state?.message && (
        <p
          className={`text-sm p-3 border ${
            state.ok
              ? "text-foreground border-border bg-accent/5"
              : "text-red-700 border-red-200 bg-red-50"
          }`}
        >
          {state.message}
        </p>
      )}
      <div className="flex justify-end gap-4 pt-4 border-t border-border">
        <Link
          href="/admin/subscribers"
          className="px-4 py-2 text-sm font-medium text-foreground/70 hover:text-foreground transition-colors"
        >
          Back
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="bg-accent text-white px-6 py-2 text-sm font-medium tracking-wide hover:bg-accent-hover disabled:opacity-50 transition-colors cursor-pointer"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  )
}
