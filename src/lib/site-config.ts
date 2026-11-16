/** Trusted deployment configuration, never inferred from a request Host header. */
export const LEGACY_SITE_ORIGIN = "https://apri.athenacentre.org"
export const ADVISORY_SITE_ORIGIN = "https://athenaadvisory.ng"
const APPROVED_ORIGINS = [LEGACY_SITE_ORIGIN, ADVISORY_SITE_ORIGIN] as const

export function siteOrigin(
  env: Record<string, string | undefined> = process.env,
): string {
  const raw = (env.PUBLIC_SITE_URL ?? "").trim()
  if (!raw) return ADVISORY_SITE_ORIGIN
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error("PUBLIC_SITE_URL must be an approved HTTPS site origin")
  }
  if (
    !APPROVED_ORIGINS.includes(url.origin as typeof APPROVED_ORIGINS[number]) ||
    url.username ||
    url.password ||
    !["", "/"].includes(url.pathname) ||
    url.search ||
    url.hash
  ) {
    throw new Error("PUBLIC_SITE_URL must be an approved HTTPS site origin")
  }
  return url.origin
}

// Public information pages only. Authentication, assigned editions, viewers,
// legal-policy pages and individual publication records remain unindexed.
export const INDEXABLE_PATHS = [
  "/",
  "/publications",
  "/services",
  "/team",
  "/access",
  "/review",
  "/request-briefing",
] as const
export function isIndexablePath(path: string): boolean {
  return (INDEXABLE_PATHS as readonly string[]).includes(path)
}
export function indexingEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (
    env.VERCEL_ENV !== "preview" &&
    env.VERCEL_ENV !== "development" &&
    env.NODE_ENV !== "development"
  )
}
export function mayIndexRequest(
  path: string,
  hostname: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (
    indexingEnabled(env) &&
    isIndexablePath(path) &&
    hostname.toLowerCase() === new URL(siteOrigin(env)).hostname
  )
}

const SENSITIVE_QUERY =
  /^(?:token|code|email|secret|key|signature|session|authorization|password|link|url)$/i
/** Opt-in migration preparation. APIs/POSTs stay on their original endpoint. */
export function migrationDestination(
  url: URL,
  method: string,
  env: Record<string, string | undefined> = process.env,
): URL | null {
  if (
    env.SITE_REDIRECTS_ENABLED !== "enabled" ||
    siteOrigin(env) !== ADVISORY_SITE_ORIGIN ||
    !["GET", "HEAD"].includes(method)
  )
    return null
  if (
    ![new URL(LEGACY_SITE_ORIGIN).hostname, "www.athenaadvisory.ng"].includes(
      url.hostname,
    ) ||
    url.pathname === "/api" ||
    url.pathname.startsWith("/api/")
  )
    return null
  // A pending complimentary-review request must still be able to confirm its
  // address using an already-issued old-domain email. Verify there against
  // the same database; never forward its token to another origin.
  if (url.pathname === "/review/verify") return null
  const next = new URL(url.pathname, ADVISORY_SITE_ORIGIN)
  const bearer = [
    "/portal/verify",
    "/portal/verify/continue",
    "/review/verify",
    "/review/access",
    "/review/library/verify",
  ].includes(url.pathname)
  const sensitive = [...url.searchParams.keys()].some((key) =>
    SENSITIVE_QUERY.test(key),
  )
  if (bearer || sensitive) {
    next.pathname = url.pathname.startsWith("/admin")
      ? "/admin/login"
      : url.pathname.startsWith("/portal")
        ? "/portal/sign-in"
        : url.pathname.startsWith("/review")
          ? "/review/library/sign-in"
          : url.pathname
    return next
  }
  next.search = url.search
  return next
}
