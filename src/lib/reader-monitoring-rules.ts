/**
 * The Engagement monitor's rules -- dates, statuses and how sessions become
 * one row per exact publication edition -- with no database in the way, so
 * each rule is tested directly.
 */

import { cumulativeCoverage, formatPageList, sessionProgress, type Coverage, type PageEvidence } from "./page-progress"

export const LAGOS_OFFSET = "+01:00" // Africa/Lagos is UTC+1 all year (no daylight saving).

export type DateRange = {
  /** Inclusive start, as an instant. */
  fromIso: string
  /** Exclusive end: the start of the day AFTER the chosen end day. */
  toIso: string
  from: string
  to: string
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

function validDay(value: string): boolean {
  if (!ISO_DAY.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

function nextDay(value: string): string {
  const d = new Date(`${value}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/**
 * A reporting period from two calendar days in Africa/Lagos, inclusive of the
 * whole end day: 1 to 1 September is all of 1 September. Null when either day
 * is missing or invalid, or the end is before the start -- the monitor then
 * shows all-time figures and says so.
 */
export function lagosDateRange(from: string | null | undefined, to: string | null | undefined): DateRange | null {
  const f = (from ?? "").trim()
  const t = (to ?? "").trim()
  if (!f || !t || !validDay(f) || !validDay(t) || t < f) return null
  return {
    from: f,
    to: t,
    fromIso: new Date(`${f}T00:00:00${LAGOS_OFFSET}`).toISOString(),
    toIso: new Date(`${nextDay(t)}T00:00:00${LAGOS_OFFSET}`).toISOString(),
  }
}

/** Today's calendar day in Africa/Lagos, as YYYY-MM-DD. */
export function lagosToday(now = new Date()): string {
  return new Date(now.getTime() + 60 * 60_000).toISOString().slice(0, 10)
}

/** A subscriber's access in words: the recorded status, and whether the term has ended. */
export function accessStatus(status: string | null | undefined, termEnd: string | Date | null | undefined, today: string): {
  key: "active" | "term_ended" | "pending" | "lapsed" | "suspended" | "declined" | "other"
  label: string
} {
  const s = (status ?? "").trim().toLowerCase()
  const end = termEnd ? (termEnd instanceof Date ? termEnd.toISOString().slice(0, 10) : String(termEnd).slice(0, 10)) : null
  if (s === "active") {
    return end && end < today ? { key: "term_ended", label: "Active, term ended" } : { key: "active", label: "Active" }
  }
  if (s === "pending") return { key: "pending", label: "Pending" }
  if (s === "lapsed") return { key: "lapsed", label: "Lapsed" }
  if (s === "suspended") return { key: "suspended", label: "Suspended" }
  if (s === "declined") return { key: "declined", label: "Declined" }
  return { key: "other", label: status ? String(status) : "Unknown" }
}

// ---------------------------------------------------------------------------
// Sessions into per-edition rows
// ---------------------------------------------------------------------------

export type SessionInput = {
  viewId: string
  papermarkViewId: string
  /** Identifies the exact edition: its Papermark document, else its APRI publication. */
  editionKey: string
  title: string
  editionLabel: string
  /** The version this session was on; null while it is not known. */
  versionNumber: number | null
  viewedAt: string
  /** Null when Papermark reported no time -- never read as zero. */
  durationSeconds: number | null
  /** The page total of that version; null when it is not known. */
  totalPages: number | null
  pages: PageEvidence[]
  downloaded: boolean
  /** How the reader reached it, in words (a Data Room link, a review link...). */
  accessRoute: string
}

export type DownloadInput = {
  sourceEventId: string
  papermarkViewId: string | null
  editionKey: string
  downloadedAt: string
}

export type SessionDetail = {
  viewedAt: string
  durationSeconds: number | null
  pagesViewed: number | null
  totalPages: number | null
  furthestPage: number | null
  pageList: string
  downloaded: boolean
  accessRoute: string
}

export type EditionActivity = {
  key: string
  editionKey: string
  title: string
  editionLabel: string
  versionNumber: number | null
  /** Whether this edition's sessions span more than one version (each has its own row). */
  otherVersions: boolean
  firstViewedAt: string
  latestViewedAt: string
  sessions: number
  coverage: Coverage
  /** Summed recorded time; null when no session reported any. */
  viewingSeconds: number | null
  /** Some sessions reported no time, so the sum covers only the others. */
  viewingPartial: boolean
  downloads: { count: number; latestAt: string | null; downloaded: boolean }
  sessionDetails: SessionDetail[]
}

function versionKey(v: number | null): string {
  return v === null ? "unknown" : String(v)
}

/**
 * One row per exact edition AND version. Sessions of different versions of
 * the same PDF are never merged: each version is its own row, because a page
 * number means a different page in each. Pages are deduplicated across the
 * row's sessions; percentages are never added or averaged.
 */
export function editionActivity(sessions: readonly SessionInput[], downloads: readonly DownloadInput[]): EditionActivity[] {
  const groups = new Map<string, SessionInput[]>()
  for (const s of sessions) {
    const key = `${s.editionKey}|${versionKey(s.versionNumber)}`
    const list = groups.get(key) ?? []
    list.push(s)
    groups.set(key, list)
  }
  const versionsPerEdition = new Map<string, Set<string>>()
  for (const s of sessions) {
    const set = versionsPerEdition.get(s.editionKey) ?? new Set<string>()
    set.add(versionKey(s.versionNumber))
    versionsPerEdition.set(s.editionKey, set)
  }
  const sessionToGroup = new Map<string, string>()
  for (const [key, list] of groups) for (const s of list) sessionToGroup.set(s.papermarkViewId, key)

  const rows: EditionActivity[] = []
  for (const [key, list] of groups) {
    const sorted = [...list].sort((a, b) => Date.parse(a.viewedAt) - Date.parse(b.viewedAt))
    const first = sorted[0]!
    const latest = sorted[sorted.length - 1]!
    const totals = sorted.map((s) => s.totalPages).filter((n): n is number => typeof n === "number" && n > 0)
    // One version has one page total; a disagreement means it is not reliable.
    const total = totals.length > 0 && totals.every((n) => n === totals[0]) ? totals[0]! : null
    const withTime = sorted.filter((s) => s.durationSeconds !== null)
    const ids = new Set(sorted.map((s) => s.papermarkViewId))

    // A download belongs to its session's row; one Papermark could not tie to
    // a session goes to the edition's newest-version row.
    const editionRows = [...groups.keys()].filter((k) => k.startsWith(`${first.editionKey}|`))
    const newestRow = editionRows.sort().at(-1)
    const mine = downloads.filter((d) =>
      d.papermarkViewId && sessionToGroup.has(d.papermarkViewId)
        ? sessionToGroup.get(d.papermarkViewId) === key
        : d.editionKey === first.editionKey && key === newestRow,
    )
    const downloadIds = new Set(mine.map((d) => d.sourceEventId))
    const latestDownload = mine.map((d) => d.downloadedAt).sort().at(-1) ?? null

    rows.push({
      key,
      editionKey: first.editionKey,
      title: latest.title,
      editionLabel: latest.editionLabel,
      versionNumber: first.versionNumber,
      otherVersions: (versionsPerEdition.get(first.editionKey)?.size ?? 1) > 1,
      firstViewedAt: first.viewedAt,
      latestViewedAt: latest.viewedAt,
      sessions: ids.size,
      coverage: cumulativeCoverage(sorted, total),
      viewingSeconds: withTime.length ? withTime.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0) : null,
      viewingPartial: withTime.length > 0 && withTime.length < sorted.length,
      downloads: {
        count: downloadIds.size,
        latestAt: latestDownload,
        downloaded: downloadIds.size > 0 || sorted.some((s) => s.downloaded),
      },
      sessionDetails: [...sorted].reverse().map((s) => {
        const progress = sessionProgress(s.pages, total)
        return {
          viewedAt: s.viewedAt,
          durationSeconds: s.durationSeconds,
          pagesViewed: total && s.pages.length ? progress.pagesViewed : null,
          totalPages: total,
          furthestPage: s.pages.length ? progress.furthestPage : null,
          pageList: formatPageList(s.pages.filter((p) => p.durationSeconds > 0 && (!total || p.pageNumber <= total)).map((p) => p.pageNumber)),
          downloaded: s.downloaded,
          accessRoute: s.accessRoute,
        }
      }),
    })
  }
  return rows.sort((a, b) => Date.parse(b.latestViewedAt) - Date.parse(a.latestViewedAt))
}

// ---------------------------------------------------------------------------
// Words for the tables
// ---------------------------------------------------------------------------

export const PROGRESS_UNAVAILABLE = "Progress unavailable"
export const TIME_UNAVAILABLE = "Unavailable"
export const NO_LOGIN = "No login recorded"
export const NO_VISIT = "No portal visit recorded"

/** "7 of 20 pages (35%)", or "Progress unavailable". Never "read" or "completed". */
export function progressLabel(coverage: Coverage): string {
  if (!coverage.available) return PROGRESS_UNAVAILABLE
  return `${coverage.pagesViewed} of ${coverage.totalPages} pages (${coverage.percent}%)`
}

/** "45 s", "12 min", "1 h 5 min", or "Unavailable" -- never 0 for missing time. */
export function durationLabel(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return TIME_UNAVAILABLE
  const s = Math.round(seconds)
  if (s < 60) return `${s} s`
  const minutes = Math.round(s / 60)
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

/** How a session reached the document, from the attribution that matched it. */
export function accessRouteLabel(method: string | null | undefined): string {
  switch (method) {
    case "dataroom-link":
      return "Portal Data Room link"
    case "subscriber-document-link":
      return "Personal document link"
    case "client-folder-link":
      return "Legacy library folder link"
    case "publication-access-link":
      return "Legacy per-publication link"
    case "review-edition-link":
    case "review-slot-link":
      return "Papermark review link (opened directly)"
    case "verified-email":
      return "Papermark link, matched by verified email"
    default:
      return "Papermark link"
  }
}

export const MONITOR_STATUSES = ["active", "term_ended", "pending", "lapsed", "suspended", "declined"] as const
export const MONITOR_SERIES = ["MIN", "AIU", "PLM", "AEO", "QIB"] as const

/**
 * The monitor's filters from the address bar, keeping only known values --
 * nothing unrecognised reaches a query, and an absent filter is empty, never
 * the text "undefined".
 */
export function readMonitorFilters(
  params: { from?: string; to?: string; level?: string; status?: string; series?: string },
  tierNames: readonly string[],
): { filters: { q: string; level: string; status: string; series: string; range: DateRange | null }; rangeInvalid: boolean } {
  const pick = <T extends string>(value: unknown, allowed: readonly T[]): T | "" =>
    typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : ""
  const range = lagosDateRange(params.from, params.to)
  return {
    filters: {
      // Name and email search happens in the browser, never in the URL.
      q: "",
      level: pick(params.level, tierNames),
      status: pick(params.status, MONITOR_STATUSES),
      series: pick(params.series, MONITOR_SERIES),
      range,
    },
    rangeInvalid: Boolean((params.from || params.to) && !range),
  }
}

/** Escapes a search term for a SQL `ilike` pattern, so % and _ match literally. */
export function likePattern(term: string): string | null {
  const t = term.trim().slice(0, 120)
  if (!t) return null
  return `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}
