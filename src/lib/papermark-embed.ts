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

/** Returns Papermark's iframe URL, or null for anything unsafe or unrelated. */
export function papermarkEmbedUrl(
  value: string | null | undefined,
  customDomain?: string | null
): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    const allowed = OFFICIAL_HOSTS.has(host) || APRI_HOSTS.has(host) || host === configuredHost(customDomain)
    if (url.protocol !== 'https:' || !allowed || url.username || url.password) return null
    if (OFFICIAL_HOSTS.has(host) && !url.pathname.startsWith('/view/')) return null
    if (url.pathname === '/' || /(^|[-_/])00[-_ ]?masters?($|[-_/])/i.test(url.pathname)) {
      return null
    }
    // Papermark's supported embed mode keeps the same private share-link token
    // and suppresses the standalone-page chrome. Existing query parameters
    // (including link authentication settings) are retained.
    url.searchParams.set('embed', '1')
    return url.toString()
  } catch {
    return null
  }
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
    const end = new Date(args.termEnd)
    const now = args.now ?? new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    if (Number.isNaN(end.getTime()) || end < today) return null
  }
  return papermarkEmbedUrl(args.libraryLinkUrl, args.customDomain)
}
