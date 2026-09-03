/**
 * What may and may not be reported to Vercel Web Analytics.
 *
 * Dependency-free and JSX-free so the rules are tested directly. The component
 * in `SiteAnalytics.tsx` is a thin wrapper that passes `sanitizeBeacon` to
 * Vercel's `beforeSend`; the decisions all live here.
 *
 * Vercel receives page paths for public pages and nothing else. No email
 * address, subscriber id, Papermark URL, token or document id ever reaches it.
 */

/**
 * Paths whose traffic is never reported.
 *
 * `/admin` covers the admin login and first-run setup; `/portal` covers
 * sign-in, the magic-link landing at `/portal/verify`, `/portal/open-private`
 * and every `/portal/document/<id>` URL. Those last two matter most: a portal
 * URL carries a document id, and a magic-link URL carries a single-use token.
 * A token in a URL that a third party logs is a credential leak.
 */
export const EXCLUDED_PREFIXES = [
  '/admin',
  '/api',
  '/portal',
  '/auth',
  '/verify',
  '/signin',
  '/sign-in',
  '/login',
  '/magic',
] as const

/**
 * Query parameters whose mere presence makes a URL unreportable.
 *
 * The whole event is dropped rather than the parameter stripped. A URL carrying
 * a token is not a public page that happens to have an untidy query string --
 * it is a credentialed request, and the fact that it was visited at all is not
 * something to hand to an analytics product.
 */
export const SENSITIVE_PARAMS = [
  'token',
  'secret',
  'code',
  'key',
  'apikey',
  'api_key',
  'access_token',
  'auth',
  'session',
  'sig',
  'signature',
  'email',
  'e',
  'subscriber',
  'subscriber_id',
  'sid',
  'document',
  'document_id',
  'documentid',
  'view',
  'link',
  'password',
  'pwd',
] as const

/**
 * Whether a path is excluded.
 *
 * Matches a prefix only as a whole path segment, so `/administration-guide` is
 * a public page rather than being caught by `/admin`.
 */
export function isExcludedAnalyticsPath(pathname: string): boolean {
  if (!pathname) return true
  const path = pathname.toLowerCase()
  return EXCLUDED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))
}

/** Whether any sensitive parameter appears in a query string. */
export function hasSensitiveParams(search: string): boolean {
  if (!search) return false
  try {
    const params = new URLSearchParams(search)
    for (const rawKey of params.keys()) {
      const key = rawKey.toLowerCase()
      if ((SENSITIVE_PARAMS as readonly string[]).includes(key)) return true
      // Catch variants such as `magic_token` or `authToken` without having to
      // enumerate every spelling.
      if (/token|secret|password|apikey|api_key/.test(key)) return true
    }
    return false
  } catch {
    // An unparseable query string is treated as suspect.
    return true
  }
}

/**
 * Strips anything identifying from a beacon before it leaves the browser.
 *
 * Three rules, in order:
 *
 *  1. Excluded areas of the site are dropped outright.
 *  2. A URL carrying a sensitive parameter is dropped outright — not cleaned
 *     and sent, because the visit itself is credentialed.
 *  3. Everything that does get sent loses its query string and hash entirely,
 *     since neither is needed to count a page view and either can carry
 *     something we have not thought to name above.
 *
 * Returns null to drop the event, which is what Vercel's `beforeSend` expects.
 */
export function sanitizeBeacon<T extends { url: string }>(event: T): T | null {
  try {
    const url = new URL(event.url)

    if (isExcludedAnalyticsPath(url.pathname)) return null
    if (hasSensitiveParams(url.search)) return null

    url.search = ''
    url.hash = ''

    return { ...event, url: url.toString() }
  } catch {
    // An unparseable URL is dropped rather than sent unexamined.
    return null
  }
}
