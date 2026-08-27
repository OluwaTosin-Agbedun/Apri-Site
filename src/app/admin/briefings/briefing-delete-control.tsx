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
      `Type the requester's exact email to delete this briefing client:\n\n${email}\n\nPapermark access must be revoked separately.`,
    )
    if (confirmation !== email) return
    if (
      !window.confirm(
        "Final warning: permanently delete this briefing request, its APRI tokens and portal access? A subscriber with the same email will not be affected.",
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
          Deleting ends this client&apos;s APRI portal access immediately. Revoke
          the private Papermark link separately.
        </p>
      )}
      <button
        type="button"
        onClick={remove}
        disabled={pending || !canDelete}
        title={canDelete ? undefined : "Only owners can delete briefing requests."}
        className="text-xs font-medium text-red-700 hover:text-red-900 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {pending ? "Deleting…" : "Delete briefing client"}
      </button>
      {message && <p className="mt-3 text-xs text-red-700">{message}</p>}
    </div>
  )
}
