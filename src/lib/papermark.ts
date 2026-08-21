import 'server-only'

/**
 * Papermark REST client.
 *
 * The token is read from the server environment only. It is never imported by a
 * client component and never prefixed NEXT_PUBLIC_, so it cannot reach the
 * browser bundle. All calls happen inside route handlers and server actions.
 *
 * NOTE ON ENDPOINTS: the paths below follow Papermark's documented v1 REST
 * shape. Papermark's API surface differs between self-hosted and hosted plans,
 * so if a call 404s, correct BASE and the two paths here -- they are
 * deliberately the only place URLs are constructed.
 */
const BASE = process.env.PAPERMARK_API_BASE ?? 'https://app.papermark.com/api/v1'

export type PapermarkDocument = {
  id: string
  name: string
  createdAt?: string
  updatedAt?: string
}

export type PapermarkLink = {
  id: string
  url?: string
  domainSlug?: string
  slug?: string
  isArchived?: boolean
}

function requireToken(): string {
  const token = process.env.PAPERMARK_API_TOKEN
  if (!token) {
    throw new PapermarkError(
      'PAPERMARK_API_TOKEN is not set. Add it to .env.local locally and to the ' +
        'hosting environment variables for deployed builds.'
    )
  }
  return token
}

function requireTeamId(): string {
  const teamId = process.env.PAPERMARK_TEAM_ID
  if (!teamId) {
    throw new PapermarkError(
      'PAPERMARK_TEAM_ID is not set. Find it in your Papermark dashboard URL.'
    )
  }
  return teamId
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

export async function listDocuments(): Promise<PapermarkDocument[]> {
  const teamId = requireTeamId()
  const data = await call<PapermarkDocument[] | { documents: PapermarkDocument[] }>(
    `/teams/${encodeURIComponent(teamId)}/documents`
  )
  const list = Array.isArray(data) ? data : data.documents
  return Array.isArray(list) ? list : []
}

export async function listLinks(documentId: string): Promise<PapermarkLink[]> {
  const teamId = requireTeamId()
  const data = await call<PapermarkLink[] | { links: PapermarkLink[] }>(
    `/teams/${encodeURIComponent(teamId)}/documents/${encodeURIComponent(documentId)}/links`
  )
  const list = Array.isArray(data) ? data : data.links
  return Array.isArray(list) ? list : []
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
  if (link.id) return `https://www.papermark.com/view/${link.id}`
  return null
}
