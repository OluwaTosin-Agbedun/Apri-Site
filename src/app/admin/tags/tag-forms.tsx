"use client"

import { useActionState, useId } from "react"
import SubmitButton from "@/components/SubmitButton"
import {
  addPublicationTag,
  deletePublicationTag,
  renamePublicationTag,
  setPublicationTagActive,
} from "@/app/actions/publication-metadata"
import type { FormState } from "@/lib/definitions"
import { MAX_TAG_LABEL_LENGTH, TAG_KINDS, TAG_KIND_LABELS, type TagKind } from "@/lib/publication-metadata"

const field = "w-full min-w-0 border border-border bg-background p-2.5 text-sm focus:outline-none focus:border-accent"
const primary = "inline-flex min-h-10 items-center justify-center gap-2 bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-colors cursor-pointer"
const quiet = "inline-flex min-h-9 items-center justify-center gap-2 border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:border-accent hover:text-accent disabled:opacity-50 transition-colors cursor-pointer"

function Message({ state }: { state: FormState }) {
  if (!state?.message) return null
  return (
    <p role="status" className={`text-xs ${state.ok ? "text-foreground/80" : "text-red-700"}`}>
      {state.message}
    </p>
  )
}

/**
 * Adds a subject, sector or geography to the vocabulary. Any administrator.
 * `publicationId` refreshes that publication's editor too, so the new tag can
 * be ticked straight away.
 */
export function AddTagForm({ publicationId, defaultKind = "subject", disabled = false }: { publicationId?: string; defaultKind?: TagKind; disabled?: boolean }) {
  const [state, action] = useActionState<FormState, FormData>(addPublicationTag, undefined)
  const id = useId()
  return (
    <form action={action} className="space-y-2">
      {publicationId && <input type="hidden" name="publicationId" value={publicationId} />}
      <fieldset disabled={disabled} className="grid grid-cols-1 sm:grid-cols-[10rem_1fr_auto] gap-2 items-end disabled:opacity-60">
        <legend className="sr-only">Add a tag</legend>
        <label htmlFor={`${id}-kind`} className="block text-xs font-medium text-muted-foreground">
          Kind
          <select id={`${id}-kind`} name="kind" defaultValue={defaultKind} className={`${field} mt-1`}>
            {TAG_KINDS.map((kind) => <option key={kind} value={kind}>{TAG_KIND_LABELS[kind].label}</option>)}
          </select>
        </label>
        <label htmlFor={`${id}-label`} className="block text-xs font-medium text-muted-foreground">
          New tag
          <input id={`${id}-label`} name="label" required maxLength={MAX_TAG_LABEL_LENGTH} autoComplete="off" className={`${field} mt-1`} placeholder="e.g. Electricity tariffs" />
        </label>
        <SubmitButton busy="Adding…" className={primary}>Add tag</SubmitButton>
      </fieldset>
      <Message state={state} />
    </form>
  )
}

/** Renames a tag on every publication that carries it. Owners only (checked on the server). */
export function RenameTagForm({ id, label }: { id: string; label: string }) {
  const [state, action] = useActionState<FormState, FormData>(renamePublicationTag, undefined)
  const inputId = useId()
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap items-end gap-2">
        <label htmlFor={inputId} className="sr-only">Rename “{label}”</label>
        <input id={inputId} name="label" defaultValue={label} required maxLength={MAX_TAG_LABEL_LENGTH} autoComplete="off" className={`${field} max-w-xs`} />
        <SubmitButton busy="Renaming…" className={quiet}>Rename</SubmitButton>
      </div>
      <Message state={state} />
    </form>
  )
}

/** Retire (no longer offered; kept where it is) or restore. Owners only (checked on the server). */
export function TagStateForm({ id, active, label }: { id: string; active: boolean; label: string }) {
  const [state, action] = useActionState<FormState, FormData>(setPublicationTagActive, undefined)
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="state" value={active ? "retire" : "restore"} />
      <SubmitButton busy={active ? "Retiring…" : "Restoring…"} className={quiet}>
        {active ? "Retire" : "Restore"}<span className="sr-only"> “{label}”</span>
      </SubmitButton>
      <Message state={state} />
    </form>
  )
}

/** Deletes a tag no publication carries. Owners only (checked on the server). */
export function DeleteTagForm({ id, label }: { id: string; label: string }) {
  const [state, action] = useActionState<FormState, FormData>(deletePublicationTag, undefined)
  return (
    <form
      action={action}
      className="space-y-1"
      onSubmit={(event) => {
        if (!window.confirm(`Delete “${label}”? No publication carries it. This cannot be undone.`)) event.preventDefault()
      }}
    >
      <input type="hidden" name="id" value={id} />
      <SubmitButton busy="Deleting…" className={quiet}>
        Delete<span className="sr-only"> “{label}”</span>
      </SubmitButton>
      <Message state={state} />
    </form>
  )
}
