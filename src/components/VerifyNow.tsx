'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { runLinkVerification } from '@/app/actions/verification'

/** Runs the allow-list check on demand, rather than waiting for the daily job. */
export default function VerifyNow({ subtle = false }: { subtle?: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  function run() {
    setMessage(null)
    startTransition(async () => {
      const result = await runLinkVerification()
      setMessage(result?.message ?? null)
      router.refresh()
    })
  }

  return (
    <div className="text-right">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className={
          subtle
            ? 'text-xs font-medium text-accent hover:text-accent-hover cursor-pointer disabled:opacity-40'
            : 'border border-red-300 bg-white px-4 py-2 text-xs font-medium text-red-900 hover:bg-red-100 disabled:opacity-50 transition-colors cursor-pointer'
        }
      >
        {pending ? 'Checking links…' : 'Re-check now'}
      </button>
      {message && (
        <p className="mt-2 text-xs text-foreground/70 max-w-xs">{message}</p>
      )}
    </div>
  )
}
