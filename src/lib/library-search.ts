import { currentBrandCopy } from "./brand.ts"
import { isCatalogueCode, sectionKey, UNASSIGNED_KEY, type CatalogueCode } from "./publication-catalogue.ts"

/**
 * The kinds of controlled tag an edition can carry (Admin -> Publication
 * Tags), each with its own library filter.
 */
export const LIBRARY_TAG_KINDS = ["subject", "sector", "geography"] as const
export type LibraryTagKind = (typeof LIBRARY_TAG_KINDS)[number]

/** Each kind's control label, its "any" option, plural heading and its error. */
export const LIBRARY_TAG_KIND_LABELS: Record<LibraryTagKind, { label: string; plural: string; all: string; choose: string }> = {
  subject: { label: "Subject", plural: "Subjects", all: "All subjects", choose: "Choose a subject from the list." },
  sector: { label: "Sector", plural: "Sectors", all: "All sectors", choose: "Choose a sector from the list." },
  geography: { label: "Geography", plural: "Geography", all: "All geographies", choose: "Choose a geography from the list." },
}

/** Tag labels by kind: display text only, never a tag id. */
export type LibraryEntryTags = Partial<Record<LibraryTagKind, readonly string[]>>

/** Search metadata for an edition the server has already permitted. No links or reader details. */
export type LibrarySearchEntry = {
  id: string
  /** The section the card is listed in: its catalogue code, or "unassigned". */
  series: string | null
  editionDate: string | null
  title: string
  description?: string | null
  /** The edition's tag labels, for the Subject, Sector and Geography filters. */
  tags?: LibraryEntryTags
  /**
   * The text of the edition's approved protected summary, for keywords: only
   * ever the approved copy this reader is entitled to see (never a draft).
   */
  brief?: string | null
}

export type LibrarySearchFilters = {
  query: string
  series: string
  from: string
  to: string
  /** A tag label of each kind ("" for any). */
  subject: string
  sector: string
  geography: string
}

/** Which control an error is about, so only that control is marked invalid. */
export type LibrarySearchErrorField = "series" | "from" | "to" | "range" | LibraryTagKind

export type LibrarySearchResult<T> = {
  entries: T[]
  /** Whether any filter is set (so Clear filters has something to clear). */
  active: boolean
  error: string | null
  errorField: LibrarySearchErrorField | null
}

/**
 * What a search entry may take from an edition's reader details
 * (src/lib/publication-metadata-dal.ts): tag labels and the approved summary's
 * text. Nothing else in them reaches the browser's search records.
 */
export type SearchableDetails = {
  tags?: LibraryEntryTags
  /** The approved summary's text ("" when it has none). */
  summaryText?: string | null
} | null | undefined

/** Only kinds that carry labels, each list a copy: display text only. */
function entryTags(details: SearchableDetails): Pick<LibrarySearchEntry, "tags" | "brief"> {
  const tags: LibraryEntryTags = {}
  for (const kind of LIBRARY_TAG_KINDS) {
    const labels = (details?.tags?.[kind] ?? []).filter((label) => typeof label === "string" && label.trim() !== "")
    if (labels.length) tags[kind] = [...labels]
  }
  const out: Pick<LibrarySearchEntry, "tags" | "brief"> = {}
  if (Object.keys(tags).length) out.tags = tags
  if (details?.summaryText) out.brief = details.summaryText
  return out
}

/**
 * The search entry for one Data Room card the access policy already lists.
 * Only these display fields go to the browser for searching: never a link,
 * a Papermark id or reader activity.
 */
export function dataRoomSearchEntry(document: {
  id: string
  /** The card's resolved catalogue category (null: awaiting a category). */
  category: CatalogueCode | null
  editionDate: string | null
  displayTitle: string
  summary?: string | null
  kicker?: string | null
  details?: SearchableDetails
}): LibrarySearchEntry {
  return {
    id: document.id,
    series: sectionKey(document.category),
    editionDate: document.editionDate,
    title: document.displayTitle,
    description: [document.summary, document.kicker].filter(Boolean).join(" "),
    ...entryTags(document.details),
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
  details?: SearchableDetails
}): LibrarySearchEntry {
  return {
    id: item.id,
    // A legacy record has no folder: its own series is its category, if any.
    series: sectionKey(isCatalogueCode(item.series) ? item.series : null),
    editionDate: item.editionDate,
    title: item.title,
    description: [item.summary, item.code].filter(Boolean).join(" "),
    ...entryTags(item.details),
  }
}

/**
 * The tag options each filter offers: only labels carried by the permitted
 * entries passed in, sorted, per kind. A kind with no labels offers nothing
 * (and its filter is not shown).
 */
export function libraryTagOptions(entries: readonly LibrarySearchEntry[]): Record<LibraryTagKind, string[]> {
  const out = { subject: [], sector: [], geography: [] } as Record<LibraryTagKind, string[]>
  for (const kind of LIBRARY_TAG_KINDS) {
    const labels = new Set<string>()
    for (const entry of entries) for (const label of entry.tags?.[kind] ?? []) if (label.trim()) labels.add(label)
    out[kind] = [...labels].sort((a, b) => a.localeCompare(b, "en-GB", { sensitivity: "base" }) || a.localeCompare(b))
  }
  return out
}

export const EMPTY_LIBRARY_FILTERS: LibrarySearchFilters = { query: "", series: "", from: "", to: "", subject: "", sector: "", geography: "" }
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
  return currentBrandCopy(text)
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
 * search terms. Keywords search titles, descriptions and the approved summary
 * text the server put in each entry (never a draft), not type or tag names:
 * the publication type and each tag kind have their own filter. Date filters
 * use editorial issue dates, inclusive, never upload or sync timestamps; an
 * undated edition never falls inside a range. Every filter combines (AND).
 *
 * The publication types on offer are only those present among the permitted
 * entries (`types` when the caller lists them), and the tags on offer only
 * those the permitted entries carry; any other value is refused, so an unknown
 * type or tag never silently broadens the results.
 */
export function searchLibrary<T extends LibrarySearchEntry>(
  entries: readonly T[],
  filters: LibrarySearchFilters,
  types?: readonly string[],
): LibrarySearchResult<T> {
  const offered = new Set(types ?? entries.map((entry) => entry.series || UNASSIGNED_KEY))
  const tagOptions = libraryTagOptions(entries)
  const tagFilters = LIBRARY_TAG_KINDS.map((kind) => [kind, filters[kind] ?? ""] as const).filter(([, value]) => value)
  const from = stillTyping(filters.from) ? "" : filters.from
  const to = stillTyping(filters.to) ? "" : filters.to
  const query = normalise(filters.query.slice(0, MAX_LIBRARY_QUERY_LENGTH)).trim()
  const active = Boolean(query || filters.series || from || to || tagFilters.length)
  const invalid = (error: string, errorField: LibrarySearchErrorField) => ({ entries: [] as T[], active, error, errorField })
  if (filters.series && !offered.has(filters.series)) return invalid("Choose a publication type from the list.", "series")
  for (const [kind, value] of tagFilters) {
    if (!tagOptions[kind].includes(value)) return invalid(LIBRARY_TAG_KIND_LABELS[kind].choose, kind)
  }
  if (from && !validDay(from)) return invalid("Enter a valid start date, or clear it.", "from")
  if (to && !validDay(to)) return invalid("Enter a valid end date, or clear it.", "to")
  if (from && to && from > to) return invalid("The end date must be on or after the start date.", "range")
  const words = query.split(/\s+/).filter(Boolean)
  const matches = entries.filter((entry) => {
    if (filters.series && (entry.series || UNASSIGNED_KEY) !== filters.series) return false
    for (const [kind, value] of tagFilters) if (!(entry.tags?.[kind] ?? []).includes(value)) return false
    if (from || to) {
      const day = entry.editionDate?.slice(0, 10) ?? ""
      if (!validDay(day)) return false
      if (from && day < from) return false
      if (to && day > to) return false
    }
    const text = normalise([entry.title, entry.description, entry.brief].filter(Boolean).join(" "))
    return words.every((word) => text.includes(word))
  })
  return { entries: matches, active, error: null, errorField: null }
}
