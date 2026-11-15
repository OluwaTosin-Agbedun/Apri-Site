"use client"

import { useActionState, useId, useState } from "react"
import SubmitButton from "@/components/SubmitButton"
import type { FormState } from "@/lib/definitions"
import { addFolderMapping, removeFolderMapping, savePublicationCategory } from "@/app/actions/publication-categories"

const field = "w-full min-w-0 border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-accent"
const label = "block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1"
const primary =
  "inline-flex items-center justify-center bg-foreground text-background px-4 py-2 text-sm font-medium disabled:opacity-40 cursor-pointer"
const secondary = "inline-flex items-center justify-center border border-border px-3 py-1.5 text-xs hover:bg-black/5 disabled:opacity-40 cursor-pointer"

function Message({ state }: { state: FormState }) {
  if (!state?.message) return null
  return (
    <p role={state.ok ? "status" : "alert"} className={`mt-2 text-xs ${state.ok ? "text-green-700" : "text-red-700"}`}>
      {state.message}
    </p>
  )
}

export type CategoryRow = {
  code: string
  label: string
  singularLabel: string
  sortOrder: number
  active: boolean
  aliases: string[]
  usage: string
  inUse: boolean
}

/** One category's editable labels, position, active flag and other names. */
export function CategoryForm({ category, disabled }: { category: CategoryRow; disabled: boolean }) {
  const [state, action] = useActionState<FormState, FormData>(savePublicationCategory, undefined)
  const [active, setActive] = useState(category.active)
  const id = `category-${category.code.toLowerCase()}`
  return (
    <form action={action} className="border border-border bg-card/30 p-4 sm:p-5" aria-labelledby={`${id}-name`}>
      <input type="hidden" name="code" value={category.code} />
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
        <h3 id={`${id}-name`} className="font-serif text-lg">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-accent mr-2">{category.code}</span>
          {category.label}
        </h3>
        <span className="text-xs text-muted-foreground">{category.usage}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label htmlFor={`${id}-label`} className="block min-w-0">
          <span className={label}>Section label (plural)</span>
          <input id={`${id}-label`} name="label" defaultValue={category.label} maxLength={80} required className={field} disabled={disabled} />
        </label>
        <label htmlFor={`${id}-singular`} className="block min-w-0">
          <span className={label}>Card label (singular)</span>
          <input id={`${id}-singular`} name="singularLabel" defaultValue={category.singularLabel} maxLength={80} required className={field} disabled={disabled} />
        </label>
        <label htmlFor={`${id}-order`} className="block min-w-0">
          <span className={label}>Position (lower comes first)</span>
          <input id={`${id}-order`} name="sortOrder" type="number" min={0} max={9999} step={1} defaultValue={category.sortOrder} required className={field} disabled={disabled} />
        </label>
        <label htmlFor={`${id}-aliases`} className="block min-w-0">
          <span className={label}>Other names (comma separated, for reference only)</span>
          <input id={`${id}-aliases`} name="aliases" defaultValue={category.aliases.join(", ")} className={field} disabled={disabled} />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="inline-flex items-center gap-2 text-sm min-h-11">
          <input type="checkbox" name="active" checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-accent" disabled={disabled} />
          Active (offered for new choices)
        </label>
        {category.active && !active && category.inUse && (
          <label className="inline-flex items-center gap-2 text-sm text-amber-800 min-h-11">
            <input type="checkbox" name="confirmDeactivate" value="yes" className="accent-accent" disabled={disabled} />
            I understand this category is in use. Its editions stay listed; it is only no longer offered for new choices.
          </label>
        )}
        <SubmitButton busy="Saving…" className={primary} disabled={disabled}>
          Save
        </SubmitButton>
      </div>
      <Message state={state} />
    </form>
  )
}

/** Map a Papermark folder to a category. */
export function AddFolderForm({
  categories,
  disabled,
  folder = "",
}: {
  categories: { code: string; label: string }[]
  disabled: boolean
  folder?: string
}) {
  const [state, action] = useActionState<FormState, FormData>(addFolderMapping, undefined)
  // Unique per form: the same folder can be offered more than once on the page.
  const id = `add-folder-${useId()}`
  return (
    <form action={action} className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 items-end">
      <label htmlFor={`${id}-folder`} className="block min-w-0">
        <span className={label}>Papermark folder name</span>
        <input id={`${id}-folder`} name="folder" defaultValue={folder} required maxLength={200} placeholder="e.g. Quarterly Intelligence Briefs" className={field} disabled={disabled} />
      </label>
      <label htmlFor={`${id}-code`} className="block min-w-0">
        <span className={label}>Category</span>
        <select id={`${id}-code`} name="code" required defaultValue="" className={field} disabled={disabled}>
          <option value="" disabled>
            Choose a category
          </option>
          {categories.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} · {c.label}
            </option>
          ))}
        </select>
      </label>
      <SubmitButton busy="Mapping…" className={primary} disabled={disabled}>
        Map folder
      </SubmitButton>
      <div className="md:col-span-3">
        <Message state={state} />
      </div>
    </form>
  )
}

/** Remove one folder mapping. */
export function RemoveFolderButton({ folderSlug, disabled }: { folderSlug: string; disabled: boolean }) {
  const [state, action] = useActionState<FormState, FormData>(removeFolderMapping, undefined)
  return (
    <form action={action}>
      <input type="hidden" name="folderSlug" value={folderSlug} />
      <SubmitButton busy="Removing…" className={secondary} disabled={disabled}>
        Remove
      </SubmitButton>
      <Message state={state} />
    </form>
  )
}
