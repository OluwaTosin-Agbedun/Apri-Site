"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  createSubscriberDataRoomLink,
  revokeSubscriberDataRoomLink,
  refreshDataRoomLinkAnalytics,
} from "@/app/actions/datarooms"

type LinkRecord = {
  id: string
  linkUrl: string
  assignedName: string
  assignedEmail: string
  allowDownload: boolean
  revokeState: string
  createdAt: string
  totalViews: number | null
  uniqueViewers: number | null
  lastActivityAt: string | null
}

export default function DataRoomPanel({
  subscriberId,
  dataroomName,
  dataroomId,
  link,
}: {
  subscriberId: string
  dataroomName: string | null
  dataroomId: string | null
  link: LinkRecord | null
}) {
  const router = useRouter()
  const [creating, startCreate] = useTransition()
  const [revoking, startRevoke] = useTransition()
  const [refreshing, startRefresh] = useTransition()
  const [message, setMessage] = useState("")

  function handleCreate() {
    setMessage("")
    startCreate(async () => {
      const result = await createSubscriberDataRoomLink(subscriberId)
      setMessage(result?.message ?? "")
      if (result?.ok) router.refresh()
    })
  }

  function handleRevoke() {
    if (!link || !window.confirm("Revoke this Data Room link? The subscriber will lose access.")) return
    setMessage("")
    startRevoke(async () => {
      const result = await revokeSubscriberDataRoomLink(link.id)
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

  return (
    <div className="mb-6 border border-border bg-card/30 p-6">
      <h3 className="text-xs font-medium uppercase tracking-wider text-accent mb-4">
        Data Room
      </h3>

      {dataroomId ? (
        <p className="text-sm text-foreground/70 mb-4">
          Mapped to <span className="font-medium text-foreground">{dataroomName || dataroomId}</span>
        </p>
      ) : (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 p-4 mb-4">
          No Data Room is configured for this subscription access level. Configure it
          under Admin &rarr; Data Rooms before activating or migrating this subscriber.
        </p>
      )}

      {link && link.revokeState === "live" ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Assigned to</p>
              <p className="text-foreground">{link.assignedName}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Downloads</p>
              <p className="text-foreground">{link.allowDownload ? "Enabled" : "Disabled"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Views</p>
              <p className="text-foreground">
                {link.totalViews !== null ? link.totalViews : "Not checked"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Created</p>
              <p className="text-foreground">
                {new Date(link.createdAt).toLocaleDateString("en-GB")}
              </p>
            </div>
          </div>

          <div className="flex gap-3 pt-3 border-t border-border">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="border border-border px-4 py-2 text-xs hover:bg-black/5 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {refreshing ? "Refreshing..." : "Refresh analytics"}
            </button>
            <button
              type="button"
              onClick={handleRevoke}
              disabled={revoking}
              className="border border-red-300 px-4 py-2 text-xs text-red-700 hover:bg-red-50 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {revoking ? "Revoking..." : "Revoke link"}
            </button>
          </div>
        </div>
      ) : (
        <div>
          {link?.revokeState === "revoked" && (
            <p className="text-xs text-muted-foreground mb-3">
              Previous link was revoked on{" "}
              {link.createdAt ? new Date(link.createdAt).toLocaleDateString("en-GB") : "unknown date"}.
            </p>
          )}
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating || !dataroomId}
            className="bg-foreground text-background px-6 py-3 text-sm font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {creating ? "Creating link..." : "Create Data Room link"}
          </button>
        </div>
      )}

      {message && (
        <p className="text-sm text-foreground/70 mt-3">{message}</p>
      )}
    </div>
  )
}
