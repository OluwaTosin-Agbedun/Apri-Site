"use client"

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { deleteDocument, setDocumentStatus } from '@/app/actions/documents'
import AlertPanel from './alert-panel'

export default function RowActions({
  id,
  status,
  visibility,
  title,
  canDelete,
}: {
  id: string
  status: string
  visibility: string
  title: string
  canDelete: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function run(next: string) {
    setError(null)
    startTransition(async () => {
      const result = await setDocumentStatus(id, next)
      if (result?.message && !result.ok) setError(result.message)
      else router.refresh()
    })
  }

  function remove() {
    if (!window.confirm(`Delete “${title}” from APRI and remove its APRI associations?\n\nThe original Papermark document and link will not be deleted.`)) return
    startTransition(async () => {
      const result = await deleteDocument(id)
      if (result?.message && !result.ok) setError(result.message)
      else router.refresh()
    })
  }

  const link = 'text-xs font-medium text-accent hover:text-accent-hover cursor-pointer disabled:opacity-40'

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Link href={`/admin/documents/${id}`} className={link}>Edit</Link>

        {status !== "published" && (
          <button type="button" onClick={() => run("published")} disabled={pending} className={link}>
            Publish
          </button>
        )}
        {status === "published" && (
          <button type="button" onClick={() => run("draft")} disabled={pending} className={link}>
            Unpublish
          </button>
        )}
        {status === "published" && visibility !== "OPEN" && (
          <AlertPanel id={id} title={title} />
        )}
        {status !== "archived" && (
          <button
            type="button"
            onClick={() => run("archived")}
            disabled={pending}
            className="text-xs font-medium text-foreground/50 hover:text-foreground cursor-pointer disabled:opacity-40"
          >
            Archive
          </button>
        )}
        <button type="button" onClick={remove} disabled={pending} className="text-xs font-medium text-red-700 hover:text-red-800 disabled:opacity-40">Delete</button>
      </div>
      {error && <p className="text-xs text-red-700 max-w-[18rem] text-right">{error}</p>}
    </div>
  )
}
