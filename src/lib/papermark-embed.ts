import { dateOnly, lagosToday } from './subscription-term.ts'
const OFFICIAL_HOSTS = new Set(['papermark.com', 'www.papermark.com', 'app.papermark.com'])
const APRI_HOSTS = new Set(['docs.athenacentre.org'])

export function normalisePapermarkUrl(value: string): string {
  const trimmed = value.trim()
  return trimmed && !trimmed.includes('://') ? `https://${trimmed}` : trimmed
}

function configuredHost(customDomain?: string | null): string | null {
  if (!customDomain) return null
  try {
    const value = customDomain.includes('://') ? customDomain : `https://${customDomain}`
    const url = new URL(normalisePapermarkUrl(value))
    return url.protocol === 'https:' ? url.hostname.toLowerCase() : null
  } catch {
    return null
  }
}

/**
 * A stored Papermark share link, checked: https, a Papermark host (or APRI's
 * own Papermark domain), no credentials, never a dashboard or the masters
 * folder. Returns the link to open in its own tab, or null for anything unsafe
 * or unrelated. Existing query parameters are kept; a stale `embed` one is
 * dropped.
 */
export function papermarkShareUrl(
  value: string | null | undefined,
  customDomain?: string | null
): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    const allowed = OFFICIAL_HOSTS.has(host) || APRI_HOSTS.has(host) || host === configuredHost(customDomain)
    if (url.protocol !== 'https:' || !allowed || url.username || url.password) return null
    const path = url.pathname.toLowerCase()
    if (/\/(dashboard|edit|team|teams|folders?|settings|documents?)(\/|$)/.test(path)) return null
    if (
      OFFICIAL_HOSTS.has(host) &&
      !['/view/', '/dataroom/', '/data-room/', '/rooms/'].some((prefix) => path.startsWith(prefix))
    ) return null
    if (url.pathname === '/' || /(^|[-_/])00[-_ ]?masters?($|[-_/])/i.test(url.pathname)) {
      return null
    }
    url.searchParams.delete('embed')
    return url.toString()
  } catch {
    return null
  }
}

/**
 * Papermark's iframe address for a share link, or null when the link has none.
 *
 * Papermark lets other sites frame only its /embed page:
 *   https://app.papermark.com/view/<link>/embed  (papermark.com hosts)
 *   https://<custom domain>/<slug>/embed          (a custom domain)
 * which it serves with `frame-ancestors *`. Every other viewer address sends
 * X-Frame-Options (SAMEORIGIN or DENY), so a browser refuses to show it inside
 * an APRI page. The `?embed=1` this used to add is not a Papermark option, and
 * those frames were refused (checked on the live hosts, 2 October 2026).
 *
 * Any other shape -- a Data Room listing, a document inside a room, an unknown
 * path -- gets no iframe; the caller offers the share link in its own tab.
 */
export function papermarkEmbedUrl(
  value: string | null | undefined,
  customDomain?: string | null
): string | null {
  const share = papermarkShareUrl(value, customDomain)
  if (!share) return null
  const url = new URL(share)
  const segments = url.pathname.split('/').filter(Boolean)
  const isEmbed = (i: number) => segments.length === i + 1 && segments[i] === 'embed'
  if (OFFICIAL_HOSTS.has(url.hostname.toLowerCase())) {
    if (segments[0] !== 'view' || !(segments.length === 2 || isEmbed(2))) return null
    if (!PAPERMARK_LINK_ID_RE.test(segments[1]!)) return null
    url.pathname = `/view/${segments[1]}/embed`
  } else {
    if (!(segments.length === 1 || isEmbed(1))) return null
    if (!PAPERMARK_LINK_ID_RE.test(segments[0]!)) return null
    url.pathname = `/${segments[0]}/embed`
  }
  return url.toString()
}

const PAPERMARK_LINK_ID_RE = /^[a-zA-Z0-9_-]+$/

/**
 * Build the Papermark document embed URL from a stored link ID.
 *
 * Papermark's documented iframe format for a per-document personal link is:
 *   https://app.papermark.com/view/{linkId}/embed
 *
 * Returns null when the link ID is missing or has unexpected characters.
 */
export function papermarkDocumentEmbedUrl(
  papermarkLinkId: string | null | undefined,
): string | null {
  if (!papermarkLinkId) return null
  const id = papermarkLinkId.trim()
  if (!id || !PAPERMARK_LINK_ID_RE.test(id)) return null
  return `https://app.papermark.com/view/${encodeURIComponent(id)}/embed`
}

export function subscriberLibraryEmbedUrl(args: {
  authenticatedSubscriberId: string | null
  subscriberId: string
  status: string
  termEnd: string | null
  libraryLinkUrl: string | null
  customDomain?: string | null
  now?: Date
}): string | null {
  if (!args.authenticatedSubscriberId || args.authenticatedSubscriberId !== args.subscriberId) {
    return null
  }
  if (args.status.toLowerCase() !== 'active') return null
  if (args.termEnd) {
    const end = dateOnly(args.termEnd)
    if (!end || end < lagosToday(args.now ?? new Date())) return null
  }
  return papermarkEmbedUrl(args.libraryLinkUrl, args.customDomain)
}
