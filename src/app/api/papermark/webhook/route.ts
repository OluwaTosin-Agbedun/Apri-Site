import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextResponse, after } from 'next/server'
import { recordView, refreshLastViewed, type IncomingView } from '@/lib/view-attribution'
import { getSql } from '@/lib/db'
import { notifyNewDataRoomDocuments } from '@/lib/dataroom-notifications'

export const dynamic = 'force-dynamic'

/**
 * POST /api/papermark/webhook
 *
 * Records document view events, download events, and document lifecycle
 * changes from Papermark.
 *
 * Unconfigured until PAPERMARK_WEBHOOK_SECRET is set, at which point it becomes
 * live with no code change. While the secret is absent it answers 503 and does
 * nothing else: accepting unsigned events would let anyone who found this URL
 * write view records for any subscriber, which is the one thing that would make
 * the engagement figures worthless.
 *
 * Uses the papermark_webhook_events table for idempotency: a repeated delivery
 * is acknowledged but not processed a second time.
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

  if (eventType && /view/i.test(eventType)) {
    return handleViewEvents(payload, eventId)
  }

  if (eventType && /document\.(created|updated|deleted)/i.test(eventType)) {
    return handleDocumentEvent(payload, eventType, eventId)
  }

  if (eventType && /link\.downloaded/i.test(eventType)) {
    return handleDownloadEvent(payload, eventId)
  }

  if (eventType && /link\.(created|updated)/i.test(eventType)) {
    return handleLinkEvent(payload, eventType, eventId)
  }

  // Unrecognised event type — acknowledge so Papermark does not retry.
  return NextResponse.json({ ok: true, stored: 0 })
}

// ---------------------------------------------------------------------------
// View events (existing behaviour)
// ---------------------------------------------------------------------------

function handleViewEvents(payload: unknown, eventId: string | null) {
  const events = readViewEvents(payload)
  if (events.length === 0) return NextResponse.json({ ok: true, stored: 0 })

  after(async () => {
    if (eventId) {
      const alreadyProcessed = await checkIdempotency(eventId)
      if (alreadyProcessed) return
    }

    for (const event of events) {
      try {
        const { attribution } = await recordView(event)
        if (attribution.subscriberId) {
          await refreshLastViewed(attribution.subscriberId)
        }
      } catch {}
    }

    if (eventId) await markProcessed(eventId, 'view')
  })

  return NextResponse.json({ ok: true, accepted: events.length })
}

// ---------------------------------------------------------------------------
// Document lifecycle events
// ---------------------------------------------------------------------------

function handleDocumentEvent(payload: unknown, eventType: string, eventId: string | null) {
  after(async () => {
    if (eventId) {
      const alreadyProcessed = await checkIdempotency(eventId)
      if (alreadyProcessed) return
    }

    try {
      const data = readData(payload)
      const documentId = str(data.document_id ?? data.documentId ?? data.id)
      const dataroomId = str(data.dataroom_id ?? data.dataroomId)

      if (!documentId) return

      const sql = getSql()

      if (/deleted/i.test(eventType) && dataroomId) {
        await sql`
          update papermark_dataroom_documents
          set is_present = false, removed_at = now(), updated_at = now()
          where papermark_dataroom_id = ${dataroomId}
            and papermark_document_id = ${documentId}
            and is_present = true
        `
      } else if (dataroomId) {
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

        if (/created/i.test(eventType) && dataroomId) {
          try { await notifyNewDataRoomDocuments(dataroomId) } catch {}
        }
      }
    } catch {}

    if (eventId) await markProcessed(eventId, eventType)
  })

  return NextResponse.json({ ok: true, accepted: 1 })
}

// ---------------------------------------------------------------------------
// Download events
// ---------------------------------------------------------------------------

function handleDownloadEvent(payload: unknown, eventId: string | null) {
  after(async () => {
    if (eventId) {
      const alreadyProcessed = await checkIdempotency(eventId)
      if (alreadyProcessed) return
    }

    try {
      const data = readData(payload)
      const viewId = str(data.view_id ?? data.viewId ?? data.id)
      const linkId = str(data.link_id ?? data.linkId)
      const documentId = str(data.document_id ?? data.documentId)
      const downloadedAt = str(data.downloaded_at ?? data.downloadedAt)

      if (!viewId) return

      const sql = getSql()

      await sql`
        update document_views set downloaded = true
        where papermark_view_id = ${viewId}
      `

      if (!linkId) return

      const resolved = await resolveLink(sql, linkId, documentId)
      if (!resolved) return

      const metadata = JSON.stringify({
        source: 'papermark',
        ...(resolved.papermarkDocumentId ? { papermarkDocumentId: resolved.papermarkDocumentId } : {}),
        ...(resolved.documentTitle ? { documentTitle: resolved.documentTitle } : {}),
        papermarkLinkId: linkId,
      })

      await sql`
        insert into client_engagement_events
          (subscriber_id, briefing_request_id, event_type, webhook_event_id, occurred_at, metadata)
        values (
          ${resolved.subscriberId}::uuid, ${resolved.briefingRequestId}::uuid,
          'document_downloaded', ${'dl-' + viewId},
          coalesce(${downloadedAt}::timestamptz, now()),
          ${metadata}::jsonb
        )
        on conflict (webhook_event_id) where webhook_event_id is not null do nothing
      `
    } catch {}

    if (eventId) await markProcessed(eventId, 'link.downloaded')
  })

  return NextResponse.json({ ok: true, accepted: 1 })
}

/**
 * Resolve a Papermark link ID to a subscriber and, where possible, the
 * document that was downloaded. Three tables carry link IDs, checked from
 * most specific to least: per-document subscriber links, Data Room links,
 * and legacy publication_access links.
 */
async function resolveLink(
  sql: ReturnType<typeof getSql>,
  linkId: string,
  payloadDocumentId: string | null,
): Promise<{
  subscriberId: string | null
  briefingRequestId: string | null
  papermarkDocumentId: string | null
  documentTitle: string | null
} | null> {
  // 1. Per-subscriber per-document links (most specific)
  const docLinks = (await sql`
    select dl.subscriber_id, dl.papermark_document_id,
           coalesce(nullif(dd.title, ''), '') as title
    from papermark_subscriber_document_links dl
    left join papermark_dataroom_documents dd
      on dd.papermark_document_id = dl.papermark_document_id
    where dl.papermark_link_id = ${linkId}
    limit 1
  `) as { subscriber_id: string; papermark_document_id: string; title: string }[]

  if (docLinks[0]) {
    return {
      subscriberId: docLinks[0].subscriber_id,
      briefingRequestId: null,
      papermarkDocumentId: docLinks[0].papermark_document_id,
      documentTitle: docLinks[0].title || null,
    }
  }

  // 2. Data Room links (one link per subscriber per Data Room)
  const drLinks = (await sql`
    select subscriber_id, briefing_request_id
    from papermark_dataroom_links
    where papermark_link_id = ${linkId}
    limit 1
  `) as { subscriber_id: string | null; briefing_request_id: string | null }[]

  if (drLinks[0] && (drLinks[0].subscriber_id || drLinks[0].briefing_request_id)) {
    let docTitle: string | null = null
    const pmDocId = payloadDocumentId
    if (pmDocId) {
      const titleRows = (await sql`
        select title from papermark_dataroom_documents
        where papermark_document_id = ${pmDocId} limit 1
      `) as { title: string }[]
      if (titleRows[0]) docTitle = titleRows[0].title
    }
    return {
      subscriberId: drLinks[0].subscriber_id,
      briefingRequestId: drLinks[0].briefing_request_id,
      papermarkDocumentId: pmDocId,
      documentTitle: docTitle,
    }
  }

  // 3. Legacy publication_access links
  const pubLinks = (await sql`
    select pa.subscriber_id, d.title
    from publication_access pa
    left join documents d on d.id = pa.publication_id
    where pa.papermark_link_id = ${linkId}
    limit 1
  `) as { subscriber_id: string; title: string | null }[]

  if (pubLinks[0]) {
    return {
      subscriberId: pubLinks[0].subscriber_id,
      briefingRequestId: null,
      papermarkDocumentId: payloadDocumentId,
      documentTitle: pubLinks[0].title || null,
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Link lifecycle events
// ---------------------------------------------------------------------------

function handleLinkEvent(payload: unknown, eventType: string, eventId: string | null) {
  after(async () => {
    if (eventId) {
      const alreadyProcessed = await checkIdempotency(eventId)
      if (alreadyProcessed) return
    }

    try {
      const data = readData(payload)
      const linkId = str(data.link_id ?? data.linkId ?? data.id)
      if (!linkId) return

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
    } catch {}

    if (eventId) await markProcessed(eventId, eventType)
  })

  return NextResponse.json({ ok: true, accepted: 1 })
}

// ---------------------------------------------------------------------------
// Idempotency via papermark_webhook_events
// ---------------------------------------------------------------------------

async function checkIdempotency(eventId: string): Promise<boolean> {
  try {
    const sql = getSql()
    const rows = await sql`
      select 1 from papermark_webhook_events where event_id = ${eventId} limit 1
    `
    return rows.length > 0
  } catch {
    return false
  }
}

async function markProcessed(eventId: string, eventType: string): Promise<void> {
  try {
    const sql = getSql()
    await sql`
      insert into papermark_webhook_events (event_id, event_type, processed_at, outcome)
      values (${eventId}, ${eventType}, now(), 'processed')
      on conflict (event_id) do update set processed_at = now(), outcome = 'processed'
    `
  } catch {}
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
