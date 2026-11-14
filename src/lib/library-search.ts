import { isPortalSeries } from "./portal-library.ts"

/** Search metadata for an edition the server has already permitted. No links or reader details. */
export type LibrarySearchEntry = {
  id: string
  series: string | null
  editionDate: string | null
  title: string
  description?: string | null
}

export type LibrarySearchFilters = {
  query: string
  series: string
  from: string
  to: string
}

/** Which control an error is about, so only that control is marked invalid. */
export type LibrarySearchErrorField = "series" | "from" | "to" | "range"

export type LibrarySearchResult<T> = {
  entries: T[]
  /** Whether any filter is set (so Clear filters has something to clear). */
  active: boolean
  error: string | null
  errorField: LibrarySearchErrorField | null
}

/**
 * The search entry for one Data Room card the access policy already lists.
 * Only these display fields go to the browser for searching: never a link,
 * a Papermark id or reader activity.
 */
export function dataRoomSearchEntry(document: {
  id: string
  series: string | null
  editionDate: string | null
  displayTitle: string
  summary?: string | null
  kicker?: string | null
}): LibrarySearchEntry {
  return {
    id: document.id,
    series: document.series,
    editionDate: document.editionDate,
    title: document.displayTitle,
    description: [document.summary, document.kicker].filter(Boolean).join(" "),
  }
}

/** The same for one legacy library row. */
export function legacySearchEntry(item: {
  id: string
  series: string | null
  editionDate: string | null
  title: string
  summary?: string | null
  code?: string | null
}): LibrarySearchEntry {
  return {
    id: item.id,
    series: item.series,
    editionDate: item.editionDate,
    title: item.title,
    description: [item.summary, item.code].filter(Boolean).join(" "),
  }
}

export const EMPTY_LIBRARY_FILTERS: LibrarySearchFilters = { query: "", series: "", from: "", to: "" }
export const MAX_LIBRARY_QUERY_LENGTH = 200
/**
 * What the form records for a date the reader typed that the browser could not
 * read (31 February, or a missing year): the field shows it, but the browser
 * reports it as empty, so it must not be silently ignored.
 */
export const UNREADABLE_DATE = "unreadable"

/**
 * Case, accents and typographic punctuation are ignored, so a straight
 * apostrophe or hyphen typed by the reader matches the curly apostrophes and
 * dashes that pasted or smart-punctuated text contains, and the reverse.
 */
function normalise(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[‘’‚‛ʼ′`´]/g, "'")
    .replace(/[‐-―−﹘﹣－]/g, "-")
    .toLowerCase()
}

function validDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/**
 * A date whose year is still being typed. A browser's date field reports a
 * value after every digit of the year (0002, 0020, 0202, then 2026), and no
 * issue date is earlier than year 1000, so such a value is waiting for the
 * reader to finish, not an error and not a filter yet.
 */
function stillTyping(value: string): boolean {
  return /^0\d{3}-\d{2}-\d{2}$/.test(value)
}

/**
 * Refines an already-authorised list; this is not an entitlement decision.
 * Preserves its order and never fetches documents, calls Papermark or stores
 * search terms. Searches titles and descriptions only: the publication type has
 * its own filter. Date filters use editorial issue dates, inclusive, never
 * upload or sync timestamps; an undated edition never falls inside a range.
 */
export function searchLibrary<T extends LibrarySearchEntry>(
  entries: readonly T[],
  filters: LibrarySearchFilters,
): LibrarySearchResult<T> {
  const from = stillTyping(filters.from) ? "" : filters.from
  const to = stillTyping(filters.to) ? "" : filters.to
  const query = normalise(filters.query.slice(0, MAX_LIBRARY_QUERY_LENGTH)).trim()
  const active = Boolean(query || filters.series || from || to)
  const invalid = (error: string, errorField: LibrarySearchErrorField) => ({ entries: [] as T[], active, error, errorField })
  if (filters.series && !isPortalSeries(filters.series)) return invalid("Choose a publication type from the list.", "series")
  if (from && !validDay(from)) return invalid("Enter a valid start date, or clear it.", "from")
  if (to && !validDay(to)) return invalid("Enter a valid end date, or clear it.", "to")
  if (from && to && from > to) return invalid("The end date must be on or after the start date.", "range")
  const words = query.split(/\s+/).filter(Boolean)
  const matches = entries.filter((entry) => {
    if (filters.series && entry.series !== filters.series) return false
    if (from || to) {
      const day = entry.editionDate?.slice(0, 10) ?? ""
      if (!validDay(day)) return false
      if (from && day < from) return false
      if (to && day > to) return false
    }
    const text = normalise([entry.title, entry.description].filter(Boolean).join(" "))
    return words.every((word) => text.includes(word))
  })
  return { entries: matches, active, error: null, errorField: null }
}
