"use client"

import { useActionState, useState } from "react"
import { useRouter } from "next/navigation"
import {
  saveReviewLibrarySettings,
  addReviewItem,
  removeReviewItem,
  reorderReviewItems,
  saveReviewItemDetails,
  regenerateReviewItemDetails,
} from "@/app/actions/review-library"
import type { FormState } from "@/lib/definitions"

const field =
  "w-full border border-border bg-background p-3 text-sm focus:outline-none focus:border-accent"
const label =
  "block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2"
const btnPrimary =
  "bg-foreground text-background px-6 py-3 text-sm font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50 cursor-pointer"
const btnSecondary =
  "border border-border px-4 py-2 text-sm hover:bg-black/5 transition-colors disabled:opacity-50 cursor-pointer"

type ReviewItem = {
  id: string
  publicationId: string
  displayOrder: number
  isActive: boolean
  publicationType: string
  description: string
  frequency: string
  audience: string
  pubTitle: string
  series: string
  slug: string
}

type AvailablePublication = {
  id: string
  title: string
  series: string
}

export default function ReviewLibraryForm({
  enabled,
  papermarkUrl,
  items,
  availablePublications,
}: {
  enabled: boolean
  papermarkUrl: string
  items: ReviewItem[]
  availablePublications: AvailablePublication[]
}) {
  return (
    <div className="space-y-8">
      <SettingsSection enabled={enabled} papermarkUrl={papermarkUrl} />
      <AddItemSection publications={availablePublications} />
      {items.length > 0 && <ReorderSection items={items} />}
      {items.map((item) => (
        <ItemCard key={item.id} item={item} />
      ))}
    </div>
  )
}

function SettingsSection({ enabled, papermarkUrl }: { enabled: boolean; papermarkUrl: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    saveReviewLibrarySettings,
    {},
  )

  return (
    <div className="border border-border bg-card/30 p-6">
      <h3 className="font-serif text-lg text-foreground mb-4">Library Settings</h3>
      <form action={formAction} className="space-y-4">
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            name="enabled"
            id="review-enabled"
            defaultChecked={enabled}
            className="accent-accent"
          />
          <label htmlFor="review-enabled" className="text-sm text-foreground">
            Enable complimentary review library
          </label>
        </div>
        <div>
          <label className={label}>Papermark Data Room URL</label>
          <input
            name="papermarkUrl"
            type="url"
            defaultValue={papermarkUrl}
            placeholder="https://..."
            className={field}
          />
          {state?.errors?.papermarkUrl && (
            <p className="text-xs text-red-600 mt-1">{state.errors.papermarkUrl[0]}</p>
          )}
        </div>
        <div className="flex items-center gap-4">
          <button type="submit" disabled={pending} className={btnPrimary}>
            {pending ? "Saving..." : "Save settings"}
          </button>
          {state?.message && (
            <p className={`text-sm ${state.ok ? "text-accent" : "text-red-600"}`}>
              {state.message}
            </p>
          )}
        </div>
      </form>
    </div>
  )
}

function AddItemSection({ publications }: { publications: AvailablePublication[] }) {
  const [selected, setSelected] = useState("")
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState("")
  const router = useRouter()

  async function handleAdd() {
    if (!selected) return
    setBusy(true)
    setMsg("")
    const result = await addReviewItem(selected)
    setMsg(result?.message ?? "")
    setBusy(false)
    if (result?.ok) {
      setSelected("")
      router.refresh()
    }
  }

  return (
    <div className="border border-border bg-card/30 p-6">
      <h3 className="font-serif text-lg text-foreground mb-4">Add Publication</h3>
      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <label className={label}>Select a publication</label>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className={field}
          >
            <option value="">Choose...</option>
            {publications.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} {p.series ? `(${p.series})` : ""}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={handleAdd}
          disabled={!selected || busy}
          className={btnPrimary}
        >
          {busy ? "Adding..." : "Add to library"}
        </button>
      </div>
      {msg && <p className={`text-sm mt-2 ${msg.includes("already") ? "text-amber-600" : "text-foreground/70"}`}>{msg}</p>}
    </div>
  )
}

function ReorderSection({ items }: { items: ReviewItem[] }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState("")
  const [order, setOrder] = useState(items.map((i) => i.id))
  const router = useRouter()

  function moveUp(index: number) {
    if (index === 0) return
    const next = [...order]
    ;[next[index - 1], next[index]] = [next[index]!, next[index - 1]!]
    setOrder(next)
  }

  function moveDown(index: number) {
    if (index >= order.length - 1) return
    const next = [...order]
    ;[next[index], next[index + 1]] = [next[index + 1]!, next[index]!]
    setOrder(next)
  }

  async function handleSave() {
    setBusy(true)
    setMsg("")
    const result = await reorderReviewItems(order)
    setMsg(result?.message ?? "")
    setBusy(false)
    if (result?.ok) router.refresh()
  }

  const itemMap = Object.fromEntries(items.map((i) => [i.id, i]))

  return (
    <div className="border border-border bg-card/30 p-6">
      <h3 className="font-serif text-lg text-foreground mb-4">Display Order</h3>
      <div className="space-y-2 mb-4">
        {order.map((id, i) => {
          const item = itemMap[id]
          return (
            <div key={id} className="flex items-center gap-3 p-2 border border-border/50 bg-background">
              <span className="text-xs text-muted-foreground w-6 text-center">{i + 1}</span>
              <span className="flex-1 text-sm text-foreground truncate">{item?.pubTitle ?? id}</span>
              <button type="button" onClick={() => moveUp(i)} disabled={i === 0} className="text-xs text-accent disabled:opacity-30 cursor-pointer">Up</button>
              <button type="button" onClick={() => moveDown(i)} disabled={i >= order.length - 1} className="text-xs text-accent disabled:opacity-30 cursor-pointer">Down</button>
            </div>
          )
        })}
      </div>
      <div className="flex items-center gap-4">
        <button type="button" onClick={handleSave} disabled={busy} className={btnSecondary}>
          {busy ? "Saving..." : "Save order"}
        </button>
        {msg && <p className="text-sm text-foreground/70">{msg}</p>}
      </div>
    </div>
  )
}

function ItemCard({ item }: { item: ReviewItem }) {
  const action = saveReviewItemDetails.bind(null, item.id)
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {})
  const [removing, setRemoving] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const router = useRouter()

  async function handleRemove() {
    if (!window.confirm(`Remove "${item.pubTitle}" from the review library?`)) return
    setRemoving(true)
    await removeReviewItem(item.id)
    setRemoving(false)
    router.refresh()
  }

  async function handleRegenerate() {
    if (!window.confirm(`Regenerate card details for "${item.pubTitle}"? This will overwrite the current values.`)) return
    setRegenerating(true)
    await regenerateReviewItemDetails(item.id)
    setRegenerating(false)
    router.refresh()
  }

  return (
    <div className="border border-border bg-card/30 p-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="font-serif text-lg text-foreground">{item.pubTitle}</h3>
          <span className="text-xs text-muted-foreground">
            {item.series || "No series"} &middot; Order: {item.displayOrder}
            {!item.isActive && <span className="ml-2 text-amber-600">(Inactive)</span>}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleRegenerate}
            disabled={regenerating}
            className="text-xs text-accent hover:text-accent-hover transition-colors disabled:opacity-50 cursor-pointer"
          >
            {regenerating ? "..." : "Regenerate"}
          </button>
          <button
            type="button"
            onClick={handleRemove}
            disabled={removing}
            className="text-xs text-red-600 hover:text-red-700 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {removing ? "..." : "Remove"}
          </button>
        </div>
      </div>

      <form action={formAction} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={label}>Publication Type</label>
            <input name="publicationType" defaultValue={item.publicationType} className={field} />
          </div>
          <div>
            <label className={label}>Frequency</label>
            <input name="frequency" defaultValue={item.frequency} className={field} />
          </div>
        </div>
        <div>
          <label className={label}>Description</label>
          <textarea name="description" defaultValue={item.description} rows={4} className={field} />
        </div>
        <div>
          <label className={label}>Intended Audience</label>
          <input name="audience" defaultValue={item.audience} className={field} />
        </div>
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            name="isActive"
            id={`active-${item.id}`}
            defaultChecked={item.isActive}
            className="accent-accent"
          />
          <label htmlFor={`active-${item.id}`} className="text-sm text-foreground">Active</label>
        </div>
        <div className="flex items-center gap-4">
          <button type="submit" disabled={pending} className={btnSecondary}>
            {pending ? "Saving..." : "Save card details"}
          </button>
          {state?.message && (
            <p className={`text-sm ${state.ok ? "text-accent" : "text-red-600"}`}>
              {state.message}
            </p>
          )}
        </div>
      </form>
    </div>
  )
}
