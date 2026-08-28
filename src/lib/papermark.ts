import 'server-only'
import { WATERMARKING_ENABLED } from './delivery'

/**
 * Papermark REST client.
 *
 * The token is read from the server environment only. It is never imported by a
 * client component and never prefixed NEXT_PUBLIC_, so it cannot reach the
 * browser bundle. All calls happen inside route handlers and server actions.
 *
 * ENDPOINTS: taken from Papermark's published OpenAPI document at
 * https://www.papermark.com/docs/openapi.json, which declares
 * `https://api.papermark.com` as the production server and paths under `/v1`.
 * There is no team id in the path -- the token identifies the team. An earlier
 * revision of this file guessed `app.papermark.com/api/v1/teams/{id}/…`, which
 * does not exist; PAPERMARK_TEAM_ID is consequently no longer required.
 */
const BASE = process.env.PAPERMARK_API_BASE ?? 'https://api.papermark.com'

export type PapermarkDocument = {
  id: string
  name: string
  folderId?: string | null
  createdAt?: string
  updatedAt?: string
}

export type PapermarkFolder = {
  id: string
  name: string
  parent_id?: string | null
  parentId?: string | null
  path?: string
}

export type PapermarkLink = {
  id: string
  url?: string
  domainSlug?: string
  slug?: string
  isArchived?: boolean
  /** snake_case per the OpenAPI Link schema; camelCase kept for older payloads. */
  document_id?: string | null
  documentId?: string | null
}

/**
 * Whether the API credentials are present.
 *
 * Callers that must keep working without them -- the portal, the public pages,
 * anything on a request path a subscriber can reach -- check this first and take
 * the manual-link route instead of calling the API. Only the admin sync panel,
 * where a human is waiting for an explanation, lets the throwing helpers below
 * surface their message.
 */
export function isPapermarkConfigured(): boolean {
  return Boolean(apiToken())
}

/**
 * The API token.
 *
 * PAPERMARK_API_TOKEN is this project's name for it. PAPERMARK_API_KEY is
 * accepted as well because that is the name used in the brief, and a token set
 * under the wrong one would otherwise leave the poller silently doing nothing.
 */
function apiToken(): string | null {
  return process.env.PAPERMARK_API_TOKEN ?? process.env.PAPERMARK_API_KEY ?? null
}

function requireToken(): string {
  const token = apiToken()
  if (!token) {
    throw new PapermarkError(
      'PAPERMARK_API_TOKEN is not set. Add it to .env.local locally and to the ' +
        'hosting environment variables for deployed builds.'
    )
  }
  return token
}

export class PapermarkError extends Error {}

async function call<T>(path: string): Promise<T> {
  const token = requireToken()

  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      // Never cache: a sync must see current state.
      cache: 'no-store',
    })
  } catch (cause) {
    throw new PapermarkError('Could not reach Papermark. Check network access.')
  }

  if (response.status === 401 || response.status === 403) {
    throw new PapermarkError(
      'Papermark rejected the API token. Check PAPERMARK_API_TOKEN is current.'
    )
  }
  if (response.status === 404) {
    throw new PapermarkError(
      `Papermark returned 404 for ${path}. The API path or team id may be wrong.`
    )
  }
  if (!response.ok) {
    throw new PapermarkError(
      `Papermark returned ${response.status}. Try again, or check the Papermark status page.`
    )
  }

  try {
    return (await response.json()) as T
  } catch {
    throw new PapermarkError('Papermark returned a response that was not JSON.')
  }
}

/** Unwraps either a bare array or the spec's `{ data, next_cursor }` envelope. */
function unwrap<T>(data: unknown, legacyKey: string): { items: T[]; next: string | null } {
  if (Array.isArray(data)) return { items: data as T[], next: null }
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    const items = obj.data ?? obj[legacyKey]
    return {
      items: Array.isArray(items) ? (items as T[]) : [],
      next: typeof obj.next_cursor === 'string' ? obj.next_cursor : null,
    }
  }
  return { items: [], next: null }
}

/**
 * Documents from one explicitly selected folder.
 *
 * There is deliberately no team-wide list helper: APRI Fetch must never have a
 * code path that can fall back to importing 00 Masters or folders 01–06.
 */
export async function listDocumentsInFolder(
  folderId: string,
): Promise<PapermarkDocument[]> {
  const selectedFolderId = folderId.trim()
  if (!selectedFolderId) {
    throw new PapermarkError("A Papermark folder ID is required.")
  }
  const { items } = unwrap<PapermarkDocument>(
    await call<unknown>(
      `/v1/documents?folder_id=${encodeURIComponent(selectedFolderId)}`,
    ),
    'documents'
  )
  return items
}

/** Direct children of one configured root; never returns a team-wide folder list. */
export async function listFoldersInRoot(rootFolderId: string): Promise<PapermarkFolder[]> {
  const root = rootFolderId.trim()
  if (!root) throw new PapermarkError('The Papermark root folder is not configured.')
  const { items } = unwrap<PapermarkFolder>(
    await call<unknown>(`/v1/folders?parent_id=${encodeURIComponent(root)}`),
    'folders'
  )
  return items.filter((folder) => (folder.parent_id ?? folder.parentId ?? root) === root)
}

/** Reuse an exact-email protected link where possible, otherwise create one. */
export async function ensurePrivateDocumentLink(args: {
  documentId: string
  email: string
  name: string
}): Promise<MintResult> {
  const links = await listLinks(args.documentId)
  for (const link of links) {
    if (!link.id || link.isArchived) continue
    const detail = await getLinkDetail(link.id)
    const allow = detail.ok ? detail.link.allow_list ?? [] : []
    if (detail.ok && detail.link.email_protected && allow.length === 1 &&
        allow[0]?.toLowerCase() === args.email.toLowerCase()) {
      const url = resolveShareUrl(link)
      if (url) return { ok: true, url, linkId: link.id }
    }
  }
  return mintSubscriberLink({
    papermarkDocumentId: args.documentId,
    subscriberEmail: args.email,
    subscriberName: args.name,
  })
}

/**
 * Share links. The spec exposes `/v1/links` for the whole team rather than a
 * per-document path, so `documentId` filters client-side.
 */
export async function listLinks(documentId?: string): Promise<PapermarkLink[]> {
  const links: PapermarkLink[] = []
  let cursor: string | null = null

  do {
    const query: string = cursor
      ? `?limit=100&cursor=${encodeURIComponent(cursor)}`
      : '?limit=100'
    const page = unwrap<PapermarkLink>(await call<unknown>(`/v1/links${query}`), 'links')
    links.push(...page.items)
    cursor = page.next
    // Bounded: a runaway cursor must not loop forever inside a request.
  } while (cursor && links.length < 2000)

  if (!documentId) return links
  return links.filter((l) => (l.document_id ?? l.documentId) === documentId)
}

// ---------------------------------------------------------------------------
// Views, for the daily catch-up poll
// ---------------------------------------------------------------------------

/** Papermark's View object, per the OpenAPI `View` schema. */
export type PapermarkView = {
  id: string
  link_id?: string | null
  document_id?: string | null
  viewer_email?: string | null
  view_type?: string | null
  viewed_at?: string
  downloaded_at?: string | null
}

/**
 * Views recorded against one share link, newest first, following cursors.
 *
 * `GET /v1/links/{id}/views` is the endpoint the spec provides for this; there
 * is no team-wide "recent views" path, so the poller walks the links it knows
 * about. `limit` caps how many pages are pulled per link so one very busy link
 * cannot exhaust the whole cron run.
 */
export async function listViewsForLink(
  linkId: string,
  maxPages = 3
): Promise<PapermarkView[]> {
  const views: PapermarkView[] = []
  let cursor: string | null = null
  let pages = 0

  do {
    const query: string = cursor
      ? `?limit=100&cursor=${encodeURIComponent(cursor)}`
      : '?limit=100'
    const page = unwrap<PapermarkView>(
      await call<unknown>(`/v1/links/${encodeURIComponent(linkId)}/views${query}`),
      'views'
    )
    views.push(...page.items)
    cursor = page.next
    pages++
  } while (cursor && pages < maxPages)

  return views
}

/**
 * Per-view analytics, which is where duration lives.
 *
 * A separate call per view, so the poller only enriches a bounded number of the
 * newest views rather than every one it sees.
 */
export type PapermarkViewDetail = {
  view_id?: string
  total_duration_seconds?: number
  page_durations?: unknown[]
}

export async function getViewDetail(
  viewId: string
): Promise<PapermarkViewDetail | null> {
  try {
    return await call<PapermarkViewDetail>(
      `/v1/analytics/views/${encodeURIComponent(viewId)}`
    )
  } catch {
    // Enrichment is optional; a failure must not fail the whole poll.
    return null
  }
}

// ---------------------------------------------------------------------------
// Reading a link back, for allow-list verification
// ---------------------------------------------------------------------------

/**
 * One share link as Papermark reports it.
 *
 * `allow_list` is a real array of strings in the API, which is why this check is
 * worth having: the dashboard renders it in a textarea that hides everything
 * past the first line, so a person reading the interface cannot reliably see
 * what is in it. The API can.
 */
export type PapermarkLinkDetail = {
  id: string
  document_id?: string | null
  allow_list?: string[]
  deny_list?: string[]
  allow_download?: boolean
  email_protected?: boolean
  email_authenticated?: boolean
  enable_watermark?: boolean
}

export type LinkDetailResult =
  | { ok: true; link: PapermarkLinkDetail }
  | { ok: false; reason: 'not-configured' | 'missing' | 'failed' }

/**
 * Fetches one link's settings.
 *
 * Distinguishes "the link is gone" from "we could not ask", because those are
 * different findings: a missing link means a subscriber's document has vanished,
 * while a failed call means we simply do not know yet.
 */
export async function getLinkDetail(linkId: string): Promise<LinkDetailResult> {
  if (!isPapermarkConfigured()) return { ok: false, reason: 'not-configured' }

  try {
    const response = await fetch(
      `${BASE}/v1/links/${encodeURIComponent(linkId)}`,
      {
        headers: {
          Authorization: `Bearer ${apiToken()}`,
          Accept: 'application/json',
        },
        cache: 'no-store',
      }
    )

    if (response.status === 404) return { ok: false, reason: 'missing' }
    if (!response.ok) return { ok: false, reason: 'failed' }

    const body = (await response.json()) as
      | PapermarkLinkDetail
      | { data: PapermarkLinkDetail }

    const link =
      body && typeof body === 'object' && 'data' in body
        ? (body as { data: PapermarkLinkDetail }).data
        : (body as PapermarkLinkDetail)

    if (!link?.id) return { ok: false, reason: 'failed' }
    return { ok: true, link }
  } catch {
    return { ok: false, reason: 'failed' }
  }
}

// ---------------------------------------------------------------------------
// Revocation
// ---------------------------------------------------------------------------

export type RevokeResult =
  | { ok: true }
  | { ok: false; reason: 'not-configured' | 'failed'; message: string }

/**
 * Revokes one share link.
 *
 * `DELETE /v1/links/{id}` is a soft delete in Papermark, which is what we want:
 * the link stops working, and the record of it having existed survives on their
 * side as well as ours.
 *
 * Returns a result rather than throwing. A revocation that cannot be completed
 * must surface as a manual task, not as an exception that loses the link id --
 * a link left live after someone's term ends is a leak carrying their name.
 */
export async function revokeLink(papermarkLinkId: string): Promise<RevokeResult> {
  if (!isPapermarkConfigured()) {
    return {
      ok: false,
      reason: 'not-configured',
      message: 'Papermark is not configured; revoke this link by hand.',
    }
  }

  try {
    const response = await fetch(
      `${BASE}/v1/links/${encodeURIComponent(papermarkLinkId)}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${apiToken()}`,
          Accept: 'application/json',
        },
        cache: 'no-store',
      }
    )

    // A link already gone is the outcome we wanted.
    if (response.ok || response.status === 404) return { ok: true }

    return {
      ok: false,
      reason: 'failed',
      // No status or body echoed: Papermark errors can quote the request, which
      // carries the token.
      message: 'Papermark refused the revocation; revoke this link by hand.',
    }
  } catch {
    return {
      ok: false,
      reason: 'failed',
      message: 'Could not reach Papermark; revoke this link by hand.',
    }
  }
}

/**
 * The share URL an executive would open. Prefers an explicit url, falls back to
 * composing one from the slug. Returns null when the document has no usable
 * live link, which the sync reports as "Missing secure link" rather than
 * inventing an address.
 */
export function resolveShareUrl(link: PapermarkLink | undefined): string | null {
  if (!link || link.isArchived) return null
  if (link.url && link.url.startsWith('https://')) return link.url
  if (link.domainSlug && link.slug) {
    return `https://${link.domainSlug}/${link.slug}`
  }

  // Deliberately no papermark.com/view/{id} fallback.
  //
  // Provisioning rejects any link not on docs.athenacentre.org, because a
  // papermark.com address changes once a custom domain is applied and breaks
  // silently months later. Composing one here would write exactly the address
  // we refuse to accept, so a link with no usable domain is reported as missing
  // instead.
  return null
}

// ---------------------------------------------------------------------------
// Per-subscriber links
// ---------------------------------------------------------------------------

export type MintResult =
  | { ok: true; url: string; linkId: string | null }
  | { ok: false; reason: 'not-configured' | 'no-document' | 'failed'; message: string }

/**
 * Mints a personal, email-gated, view-only link to one document for one named
 * subscriber. Watermarking is added only when WATERMARKING_ENABLED is set.
 *
 * Returns a result rather than throwing, and returns `not-configured` when the
 * credentials are absent, so every caller has a defined path while the API
 * token is still to be added. Setting PAPERMARK_API_TOKEN and redeploying is
 * what turns this live -- no code change is needed.
 *
 * Until then the admin pastes a link in by hand and the portal serves that.
 */
export async function mintSubscriberLink(args: {
  papermarkDocumentId: string | null
  subscriberEmail: string
  subscriberName: string
}): Promise<MintResult> {
  if (!isPapermarkConfigured()) {
    return {
      ok: false,
      reason: 'not-configured',
      message:
        'Papermark is not configured yet. Paste a link into the subscriber record by hand for now.',
    }
  }

  if (!args.papermarkDocumentId) {
    return {
      ok: false,
      reason: 'no-document',
      message: 'This publication has no Papermark document attached.',
    }
  }

  const token = apiToken()!

  try {
    // POST /v1/links, with the target document in the body -- per the spec
    // there is no per-document links path.
    const response = await fetch(`${BASE}/v1/links`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        document_id: args.papermarkDocumentId,
        name: `APRI — ${args.subscriberName || args.subscriberEmail}`,
        // Email-gated to one address: the link identifies the reader even
        // without a watermark, which is what makes attribution work.
        email_protected: true,
        allow_list: [args.subscriberEmail],
        // Downloads are off by decision, not by omission. Documents are
        // view-only and this application has no download surface at all.
        allow_download: false,
        // Only requested when the plan actually provides it. Asking for a
        // watermark the plan does not include is rejected by Papermark, which
        // would fail link creation outright rather than degrade.
        ...(WATERMARKING_ENABLED ? { enable_watermark: true } : {}),
      }),
      cache: 'no-store',
    })

    if (!response.ok) {
      // No status code or body echoed to the caller: this message can reach a
      // UI, and Papermark errors can quote the request, which holds the token.
      return {
        ok: false,
        reason: 'failed',
        message: 'Papermark could not create the link. Try again, or paste one by hand.',
      }
    }

    const link = (await response.json()) as PapermarkLink
    const url = resolveShareUrl(link)

    if (!url) {
      return {
        ok: false,
        reason: 'failed',
        message: 'Papermark created a link with no usable address.',
      }
    }

    return { ok: true, url, linkId: link.id ?? null }
  } catch {
    return {
      ok: false,
      reason: 'failed',
      message: 'Could not reach Papermark. Try again, or paste a link by hand.',
    }
  }
}
