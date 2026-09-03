import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import {
  recordView,
  recordDownload,
  refreshLastViewed,
  attribute,
  type IncomingView,
} from '@/lib/view-attribution'
import { getSql } from '@/lib/db'
import { notifyNewDataRoomDocuments } from '@/lib/dataroom-notifications'

export const dynamic = 'force-dynamic'

/**
 * POST /api/papermark/webhook
 *
 * Records Papermark view events, download events and document lifecycle
 * changes.
 *
 * Unconfigured until PAPERMARK_WEBHOOK_SECRET is set, at which point it becomes
 * live with no code change. While the secret is absent it answers 503 and does
 * nothing else: accepting unsigned events would let anyone who found this URL
 * write view records for any subscriber, which is the one thing that would make
 * the engagement figures worthless.
 *
 * Two behaviours were deliberately changed in Phase 6:
 *
 *  - Processing is awaited, not deferred to `after()`. The old route responded
 *    200 and then worked in the background, so a database failure was invisible
 *    to Papermark and the event was never retried.
 *  - An event is marked processed only once its database work has succeeded. The
 *    old route wrapped the work in `try {} catch {}` and then marked the event
 *    processed regardless, so a failed event was permanently recorded as done
 *    and its data lost. A genuine failure now returns 500 so Papermark retries.
 */
export async function POST(request: Request) {
  const secret = process.env.PAPERMARK_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Not configured.' }, { status: 503 })
  }

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

  const eventType = readEventType(payload)
  const eventId = readEventId(payload)

  // An event with no usable type cannot be dispatched. Acknowledged so
  // Papermark does not retry something we will never understand.
  if (!eventType) {
    return NextResponse.json({ ok: true, stored: 0, reason: 'no-event-type' })
  }

  await noteWebhookSeen()

  // Already done? Acknowledge without repeating the work.
  if (eventId && (await alreadyProcessed(eventId))) {
    return NextResponse.json({ ok: true, duplicate: true })
  }

  try {
    const result = await dispatch(payload, eventType)

    if (eventId) await markProcessed(eventId, eventType)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    // Recorded as failed, NOT processed, and answered with a retriable status.
    // The sanitized reason never includes a token, a signature or a raw header.
    const reason = sanitizeError(error)
    if (eventId) await markFailed(eventId, eventType, reason)

    return NextResponse.json(
      { ok: false, error: 'Processing failed.', reason },
      { status: 500 },
    )
  }
}

/**
 * Routes one event to its handler.
 *
 * `link.downloaded` is tested FIRST, before the generic view matcher. The
 * matcher is a loose `/view/i` test, so any future event type that mentions a
 * view — `view.downloaded`, say — would otherwise be swallowed by it and
 * recorded as a plain view session, losing the download entirely.
 */
async function dispatch(
  payload: unknown,
  eventType: string,
): Promise<Record<string, number | boolean>> {
  if (/download/i.test(eventType)) {
    return handleDownloadEvent(payload)
  }

  if (/view/i.test(eventType)) {
    return handleViewEvents(payload)
  }

  if (/document\.(created|updated|deleted)/i.test(eventType)) {
    return handleDocumentEvent(payload, eventType)
  }

  if (/link\.(created|updated)/i.test(eventType)) {
    return handleLinkEvent(payload)
  }

  // Recognised as valid but not something we act on.
  return { stored: 0 }
}

// ---------------------------------------------------------------------------
// View events
// ---------------------------------------------------------------------------

async function handleViewEvents(payload: unknown): Promise<Record<string, number>> {
  const events = readViewEvents(payload)
  if (events.length === 0) return { stored: 0 }

  let stored = 0

  // Not wrapped in a swallowing catch: a failure here must reach the caller so
  // the event is marked failed and retried.
  for (const event of events) {
    const { attribution } = await recordView(event)
    stored++

    // A view arriving with downloaded_at set is also a download. Keyed on the
    // view id so the poll seeing the same thing does not duplicate it.
    if (event.downloaded) {
      await recordDownload({
        sourceEventId: `view:${event.papermarkViewId}`,
        papermarkViewId: event.papermarkViewId,
        papermarkLinkId: event.papermarkLinkId,
        papermarkDocumentId: event.papermarkDocumentId,
        viewerEmail: event.viewerEmail,
        downloadedAt: event.viewedAt,
        collectionSource: 'webhook',
        attribution,
      })
    }

    if (attribution.subscriberId) {
      // Derived convenience field; a failure must not lose the view itself.
      try {
        await refreshLastViewed(attribution.subscriberId)
      } catch {}
    }
  }

  return { stored }
}

// ---------------------------------------------------------------------------
// Download events
// ---------------------------------------------------------------------------

/**
 * Records one confirmed download.
 *
 * One `document_download_events` row per unique webhook event, so a reader who
 * downloads the same document four times produces four rows. The old route
 * could only set a boolean on the view, which cannot represent that at all.
 *
 * When Papermark omits a view id the event id becomes the deduplication key —
 * the old route returned early without a view id and dropped the download.
 */
async function handleDownloadEvent(payload: unknown): Promise<Record<string, number | boolean>> {
  const data = readData(payload)

  const viewId = str(data.view_id ?? data.viewId)
  const linkId = str(data.link_id ?? data.linkId)
  const documentId = str(data.document_id ?? data.documentId)
  const viewerEmail = str(data.viewer_email ?? data.viewerEmail ?? data.email)
  const downloadedAt = str(data.downloaded_at ?? data.downloadedAt)
  const eventId = readEventId(payload)

  // Deduplication key: the view id where Papermark supplies one, otherwise the
  // event id. Without either there is nothing to key on and the row would
  // duplicate on every retry, so it is refused rather than stored.
  const sourceEventId = viewId ? `view:${viewId}` : eventId ? `event:${eventId}` : null

  if (!sourceEventId) {
    return { stored: 0, missingIdentifiers: true }
  }

  // A download with no link and no document cannot be attributed to anything.
  if (!linkId && !documentId && !viewId) {
    return { stored: 0, missingIdentifiers: true }
  }

  const attribution = await attribute({
    papermarkViewId: viewId ?? sourceEventId,
    papermarkLinkId: linkId,
    papermarkDocumentId: documentId,
    viewerEmail,
    viewedAt: downloadedAt,
    durationSeconds: null,
    completionPct: null,
    downloaded: true,
    source: 'webhook',
  })

  const { created } = await recordDownload({
    sourceEventId,
    papermarkViewId: viewId,
    papermarkLinkId: linkId,
    papermarkDocumentId: documentId,
    viewerEmail,
    downloadedAt,
    collectionSource: 'webhook',
    attribution,
  })

  // Keep the legacy engagement timeline populated for subscribers and briefing
  // clients, so the existing per-subscriber detail view is unchanged.
  if (attribution.subscriberId || attribution.briefingRequestId) {
    const sql = getSql()
    const metadata = JSON.stringify({
      source: 'papermark',
      ...(documentId ? { papermarkDocumentId: documentId } : {}),
      ...(linkId ? { papermarkLinkId: linkId } : {}),
    })

    await sql`
      insert into client_engagement_events
        (subscriber_id, briefing_request_id, event_type, webhook_event_id, occurred_at, metadata)
      values (
        ${attribution.subscriberId}::uuid, ${attribution.briefingRequestId}::uuid,
        'document_downloaded', ${'dl-' + sourceEventId},
        coalesce(${downloadedAt}::timestamptz, now()),
        ${metadata}::jsonb
      )
      on conflict (webhook_event_id) where webhook_event_id is not null do nothing
    `
  }

  return { stored: created ? 1 : 0, duplicate: !created }
}

// ---------------------------------------------------------------------------
// Document lifecycle events
// ---------------------------------------------------------------------------

async function handleDocumentEvent(
  payload: unknown,
  eventType: string,
): Promise<Record<string, number>> {
  const data = readData(payload)
  const documentId = str(data.document_id ?? data.documentId ?? data.id)
  const dataroomId = str(data.dataroom_id ?? data.dataroomId)

  if (!documentId || !dataroomId) return { stored: 0 }

  const sql = getSql()

  if (/deleted/i.test(eventType)) {
    await sql`
      update papermark_dataroom_documents
      set is_present = false, removed_at = now(), updated_at = now()
      where papermark_dataroom_id = ${dataroomId}
        and papermark_document_id = ${documentId}
        and is_present = true
    `
    return { stored: 1 }
  }

  const title = str(data.name ?? data.document_name ?? data.title) ?? ''
  const numPages = num(data.num_pages ?? data.numPages)
  const contentType = str(data.content_type ?? data.contentType)

  await sql`
    insert into papermark_dataroom_documents
      (papermark_dataroom_id, papermark_document_id, title, num_pages, content_type)
    values (${dataroomId}, ${documentId}, ${title}, ${numPages}, ${contentType})
    on conflict (papermark_dataroom_id, papermark_document_id) do update set
      title = coalesce(nullif(excluded.title, ''), papermark_dataroom_documents.title),
      num_pages = coalesce(excluded.num_pages, papermark_dataroom_documents.num_pages),
      content_type = coalesce(excluded.content_type, papermark_dataroom_documents.content_type),
      last_seen_at = now(),
      is_present = true,
      removed_at = null,
      updated_at = now()
  `

  if (/created/i.test(eventType)) {
    // Notification is a side effect; a mail failure must not lose the document
    // record or cause Papermark to retry an event we have already stored.
    try {
      await notifyNewDataRoomDocuments(dataroomId)
    } catch {}
  }

  return { stored: 1 }
}

// ---------------------------------------------------------------------------
// Link lifecycle events
// ---------------------------------------------------------------------------

async function handleLinkEvent(payload: unknown): Promise<Record<string, number>> {
  const data = readData(payload)
  const linkId = str(data.link_id ?? data.linkId ?? data.id)
  if (!linkId) return { stored: 0 }

  const sql = getSql()
  const expiresAt = str(data.expires_at ?? data.expiresAt)
  const allowDownload = data.allow_download === true || data.allowDownload === true

  await sql`
    update papermark_dataroom_links set
      expires_at = coalesce(${expiresAt}::timestamptz, expires_at),
      allow_download = ${allowDownload},
      last_synced_at = now(),
      updated_at = now()
    where papermark_link_id = ${linkId}
  `

  return { stored: 1 }
}

// ---------------------------------------------------------------------------
// Idempotency and failure diagnostics
// ---------------------------------------------------------------------------

/**
 * Whether this event has already been processed successfully.
 *
 * Only `outcome = 'processed'` counts. A row left by a previous failure must
 * not suppress the retry — which is what would happen if presence alone were
 * treated as done.
 */
async function alreadyProcessed(eventId: string): Promise<boolean> {
  try {
    const sql = getSql()
    const rows = await sql`
      select 1 from papermark_webhook_events
      where event_id = ${eventId} and outcome = 'processed'
      limit 1
    `
    return rows.length > 0
  } catch {
    // Cannot confirm: treat as not processed. Re-processing is idempotent
    // everywhere downstream, whereas skipping would silently lose the event.
    return false
  }
}

async function markProcessed(eventId: string, eventType: string): Promise<void> {
  try {
    const sql = getSql()
    await sql`
      insert into papermark_webhook_events
        (event_id, event_type, processed_at, outcome, attempts)
      values (${eventId}, ${eventType}, now(), 'processed', 1)
      on conflict (event_id) do update set
        processed_at = now(),
        outcome = 'processed',
        attempts = papermark_webhook_events.attempts + 1,
        last_error = null
    `
  } catch {}
}

async function markFailed(eventId: string, eventType: string, reason: string): Promise<void> {
  try {
    const sql = getSql()
    await sql`
      insert into papermark_webhook_events
        (event_id, event_type, outcome, attempts, last_error, failed_at)
      values (${eventId}, ${eventType}, 'failed', 1, ${reason}, now())
      on conflict (event_id) do update set
        outcome = 'failed',
        attempts = papermark_webhook_events.attempts + 1,
        last_error = ${reason},
        failed_at = now()
    `
  } catch {}
}

/** Records that a delivery arrived, for the diagnostics panel. */
async function noteWebhookSeen(): Promise<void> {
  try {
    const sql = getSql()
    await sql`
      insert into app_settings (key, value)
      values ('papermark_last_webhook_at', ${new Date().toISOString()})
      on conflict (key) do update set value = excluded.value
    `
  } catch {}
}

/**
 * A short, safe failure reason.
 *
 * Truncated, and stripped of anything that looks like a bearer token or a long
 * opaque credential, so a provider message that quotes the request cannot put a
 * secret into the database or the response body.
 */
function sanitizeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : 'Unknown error'
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted]')
    .slice(0, 300)
}

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

function verifySignature(body: string, header: string, secret: string): boolean {
  if (!header) return false

  const provided = header.startsWith('sha256=') ? header.slice(7) : header
  const expected = createHmac('sha256', secret).update(body).digest('hex')

  const a = Buffer.from(provided, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

// ---------------------------------------------------------------------------
// Payload parsing
// ---------------------------------------------------------------------------

function readEventType(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const root = payload as Record<string, unknown>
  return str(root.type ?? root.event ?? root.event_type)
}

function readEventId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const root = payload as Record<string, unknown>
  return str(root.event_id ?? root.eventId ?? root.webhook_id ?? root.id)
}

function readData(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return {}
  const root = payload as Record<string, unknown>
  if (root.data && typeof root.data === 'object' && !Array.isArray(root.data)) {
    return root.data as Record<string, unknown>
  }
  return root
}

function readViewEvents(payload: unknown): IncomingView[] {
  if (!payload || typeof payload !== 'object') return []
  const root = payload as Record<string, unknown>

  const batch = arr(root.events) ?? arr(root.data)
  if (batch) {
    return batch
      .map((item) => readOneView(item))
      .filter((v): v is IncomingView => v !== null)
  }

  const single =
    root.data && typeof root.data === 'object' && !Array.isArray(root.data)
      ? (root.data as Record<string, unknown>)
      : root

  const one = readOneView(single)
  return one ? [one] : []
}

function readOneView(value: unknown): IncomingView | null {
  if (!value || typeof value !== 'object') return null
  const d = value as Record<string, unknown>

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

function num(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return Math.round(value)
}

function arr(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null
}
