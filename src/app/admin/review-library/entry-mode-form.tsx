"use client"

import { useActionState, useState } from "react"
import { setReviewEntryMode } from "@/app/actions/review-reader"
import { Busy } from "@/components/Spinner"

const LABEL = {
  papermark: "Each edition's own Papermark link",
  library: "APRI Review Library (APRI sign-in, then a Papermark code per edition)",
  rooms: "Personal Papermark rooms (one Papermark code)",
} as const

/**
 * Advanced: where the public review cards lead. The page passes the setting
 * that is IN EFFECT (read from the database on every load) and remounts this
 * form whenever it changes (key on the page), so the select and the line
 * above it always show the persisted value -- never a value React's form
 * reset or a stale action message left behind.
 */
export default function EntryModeForm({
  mode,
  ready,
  roomsReady,
}: {
  mode: "papermark" | "library" | "rooms"
  ready: boolean
  /** Rooms migration applied and the two-reader proof recorded. */
  roomsReady: boolean
}) {
  const [state, action, pending] = useActionState(setReviewEntryMode, undefined)
  const [choice, setChoice] = useState<string>(mode)
  return (
    <div>
      <p className="text-sm mb-3">
        In effect now: <strong>{LABEL[mode]}</strong>
      </p>
      <form action={action} className="flex flex-wrap items-center gap-3">
        <select
          name="mode"
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          className="border border-border bg-background px-3 py-2 text-sm"
          aria-label="Where public review cards lead"
        >
          <option value="papermark">{LABEL.papermark}</option>
          <option value="library" disabled={!ready}>
            {LABEL.library}
            {ready ? "" : " (needs migration 20261008)"}
          </option>
          <option value="rooms" disabled={!roomsReady}>
            {LABEL.rooms}
            {roomsReady ? "" : " (needs the recorded two-reader test)"}
          </option>
        </select>
        <button type="submit" className="btn-secondary text-xs" disabled={pending || choice === mode} aria-busy={pending}>
          <Busy pending={pending} idle="Save" busy="Saving…" />
        </button>
      </form>
      {state?.message && (
        <p className={`mt-2 text-xs ${state.ok ? "text-foreground/80" : "text-red-700"}`} role="status">
          {state.message}
        </p>
      )}
    </div>
  )
}
