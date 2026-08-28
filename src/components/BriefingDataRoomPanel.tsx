"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  createBriefingDataRoomLink,
  revokeBriefingDataRoomLink,
  refreshDataRoomLinkAnalytics,
  assignDataRoomToBriefing,
  fetchAvailableDataRooms,
} from "@/app/actions/datarooms"

type LinkRecord = {
  id: string
  linkUrl: string
  assignedName: string
  allowDownload: boolean
  revokeState: string
  createdAt: string
  totalViews: number | null
}

export default function BriefingDataRoomPanel({
  briefingRequestId,
  dataroomId,
  link,
}: {
  briefingRequestId: string
  dataroomId: string | null
  link: LinkRecord | null
}) {
  const router = useRouter()
  const [creating, startCreate] = useTransition()
  const [revoking, startRevoke] = useTransition()
  const [refreshing, startRefresh] = useTransition()
  const [assigning, startAssign] = useTransition()
  const [message, setMessage] = useState("")

  const [rooms, setRooms] = useState<{ id: string; name: string; documentCount: number }[]>([])
  const [loadingRooms, setLoadingRooms] = useState(false)
  const [selectedRoom, setSelectedRoom] = useState("")

  async function loadRooms() {
    setLoadingRooms(true)
    const result = await fetchAvailableDataRooms()
    if (result.ok) setRooms(result.rooms)
    else setMessage(result.message)
    setLoadingRooms(false)
  }

  function handleAssign() {
    if (!selectedRoom) return
    setMessage("")
    startAssign(async () => {
      const result = await assignDataRoomToBriefing(briefingRequestId, selectedRoom)
      setMessage(result?.message ?? "")
      if (result?.ok) router.refresh()
    })
  }

  function handleCreate() {
    setMessage("")
    startCreate(async () => {
      const result = await createBriefingDataRoomLink(briefingRequestId)
      setMessage(result?.message ?? "")
      if (result?.ok) router.refresh()
    })
  }

  function handleRevoke() {
    if (!link || !window.confirm("Revoke this Data Room link?")) return
    setMessage("")
    startRevoke(async () => {
      const result = await revokeBriefingDataRoomLink(link.id)
      setMessage(result?.message ?? "")
      if (result?.ok) router.refresh()
    })
  }

  function handleRefresh() {
    if (!link) return
    setMessage("")
    startRefresh(async () => {
      const result = await refreshDataRoomLinkAnalytics(link.id)
      setMessage(result?.message ?? "")
      if (result?.ok) router.refresh()
    })
  }

  const btn = "border border-border px-4 py-2 text-xs hover:bg-black/5 transition-colors disabled:opacity-50 cursor-pointer"
  const btnDanger = "border border-red-300 px-4 py-2 text-xs text-red-700 hover:bg-red-50 transition-colors disabled:opacity-50 cursor-pointer"

  return (
    <div className="mb-6 border border-border bg-card/30 p-6">
      <h3 className="text-xs font-medium uppercase tracking-wider text-accent mb-4">
        Briefing Data Room
      </h3>

      {!dataroomId ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            No Data Room assigned to this briefing.
          </p>
          {rooms.length === 0 ? (
            <button type="button" onClick={loadRooms} disabled={loadingRooms} className={btn}>
              {loadingRooms ? "Loading..." : "Fetch Data Rooms from Papermark"}
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <select
                value={selectedRoom}
                onChange={(e) => setSelectedRoom(e.target.value)}
                className="border border-border bg-background p-2 text-sm"
              >
                <option value="">Select a Data Room</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>{r.name} ({r.documentCount} docs)</option>
                ))}
              </select>
              <button type="button" onClick={handleAssign} disabled={assigning || !selectedRoom} className={btn}>
                {assigning ? "Assigning..." : "Assign"}
              </button>
            </div>
          )}
        </div>
      ) : link && link.revokeState === "live" ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Assigned to</p>
              <p className="text-foreground">{link.assignedName}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Views</p>
              <p className="text-foreground">{link.totalViews !== null ? link.totalViews : "Not checked"}</p>
            </div>
          </div>
          <div className="flex gap-3 pt-3 border-t border-border">
            <button type="button" onClick={handleRefresh} disabled={refreshing} className={btn}>
              {refreshing ? "Refreshing..." : "Refresh analytics"}
            </button>
            <button type="button" onClick={handleRevoke} disabled={revoking} className={btnDanger}>
              {revoking ? "Revoking..." : "Revoke link"}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <p className="text-sm text-foreground/70 mb-3">Data Room assigned. No link created yet.</p>
          <button type="button" onClick={handleCreate} disabled={creating} className="bg-foreground text-background px-6 py-3 text-sm font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50 cursor-pointer">
            {creating ? "Creating link..." : "Create Data Room link"}
          </button>
        </div>
      )}

      {message && <p className="text-sm text-foreground/70 mt-3">{message}</p>}
    </div>
  )
}
