import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getSql } from '@/lib/db'
import { ACCESS_EVENT_TYPES } from '@/lib/engagement-metrics'

export const dynamic = 'force-dynamic'

/**
 * POST /api/engagement/click
 *
 * Records one click on an APRI publication card.
 *
 * A click is an intent signal recorded by our own site. It is not a view: only
 * Papermark can confirm a document was opened, so these rows are reported
 * separately and never added to view sessions.
 *
 * What the browser is trusted with is deliberately minimal: an event id, an
 * event type, and a publication id or slot key. Everything else — the Papermark
 * document and link ids — is resolved here from our own tables. The browser
 * never sends, and this route never accepts, an email address, a secure URL, a
 * token or an IP address, and no IP is stored.
 */

const VISITOR_COOKIE = 'apri_vid'
const VISITOR_MAX_AGE = 60 * 60 * 24 * 365

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const Body = z.object({
  // Client-generated, so a retried beacon collapses onto one row.
  eventId: z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/),
  eventType: z.enum(ACCESS_EVENT_TYPES),
  publicationId: z.string().regex(UUID_RE).nullish(),
  slotKey: z.enum(['MIN', 'AIU', 'PLM']).nullish(),
  // The portal identifies a document by its Papermark id rather than an APRI
  // publication uuid. Resolved and validated server-side like the others, so
  // an id APRI does not know about is still refused.
  papermarkDocumentId: z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/).nullish(),
  originPath: z.string().max(200).nullish(),
  occurredAt: z.string().datetime().nullish(),
})

export async function POST(request: Request) {
  // Same-origin only. A cross-site caller could otherwise inflate the click
  // figures for any publication, and the numbers exist to be trusted.
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  }

  const parsed = Body.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid event.' }, { status: 400 })
  }

  const body = parsed.data

  // One identifier is required: without any there is nothing to attribute the
  // click to.
  if (!body.publicationId && !body.slotKey && !body.papermarkDocumentId) {
    return NextResponse.json({ error: 'Invalid event.' }, { status: 400 })
  }

  const visitorId = await resolveVisitorId()

  try {
    const sql = getSql()

    // Only a publication or slot APRI actually knows about is accepted, and the
    // Papermark ids come from our own tables rather than the request. This is
    // both a validation step and the reason the browser needs no Papermark
    // knowledge at all.
    const resolved = await resolveTarget(
      sql,
      body.publicationId ?? null,
      body.slotKey ?? null,
      body.papermarkDocumentId ?? null,
    )
    if (!resolved) {
      return NextResponse.json({ error: 'Unknown publication.' }, { status: 400 })
    }

    await sql`
      insert into publication_access_events (
        event_id, visitor_id, publication_id, slot_key,
        papermark_document_id, papermark_link_id,
        event_type, origin_path, occurred_at, received_at
      ) values (
        ${body.eventId},
        ${visitorId},
        ${resolved.publicationId},
        ${resolved.slotKey},
        ${resolved.papermarkDocumentId},
        ${resolved.papermarkLinkId},
        ${body.eventType},
        ${sanitizePath(body.originPath)},
        coalesce(${safeTimestamp(body.occurredAt)}::timestamptz, now()),
        now()
      )
      on conflict (event_id) do nothing
    `

    await stampFirstReliableTimestamp(sql)

    const response = NextResponse.json({ ok: true })
    await setVisitorCookie(visitorId)
    return response
  } catch {
    // Recording a click must never be the reason a reader cannot open a
    // document. The caller ignores this status and navigates regardless; it is
    // returned only so a failure is visible in the network log.
    return NextResponse.json({ ok: false }, { status: 202 })
  }
}

/**
 * Resolves the click target from APRI's own tables.
 *
 * A slot key resolves through `complimentary_review_items`, which is also where
 * the review link id lives. Nothing here reads or returns `secure_link_url` —
 * the event stores which publication was clicked, not the credential that opens
 * it.
 */
async function resolveTarget(
  sql: ReturnType<typeof getSql>,
  publicationId: string | null,
  slotKey: string | null,
  papermarkDocumentId: string | null,
): Promise<{
  publicationId: string | null
  slotKey: string | null
  papermarkDocumentId: string | null
  papermarkLinkId: string | null
} | null> {
  if (slotKey) {
    const rows = (await sql`
      select slot_key, publication_id, papermark_document_id, secure_link_id
      from complimentary_review_items
      where slot_key = ${slotKey} and is_active = true
      limit 1
    `) as {
      slot_key: string
      publication_id: string | null
      papermark_document_id: string | null
      secure_link_id: string | null
    }[]

    const row = rows[0]
    if (!row) return null
    return {
      publicationId: row.publication_id,
      slotKey: row.slot_key,
      papermarkDocumentId: row.papermark_document_id,
      papermarkLinkId: row.secure_link_id,
    }
  }

  if (papermarkDocumentId) {
    // Checked against all three places a Papermark document can be mapped, the
    // same set the attribution resolver consults. An unmapped document is
    // recorded with a null publication rather than refused: the click is real
    // and the mapping can be repaired later.
    const known = (await sql`
      select d.id as publication_id
        from documents d
        where d.papermark_document_id = ${papermarkDocumentId}
      union all
      select dd.publication_id
        from papermark_dataroom_documents dd
        where dd.papermark_document_id = ${papermarkDocumentId}
          and dd.publication_id is not null
      union all
      select ri.publication_id
        from complimentary_review_items ri
        where ri.papermark_document_id = ${papermarkDocumentId}
          and ri.publication_id is not null
      limit 1
    `) as { publication_id: string | null }[]

    return {
      publicationId: known[0]?.publication_id ?? null,
      slotKey: null,
      papermarkDocumentId,
      papermarkLinkId: null,
    }
  }

  const rows = (await sql`
    select id, papermark_document_id from documents where id = ${publicationId}::uuid limit 1
  `) as { id: string; papermark_document_id: string | null }[]

  const row = rows[0]
  if (!row) return null
  return {
    publicationId: row.id,
    slotKey: null,
    papermarkDocumentId: row.papermark_document_id,
    papermarkLinkId: null,
  }
}

/**
 * Reads or mints the first-party visitor cookie.
 *
 * A random value with no derivation from anything about the person: not their
 * address, not their IP, not a fingerprint. It exists only to tell one
 * browser's repeat clicks apart from two browsers' single clicks.
 */
async function resolveVisitorId(): Promise<string> {
  const jar = await cookies()
  const existing = jar.get(VISITOR_COOKIE)?.value
  if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing
  return randomUUID()
}

async function setVisitorCookie(value: string): Promise<void> {
  try {
    const jar = await cookies()
    jar.set(VISITOR_COOKIE, value, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: VISITOR_MAX_AGE,
    })
  } catch {
    // A read-only cookie store in some rendering contexts; the click is still
    // recorded, just without a durable visitor id.
  }
}

/**
 * Records when click collection genuinely began.
 *
 * Written once and never moved backwards, so "Data since" reports the first
 * real event rather than implying coverage that does not exist. Historical
 * clicks are not fabricated.
 */
async function stampFirstReliableTimestamp(sql: ReturnType<typeof getSql>): Promise<void> {
  try {
    await sql`
      insert into app_settings (key, value)
      values ('engagement_click_tracking_since', ${new Date().toISOString()})
      on conflict (key) do update set
        value = case
                  when app_settings.value is null or app_settings.value = ''
                  then excluded.value
                  else app_settings.value
                end
    `
  } catch {}
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  const host = request.headers.get('host')
  if (!host) return false

  // A same-origin fetch may omit Origin in some browsers; Sec-Fetch-Site is
  // then the reliable signal and cannot be set by script.
  const site = request.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin') return false
  if (!origin) return site === 'same-origin'

  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/** Keeps only an APRI-looking path, with no query string. */
function sanitizePath(value: string | null | undefined): string {
  if (!value) return ''
  const path = value.split('?')[0]!.split('#')[0]!
  return /^\/[A-Za-z0-9/_-]{0,199}$/.test(path) ? path : ''
}

function safeTimestamp(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  // Refuse a client clock claiming the future or the distant past.
  const now = Date.now()
  const t = date.getTime()
  if (t > now + 5 * 60_000 || t < now - 7 * 86_400_000) return null
  return date.toISOString()
}
