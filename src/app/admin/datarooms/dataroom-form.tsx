"use client"

import { useActionState, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  saveLevelRoomMapping,
  deleteLevelRoomMapping,
  syncDataRoomForLevel,
  syncAndNotify,
  fetchAvailableDataRooms,
  prepareDocumentLinksForLevel,
  autoLinkPublicationsByPapermarkId,
} from "@/app/actions/datarooms"
import type { FormState } from "@/lib/definitions"
import { tierDisplayName } from "@/lib/entitlements"

const field =
  "w-full border border-border bg-background p-3 text-sm focus:outline-none focus:border-accent"
const label =
  "block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2"
const btnPrimary =
  "bg-foreground text-background px-6 py-3 text-sm font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50 cursor-pointer"
const btnSecondary =
  "border border-border px-4 py-2 text-sm hover:bg-black/5 transition-colors disabled:opacity-50 cursor-pointer"

export default function DataRoomMappingForm({
  unmappedTiers,
}: {
  unmappedTiers: string[]
  }) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    saveLevelRoomMapping,
    {},
  )
  const [rooms, setRooms] = useState<
    { id: string; name: string; documentCount: number }[]
  >([])
  const [loadingRooms, setLoadingRooms] = useState(false)
  const [roomError, setRoomError] = useState("")

  useEffect(() => {
    if (state?.ok) router.refresh()
  }, [state, router])

  async function loadRooms() {
    setLoadingRooms(true)
    setRoomError("")
    const result = await fetchAvailableDataRooms()
    if (result.ok) {
      setRooms(result.rooms)
    } else {
      setRoomError(result.message)
    }
    setLoadingRooms(false)
  }

  return (
    <div>
      <form action={formAction} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={label}>Subscription Level</label>
            <select name="publicTier" className={field} required>
              <option value="">Select a level</option>
              {unmappedTiers.map((tier) => (
                <option key={tier} value={tier}>{tierDisplayName(tier)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Papermark Data Room</label>
            {rooms.length === 0 ? (
              <button
                type="button"
                onClick={loadRooms}
                disabled={loadingRooms}
                className={btnSecondary}
              >
                {loadingRooms ? "Loading..." : "Fetch Data Rooms from Papermark"}
              </button>
            ) : (
              <select name="dataroomId" className={field} required>
                <option value="">Select a Data Room</option>
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name} ({room.documentCount} docs)
                  </option>
                ))}
              </select>
            )}
            {roomError && (
              <p className="text-xs text-red-600 mt-1">{roomError}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button type="submit" disabled={pending || rooms.length === 0} className={btnPrimary}>
            {pending ? "Saving..." : "Save mapping"}
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

export function MappingActions({ mappedTiers }: { mappedTiers: string[] }) {
  const [syncing, setSyncing] = useState("")
  const [syncMsg, setSyncMsg] = useState("")
  const [notifying, setNotifying] = useState("")
  const [notifyMsg, setNotifyMsg] = useState("")
  const [deleting, setDeleting] = useState("")
  const [deleteMsg, setDeleteMsg] = useState("")
  const [preparing, setPreparing] = useState("")
  const [prepareMsg, setPrepareMsg] = useState("")
  const [autoLinking, setAutoLinking] = useState("")
  const [autoLinkMsg, setAutoLinkMsg] = useState("")
  const [tier, setTier] = useState("")
  const router = useRouter()

  async function handleSync() {
    if (!tier) return
    setSyncing(tier)
    setSyncMsg("")
    const result = await syncDataRoomForLevel(tier)
    setSyncMsg(result?.message ?? "")
    setSyncing("")
    if (result?.ok) router.refresh()
  }

  async function handleSyncAndNotify() {
    if (!tier) return
    if (!window.confirm(`Sync documents and notify all ${tier} subscribers of new publications?`)) return
    setNotifying(tier)
    setNotifyMsg("")
    const result = await syncAndNotify(tier)
    setNotifyMsg(result?.message ?? "")
    setNotifying("")
    if (result?.ok) router.refresh()
  }

  async function handleDelete() {
    if (!tier) return
    if (!window.confirm(`Remove the Data Room mapping for "${tier}"?`)) return
    setDeleting(tier)
    setDeleteMsg("")
    const result = await deleteLevelRoomMapping(tier)
    setDeleteMsg(result?.message ?? "")
    setDeleting("")
    if (result?.ok) router.refresh()
  }

  async function handlePrepareLinks() {
    if (!tier) return
    setPreparing(tier)
    setPrepareMsg("")
    const result = await prepareDocumentLinksForLevel(tier)
    setPrepareMsg(result?.message ?? "")
    setPreparing("")
    if (result?.ok) router.refresh()
  }

  async function handleAutoLink() {
    if (!tier) return
    setAutoLinking(tier)
    setAutoLinkMsg("")
    const result = await autoLinkPublicationsByPapermarkId(tier)
    setAutoLinkMsg(result?.message ?? "")
    setAutoLinking("")
    if (result?.ok) router.refresh()
  }

  return (
    <div className="mt-6 pt-6 border-t border-border">
      <p className={label}>Quick actions on an existing mapping</p>
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={tier}
          onChange={(e) => setTier(e.target.value)}
          className={`${field} max-w-xs`}
        >
          <option value="">Select a mapped level</option>
          {mappedTiers.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleSync}
          disabled={!tier || syncing !== ""}
          className={btnSecondary}
        >
          {syncing ? "Syncing..." : "Sync documents"}
        </button>
        <button
          type="button"
          onClick={handleSyncAndNotify}
          disabled={!tier || notifying !== ""}
          className={btnSecondary}
        >
          {notifying ? "Syncing & notifying..." : "Sync and notify"}
        </button>
        <button
          type="button"
          onClick={handlePrepareLinks}
          disabled={!tier || preparing !== ""}
          className={btnSecondary}
        >
          {preparing ? "Preparing links..." : "Prepare document links"}
        </button>
        <button
          type="button"
          onClick={handleAutoLink}
          disabled={!tier || autoLinking !== ""}
          className={btnSecondary}
        >
          {autoLinking ? "Linking..." : "Auto-link publications"}
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={!tier || deleting !== ""}
          className="border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 transition-colors disabled:opacity-50 cursor-pointer"
        >
          {deleting ? "Removing..." : "Remove mapping"}
        </button>
      </div>
      {syncMsg && <p className="text-sm text-foreground/70 mt-2">{syncMsg}</p>}
      {notifyMsg && <p className="text-sm text-foreground/70 mt-2">{notifyMsg}</p>}
      {prepareMsg && <p className="text-sm text-foreground/70 mt-2">{prepareMsg}</p>}
      {autoLinkMsg && <p className="text-sm text-foreground/70 mt-2">{autoLinkMsg}</p>}
      {deleteMsg && <p className="text-sm text-foreground/70 mt-2">{deleteMsg}</p>}
    </div>
  )
}
