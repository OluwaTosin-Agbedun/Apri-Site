"use client"

import Link from "next/link"
import type { ReactNode } from "react"

/**
 * A link that records the click and then gets out of the way.
 *
 * The ordering is the whole design: the beacon is fired and NOT awaited, and
 * nothing is prevented, cancelled or delayed. If the endpoint is down, slow,
 * blocked by an extension or returns an error, the browser follows the link
 * exactly as it would have without this component. A reader must never be kept
 * from a document because analytics failed.
 *
 * `keepalive` is what makes that safe: the request survives the page
 * navigation that immediately follows, so a fire-and-forget beacon still
 * arrives rather than being cancelled on unload.
 */

export type AccessEventType =
  | 'review_access_clicked'
  | 'publication_details_clicked'
  | 'subscriber_document_view_clicked'
  | 'subscriber_document_download_clicked'

type Props = {
  href: string
  eventType: AccessEventType
  publicationId?: string | null
  slotKey?: 'MIN' | 'AIU' | 'PLM' | null
  papermarkDocumentId?: string | null
  className?: string
  children: ReactNode
  /** External Papermark links open in a new tab. */
  newTab?: boolean
  /** Use next/link for in-app navigation. */
  internal?: boolean
}

/**
 * Sends the beacon.
 *
 * Every failure path is swallowed on purpose. This function is called for its
 * side effect and its result is never inspected, so a rejected promise here
 * must not surface as an unhandled rejection either.
 */
export function recordAccessClick(input: {
  eventType: AccessEventType
  publicationId?: string | null
  slotKey?: string | null
  papermarkDocumentId?: string | null
}): void {
  try {
    const eventId = newEventId()

    const body = JSON.stringify({
      eventId,
      eventType: input.eventType,
      publicationId: input.publicationId ?? null,
      slotKey: input.slotKey ?? null,
      papermarkDocumentId: input.papermarkDocumentId ?? null,
      originPath: typeof window !== 'undefined' ? window.location.pathname : '',
      occurredAt: new Date().toISOString(),
    })

    // sendBeacon first: the browser hands it to the network stack and returns
    // immediately, and delivery survives the navigation that follows without
    // the page having to stay alive for it. fetch with keepalive is the
    // fallback where sendBeacon is unavailable or refuses the payload (it can
    // return false when its queue is full).
    //
    // Neither is awaited, and neither result is acted on. If both fail the
    // click is simply not recorded, which is the correct trade: analytics must
    // never be the reason a reader cannot open a document.
    let queued = false
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        queued = navigator.sendBeacon(
          '/api/engagement/click',
          new Blob([body], { type: 'application/json' }),
        )
      }
    } catch {
      queued = false
    }

    if (!queued) {
      void fetch('/api/engagement/click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
        credentials: 'same-origin',
      }).catch(() => {})
    }
  } catch {
    // Nothing about a click record is worth interrupting navigation for.
  }
}

/** A client-side idempotency key, so a double-fired beacon is one click. */
function newEventId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {}
  return `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
}

export default function TrackedAccessLink({
  href,
  eventType,
  publicationId = null,
  slotKey = null,
  papermarkDocumentId = null,
  className,
  children,
  newTab = false,
  internal = false,
}: Props) {
  // No preventDefault, no await, no state. The click proceeds natively.
  const onClick = () => {
    recordAccessClick({ eventType, publicationId, slotKey, papermarkDocumentId })
  }

  if (internal) {
    return (
      <Link href={href} className={className} onClick={onClick}>
        {children}
      </Link>
    )
  }

  return (
    <a
      href={href}
      className={className}
      onClick={onClick}
      {...(newTab ? { target: '_blank', rel: 'noreferrer' } : {})}
    >
      {children}
    </a>
  )
}
