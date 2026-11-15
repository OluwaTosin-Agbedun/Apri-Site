import {
  categorySections,
  isCatalogueCode,
  searchTypeOptions,
  type CatalogueCategory,
  type CatalogueCode,
  type CategorySection,
  type SearchTypeOption,
} from "./publication-catalogue.ts"
import { dataRoomSearchEntry, legacySearchEntry, type LibrarySearchEntry } from "./library-search.ts"

export type DatedEdition = {
  id: string
  editionDate: string | null
}

/**
 * Publication order is editorial, never operational. Missing dates sit last;
 * equal dates use the stable database id so a later sync cannot reorder them.
 */
export function compareEditionsNewestFirst(
  a: DatedEdition,
  b: DatedEdition,
): number {
  if (a.editionDate && b.editionDate) {
    const byDate = b.editionDate.localeCompare(a.editionDate)
    if (byDate !== 0) return byDate
  } else if (a.editionDate) {
    return -1
  } else if (b.editionDate) {
    return 1
  }

  return a.id.localeCompare(b.id)
}

/** The single Latest card: the newest permitted edition across every category. */
export function newestEdition<T extends DatedEdition>(
  items: readonly T[],
): T | null {
  return [...items].sort(compareEditionsNewestFirst)[0] ?? null
}

/**
 * A subscriber library's sections: every permitted edition, grouped by its
 * catalogue category in catalogue order, newest first within each. Nothing
 * permitted is dropped: an edition with no category is listed last under
 * "Publications awaiting a category". (See categorySections for which
 * empty sections are shown.)
 */
export function editionsByCategory<T extends DatedEdition>(
  items: readonly T[],
  categories: readonly CatalogueCategory[],
  codeOf: (item: T) => CatalogueCode | null,
): CategorySection<T>[] {
  return categorySections([...items].sort(compareEditionsNewestFirst), categories, codeOf)
}

/**
 * Everything a subscriber library page shows, built from the permitted list
 * alone: one helper per library path, used by src/app/portal/page.tsx and by
 * the database tests, so what is tested is what is rendered.
 */
export type LibraryView<T> = {
  /** Every permitted edition in its catalogue section, catalogue order, newest first. */
  sections: CategorySection<T>[]
  /** The browser's search records: display fields only, one per listed edition. */
  entries: LibrarySearchEntry[]
  /** The type filter's options: only the categories present among those editions. */
  types: SearchTypeOption[]
  /** The single Latest card: the newest edition across every category, never filtered. */
  latest: T | null
}

function libraryView<T extends DatedEdition>(
  items: readonly T[],
  categories: readonly CatalogueCategory[],
  codeOf: (item: T) => CatalogueCode | null,
  entryOf: (item: T) => LibrarySearchEntry,
): LibraryView<T> {
  const entries = items.map(entryOf)
  return {
    sections: editionsByCategory(items, categories, codeOf),
    entries,
    types: searchTypeOptions(entries, categories),
    latest: newestEdition(items),
  }
}

/** A legacy record has no folder: its own series is its category, when it is a catalogue code. */
export function legacyCategory(item: { series: string | null }): CatalogueCode | null {
  return isCatalogueCode(item.series) ? item.series : null
}

/** The legacy library (no Data Room): every permitted record, placed by its series. */
export function legacyLibraryView<T extends DatedEdition & Parameters<typeof legacySearchEntry>[0]>(
  items: readonly T[],
  categories: readonly CatalogueCategory[],
): LibraryView<T> {
  return libraryView(items, categories, legacyCategory, legacySearchEntry)
}

/** The Data Room library: every listed document, placed by its resolved category (series, else mapped folder). */
export function dataRoomLibraryView<T extends DatedEdition & Parameters<typeof dataRoomSearchEntry>[0]>(
  documents: readonly T[],
  categories: readonly CatalogueCategory[],
): LibraryView<T> {
  return libraryView(documents, categories, (doc) => doc.category, dataRoomSearchEntry)
}
