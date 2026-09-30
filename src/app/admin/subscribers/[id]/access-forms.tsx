"use client"

import { useActionState, useState } from "react"
import {
  addPaidPeriod,
  reconcilePublicationAccess,
  setPaidPeriodVoided,
  setPublicationException,
} from "@/app/actions/subscribers"
import { saveEditionAvailability } from "@/app/actions/documents"
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

export function AddPeriodForm({ subscriberId, level }: { subscriberId: string; level: string }) {
  const [state, action, pending] = useActionState(addPaidPeriod, undefined)
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="subscriberId" value={subscriberId} />
      <label className="text-xs text-muted-foreground flex flex-col gap-1">From<input className={input} type="date" name="startsOn" required /></label>
      <label className="text-xs text-muted-foreground flex flex-col gap-1">To (inclusive)<input className={input} type="date" name="endsOn" required /></label>
      <input type="hidden" name="level" value={level} />
      <label className="text-xs text-muted-foreground flex flex-col gap-1 grow min-w-[12rem]">Reason (invoice or agreement)<input className={input} name="reason" required maxLength={500} /></label>
      <button className="btn-secondary text-xs" type="submit" disabled={pending}>{pending ? "Adding…" : "Add an earlier term"}</button>
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
        <option value="automatic">Automatic (follow the rule)</option>
        <option value="allow">Also give to this subscriber</option>
        <option value="block">Hide from this subscriber</option>
      </select>
      <input name="reason" required maxLength={500} aria-label="Reason" placeholder="Reason (required)" className={input} />
      {!confirming ? (
        <button className="btn-secondary text-xs" type="button" onClick={() => setConfirming(true)}>Preview</button>
      ) : (
        <>
          <span className="text-xs" role="status">
            {decision === "allow" ? `Give “${title}” to this subscriber` : decision === "block" ? `Hide “${title}” from this subscriber` : `Let the rule decide “${title}” for this subscriber`}
          </span>
          <button className="btn-secondary text-xs" type="submit" disabled={pending}>Confirm</button>
        </>
      )}
      <div className="basis-full"><Result state={state} /></div>
    </form>
  )
}

/**
 * Who gets this edition: the plans that receive it and whether it is On for
 * subscribers. Saving updates every affected subscriber's access at once.
 */
export function EditionAvailabilityForm({
  publicationId,
  plans,
  current,
  state,
}: {
  publicationId: string
  /** Every plan: stored name and display name. */
  plans: readonly { value: string; label: string }[]
  /** The plans ticked now. */
  current: readonly string[]
  state: "released" | "withheld" | null
}) {
  const [result, action, pending] = useActionState(saveEditionAvailability, undefined)
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="publicationId" value={publicationId} />
      <fieldset>
        <legend className="text-xs text-muted-foreground mb-2">Plans that receive this edition</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {plans.map((p) => (
            <label key={p.value} className="text-sm flex items-center gap-2">
              <input type="checkbox" name="plans" value={p.value} defaultChecked={current.includes(p.value)} />
              {p.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        <select name="state" defaultValue={state ?? "undecided"} className={input} aria-label="Show to subscribers">
          <option value="released">On: show to subscribers</option>
          <option value="withheld">Off: do not show</option>
          <option value="undecided">Not decided yet</option>
        </select>
        <input name="reason" required maxLength={500} aria-label="Reason" placeholder="Reason (required)" className={`${input} grow min-w-[14rem]`} />
        <button className="btn-secondary text-xs" type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
      </div>
      <Result state={result} />
    </form>
  )
}
