'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { markRevoked } from '@/app/actions/copies'

export default function RevokeActions({ accessId }: { accessId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function confirmDone() {
    setError(null)
    startTransition(async () => {
      const result = await markRevoked(accessId)
      if (result?.ok) router.refresh()
      else setError(result?.message ?? 'Could not update.')
    })
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={confirmDone}
        disabled={pending}
        className="text-xs font-medium text-accent hover:text-accent-hover cursor-pointer disabled:opacity-40"
      >
        {pending ? 'Saving…' : 'Mark withdrawn'}
      </button>
      {error && <p className="text-xs text-red-700 max-w-[14rem] text-right">{error}</p>}
    </div>
  )
}
