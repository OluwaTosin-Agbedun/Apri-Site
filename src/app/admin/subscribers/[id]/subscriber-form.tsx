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
  LEVELS,
  PUBLIC_TIERS,
  levelForPublicTier,
  levelLabel,
  seatsForPublicTier,
} from "@/lib/entitlements"
import type { FormState } from "@/lib/definitions"

export type SubscriberDraft = {
  id: string | null
  clientType: string
  fullName: string
  organisation: string
  roleTitle: string
  email: string
  phone: string
  publicTier: string
  level: string
  seats: number
  termStart: string
  termEnd: string
  status: string
  invoiceRef: string
  libraryLinkUrl: string
  note: string
}

const STATUSES = [
  { value: "pending", label: "Pending — enquiry, no access" },
  { value: "active", label: "Active — access open" },
  { value: "lapsed", label: "Lapsed — term ended" },
  { value: "suspended", label: "Suspended — access withheld" },
]

const field =
  "w-full border border-border bg-background p-3 text-sm focus:outline-none focus:border-accent"
const label =
  "block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2"

export default function SubscriberForm({ draft }: { draft: SubscriberDraft }) {
  const router = useRouter()
  const action = saveSubscriber.bind(null, draft.id)
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    action,
    undefined,
  )
  useEffect(() => {
    if (state?.ok) router.refresh()
  }, [state?.ok, router])
  const [clientType, setClientType] = useState(draft.clientType || "subscriber")
  const [level, setLevel] = useState(draft.level)
  const [seats, setSeats] = useState(String(draft.seats))
  const isSubscriber = clientType !== "engagement"
  const parsedSeats = Number.parseInt(seats, 10)
  const seatCount =
    Number.isFinite(parsedSeats) && parsedSeats > 0 ? parsedSeats : 1

  function onTierChange(tier: string) {
    const mapped = levelForPublicTier(tier)
    if (mapped) {
      setLevel(mapped)
      setSeats(String(seatsForPublicTier(tier)))
    }
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
      {}
      <div>
        <label htmlFor="clientType" className={label}>
          This person is a
        </label>
        <select
          id="clientType"
          name="clientType"
          value={clientType}
          onChange={(e) => setClientType(e.target.value)}
          className={field}
        >
          <option value="subscriber">
            Subscriber — holds a level, gets a library
          </option>
          <option value="engagement">
            Briefing client — no level, receives documents individually
          </option>
        </select>
        <p className="mt-2 text-xs text-muted-foreground">
          {clientType === "engagement"
            ? "A briefing client holds no access level and sees no library. Issue their board papers from the Copies queue."
            : "A subscriber sees every edition at or below their level."}
        </p>
        {err("clientType")}
      </div>

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

      <div
        className={`pt-6 border-t border-border ${
          isSubscriber ? "" : "hidden"
        }`}
      >
        <h3 className="text-xs font-medium uppercase tracking-wider text-accent mb-5">
          Subscription
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <label htmlFor="publicTier" className={label}>
              Tier (as named publicly)
            </label>
            <select
              id="publicTier"
              name="publicTier"
              defaultValue={draft.publicTier}
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
            <label htmlFor="level" className={label}>
              Access level (internal)
            </label>
            <select
              id="level"
              name="level"
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              className={field}
            >
              <option value="">Not set</option>
              {}
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {levelLabel(l, seatCount)}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-muted-foreground">
              Decides what they can read. Never shown to the subscriber.
            </p>
            {err("level")}
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
              className={field}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              For the record only. Each named person needs their own row here.
            </p>
            {err("seats")}
          </div>
          <div>
            <label htmlFor="status" className={label}>
              Status
            </label>
            <select
              id="status"
              name="status"
              defaultValue={draft.status || "pending"}
              className={field}
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            {err("status")}
          </div>
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

        <div>
          <label htmlFor="libraryLinkUrl" className={label}>
            Their personal Papermark link
          </label>
          <input
            id="libraryLinkUrl"
            name="libraryLinkUrl"
            type="url"
            defaultValue={draft.libraryLinkUrl}
            className={field}
            placeholder="https://www.papermark.com/view/…"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Paste the subscriber&apos;s private Papermark multi-file share link. It will be
            embedded securely inside their portal. Enable downloading in the link&apos;s
            Papermark settings if the subscriber should download the files.
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
