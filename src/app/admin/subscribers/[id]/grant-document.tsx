'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export type GrantablePublication = {
  id: string
  label: string
  /** True when this person already holds a live copy of it. */
  alreadyHeld: boolean
}

/**
 * Opens the provisioning form for one publication and this person.
 *
 * Exists because a briefing client is correctly absent from the copies queue --
 * they hold no level, so nothing is owed to them -- which left their
 * provisioning form reachable only by constructing the URL by hand. A
 * hand-built URL is one mistyped id away from stamping someone else's name into
 * a document.
 *
 * Offered for subscribers too: it is the way to grant an edition outside the
 * normal entitlement, such as a single paper sent as a courtesy.
 */
export default function GrantDocument({
  subscriberId,
  publications,
}: {
  subscriberId: string
  publications: GrantablePublication[]
}) {
  const router = useRouter()
  const [publicationId, setPublicationId] = useState('')

  if (publications.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No published editions to grant yet.
      </p>
    )
  }

  const chosen = publications.find((p) => p.id === publicationId)

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <label
            htmlFor="grantPublication"
            className="block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2"
          >
            Grant a document
          </label>
          <select
            id="grantPublication"
            value={publicationId}
            onChange={(e) => setPublicationId(e.target.value)}
            className="w-full border border-border bg-background p-2.5 text-sm focus:outline-none focus:border-accent"
          >
            <option value="">Choose a publication…</option>
            {publications.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
                {p.alreadyHeld ? ' — already granted' : ''}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          disabled={!publicationId}
          onClick={() =>
            router.push(
              `/admin/copies/provision?s=${subscriberId}&p=${publicationId}`
            )
          }
          className="border border-border px-4 py-2.5 text-sm font-medium text-foreground/80 hover:border-accent hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          Provision
        </button>
      </div>

      {chosen?.alreadyHeld && (
        <p className="mt-2 text-xs text-muted-foreground">
          They already hold a live copy of this. Provisioning again replaces the
          recorded link.
        </p>
      )}
    </div>
  )
}
