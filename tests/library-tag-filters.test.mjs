/**
 * Subject, Sector and Geography filters in the subscriber library search
 * (src/lib/library-search.ts and src/components/LibrarySearch.tsx), extending
 * Step 1 without changing it:
 *
 *  - each filter appears only when the reader's permitted entries carry tags
 *    of that kind, offering only those labels;
 *  - tag filters combine (AND) with keywords, publication type and the
 *    inclusive issue-date range, and counts follow;
 *  - an unknown tag is refused on its own control, never silently ignored;
 *  - Clear filters empties them too;
 *  - keywords also search the approved summary text the server put in an
 *    entry, but not tag or type names;
 *  - search entries carry tag labels and approved text only: never a tag id,
 *    a link, a Papermark id or reader activity.
 *
 * Rendered with React's server renderer from the component's own source.
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

const search = await import("../src/lib/library-search.ts")
const { default: LibrarySearch, LibrarySearchResult, LibrarySearchSeries, LibrarySearchCount } = await import("../src/components/LibrarySearch.tsx")
const { searchLibrary, libraryTagOptions, dataRoomSearchEntry, legacySearchEntry, EMPTY_LIBRARY_FILTERS, LIBRARY_TAG_KINDS } = search

const entries = [
  { id: "a", series: "MIN", editionDate: "2026-03-10", title: "Grid tariff reset", description: "Distribution margins", tags: { subject: ["Tariffs", "Regulation"], sector: ["Power"], geography: ["Lagos"] }, brief: "The consultation closes on 30 November." },
  { id: "b", series: "AIU", editionDate: "2026-05-02", title: "Port concession update", description: "Concessions", tags: { subject: ["Regulation"], sector: ["Transport"], geography: ["Lagos", "Rivers"] } },
  { id: "c", series: "MIN", editionDate: "2026-06-20", title: "Fiscal outlook", description: "Budget", tags: { subject: ["Public finance"] } },
  { id: "d", series: "PLM", editionDate: null, title: "Election note", description: null },
]
const find = (filters = {}, list = entries, types) => searchLibrary(list, { ...EMPTY_LIBRARY_FILTERS, ...filters }, types)
const ids = (result) => result.entries.map((e) => e.id)

describe("tag filter rules", () => {
  it("offers only the labels the permitted entries carry, sorted, per kind", () => {
    assert.deepEqual(libraryTagOptions(entries), {
      subject: ["Public finance", "Regulation", "Tariffs"],
      sector: ["Power", "Transport"],
      geography: ["Lagos", "Rivers"],
    })
    // A reader with fewer editions sees fewer options: a label is never offered from someone else's editions.
    assert.deepEqual(libraryTagOptions([entries[2], entries[3]]), { subject: ["Public finance"], sector: [], geography: [] })
    assert.deepEqual(libraryTagOptions([]), { subject: [], sector: [], geography: [] })
  })

  it("each tag kind narrows the list, and they combine with each other (AND)", () => {
    assert.deepEqual(ids(find({ subject: "Regulation" })), ["a", "b"])
    assert.deepEqual(ids(find({ geography: "Lagos" })), ["a", "b"])
    assert.deepEqual(ids(find({ subject: "Regulation", sector: "Transport" })), ["b"])
    assert.deepEqual(ids(find({ subject: "Tariffs", geography: "Rivers" })), [])
    assert.equal(find({ sector: "Power" }).active, true)
  })

  it("combine with keywords, publication type and the inclusive issue-date range", () => {
    assert.deepEqual(ids(find({ subject: "Regulation", query: "port" })), ["b"])
    assert.deepEqual(ids(find({ subject: "Regulation", series: "MIN" })), ["a"])
    assert.deepEqual(ids(find({ geography: "Lagos", from: "2026-05-02", to: "2026-05-02" })), ["b"], "inclusive on both ends")
    assert.deepEqual(ids(find({ geography: "Lagos", from: "2026-05-03" })), [])
    assert.deepEqual(ids(find({ subject: "Regulation", series: "AIU", query: "concession", from: "2026-01-01", to: "2026-12-31", geography: "Rivers", sector: "Transport" })), ["b"])
  })

  it("refuses a tag the reader's editions do not carry, on that control only", () => {
    for (const kind of LIBRARY_TAG_KINDS) {
      const result = find({ [kind]: "Not offered" })
      assert.equal(result.errorField, kind)
      assert.equal(result.entries.length, 0)
      assert.match(result.error, /from the list/)
    }
    // A label from another kind is not accepted either.
    assert.equal(find({ sector: "Lagos" }).errorField, "sector")
    // Labels match exactly as offered.
    assert.equal(find({ subject: "regulation" }).errorField, "subject")
  })

  it("an empty set of filters (Clear filters) restores every entry, in order", () => {
    assert.deepEqual(ids(find(EMPTY_LIBRARY_FILTERS)), ["a", "b", "c", "d"])
    assert.equal(find(EMPTY_LIBRARY_FILTERS).active, false)
    for (const kind of LIBRARY_TAG_KINDS) assert.equal(EMPTY_LIBRARY_FILTERS[kind], "", kind)
  })

  it("filters written before tags existed (no tag keys) behave exactly as before", () => {
    const old = { query: "", series: "MIN", from: "", to: "" }
    assert.deepEqual(ids(searchLibrary(entries, old)), ["a", "c"])
    assert.equal(searchLibrary(entries, { query: "", series: "", from: "", to: "" }).active, false)
  })

  it("keywords search the approved summary text, but never tag or type names", () => {
    assert.deepEqual(ids(find({ query: "consultation november" })), ["a"])
    assert.deepEqual(ids(find({ query: "Lagos" })), [], "a geography label is a filter, not a keyword")
    assert.deepEqual(ids(find({ query: "Transport" })), [])
    assert.deepEqual(ids(find({ query: "Monthly Intelligence" })), [])
  })
})

describe("search entries carry display fields only", () => {
  const readerDetails = {
    authorEditor: "APRA Research Team",
    coveredPeriod: { start: "2026-09-01", end: "2026-09-30" },
    informationCutoff: "2026-09-28",
    readingMinutes: 12,
    tags: { subject: ["Tariffs"], sector: [], geography: ["Lagos"] },
    summary: { whatChanged: "x", whyItMatters: "y", implications: "z", watchNext: "w", sourceDate: null, uncertainty: "" },
    summaryText: "x y z w",
  }

  it("a Data Room entry adds tag labels and approved text, and nothing else from the card", () => {
    const entry = dataRoomSearchEntry({
      id: "row-1", category: "MIN", editionDate: "2026-09-30", displayTitle: "Title", summary: "Teaser", kicker: null,
      papermarkDocumentId: "pm_secret_document", delivery: "open", viewedBySubscriber: true, details: readerDetails,
    })
    assert.deepEqual(entry, {
      id: "row-1", series: "MIN", editionDate: "2026-09-30", title: "Title", description: "Teaser",
      tags: { subject: ["Tariffs"], geography: ["Lagos"] },
      brief: "x y z w",
    })
  })

  it("a legacy entry does the same, and an edition with no details gains no keys at all", () => {
    const entry = legacySearchEntry({ id: "pub-1", series: "AIU", editionDate: null, title: "T", summary: "S", code: "C", linkUrl: "https://docs.example.invalid/view/secret", details: readerDetails })
    assert.deepEqual(Object.keys(entry).sort(), ["brief", "description", "editionDate", "id", "series", "tags", "title"])
    assert.ok(!JSON.stringify(entry).includes("secret"))
    const plain = legacySearchEntry({ id: "pub-2", series: "AIU", editionDate: null, title: "T", summary: "S", code: null, details: null })
    assert.deepEqual(Object.keys(plain).sort(), ["description", "editionDate", "id", "series", "title"], "identical to Step 1 when nothing is stated")
  })
})

describe("the controls as rendered", () => {
  function render(list = entries, initialFilters) {
    const archive = createElement("div", { "data-archive": "yes" },
      ...["MIN", "AIU", "PLM"].map((series) => createElement(LibrarySearchSeries, { key: series, series },
        createElement("section", null,
          createElement("span", { "data-count": series }, createElement(LibrarySearchCount, { series })),
          createElement("ul", null, ...list.filter((e) => e.series === series).map((e) => createElement(LibrarySearchResult, { key: e.id, id: e.id }, createElement("span", { "data-card": e.id }, e.title)))),
        ))),
    )
    return renderToStaticMarkup(createElement(LibrarySearch, { entries: list, ...(initialFilters ? { initialFilters: { ...EMPTY_LIBRARY_FILTERS, ...initialFilters } } : {}) }, archive))
  }
  const selectFor = (html, label) => {
    const m = html.match(new RegExp(`<label for="([^"]+)"[^>]*>${label}<select[^>]*>([\\s\\S]*?)</select>`))
    return m ? { id: m[1], options: [...m[2].matchAll(/<option value="([^"]*)"/g)].map((o) => o[1]) } : null
  }

  it("shows each tag filter only for kinds present, with only the reader's labels", () => {
    const html = render()
    assert.deepEqual(selectFor(html, "Subject").options, ["", "Public finance", "Regulation", "Tariffs"])
    assert.deepEqual(selectFor(html, "Sector").options, ["", "Power", "Transport"])
    assert.deepEqual(selectFor(html, "Geography").options, ["", "Lagos", "Rivers"])
    const fewer = render([entries[2], entries[3]])
    assert.ok(selectFor(fewer, "Subject"))
    assert.equal(selectFor(fewer, "Sector"), null, "no sector tags among this reader's editions: no sector filter")
    assert.equal(selectFor(fewer, "Geography"), null)
  })

  it("shows no tag filter at all when no permitted edition is tagged (Step 1's controls exactly)", () => {
    const html = render(entries.map(({ tags, brief, ...rest }) => rest))
    for (const label of ["Subject", "Sector", "Geography"]) assert.equal(selectFor(html, label), null, label)
    assert.match(html, />Search titles and descriptions, or filter by publication type and issue date\.</)
    assert.match(html, /placeholder="Title or description"/)
  })

  it("says when summaries and tags can be searched", () => {
    const html = render()
    assert.match(html, />Search titles, descriptions and summaries, or filter by publication type, subject, sector, geography and issue date\.</)
    assert.match(html, /placeholder="Title, description or summary"/)
  })

  it("labels each tag control, gives it no name (nothing can reach a URL), and counts only matches", () => {
    const html = render(entries, { subject: "Regulation", geography: "Lagos" })
    for (const tag of html.match(/<(input|select)\b[^>]*>/g)) assert.doesNotMatch(tag, /\bname=/, tag)
    assert.match(html, /role="status" aria-live="polite"[^>]*>2 of 4 editions match\.</)
    assert.match(html, /data-card="a"/)
    assert.match(html, /data-card="b"/)
    assert.doesNotMatch(html, /data-card="c"|data-card="d"/)
    assert.match(html, /data-count="MIN">1 edition</)
    assert.match(html, /data-count="AIU">1 edition</)
    assert.doesNotMatch(html, /data-count="PLM"/, "a section with no matches is hidden")
    assert.doesNotMatch(html, /<button type="button" disabled=""/, "Clear filters is available")
  })

  it("marks only the tag control in error for an unknown tag", () => {
    const html = render(entries, { sector: "Mining" })
    assert.match(html, /role="alert"[^>]*>Choose a sector from the list\.</)
    const sector = html.match(/<select[^>]*id="[^"]*-sector"[^>]*>/)[0]
    assert.match(sector, /aria-invalid="true"/)
    for (const other of ["series", "subject", "geography"]) assert.doesNotMatch(html.match(new RegExp(`<select[^>]*id="[^"]*-${other}"[^>]*>`))[0], /aria-invalid/, other)
  })

  it("Clear filters resets every filter, the tag filters included (one empty filter object)", () => {
    const component = read("src/components/LibrarySearch.tsx")
    assert.match(component, /const clear = \(\) => \{\s*setFilters\(EMPTY_LIBRARY_FILTERS\)/)
    assert.match(component, /value=\{filters\[kind\]\}/, "each tag select shows the filter state Clear resets")
  })
})
