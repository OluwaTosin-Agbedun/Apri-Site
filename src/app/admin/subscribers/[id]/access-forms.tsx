"use client"

import { Busy } from "@/components/Spinner"
import { useActionState, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
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

/**
 * After a save, the links are prepared in the background: refresh the page a
 * few seconds later so the panel shows the result without another click.
 */
function useRefreshAfterSave(state: FormState) {
  const router = useRouter()
  useEffect(() => {
    if (!state?.ok) return
    // Twice: the background preparation usually finishes within a few seconds.
    const timers = [2500, 7000].map((ms) => setTimeout(() => router.refresh(), ms))
    return () => timers.forEach(clearTimeout)
  }, [state, router])
}

/**
 * Prepare library access: their plan's library, and a verified personal link
 * for every document they should see. Never emails.
 */
export function RepairForm({ subscriberId }: { subscriberId: string }) {
  const [state, action, pending] = useActionState(reconcilePublicationAccess, undefined)
  return (
    <form action={action}>
      <input type="hidden" name="subscriberId" value={subscriberId} />
      <button className="btn-primary text-xs" type="submit" disabled={pending}>
        <Busy pending={pending} idle={"Prepare library access"} busy={"Preparing…"} />
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
      <button className="btn-secondary text-xs" type="submit" disabled={pending}><Busy pending={pending} idle={"Add an earlier term"} busy={"Adding…"} /></button>
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
  useRefreshAfterSave(state)
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 w-full min-w-0">
      <input type="hidden" name="subscriberId" value={subscriberId} />
      <input type="hidden" name="publicationId" value={publicationId} />
      <select
        name="decision"
        value={decision}
        onChange={(e) => setDecision(e.target.value)}
        className={input}
        aria-label={`Access control for ${title}`}
      >
        <option value="automatic">Automatic (follow the rule)</option>
        <option value="allow">Also give to this subscriber</option>
        <option value="block">Hide from this subscriber</option>
      </select>
      <input name="reason" maxLength={500} aria-label="Reason (optional)" placeholder="Reason (optional)" className={`${input} grow min-w-[10rem]`} />
      <button className="btn-primary text-xs disabled:opacity-40 disabled:cursor-default" type="submit" disabled={pending || decision === (current ?? "automatic")}>
        <Busy pending={pending} idle={"Save"} busy={"Saving…"} />
      </button>
      <div className="basis-full min-w-0 break-words"><Result state={state} /></div>
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
  useRefreshAfterSave(result)
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
        <input name="reason" maxLength={500} aria-label="Reason (optional)" placeholder="Reason (optional)" className={`${input} grow min-w-[14rem]`} />
        <button className="btn-secondary text-xs" type="submit" disabled={pending}><Busy pending={pending} idle={"Save"} busy={"Saving…"} /></button>
      </div>
      <Result state={result} />
    </form>
  )
}
