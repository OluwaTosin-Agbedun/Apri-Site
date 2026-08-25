'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { setDocumentStatus } from '@/app/actions/documents'
import AlertPanel from './alert-panel'

export default function RowActions({
  id,
  status,
  visibility,
  title,
}: {
  id: string
  status: string
  visibility: string
  /** Shown on the alert panel, so the operator sees which edition they are sending. */
  title: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  function run(next: string) {
    setError(null)
    setNotice(null)
    startTransition(async () => {
      const result = await setDocumentStatus(id, next)
      if (result?.message && !result.ok) setError(result.message)
      else router.refresh()
    })
  }

  const link = 'text-xs font-medium text-accent hover:text-accent-hover cursor-pointer disabled:opacity-40'

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-3">
        <Link href={`/admin/documents/${id}`} className={link}>
          Edit
        </Link>

        {status !== 'published' && (
          <button type="button" onClick={() => run('published')} disabled={pending} className={link}>
            Publish
          </button>
        )}

        {status === 'published' && (
          <button type="button" onClick={() => run('draft')} disabled={pending} className={link}>
            Unpublish
          </button>
        )}

        {/* Only a published, paid edition has an audience to alert. */}
        {/*
          Alerting is its own two-step panel: the split has to be seen before
          anything is sent, so it cannot live behind a single confirm dialog.
        */}
        {status === 'published' && visibility !== 'OPEN' && (
          <AlertPanel id={id} title={title} />
        )}

        {status !== 'archived' && (
          <button
            type="button"
            onClick={() => run('archived')}
            disabled={pending}
            className="text-xs font-medium text-foreground/50 hover:text-foreground cursor-pointer disabled:opacity-40"
          >
            Archive
          </button>
        )}
      </div>

      {error && <p className="text-xs text-red-700 max-w-[16rem] text-right">{error}</p>}
      {notice && (
        <p className="text-xs text-foreground/70 max-w-[16rem] text-right">{notice}</p>
      )}
    </div>
  )
}
