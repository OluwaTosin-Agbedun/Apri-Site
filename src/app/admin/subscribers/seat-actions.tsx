'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { activateSubscriber, resendSignInLink } from '@/app/actions/subscribers'
import type { FormState } from '@/lib/definitions'

/**
 * The single action taken after payment lands: activate the seat and send the
 * welcome email carrying a working sign-in link.
 *
 * Activation is disabled until the record actually holds a level and a term end
 * date, so the button cannot create a seat that is entitled to nothing or has no
 * expiry. The server checks the same conditions again.
 */
export default function SeatActions({
  id,
  status,
  hasLevel,
  hasTermEnd,
  compact = false,
}: {
  id: string
  status: string
  hasLevel: boolean
  hasTermEnd: boolean
  compact?: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  function run(fn: (id: string) => Promise<FormState>) {
    setMessage(null)
    startTransition(async () => {
      const result = await fn(id)
      setOk(Boolean(result?.ok))
      if (result?.message) setMessage(result.message)
      if (result?.ok) router.refresh()
    })
  }

  const isActive = status === 'active'
  const ready = hasLevel && hasTermEnd
  const blocked = !hasLevel
    ? 'Set an access level first.'
    : !hasTermEnd
      ? 'Set a term end date first.'
      : null

  const button =
    'text-xs font-medium text-accent hover:text-accent-hover cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed'

  if (compact) {
    return (
      <div className="flex flex-col items-end gap-1.5">
        <div className="flex items-center gap-3">
          {!isActive && (
            <button
              type="button"
              onClick={() => run(activateSubscriber)}
              disabled={pending || !ready}
              title={blocked ?? undefined}
              className={button}
            >
              Activate
            </button>
          )}
          {isActive && (
            <button
              type="button"
              onClick={() => run(resendSignInLink)}
              disabled={pending}
              className={button}
            >
              Send link
            </button>
          )}
        </div>
        {message && (
          <p
            className={`text-xs max-w-[18rem] text-right ${ok ? 'text-foreground/70' : 'text-red-700'}`}
          >
            {message}
          </p>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4">
        {!isActive ? (
          <button
            type="button"
            onClick={() => run(activateSubscriber)}
            disabled={pending || !ready}
            className="bg-foreground text-background px-6 py-2.5 text-sm font-medium tracking-wide hover:bg-foreground/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            {pending ? 'Working…' : 'Activate & send welcome'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => run(resendSignInLink)}
            disabled={pending}
            className="bg-foreground text-background px-6 py-2.5 text-sm font-medium tracking-wide hover:bg-foreground/90 disabled:opacity-50 transition-colors cursor-pointer"
          >
            {pending ? 'Sending…' : 'Send a fresh sign-in link'}
          </button>
        )}

        {!isActive && blocked && (
          <p className="text-xs text-muted-foreground">{blocked}</p>
        )}
      </div>

      {message && (
        <p
          className={`mt-4 text-sm p-3 border ${
            ok
              ? 'text-foreground border-border bg-accent/5'
              : 'text-red-700 border-red-200 bg-red-50'
          }`}
        >
          {message}
        </p>
      )}
    </div>
  )
}
