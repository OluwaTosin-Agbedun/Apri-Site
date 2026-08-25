'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { getAlertPreview, sendPublishAlert } from '@/app/actions/subscribers'

type Split = {
  publicationId: string
  publicationTitle: string
  entitled: number
  withCopies: number
  held: number
}

/**
 * Alerting subscribers about an edition, in two steps.
 *
 * The split is shown before anything is sent, and the send button does not
 * exist until it has been. An alert cannot be recalled, and the number held is
 * the number of people paying for something not yet made -- seeing that before
 * committing is the point.
 */
export default function AlertPanel({
  id,
  title,
}: {
  id: string
  title: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [split, setSplit] = useState<Split | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  function loadSplit() {
    setError(null)
    setResult(null)
    startTransition(async () => {
      const preview = await getAlertPreview(id)
      if (!preview) {
        setError(
          'This edition has no subscriber audience — open editions are read publicly.'
        )
        return
      }
      setSplit(preview)
    })
  }

  function send() {
    setError(null)
    startTransition(async () => {
      const outcome = await sendPublishAlert(id)
      if (outcome?.ok) {
        setResult(outcome.message ?? 'Alert sent.')
        setSplit(null)
        router.refresh()
      } else {
        setError(outcome?.message ?? 'Could not send the alert.')
      }
    })
  }

  if (result) {
    return (
      <div className="border border-border bg-accent/5 p-4">
        <p className="text-sm text-foreground/80">{result}</p>
      </div>
    )
  }

  if (!split) {
    return (
      <div>
        <button
          type="button"
          onClick={loadSplit}
          disabled={pending}
          className="text-xs font-medium text-accent hover:text-accent-hover cursor-pointer disabled:opacity-40"
        >
          {pending ? 'Checking…' : 'Alert subscribers'}
        </button>
        {error && (
          <p className="mt-2 text-xs text-red-700 max-w-[18rem] text-right">{error}</p>
        )}
      </div>
    )
  }

  return (
    <div className="border border-accent/40 bg-accent/5 p-4 text-left max-w-sm">
      <p className="text-xs font-medium uppercase tracking-wider text-accent mb-3">
        Before sending
      </p>

      <p className="font-serif text-sm text-foreground mb-3">{title}</p>

      {/* The split, stated plainly. */}
      <p className="text-sm text-foreground/80 tabular-nums">
        {split.entitled} entitled · {split.withCopies} have copies ·{' '}
        <span className={split.held > 0 ? 'text-red-700 font-medium' : ''}>
          {split.held} will be held
        </span>
      </p>

      <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
        {split.withCopies === 0
          ? 'Nobody has a stamped copy yet, so nothing will be sent now — everyone will be held until their copy lands.'
          : split.held > 0
            ? `${split.withCopies} will be emailed now. The other ${split.held} have no stamped copy yet, so their alert is held and fires automatically once it is provisioned.`
            : 'Everyone entitled has a copy. All will be emailed now.'}
      </p>

      {error && <p className="mt-3 text-xs text-red-700">{error}</p>}

      <div className="flex items-center gap-3 mt-4">
        <button
          type="button"
          onClick={send}
          disabled={pending}
          className="bg-foreground text-background px-4 py-2 text-xs font-medium tracking-wide hover:bg-foreground/90 disabled:opacity-50 transition-colors cursor-pointer"
        >
          {pending ? 'Sending…' : `Send to ${split.withCopies}`}
        </button>
        <button
          type="button"
          onClick={() => setSplit(null)}
          disabled={pending}
          className="text-xs font-medium text-foreground/60 hover:text-foreground cursor-pointer"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
