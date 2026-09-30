"use client"

import { useActionState, useState } from "react"
import {
  addPaidPeriod,
  reconcilePublicationAccess,
  setPaidPeriodVoided,
  setPublicationException,
} from "@/app/actions/subscribers"
import { setPaidRelease } from "@/app/actions/documents"
import type { FormState } from "@/lib/definitions"

const input = "border border-border bg-background p-2 text-xs"

function Result({ state }: { state: FormState }) {
  if (!state?.message) return null
  return (
    <p role="status" className={`text-xs mt-2 leading-relaxed ${state.ok ? "text-foreground/80" : "text-red-700"}`}>
      {state.message}
    </p>
  )
}

/** Repair document links: recalculate, create, repair, withdraw, verify. Never emails. */
export function RepairForm({ subscriberId }: { subscriberId: string }) {
  const [state, action, pending] = useActionState(reconcilePublicationAccess, undefined)
  return (
    <form action={action}>
      <input type="hidden" name="subscriberId" value={subscriberId} />
      <button className="btn-secondary text-xs" type="submit" disabled={pending}>
        {pending ? "Repairing…" : "Repair document links"}
      </button>
      <Result state={state} />
    </form>
  )
}

export function AddPeriodForm({ subscriberId, levels }: { subscriberId: string; levels: readonly string[] }) {
  const [state, action, pending] = useActionState(addPaidPeriod, undefined)
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="subscriberId" value={subscriberId} />
      <label className="text-xs text-muted-foreground flex flex-col gap-1">From<input className={input} type="date" name="startsOn" required /></label>
      <label className="text-xs text-muted-foreground flex flex-col gap-1">To (inclusive)<input className={input} type="date" name="endsOn" required /></label>
      <label className="text-xs text-muted-foreground flex flex-col gap-1">Level
        <select className={input} name="level" defaultValue="">
          <option value="" disabled>Choose</option>
          {levels.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </label>
      <label className="text-xs text-muted-foreground flex flex-col gap-1 grow min-w-[12rem]">Reason (invoice or agreement)<input className={input} name="reason" required maxLength={500} /></label>
      <button className="btn-secondary text-xs" type="submit" disabled={pending}>{pending ? "Adding…" : "Add paid period"}</button>
      <div className="basis-full"><Result state={state} /></div>
    </form>
  )
}

export function VoidPeriodForm({ subscriberId, periodId, voided }: { subscriberId: string; periodId: string; voided: boolean }) {
  const [state, action, pending] = useActionState(setPaidPeriodVoided, undefined)
  const [open, setOpen] = useState(false)
  if (!open) {
    return <button type="button" className="text-xs text-accent hover:text-accent-hover" onClick={() => setOpen(true)}>{voided ? "Restore" : "Void as a mistake"}</button>
  }
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="subscriberId" value={subscriberId} />
      <input type="hidden" name="periodId" value={periodId} />
      <input type="hidden" name="action" value={voided ? "restore" : "void"} />
      <input className={input} name="reason" required maxLength={500} placeholder="Reason" aria-label="Reason" />
      <button className="btn-secondary text-xs" type="submit" disabled={pending}>{voided ? "Restore period" : "Void period"}</button>
      <Result state={state} />
    </form>
  )
}

/** Automatic / Allow / Block for one publication, always with a reason. */
export function PublicationAccessControl({
  subscriberId,
  publicationId,
  title,
  current,
}: {
  subscriberId: string
  publicationId: string
  title: string
  current: string | null
}) {
  const [state, action, pending] = useActionState(setPublicationException, undefined)
  const [decision, setDecision] = useState(current ?? "automatic")
  const [confirming, setConfirming] = useState(false)
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="subscriberId" value={subscriberId} />
      <input type="hidden" name="publicationId" value={publicationId} />
      <select
        name="decision"
        value={decision}
        onChange={(e) => {
          setDecision(e.target.value)
          setConfirming(false)
        }}
        className={input}
        aria-label={`Access control for ${title}`}
      >
        <option value="automatic">Automatic</option>
        <option value="allow">Allow</option>
        <option value="block">Block</option>
      </select>
      <input name="reason" required maxLength={500} aria-label="Reason" placeholder="Reason (required)" className={input} />
      {!confirming ? (
        <button className="btn-secondary text-xs" type="button" onClick={() => setConfirming(true)}>Preview</button>
      ) : (
        <>
          <span className="text-xs" role="status">
            {decision === "allow" ? `Allow “${title}” for this subscriber` : decision === "block" ? `Block “${title}” for this subscriber` : `Return “${title}” to the paid-period rule`}
          </span>
          <button className="btn-secondary text-xs" type="submit" disabled={pending}>Confirm</button>
        </>
      )}
      <div className="basis-full"><Result state={state} /></div>
    </form>
  )
}

/** Release to paid subscribers, withhold, or return to undecided, with a reason. */
export function PaidReleaseForm({ publicationId, current }: { publicationId: string; current: "released" | "withheld" | null }) {
  const [state, action, pending] = useActionState(setPaidRelease, undefined)
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="publicationId" value={publicationId} />
      <select name="state" defaultValue={current ?? "undecided"} className={input} aria-label="Paid release">
        <option value="released">Released to paid subscribers</option>
        <option value="withheld">Withheld</option>
        <option value="undecided">Undecided</option>
      </select>
      <input name="reason" required maxLength={500} aria-label="Reason" placeholder="Reason (required)" className={input} />
      <button className="btn-secondary text-xs" type="submit" disabled={pending}>{pending ? "Saving…" : "Save release decision"}</button>
      <div className="basis-full"><Result state={state} /></div>
    </form>
  )
}

