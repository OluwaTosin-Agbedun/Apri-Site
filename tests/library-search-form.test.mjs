/**
 * The subscriber search controls (src/components/LibrarySearch.tsx), rendered
 * with React's server renderer from the component's own source: the first
 * render, and -- through the component's initialFilters -- the filtered,
 * no-results and error states. Plus source guards on where search terms may go,
 * the layout rules and where the single Latest card sits.
 *
 * This file has no DOM, so typing and pressing Clear filters are not exercised
 * here: the filter rules are in tests/library-search.test.mjs, and the
 * interaction was checked by hand in a local browser during development.
 * Invented values only.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

const SRC = fileURLToPath(new URL("../src/", import.meta.url))
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@/")) {
      const base = join(SRC, specifier.slice(2))
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`]) {
        if (/\.tsx?$/.test(candidate) && existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true }
      }
    }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (!url.startsWith("file:") || !url.endsWith(".tsx")) return next(url, context)
    const path = fileURLToPath(url)
    const { outputText } = ts.transpileModule(readFileSync(path, "utf8"), {
      fileName: path,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    })
    return { format: "module", source: outputText, shortCircuit: true }
  },
})

const { default: LibrarySearch, LibrarySearchResult, LibrarySearchSeries, LibrarySearchCount } = await import("../src/components/LibrarySearch.tsx")
const { EMPTY_LIBRARY_FILTERS, UNREADABLE_DATE } = await import("../src/lib/library-search.ts")
const state = (filters) => render(entries, { ...EMPTY_LIBRARY_FILTERS, ...filters })
/** The date inputs' and select's aria-invalid, by control. */
function invalid(html) {
  const tag = (re) => html.match(re)?.[0] ?? ""
  return {
    series: /aria-invalid="true"/.test(tag(/<select[^>]*>/)),
    from: /aria-invalid="true"/.test(tag(/<input[^>]*id="[^"]*-from"[^>]*>/)),
    to: /aria-invalid="true"/.test(tag(/<input[^>]*id="[^"]*-to"[^>]*>/)),
  }
}

const entries = [
  { id: "a", series: "MIN", editionDate: "2026-05-01", title: "Fiscal outlook", description: "Budget" },
  { id: "b", series: "AIU", editionDate: "2026-06-01", title: "Port update", description: "Concessions" },
  { id: "c", series: "PLM", editionDate: null, title: "Election note", description: null },
]

function render(list = entries, initialFilters) {
  // One section per series, as the portal renders them.
  const archive = createElement("div", { "data-archive": "yes" },
    ...["MIN", "AIU", "PLM"].map((series) => createElement(LibrarySearchSeries, { key: series, series },
      createElement("section", null,
        createElement("span", { "data-count": series }, createElement(LibrarySearchCount, { series })),
        createElement("ul", null, ...list.filter((e) => e.series === series).map((e) => createElement(LibrarySearchResult, { key: e.id, id: e.id }, createElement("span", { "data-card": e.id }, e.title)))),
      ))),
  )
  return renderToStaticMarkup(createElement(LibrarySearch, { entries: list, ...(initialFilters ? { initialFilters } : {}) }, archive))
}

describe("the search controls as first rendered", () => {
  const html = render()

  it("is a labelled search form whose fields have no names, so nothing can be submitted into a URL", () => {
    assert.match(html, /<form[^>]*role="search"[^>]*>/)
    assert.match(html, /<form[^>]*autoComplete="off"|<form[^>]*autocomplete="off"/i)
    assert.doesNotMatch(html.match(/<form[^>]*>/)[0], /\baction=/)
    for (const tag of html.match(/<(input|select)\b[^>]*>/g)) assert.doesNotMatch(tag, /\bname=/, tag)
  })

  it("labels every control and associates each label with its field", () => {
    for (const label of ["Keywords", "Publication type", "Issue date from", "Issue date to"]) {
      const m = html.match(new RegExp(`<label for="([^"]+)"[^>]*>${label}`))
      assert.ok(m, label)
      assert.match(html, new RegExp(`id="${m[1]}"`), `${label} field`)
    }
    assert.match(html, /<input[^>]*type="search"[^>]*maxLength="200"/)
    assert.match(html, /<input[^>]*type="search"[^>]*autoComplete="off"/)
    assert.equal((html.match(/type="date"/g) ?? []).length, 2)
  })

  it("offers MIN, AIU and PLM by name, plus all types", () => {
    assert.match(html, /<option value="" selected="">All publication types<\/option>/)
    for (const s of ["MIN", "AIU", "PLM"]) assert.match(html, new RegExp(`<option value="${s}">`))
  })

  it("announces the searchable count, keeps Clear filters disabled until a filter is set, and shows the whole archive", () => {
    assert.match(html, /role="status" aria-live="polite"[^>]*>3 editions available to search\.</)
    assert.match(html, /<button type="button" disabled=""[^>]*>Clear filters<\/button>/)
    assert.match(html, /data-archive="yes"/)
    for (const e of entries) assert.match(html, new RegExp(`data-card="${e.id}"`))
    assert.match(html, /data-count="MIN">1 edition</)
  })

  it("tells readers without JavaScript that the list below is complete", () => {
    assert.match(html, /<noscript>[\s\S]*Your available publications are listed below/)
  })
})

describe("each state the controls can be in", () => {
  it("filtered: counts only the matches, hides other cards and empty series, and enables Clear filters", () => {
    const html = state({ series: "AIU" })
    assert.match(html, /role="status" aria-live="polite"[^>]*>1 of 3 editions match\.</)
    assert.match(html, /data-card="b"/)
    assert.doesNotMatch(html, /data-card="a"|data-card="c"/)
    assert.doesNotMatch(html, /data-count="MIN"/, "a series with no matches is hidden")
    assert.match(html, /<button type="button"[^>]*>Clear filters<\/button>/)
    assert.doesNotMatch(html, /<button type="button" disabled=""/)
  })

  it("no results: says so plainly, keeps Clear filters available, and shows no cards", () => {
    const html = state({ query: "nothing matches this" })
    assert.match(html, /0 of 3 editions match\./)
    assert.match(html, /No publications match these filters\. Clear the filters or try different keywords\./)
    assert.doesNotMatch(html, /data-archive="yes"/)
    assert.doesNotMatch(html, /<button type="button" disabled=""/)
  })

  it("a reversed range: one alert naming the problem, both dates marked invalid", () => {
    const html = state({ from: "2026-09-01", to: "2026-05-01" })
    assert.match(html, /role="alert"[^>]*>The end date must be on or after the start date\.</)
    assert.match(html, />Check the filters below\.</)
    assert.deepEqual(invalid(html), { series: false, from: true, to: true })
    assert.doesNotMatch(html, /data-archive="yes"/)
  })

  it("an unreadable start date: explained, only that field marked, and Clear filters can clear it", () => {
    const html = state({ from: UNREADABLE_DATE })
    assert.match(html, /role="alert"[^>]*>Enter a valid start date, or clear it\.</)
    assert.deepEqual(invalid(html), { series: false, from: true, to: false })
    assert.match(html, /<input[^>]*id="[^"]*-from"[^>]*value=""/, "the sentinel never reaches the field")
    assert.doesNotMatch(html, /<button type="button" disabled=""/)
  })

  it("an unreadable end date marks only the end date", () => {
    assert.deepEqual(invalid(state({ to: UNREADABLE_DATE })), { series: false, from: false, to: true })
  })

  it("an unknown publication type marks the type, not the dates", () => {
    const html = state({ series: "L4" })
    assert.match(html, /role="alert"[^>]*>Choose a publication type from the list\.</)
    assert.deepEqual(invalid(html), { series: true, from: false, to: false })
  })

  it("a year still being typed changes nothing yet", () => {
    const html = state({ from: "2026-01-01", to: "0202-05-31" })
    assert.doesNotMatch(html, /role="alert"/)
    assert.deepEqual(invalid(html), { series: false, from: false, to: false })
    assert.match(html, /2 of 3 editions match\./)
  })
})

describe("an empty library", () => {
  it("shows no search controls, only the library's own content", () => {
    const html = render([])
    assert.doesNotMatch(html, /role="search"/)
    assert.doesNotMatch(html, /Find a publication/)
    assert.match(html, /data-archive="yes"/)
  })
})

describe("where search terms may and may not go", () => {
  const component = read("src/components/LibrarySearch.tsx")
  const rules = read("src/lib/library-search.ts")

  it("keeps terms in component state only: no URL, router, browser storage, cookies, analytics or network", () => {
    for (const source of [component, rules]) {
      assert.doesNotMatch(source, /useSearchParams|useRouter|next\/navigation|history\.|location\.|localStorage|sessionStorage|indexedDB|document\.cookie|fetch\(|sendBeacon|XMLHttpRequest|@vercel\/analytics|track\(|recordAccessClick|recordClientEvent/)
    }
    // Every import is on an allowlist, so a helper that reports or stores terms cannot slip in.
    const allowed = new Set(["react", "@/lib/entitlements", "@/lib/portal-library", "@/lib/library-search"])
    for (const m of component.matchAll(/^import [\s\S]*? from "([^"]+)"/gm)) assert.ok(allowed.has(m[1]), m[1])
    assert.match(component, /onSubmit=\{\(event\) => event\.preventDefault\(\)\}/)
    assert.match(component, /const clear = \(\) => \{\s*setFilters\(EMPTY_LIBRARY_FILTERS\)\s*setResetCount/, "Clear filters resets every filter and remounts the date fields")
    assert.match(component, /onClick=\{clear\}/)
    assert.match(component, /key=\{`from-\$\{resetCount\}`\}/)
    assert.match(component, /key=\{`to-\$\{resetCount\}`\}/)
  })

  it("the search rules import nothing that talks to Papermark or the database", () => {
    for (const m of rules.matchAll(/^import .* from "([^"]+)"/gm)) assert.match(m[1], /^\.\/(entitlements|portal-library)\.ts$/, m[1])
  })

  it("follows the portal's layout rules: one column first, no two columns on small phones, no fixed widths", () => {
    for (const grid of component.match(/\bgrid grid-cols-[^"]*/g) ?? []) {
      assert.match(grid, /grid-cols-1\b/, grid)
      assert.doesNotMatch(grid, /\bsm:grid-cols-2\b/, grid)
    }
    assert.doesNotMatch(component, /\bw-\[\d/, "no fixed pixel widths")
    assert.match(component, /min-h-11/, "44px tap targets")
  })

  it("the portal searches only the permitted list each library already shows", () => {
    const page = read("src/app/portal/page.tsx")
    assert.match(page, /<LibrarySearch entries=\{editions\.map\(dataRoomSearchEntry\)\}>/)
    assert.match(page, /<LibrarySearch entries=\{portalLibrary\.map\(legacySearchEntry\)\}>/)
    assert.match(page, /const editions = documents\.filter\(\(document\) => PORTAL_SERIES\.includes/)
    assert.match(page, /const portalLibrary = library\.filter\(\(item\) => isPortalSeries\(item\.series\)\)/)
  })

  it("keeps the single Latest card outside the searchable archive on both paths", () => {
    const page = read("src/app/portal/page.tsx")
    for (const start of [...page.matchAll(/<PortalSection title="Latest">/g)].map((m) => m.index)) {
      const latest = page.slice(start, page.indexOf("</PortalSection>", start))
      assert.doesNotMatch(latest, /LibrarySearch/)
      assert.ok(page.indexOf("<LibrarySearch", start) > start + latest.length, "search comes after Latest")
    }
    assert.match(page, /\{latest \? <DataRoomGrid documents=\{\[latest\]\} featured \/>/)
    const grid = page.slice(page.indexOf("function DataRoomGrid"), page.indexOf("function DataRoomCard"))
    assert.match(grid, /featured \? \(\s*<li key=\{doc\.id\}>/, "the featured card is never filtered")
  })
})
