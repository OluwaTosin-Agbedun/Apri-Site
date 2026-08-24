import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextResponse, after } from 'next/server'
import { recordView, refreshLastViewed, type IncomingView } from '@/lib/view-attribution'

export const dynamic = 'force-dynamic'

/**
 * POST /api/papermark/webhook
 *
 * Records document view events against the subscriber who opened them.
 *
 * Unconfigured until PAPERMARK_WEBHOOK_SECRET is set, at which point it becomes
 * live with no code change. While the secret is absent it answers 503 and does
 * nothing else: accepting unsigned events would let anyone who found this URL
 * write view records for any subscriber, which is the one thing that would make
 * the engagement figures worthless.
 *
 * The signature is checked before the body is parsed, and the database work
 * happens after the response is sent, so a slow write cannot cause Papermark to
 * time out and retry.
 */
export async function POST(request: Request) {
  const secret = process.env.PAPERMARK_WEBHOOK_SECRET
  if (!secret) {
    // No detail about why: the response goes to an unauthenticated caller.
    return NextResponse.json({ error: 'Not configured.' }, { status: 503 })
  }

  // The raw body is needed for the signature, so read text and parse by hand.
  // Calling request.json() first would consume the stream.
  let raw: string
  try {
    raw = await request.text()
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  }

  if (raw.length > 100_000) {
    return NextResponse.json({ error: 'Payload too large.' }, { status: 413 })
  }

  const signature =
    request.headers.get('x-papermark-signature') ??
    request.headers.get('x-webhook-signature') ??
    ''

  if (!verifySignature(raw, signature, secret)) {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  }

  const events = readEvents(payload)

  // Nothing recognised. Acknowledged rather than retried forever -- a 4xx here
  // would make Papermark redeliver an event we will never handle.
  if (events.length === 0) return NextResponse.json({ ok: true, stored: 0 })

  // Respond now; write after. `after` runs once the response has been flushed,
  // so Papermark sees a fast 200 regardless of database latency.
  after(async () => {
    for (const event of events) {
      try {
        const { attribution } = await recordView(event)
        if (attribution.subscriberId) {
          await refreshLastViewed(attribution.subscriberId)
        }
      } catch {
        // One malformed event must not abandon the rest of the batch. Nothing
        // is logged: the payload carries a viewer's email address, and the
        // daily poll will pick up anything lost here.
      }
    }
  })

  return NextResponse.json({ ok: true, accepted: events.length })
}

/**
 * HMAC-SHA256 over the raw body, compared in constant time.
 *
 * Accepts a bare hex digest or a `sha256=` prefixed one, since providers differ.
 */
function verifySignature(body: string, header: string, secret: string): boolean {
  if (!header) return false

  const provided = header.startsWith('sha256=') ? header.slice(7) : header
  const expected = createHmac('sha256', secret).update(body).digest('hex')

  const a = Buffer.from(provided, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Narrows an untrusted payload to the view events we store.
 *
 * Handles a single event, a `data` wrapper, and a batch under `events` or
 * `data`, because the exact envelope is not confirmed until the secret is live.
 * Field names follow Papermark's documented View object -- id, link_id,
 * document_id, viewer_email, viewed_at, downloaded_at -- with snake_case and
 * camelCase both accepted.
 */
function readEvents(payload: unknown): IncomingView[] {
  if (!payload || typeof payload !== 'object') return []
  const root = payload as Record<string, unknown>

  const type = str(root.type ?? root.event)
  // Only view events are stored. A link created or a document updated is not an
  // open and must not count as engagement.
  if (type && !/view/i.test(type)) return []

  const batch = arr(root.events) ?? arr(root.data)
  if (batch) {
    return batch
      .map((item) => readOne(item))
      .filter((v): v is IncomingView => v !== null)
  }

  const single =
    root.data && typeof root.data === 'object' && !Array.isArray(root.data)
      ? (root.data as Record<string, unknown>)
      : root

  const one = readOne(single)
  return one ? [one] : []
}

function readOne(value: unknown): IncomingView | null {
  if (!value || typeof value !== 'object') return null
  const d = value as Record<string, unknown>

  // Without an id the row cannot be deduplicated, so it is dropped rather than
  // stored under a fabricated key.
  const papermarkViewId = str(d.id ?? d.view_id ?? d.viewId)
  if (!papermarkViewId) return null

  const downloadedAt = str(d.downloaded_at ?? d.downloadedAt)

  return {
    papermarkViewId,
    papermarkLinkId: str(d.link_id ?? d.linkId),
    papermarkDocumentId: str(d.document_id ?? d.documentId),
    viewerEmail: str(d.viewer_email ?? d.viewerEmail ?? d.email),
    viewedAt: str(d.viewed_at ?? d.viewedAt ?? d.created_at),
    durationSeconds: num(d.total_duration_seconds ?? d.duration_seconds ?? d.duration),
    completionPct: num(d.completion_pct ?? d.completionRate),
    downloaded: Boolean(downloadedAt) || d.downloaded === true,
    source: 'webhook',
  }
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 500
    ? value
    : null
}

/** Seconds may arrive as milliseconds-precision floats; stored as whole seconds. */
function num(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return Math.round(value)
}

function arr(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null
}
