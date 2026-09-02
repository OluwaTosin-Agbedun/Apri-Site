import 'server-only'
import {
  PapermarkError,
  papermarkFetch,
  papermarkRequest,
  isPapermarkConfigured,
} from './papermark'
import {
  dataRoomLinkSettings,
  documentLinkSettings,
  watermarkConfig,
  type DataRoomLinkSettings,
  type DocumentLinkSettings,
} from './papermark-dataroom-contract'
import { papermarkExpiresAt } from './papermark-contract'

/**
 * The Papermark Data Room service.
 *
 * Read-mostly by design. APRI never creates a room, uploads a document or moves
 * anything: administrators do that inside Papermark, and this integration
 * deliberately needs no `documents.write` or `datarooms.write` scope. The one
 * thing it does write is share links, because a link has to be minted per named
 * person and no human should be pasting watermark configuration by hand.
 *
 * Scopes required: documents.read, datarooms.read, links.read, links.write,
 * analytics.read.
 */

// ---------------------------------------------------------------------------
// Types, per the OpenAPI schemas
// ---------------------------------------------------------------------------

export type DataRoom = {
  id: string
  name: string
  internal_name?: string | null
  description?: string | null
  document_count?: number
  folder_count?: number
  is_frozen?: boolean
  created?: string
  updated_at?: string
}

/** A document attached to a room, per the `DataroomItem` schema. */
export type DataRoomItem = {
  id: string
  document_id: string
  document_name: string
  type?: string | null
  content_type?: string | null
  num_pages?: number | null
  folder_id?: string | null
  folder_path?: string | null
  order_index?: number | null
  created?: string
}

export type DataRoomLink = {
  id: string
  name?: string | null
  url?: string
  dataroom_id?: string | null
  expires_at?: string | null
  email_protected?: boolean
  email_authenticated?: boolean
  allow_download?: boolean
  enable_watermark?: boolean
  enable_screenshot_protection?: boolean
  allow_list?: string[]
  updated_at?: string
}

export type LinkAnalytics = {
  link_id: string
  total_views: number
  unique_viewers: number
  total_duration_seconds: number
  since?: string
  until?: string
}

export type ServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string; status: number | null }

/**
 * Wraps a call so a caller always has a defined path.
 *
 * Errors are already sanitised by the API client -- field names and short
 * explanations only, never the request, the token or a private URL. This adds
 * the status so an administrator can be told whether to fix a scope, a payload
 * or simply wait.
 */
async function attempt<T>(run: () => Promise<T>, context: string): Promise<ServiceResult<T>> {
  if (!isPapermarkConfigured()) {
    return {
      ok: false,
      status: null,
      message: 'Papermark is not configured. Set PAPERMARK_API_TOKEN and redeploy.',
    }
  }
  try {
    return { ok: true, value: await run() }
  } catch (error) {
    if (error instanceof PapermarkError) {
      return {
        ok: false,
        status: error.failure?.status ?? null,
        message: `${context}: ${error.message}`,
      }
    }
    return {
      ok: false,
      status: null,
      message: `${context}: Papermark could not be reached. Try again shortly.`,
    }
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Every Data Room the token can see, newest page first, cursors followed. */
export async function listDataRooms(search?: string): Promise<ServiceResult<DataRoom[]>> {
  return attempt(async () => {
    const rooms: DataRoom[] = []
    let cursor: string | null = null

    do {
      const query: string = [
        'limit=100',
        cursor ? `cursor=${encodeURIComponent(cursor)}` : '',
        search?.trim() ? `query=${encodeURIComponent(search.trim())}` : '',
      ]
        .filter(Boolean)
        .join('&')

      const page: { items: DataRoom[]; next: string | null } =
        await papermarkFetch<DataRoom>(`/v1/datarooms?${query}`, 'datarooms')
      rooms.push(...page.items)
      cursor = page.next
    } while (cursor && rooms.length < 500)

    return rooms
  }, 'Listing Data Rooms')
}

export async function getDataRoom(dataroomId: string): Promise<ServiceResult<DataRoom>> {
  return attempt(
    () => papermarkRequest<DataRoom>(`/v1/datarooms/${encodeURIComponent(dataroomId)}`),
    'Reading the Data Room',
  )
}

/** Every document attached to a room, with the folder it is filed in. */
export async function listDataRoomDocuments(
  dataroomId: string,
): Promise<ServiceResult<DataRoomItem[]>> {
  return attempt(async () => {
    const items: DataRoomItem[] = []
    let cursor: string | null = null

    do {
      const query: string = ['limit=100', cursor ? `cursor=${encodeURIComponent(cursor)}` : '']
        .filter(Boolean)
        .join('&')

      const page: { items: DataRoomItem[]; next: string | null } =
        await papermarkFetch<DataRoomItem>(
        `/v1/datarooms/${encodeURIComponent(dataroomId)}/documents?${query}`,
        'documents',
      )
      items.push(...page.items)
      cursor = page.next
    } while (cursor && items.length < 2000)

    return items
  }, 'Reading the Data Room documents')
}

/** Links already minted against a room, so an existing one can be reused. */
export async function listDataRoomLinks(
  dataroomId: string,
): Promise<ServiceResult<DataRoomLink[]>> {
  return attempt(async () => {
    const links: DataRoomLink[] = []
    let cursor: string | null = null

    do {
      const query: string = [
        `dataroom_id=${encodeURIComponent(dataroomId)}`,
        'limit=100',
        cursor ? `cursor=${encodeURIComponent(cursor)}` : '',
      ]
        .filter(Boolean)
        .join('&')

      const page: { items: DataRoomLink[]; next: string | null } =
        await papermarkFetch<DataRoomLink>(`/v1/links?${query}`, 'links')
      links.push(...page.items)
      cursor = page.next
    } while (cursor && links.length < 1000)

    return links
  }, 'Reading the Data Room links')
}

export async function getLinkAnalytics(
  linkId: string,
): Promise<ServiceResult<LinkAnalytics>> {
  return attempt(
    () => papermarkRequest<LinkAnalytics>(`/v1/analytics/links/${encodeURIComponent(linkId)}`),
    'Reading link analytics',
  )
}

// ---------------------------------------------------------------------------
// Writing links
// ---------------------------------------------------------------------------

export type MintedDataRoomLink = {
  linkId: string
  url: string
  settings: DataRoomLinkSettings
}

export type MintedDocumentLink = {
  linkId: string
  url: string
  settings: DocumentLinkSettings
}

/**
 * Creates one unique Data Room link for one named person.
 *
 * The expiry is converted here rather than trusted from the caller: a term end
 * is a PostgreSQL date, and Papermark wants a date-time. An unreadable one is
 * refused before the request rather than sent and bounced back as a 422 nobody
 * can trace to a subscriber record.
 */
export async function createDataRoomLink(args: {
  dataroomId: string
  assignedName: string
  assignedEmail: string
  /** Term end. A date-only value is converted to the end of that day, UTC. */
  expiresAt: string | Date | null
  allowDownload?: boolean
  label?: string
}): Promise<ServiceResult<MintedDataRoomLink>> {
  const expiry = papermarkExpiresAt(args.expiresAt)
  if (!expiry.ok) {
    return {
      ok: false,
      status: null,
      message: `Papermark needs a complete date and time for the link expiry. ${expiry.reason}`,
    }
  }

  const settings = dataRoomLinkSettings({
    dataroomId: args.dataroomId,
    assignedName: args.assignedName,
    assignedEmail: args.assignedEmail,
    expiresAt: expiry.value,
    allowDownload: args.allowDownload,
    label: args.label,
  })

  return attempt(async () => {
    const link = await papermarkRequest<DataRoomLink>('/v1/links', {
      method: 'POST',
      body: settings,
    })
    const url = link.url
    if (!link.id || !url || !url.startsWith('https://')) {
      throw new PapermarkError('Papermark created a link with no usable address.')
    }
    return { linkId: link.id, url, settings }
  }, 'Creating the secure personal link')
}

/**
 * Brings an existing link back to APRI's required settings.
 *
 * Used when a term is extended, when downloads are switched, or when somebody
 * has changed a setting inside Papermark. The watermark is rewritten from the
 * assigned identity every time, so a link cannot drift into naming the wrong
 * person.
 */
export async function updateDataRoomLink(args: {
  linkId: string
  assignedName: string
  assignedEmail: string
  expiresAt: string | Date | null
  allowDownload?: boolean
}): Promise<ServiceResult<DataRoomLink>> {
  const expiry = papermarkExpiresAt(args.expiresAt)
  if (!expiry.ok) {
    return {
      ok: false,
      status: null,
      message: `Papermark needs a complete date and time for the link expiry. ${expiry.reason}`,
    }
  }

  return attempt(
    () =>
      papermarkRequest<DataRoomLink>(`/v1/links/${encodeURIComponent(args.linkId)}`, {
        method: 'PATCH',
        body: {
          expires_at: expiry.value,
          email_protected: false,
          email_authenticated: false,
          allow_list: [],
          deny_list: [],
          enable_watermark: true,
          watermark_config: watermarkConfig(args.assignedName, args.assignedEmail),
          enable_screenshot_protection: true,
          allow_download: args.allowDownload !== false,
          enable_agreement: false,
          show_banner: false,
        },
      }),
    'Updating the link security',
  )
}

/**
 * PATCHes only the watermark on an existing link.
 *
 * Sends `enable_watermark` and `watermark_config` and nothing else, so the
 * link URL, expiry, download permission and every other setting stay exactly
 * as they were.
 */
export async function updateLinkWatermark(args: {
  linkId: string
  assignedName: string
  assignedEmail: string
}): Promise<ServiceResult<unknown>> {
  return attempt(
    () =>
      papermarkRequest<unknown>(`/v1/links/${encodeURIComponent(args.linkId)}`, {
        method: 'PATCH',
        body: {
          enable_watermark: true,
          watermark_config: watermarkConfig(args.assignedName, args.assignedEmail),
        },
      }),
    'Updating link watermark',
  )
}

/**
 * Withdraws one link.
 *
 * A link that has already gone is the outcome we wanted, so a 404 counts as
 * success rather than as an error to show somebody.
 */
export async function revokeDataRoomLink(linkId: string): Promise<ServiceResult<true>> {
  const result = await attempt(
    () =>
      papermarkRequest<unknown>(`/v1/links/${encodeURIComponent(linkId)}`, {
        method: 'DELETE',
      }),
    'Revoking the link',
  )
  if (result.ok) return { ok: true, value: true }
  if (result.status === 404) return { ok: true, value: true }
  return result
}

// ---------------------------------------------------------------------------
// Document-target links
// ---------------------------------------------------------------------------

/**
 * Creates one share link targeting a single Papermark document.
 *
 * This is the fix for broken document delivery. The previous approach appended
 * `?documentId=` to a Data Room share URL, which is not a documented Papermark
 * mechanism and produces a broken viewer. This function creates a real
 * document-target link via `POST /v1/links` with `document_id`, which Papermark
 * recognises as a first-class share link.
 */
export async function createDocumentLink(args: {
  documentId: string
  assignedName: string
  assignedEmail: string
  expiresAt: string | Date | null
  documentTitle?: string
}): Promise<ServiceResult<MintedDocumentLink>> {
  const expiry = papermarkExpiresAt(args.expiresAt)
  if (!expiry.ok) {
    return {
      ok: false,
      status: null,
      message: `Papermark needs a complete date and time for the link expiry. ${expiry.reason}`,
    }
  }

  const settings = documentLinkSettings({
    documentId: args.documentId,
    assignedName: args.assignedName,
    assignedEmail: args.assignedEmail,
    expiresAt: expiry.value,
    documentTitle: args.documentTitle,
  })

  return attempt(async () => {
    const link = await papermarkRequest<DataRoomLink>('/v1/links', {
      method: 'POST',
      body: settings,
    })
    const url = link.url
    if (!link.id || !url || !url.startsWith('https://')) {
      throw new PapermarkError('Papermark created a link with no usable address.')
    }
    return { linkId: link.id, url, settings }
  }, 'Creating the personal document link')
}
