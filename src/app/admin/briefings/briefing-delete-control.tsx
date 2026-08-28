"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { deleteBriefing } from "@/app/actions/briefings"

export default function BriefingDeleteControl({
  id,
  email,
  canDelete,
  detail = false,
}: {
  id: string
  email: string
  canDelete: boolean
  detail?: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  function remove() {
    const confirmation = window.prompt(
      `Type the requester's exact email to delete this briefing request:\n\n${email}`,
    )
    if (confirmation !== email) return
    if (
      !window.confirm(
        "Final warning: permanently delete this briefing request? A subscriber with the same email will not be affected.",
      )
    ) {
      return
    }

    setMessage(null)
    startTransition(async () => {
      const result = await deleteBriefing(id, confirmation)
      if (result?.message) setMessage(result.message)
      if (result?.ok) {
        router.push("/admin/briefings?deleted=1")
        router.refresh()
      }
    })
  }

  return (
    <div className={detail ? "border border-red-200 bg-red-50/40 p-6" : "text-right"}>
      {detail && (
        <p className="text-sm text-foreground/70 mb-4">
          Permanently delete this briefing request. A subscriber with the same
          email will not be affected.
        </p>
      )}
      <button
        type="button"
        onClick={remove}
        disabled={pending || !canDelete}
        title={canDelete ? undefined : "Only owners can delete briefing requests."}
        className="text-xs font-medium text-red-700 hover:text-red-900 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {pending ? "Deleting…" : "Delete briefing request"}
      </button>
      {message && <p className="mt-3 text-xs text-red-700">{message}</p>}
    </div>
  )
}
