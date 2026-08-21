'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Outcome = 'new' | 'updated' | 'unchanged' | 'missing-link'

type Item = {
  papermarkDocumentId: string
  title: string
  outcome: Outcome
  papermarkUrl: string | null
}

type Result = {
  summary: { fetched: number; new: number; updated: number; unchanged: number; missingLink: number }
  items: Item[]
}

const BADGE: Record<Outcome, { label: string; className: string }> = {
  new: { label: 'New', className: 'bg-accent/10 text-accent' },
  updated: { label: 'Updated', className: 'bg-accent/10 text-accent' },
  unchanged: {
    label: 'Already imported',
    className: 'bg-muted text-muted-foreground border border-border',
  },
  'missing-link': {
    label: 'Missing secure link',
    className: 'bg-red-50 text-red-700 border border-red-200',
  },
}

export default function SyncPanel() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function sync() {
    setPending(true)
    setError(null)
    setResult(null)
    try {
      const response = await fetch('/api/admin/papermark/sync', { method: 'POST' })
      const data = await response.json()
      if (!response.ok) {
        setError(data?.error ?? 'The sync failed.')
      } else {
        setResult(data as Result)
        router.refresh() // Pull the new rows into the table below.
      }
    } catch {
      setError('Could not reach the server.')
    } finally {
      setPending(false)
    }
  }

  const s = result?.summary

  return (
    <div className="border border-border bg-card/30 p-6 mb-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="font-serif text-lg text-foreground mb-2">Papermark</h3>
          <p className="text-sm text-foreground/70 max-w-xl leading-relaxed">
            Pull documents and their secure share links from Papermark. Imported
            documents arrive as drafts and stay off the public site until you
            publish them. Running this repeatedly will not create duplicates.
          </p>
        </div>
        <button
          type="button"
          onClick={sync}
          disabled={pending}
          className="bg-foreground text-background px-6 py-2.5 text-sm font-medium tracking-wide hover:bg-foreground/90 disabled:opacity-50 transition-colors cursor-pointer shrink-0"
        >
          {pending ? 'Fetching…' : 'Fetch from Papermark'}
        </button>
      </div>

      {error && (
        <p className="mt-5 text-sm text-red-700 border border-red-200 bg-red-50 p-3">
          {error}
        </p>
      )}

      {s && (
        <div className="mt-6 pt-5 border-t border-border">
          <p className="text-sm text-foreground/80 mb-4">
            Fetched <span className="font-medium">{s.fetched}</span> from Papermark
            &mdash; <span className="font-medium">{s.new}</span> new,{' '}
            <span className="font-medium">{s.updated}</span> updated,{' '}
            <span className="font-medium">{s.unchanged}</span> unchanged
            {s.missingLink > 0 && (
              <>
                ,{' '}
                <span className="font-medium text-red-700">
                  {s.missingLink} missing a secure link
                </span>
              </>
            )}
            .
          </p>

          {result.items.length > 0 && (
            <ul className="divide-y divide-border border border-border bg-background">
              {result.items.map((item) => {
                const badge = BADGE[item.outcome]
                return (
                  <li
                    key={item.papermarkDocumentId}
                    className="flex items-center justify-between gap-4 p-3"
                  >
                    <span className="text-sm text-foreground truncate">{item.title}</span>
                    <span
                      className={`shrink-0 inline-flex items-center px-2 py-1 rounded text-xs font-medium ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
