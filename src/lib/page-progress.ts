/**
 * Page-level viewing progress -- the rules, with no database or network in the
 * way, so each one is tested directly.
 *
 * What Papermark provides (GET /v1/analytics/views/{id}, public OpenAPI spec):
 * `page_durations`, one `{ page_number, duration_seconds }` per page that has
 * recorded time in the session (1-based, as the Papermark viewer numbers
 * pages), and `total_duration_seconds`. It gives no page total and no
 * completion figure, and a view carries no document version: the total comes
 * from the version list of the document (GET /v1/documents/{id}/versions).
 *
 * The figure shown is "pages viewed": distinct pages with recorded viewing
 * time, over the page total of that exact version. It is evidence of pages
 * being on screen, not of reading or comprehension, and it is labelled so.
 *
 *  - Pages 1 and 20 of a 20-page PDF are 2 pages viewed (10%), and the
 *    furthest page reached (20) is reported separately.
 *  - Across sessions the pages are deduplicated; per-session percentages are
 *    never added or averaged.
 *  - Different versions of a PDF are never combined.
 *  - Anything that cannot be established stays unavailable, never zero.
 */

export type PageEvidence = { pageNumber: number; durationSeconds: number }

export type ParsedViewAnalytics =
  | {
      ok: true
      /** Pages with recorded time, one entry per page, in page order. */
      pages: PageEvidence[]
      /** Total recorded time in seconds; null when the provider gave none. */
      totalDurationSeconds: number | null
      /** The provider reported durations in milliseconds, converted here. */
      convertedFromMilliseconds: boolean
    }
  | { ok: false; reason: string }

function finiteNumber(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/**
 * Validates one per-view analytics response.
 *
 * Page numbers must be whole numbers from 1. A 0 means the provider numbered
 * from zero, which this code does not assume: the whole response is refused
 * rather than shifted by guesswork. Durations must be non-negative. The same
 * page reported twice is merged (its time summed), since the provider's own
 * store sums interval rows per page.
 *
 * Units: the spec names the field `duration_seconds`, while Papermark records
 * milliseconds internally. If the page times add up to roughly a thousand
 * times the reported total, they are milliseconds and are converted.
 */
export function parseViewAnalytics(raw: unknown): ParsedViewAnalytics {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'The analytics response was empty.' }
  const body = raw as Record<string, unknown>
  const list = body.page_durations
  if (list !== undefined && list !== null && !Array.isArray(list)) {
    return { ok: false, reason: 'page_durations was not a list.' }
  }

  const byPage = new Map<number, number>()
  for (const item of (list as unknown[] | null | undefined) ?? []) {
    if (!item || typeof item !== 'object') return { ok: false, reason: 'A page entry was not an object.' }
    const entry = item as Record<string, unknown>
    const page = finiteNumber(entry.page_number ?? entry.pageNumber)
    const duration = finiteNumber(entry.duration_seconds ?? entry.duration)
    if (page === null || !Number.isInteger(page)) return { ok: false, reason: 'A page number was not a whole number.' }
    if (page < 1) return { ok: false, reason: 'A page was numbered below 1, so the page numbering could not be trusted.' }
    if (duration === null || duration < 0) return { ok: false, reason: 'A page duration was missing or negative.' }
    byPage.set(page, (byPage.get(page) ?? 0) + duration)
  }

  const total = finiteNumber(body.total_duration_seconds)
  let totalDurationSeconds = total !== null && total >= 0 ? total : null
  let converted = false
  const sum = [...byPage.values()].reduce((a, b) => a + b, 0)
  if (totalDurationSeconds !== null && totalDurationSeconds > 0 && sum > 0) {
    const ratio = sum / totalDurationSeconds
    if (ratio > 500 && ratio < 2000) {
      for (const [page, value] of byPage) byPage.set(page, value / 1000)
      converted = true
    }
  } else if (totalDurationSeconds === null && sum > 0) {
    // No total reported: the recorded page times are the session's time.
    totalDurationSeconds = sum
  }

  const pages = [...byPage.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([pageNumber, durationSeconds]) => ({ pageNumber, durationSeconds: round3(durationSeconds) }))
  return { ok: true, pages, totalDurationSeconds: totalDurationSeconds === null ? null : round3(totalDurationSeconds), convertedFromMilliseconds: converted }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

export type DocumentVersion = {
  versionId: string
  versionNumber: number | null
  numPages: number | null
  createdAt: string | null
  isPrimary: boolean
}

/**
 * The version a session was on: the newest version created at or before the
 * session began -- the rule Papermark's own dashboard uses. A document with a
 * single version is that version whatever the timestamps say. Anything else
 * that cannot be decided returns null, and the page total is then unavailable
 * rather than borrowed from another version.
 */
export function versionForView(versions: readonly DocumentVersion[], viewedAt: string | Date | null): DocumentVersion | null {
  if (versions.length === 0) return null
  if (versions.length === 1) return versions[0]!
  const at = viewedAt ? new Date(viewedAt).getTime() : NaN
  if (!Number.isFinite(at)) return null
  const dated = versions
    .map((v) => ({ v, t: v.createdAt ? Date.parse(v.createdAt) : NaN }))
    .filter((x) => Number.isFinite(x.t))
    .sort((a, b) => b.t - a.t)
  if (dated.length !== versions.length) return null
  return dated.find((x) => x.t <= at)?.v ?? null
}

export type SessionProgress = {
  /** Distinct pages with recorded time that exist in the version. */
  pagesViewed: number
  /** The highest such page. Not a measure of how much was viewed. */
  furthestPage: number | null
  /** Page numbers beyond the version's page total, which were ignored. */
  outOfRange: number
}

/** One session's pages, checked against its version's page total when known. */
export function sessionProgress(pages: readonly PageEvidence[], totalPages: number | null): SessionProgress {
  const valid = pages.filter((p) => p.durationSeconds > 0 && (totalPages === null || p.pageNumber <= totalPages))
  const outOfRange = totalPages === null ? 0 : pages.filter((p) => p.pageNumber > totalPages).length
  return {
    pagesViewed: new Set(valid.map((p) => p.pageNumber)).size,
    furthestPage: valid.length ? Math.max(...valid.map((p) => p.pageNumber)) : null,
    outOfRange,
  }
}

export type Coverage =
  | { available: true; pagesViewed: number; totalPages: number; percent: number; furthestPage: number | null }
  | { available: false }

/**
 * Cumulative coverage of one version across any number of sessions: distinct
 * pages with recorded time, over that version's page total. Unavailable
 * without a total, or when no session has page evidence at all.
 */
export function cumulativeCoverage(
  sessions: readonly { pages: readonly PageEvidence[] }[],
  totalPages: number | null,
): Coverage {
  if (!totalPages || totalPages < 1) return { available: false }
  const withEvidence = sessions.filter((s) => s.pages.length > 0)
  if (withEvidence.length === 0) return { available: false }
  const seen = new Set<number>()
  for (const s of withEvidence) {
    for (const p of s.pages) if (p.durationSeconds > 0 && p.pageNumber <= totalPages) seen.add(p.pageNumber)
  }
  const furthest = seen.size ? Math.max(...seen) : null
  return {
    available: true,
    pagesViewed: seen.size,
    totalPages,
    percent: Math.round((seen.size / totalPages) * 1000) / 10,
    furthestPage: furthest,
  }
}

/** "1–3, 5, 9" for a set of page numbers. */
export function formatPageList(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].filter((n) => Number.isInteger(n) && n >= 1).sort((a, b) => a - b)
  const parts: string[] = []
  let start: number | null = null
  let prev: number | null = null
  for (const n of sorted) {
    if (start === null) {
      start = prev = n
    } else if (n === prev! + 1) {
      prev = n
    } else {
      parts.push(start === prev ? `${start}` : `${start}–${prev}`)
      start = prev = n
    }
  }
  if (start !== null) parts.push(start === prev ? `${start}` : `${start}–${prev}`)
  return parts.join(', ')
}

// ---------------------------------------------------------------------------
// When to fetch a session's analytics again
// ---------------------------------------------------------------------------

/** A session this recent may still be read; its analytics are refreshed. */
export const REFRESH_WINDOW_MS = 48 * 60 * 60_000
/** How often a recent session is refreshed. */
export const REFRESH_INTERVAL_MS = 3 * 60 * 60_000
/** Attempts before a failing session is left as failed. */
export const MAX_ENRICHMENT_ATTEMPTS = 6

export type EnrichmentOutcome = 'complete' | 'partial' | 'unavailable' | 'failed' | 'rate_limited'

/**
 * When the next fetch is due, or null when the session is settled.
 *
 *  - complete/partial: refreshed every few hours while the session is recent,
 *    so later reading appears; settled after that.
 *  - unavailable (the provider has no analytics for it): settled.
 *  - failed: retried with a growing delay, up to a limit.
 *  - rate_limited: retried once the provider's window resets.
 */
export function nextEnrichmentAt(args: {
  outcome: EnrichmentOutcome
  viewedAt: string | Date | null
  attempts: number
  now: number
  retryAfterMs?: number | null
}): Date | null {
  const viewed = args.viewedAt ? new Date(args.viewedAt).getTime() : NaN
  switch (args.outcome) {
    case 'complete':
    case 'partial':
      return Number.isFinite(viewed) && args.now - viewed < REFRESH_WINDOW_MS ? new Date(args.now + REFRESH_INTERVAL_MS) : null
    case 'unavailable':
      return null
    case 'failed':
      if (args.attempts >= MAX_ENRICHMENT_ATTEMPTS) return null
      return new Date(args.now + Math.min(24 * 60 * 60_000, 15 * 60_000 * 2 ** Math.max(0, args.attempts - 1)))
    case 'rate_limited':
      return new Date(args.now + Math.max(60_000, args.retryAfterMs ?? 60_000))
  }
}
