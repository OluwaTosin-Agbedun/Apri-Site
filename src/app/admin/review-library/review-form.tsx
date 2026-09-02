"use client"

import { useActionState, useState } from "react"
import { useRouter } from "next/navigation"
import {
  saveReviewLibrarySettings,
  saveReviewDataRoom,
  fetchAvailableReviewDataRooms,
  syncReviewLibrary,
  mapCandidateToCard,
  approveCandidateReplacement,
  ignoreCandidate,
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
  papermarkDocumentId: string | null
  papermarkDataroomId: string | null
  lastSyncedAt: string | null
  ownerEditedFields: string[]
  pubTitle: string
  series: string
  slug: string
}

type AvailablePublication = {
  id: string
  title: string
  series: string
}

type Candidate = {
  id: string
  papermarkDocumentId: string
  rawFilename: string
  cleanTitle: string
  detectedSeries: string
  detectedEditionDate: string | null
  syncStatus: string
  numPages: number | null
  firstSeenAt: string
  lastSeenAt: string
  isPresent: boolean
}

export default function ReviewLibraryForm({
  enabled,
  papermarkUrl,
  dataroomId,
  lastSyncAt,
  lastSyncResult,
  items,
  availablePublications,
  candidates,
  roomDocCount,
}: {
  enabled: boolean
  papermarkUrl: string
  dataroomId: string
  lastSyncAt: string
  lastSyncResult: string
  items: ReviewItem[]
  availablePublications: AvailablePublication[]
  candidates: Candidate[]
  roomDocCount: number
}) {
  return (
    <div className="space-y-8">
      <SettingsSection enabled={enabled} papermarkUrl={papermarkUrl} />
      <DataRoomSection dataroomId={dataroomId} />
      <SyncSection
        dataroomId={dataroomId}
        lastSyncAt={lastSyncAt}
        lastSyncResult={lastSyncResult}
      />
      {dataroomId && <RoomWarnings roomDocCount={roomDocCount} candidates={candidates} />}
      {candidates.length > 0 && (
        <CandidatesSection candidates={candidates} items={items} />
      )}
      <AddItemSection publications={availablePublications} />
      {items.length > 0 && <ReorderSection items={items} />}
      {items.map((item) => (
        <ItemCard key={item.id} item={item} />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Data Room selector
// ---------------------------------------------------------------------------

function DataRoomSection({ dataroomId }: { dataroomId: string }) {
  const [rooms, setRooms] = useState<{ id: string; name: string; documentCount: number }[]>([])
  const [selected, setSelected] = useState(dataroomId)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState("")
  const router = useRouter()

  async function loadRooms() {
    setLoading(true)
    setMsg("")
    const result = await fetchAvailableReviewDataRooms()
    if (result.ok) {
      setRooms(result.rooms)
    } else {
      setMsg(result.message)
    }
    setLoading(false)
  }

  async function handleSave() {
    if (!selected) return
    setSaving(true)
    setMsg("")
    const result = await saveReviewDataRoom(selected)
    setMsg(result?.message ?? "")
    setSaving(false)
    if (result?.ok) router.refresh()
  }

  return (
    <div className="border border-border bg-card/30 p-6">
      <h3 className="font-serif text-lg text-foreground mb-2">
        Papermark Data Room (API sync)
      </h3>
      <p className="text-sm text-foreground/70 mb-4">
        Select the Complimentary Review Data Room for document synchronisation.
        This is the Data Room ID used for API calls, separate from the public access URL above.
      </p>
      {dataroomId && (
        <p className="text-xs text-muted-foreground mb-3">
          Current Data Room ID: <code className="bg-black/5 px-1 py-0.5">{dataroomId}</code>
        </p>
      )}
      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          {rooms.length > 0 ? (
            <select value={selected} onChange={(e) => setSelected(e.target.value)} className={field}>
              <option value="">Choose a Data Room...</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.documentCount} docs)
                </option>
              ))}
            </select>
          ) : (
            <button type="button" onClick={loadRooms} disabled={loading} className={btnSecondary}>
              {loading ? "Loading..." : "Load Data Rooms from Papermark"}
            </button>
          )}
        </div>
        {rooms.length > 0 && (
          <button type="button" onClick={handleSave} disabled={!selected || saving} className={btnPrimary}>
            {saving ? "Saving..." : "Save Data Room"}
          </button>
        )}
      </div>
      {msg && <p className="text-sm mt-2 text-foreground/70">{msg}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

function SyncSection({
  dataroomId,
  lastSyncAt,
  lastSyncResult,
}: {
  dataroomId: string
  lastSyncAt: string
  lastSyncResult: string
}) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState("")
  const router = useRouter()

  async function handleSync() {
    setBusy(true)
    setMsg("")
    const result = await syncReviewLibrary()
    setMsg(result?.message ?? "")
    setBusy(false)
    if (result?.ok) router.refresh()
  }

  return (
    <div className="border border-border bg-card/30 p-6">
      <h3 className="font-serif text-lg text-foreground mb-2">
        Sync Complimentary Review Library
      </h3>
      <p className="text-sm text-foreground/70 mb-4">
        Fetch documents from the selected Data Room and classify them.
        This does not change the public website — discovered documents are held for your review.
      </p>
      {lastSyncAt && (
        <p className="text-xs text-muted-foreground mb-2">
          Last sync: {new Date(lastSyncAt).toLocaleString()}
          {lastSyncResult && <> &mdash; {lastSyncResult}</>}
        </p>
      )}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={handleSync}
          disabled={busy || !dataroomId}
          className={btnPrimary}
        >
          {busy ? "Syncing..." : "Sync Complimentary Review Library"}
        </button>
        {!dataroomId && (
          <span className="text-xs text-amber-600">Select a Data Room first.</span>
        )}
      </div>
      {msg && (
        <p className={`text-sm mt-3 ${msg.startsWith("Synced") ? "text-accent" : "text-red-600"}`}>
          {msg}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Room warnings
// ---------------------------------------------------------------------------

function RoomWarnings({
  roomDocCount,
  candidates,
}: {
  roomDocCount: number
  candidates: Candidate[]
}) {
  const supported = candidates.filter((c) => c.detectedSeries && c.isPresent)
  const unrecognised = candidates.filter((c) => !c.detectedSeries && c.isPresent)
  const seriesCounts = new Map<string, number>()
  for (const c of supported) {
    seriesCounts.set(c.detectedSeries, (seriesCounts.get(c.detectedSeries) ?? 0) + 1)
  }
  const duplicateSeries = [...seriesCounts.entries()].filter(([, n]) => n > 1)

  const warnings: string[] = []

  if (roomDocCount < 3) {
    warnings.push(`Only ${roomDocCount} document${roomDocCount === 1 ? '' : 's'} found. Expected at least 3 supported documents (MIN, AIU, PLM).`)
  }
  if (roomDocCount > 3) {
    warnings.push(`${roomDocCount} documents found in the Data Room. Only 3 are expected. Extra documents may be visible to verified recipients.`)
  }
  if (unrecognised.length > 0) {
    warnings.push(`${unrecognised.length} unrecognised document${unrecognised.length === 1 ? '' : 's'}. These could not be classified as MIN, AIU or PLM.`)
  }
  if (duplicateSeries.length > 0) {
    for (const [s, n] of duplicateSeries) {
      warnings.push(`${n} documents classified as ${s}. Only one per series is expected.`)
    }
  }

  if (warnings.length === 0) return null

  return (
    <div className="border border-amber-300 bg-amber-50 p-6">
      <h3 className="font-serif text-lg text-amber-900 mb-3">Data Room Warnings</h3>
      <p className="text-sm text-amber-800 mb-3">
        This Papermark link shares the entire Data Room. All documents in this room
        may be visible to verified recipients. Keep only the three approved review
        documents in the room.
      </p>
      <ul className="space-y-2">
        {warnings.map((w, i) => (
          <li key={i} className="flex gap-2 text-sm text-amber-800">
            <span className="shrink-0">&#9888;</span>
            <span>{w}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending review", className: "bg-amber-100 text-amber-800" },
  approved: { label: "Current", className: "bg-accent/10 text-accent" },
  ignored: { label: "Ignored", className: "bg-muted text-muted-foreground" },
  archived: { label: "Archived", className: "bg-muted text-muted-foreground" },
}

function CandidatesSection({
  candidates,
  items,
}: {
  candidates: Candidate[]
  items: ReviewItem[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState("")

  const pendingCandidates = candidates.filter((c) => c.syncStatus === 'pending')
  const approvedCandidates = candidates.filter((c) => c.syncStatus === 'approved')

  async function handleMap(candidateId: string, itemId: string) {
    setBusy(candidateId)
    setMsg("")
    const result = await mapCandidateToCard(candidateId, itemId)
    setMsg(result?.message ?? "")
    setBusy(null)
    if (result?.ok) router.refresh()
  }

  async function handleApprove(candidateId: string) {
    if (!window.confirm("Approve this candidate? It will replace the current edition for its series.")) return
    setBusy(candidateId)
    setMsg("")
    const result = await approveCandidateReplacement(candidateId)
    setMsg(result?.message ?? "")
    setBusy(null)
    if (result?.ok) router.refresh()
  }

  async function handleIgnore(candidateId: string) {
    setBusy(candidateId)
    setMsg("")
    const result = await ignoreCandidate(candidateId)
    setMsg(result?.message ?? "")
    setBusy(null)
    if (result?.ok) router.refresh()
  }

  const unmappedItems = items.filter((i) => !i.papermarkDocumentId)

  return (
    <div className="border border-border bg-card/30 p-6">
      <h3 className="font-serif text-lg text-foreground mb-4">
        Synced Documents
      </h3>

      {msg && <p className="text-sm mb-4 text-foreground/70">{msg}</p>}

      <div className="space-y-4">
        {candidates.map((c) => {
          const badge = STATUS_BADGE[c.syncStatus] ?? STATUS_BADGE.pending!
          const matchingItem = items.find((i) => i.series === c.detectedSeries)
          const alreadyMapped = matchingItem?.papermarkDocumentId === c.papermarkDocumentId
          const hasUpdate = c.syncStatus === 'pending' && c.detectedSeries && matchingItem?.papermarkDocumentId && matchingItem.papermarkDocumentId !== c.papermarkDocumentId

          return (
            <div key={c.id} className="border border-border/50 bg-background p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {c.rawFilename}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {c.detectedSeries ? (
                      <span className="font-medium text-accent">{c.detectedSeries}</span>
                    ) : (
                      <span className="text-amber-600">Unrecognised</span>
                    )}
                    {c.detectedEditionDate && <> &middot; {c.detectedEditionDate}</>}
                    {c.numPages != null && <> &middot; {c.numPages} pages</>}
                    {!c.isPresent && <> &middot; <span className="text-red-600">Removed from room</span></>}
                  </p>
                </div>
                <span className={`shrink-0 inline-flex items-center px-2 py-1 text-xs font-medium ${badge.className}`}>
                  {alreadyMapped ? "Current" : hasUpdate ? "Update available" : badge.label}
                </span>
              </div>

              {/* Initial mapping: unmapped items can be linked */}
              {c.syncStatus === 'pending' && c.detectedSeries && unmappedItems.length > 0 && !hasUpdate && (
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground">Map to:</span>
                  {unmappedItems
                    .filter((i) => i.series === c.detectedSeries || !c.detectedSeries)
                    .map((i) => (
                      <button
                        key={i.id}
                        type="button"
                        onClick={() => handleMap(c.id, i.id)}
                        disabled={busy === c.id}
                        className="text-xs text-accent hover:text-accent-hover transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        {i.pubTitle} ({i.series})
                      </button>
                    ))}
                </div>
              )}

              {/* Update available: approve or ignore */}
              {hasUpdate && (
                <div className="mt-3 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => handleApprove(c.id)}
                    disabled={busy === c.id}
                    className="text-xs text-accent hover:text-accent-hover transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {busy === c.id ? "..." : "Approve and replace current"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleIgnore(c.id)}
                    disabled={busy === c.id}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    Ignore
                  </button>
                </div>
              )}

              {/* Pending unrecognised: only ignore */}
              {c.syncStatus === 'pending' && !c.detectedSeries && (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => handleIgnore(c.id)}
                    disabled={busy === c.id}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    Ignore candidate
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Add item
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Reorder
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Item card
// ---------------------------------------------------------------------------

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
    if (!window.confirm(`Regenerate card details for "${item.pubTitle}"? This will overwrite the current values and clear owner-edit tracking.`)) return
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
          {item.papermarkDocumentId && (
            <p className="text-xs text-muted-foreground mt-1">
              Mapped to Papermark document
              {item.lastSyncedAt && <> &middot; Last synced: {new Date(item.lastSyncedAt).toLocaleString()}</>}
            </p>
          )}
          {item.ownerEditedFields.length > 0 && (
            <p className="text-xs text-amber-600 mt-1">
              Owner-edited: {item.ownerEditedFields.join(', ')}
            </p>
          )}
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
