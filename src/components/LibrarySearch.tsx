"use client"

import { createContext, useContext, useId, useMemo, useState, type FocusEvent, type ReactNode } from "react"
import { seriesLabel } from "@/lib/entitlements"
import { PORTAL_SERIES, type PortalSeries } from "@/lib/portal-library"
import {
  EMPTY_LIBRARY_FILTERS,
  MAX_LIBRARY_QUERY_LENGTH,
  UNREADABLE_DATE,
  searchLibrary,
  type LibrarySearchEntry,
  type LibrarySearchFilters,
} from "@/lib/library-search"

type SearchState = { visible: Set<string>; counts: Record<PortalSeries, number>; active: boolean }
const SearchContext = createContext<SearchState | null>(null)

function useLibrarySearch(): SearchState {
  const state = useContext(SearchContext)
  if (!state) throw new Error("Library search results must be inside LibrarySearch")
  return state
}

/**
 * Interactive controls around the existing server-rendered, permission-checked
 * cards. Search terms live only in this component's state: never in the
 * address, browser storage or analytics, and nothing is fetched.
 *
 * `initialFilters` sets the starting state (the portal always starts empty;
 * tests use it to render each state).
 */
export default function LibrarySearch({
  entries,
  children,
  initialFilters = EMPTY_LIBRARY_FILTERS,
}: {
  entries: LibrarySearchEntry[]
  children: ReactNode
  initialFilters?: LibrarySearchFilters
}) {
  const [filters, setFilters] = useState(initialFilters)
  // Remounting the date fields is the only way to empty one the browser
  // considers unreadable: its value is already "", so React cannot reset it.
  const [resetCount, setResetCount] = useState(0)
  const id = useId()
  const result = useMemo(() => searchLibrary(entries, filters), [entries, filters])
  const state = useMemo<SearchState>(() => ({
    visible: new Set(result.entries.map((entry) => entry.id)),
    counts: Object.fromEntries(PORTAL_SERIES.map((series) => [series, result.entries.filter((entry) => entry.series === series).length])) as Record<PortalSeries, number>,
    active: result.active,
  }), [result])
  const field = "min-h-11 min-w-0 w-full border border-foreground/50 bg-background px-3 py-2 text-base sm:text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
  const change = (key: keyof LibrarySearchFilters, value: string) => setFilters((current) => ({ ...current, [key]: value }))
  // A date the browser cannot read (31 February, a missing year) shows in the
  // field but reports "", with no change event: record it on leaving the
  // field so it is explained instead of silently ignored.
  const leaveDate = (key: "from" | "to") => (event: FocusEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    if (input.validity.badInput) change(key, UNREADABLE_DATE)
    else if (input.value === "" && filters[key] === UNREADABLE_DATE) change(key, "")
  }
  const clear = () => {
    setFilters(EMPTY_LIBRARY_FILTERS)
    setResetCount((n) => n + 1)
  }
  const empty = result.active && result.entries.length === 0
  const fromInvalid = result.errorField === "from" || result.errorField === "range"
  const toInvalid = result.errorField === "to" || result.errorField === "range"
  const dateValue = (value: string) => (value === UNREADABLE_DATE ? "" : value)

  // Nothing to search: the library's own empty message is enough.
  if (entries.length === 0) return <SearchContext.Provider value={state}>{children}</SearchContext.Provider>

  return (
    <SearchContext.Provider value={state}>
      <section aria-labelledby={`${id}-heading`} className="mb-10 border-y border-border py-6">
        <h2 id={`${id}-heading`} className="font-serif text-xl sm:text-2xl text-foreground">Find a publication</h2>
        <p id={`${id}-help`} className="mt-2 mb-5 text-sm text-foreground/70 max-w-2xl leading-relaxed">
          Search titles and descriptions, or filter by publication type and issue date.
        </p>
        <form role="search" aria-label="Search your publication library" aria-describedby={`${id}-help`} autoComplete="off" onSubmit={(event) => event.preventDefault()}>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <label htmlFor={`${id}-query`} className="block min-w-0 text-sm font-medium">
              Keywords
              <input id={`${id}-query`} type="search" value={filters.query} maxLength={MAX_LIBRARY_QUERY_LENGTH} onChange={(event) => change("query", event.target.value)} autoComplete="off" enterKeyHint="search" className={`${field} mt-2`} placeholder="Title or description" />
            </label>
            <label htmlFor={`${id}-series`} className="block min-w-0 text-sm font-medium">
              Publication type
              <select id={`${id}-series`} value={filters.series} onChange={(event) => change("series", event.target.value)} aria-invalid={result.errorField === "series" ? true : undefined} aria-describedby={result.errorField === "series" ? `${id}-error` : undefined} className={`${field} mt-2`}>
                <option value="">All publication types</option>
                {PORTAL_SERIES.map((series) => <option key={series} value={series}>{seriesLabel(series)}</option>)}
              </select>
            </label>
            <label htmlFor={`${id}-from`} className="block min-w-0 text-sm font-medium">
              Issue date from
              <input key={`from-${resetCount}`} id={`${id}-from`} type="date" value={dateValue(filters.from)} onChange={(event) => change("from", event.target.value)} onBlur={leaveDate("from")} aria-invalid={fromInvalid ? true : undefined} aria-describedby={fromInvalid ? `${id}-error` : undefined} className={`${field} mt-2`} />
            </label>
            <label htmlFor={`${id}-to`} className="block min-w-0 text-sm font-medium">
              Issue date to
              <input key={`to-${resetCount}`} id={`${id}-to`} type="date" value={dateValue(filters.to)} onChange={(event) => change("to", event.target.value)} onBlur={leaveDate("to")} aria-invalid={toInvalid ? true : undefined} aria-describedby={toInvalid ? `${id}-error` : undefined} className={`${field} mt-2`} />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
            <p role="status" aria-live="polite" aria-atomic="true" className="text-sm text-foreground/70">
              {result.error ? "Check the filters below." : result.active
                ? `${result.entries.length} of ${entries.length} ${entries.length === 1 ? "edition matches" : "editions match"}.`
                : `${entries.length} ${entries.length === 1 ? "edition" : "editions"} available to search.`}
            </p>
            <button type="button" disabled={!result.active} onClick={clear} className="min-h-11 px-2 text-sm underline underline-offset-4 hover:no-underline disabled:text-muted-foreground disabled:no-underline disabled:cursor-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground">
              Clear filters
            </button>
          </div>
          {result.error && <p id={`${id}-error`} role="alert" className="mt-3 text-sm font-medium text-foreground">{result.error}</p>}
        </form>
        <noscript><p className="mt-3 text-sm">Search needs JavaScript. Your available publications are listed below.</p></noscript>
      </section>
      {!result.error && empty && <p role="status" className="mb-12 text-sm text-foreground/70">No publications match these filters. Clear the filters or try different keywords.</p>}
      {!result.error && !empty && children}
    </SearchContext.Provider>
  )
}

export function LibrarySearchResult({ id, children }: { id: string; children: ReactNode }) {
  const { visible } = useLibrarySearch()
  return visible.has(id) ? <li>{children}</li> : null
}

export function LibrarySearchSeries({ series, children }: { series: PortalSeries; children: ReactNode }) {
  const { active, counts } = useLibrarySearch()
  return !active || counts[series] > 0 ? <>{children}</> : null
}

export function LibrarySearchCount({ series }: { series: PortalSeries }) {
  const count = useLibrarySearch().counts[series]
  return <>{count} {count === 1 ? "edition" : "editions"}</>
}
