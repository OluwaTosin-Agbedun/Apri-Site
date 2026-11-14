import { test } from "node:test"
import assert from "node:assert/strict"
import { searchLibrary, EMPTY_LIBRARY_FILTERS, UNREADABLE_DATE } from "../src/lib/library-search.ts"
import { decideAccess } from "../src/lib/access-policy.ts"
import { newestEdition } from "../src/lib/portal-library.ts"

const editions = [
  { id: "may", series: "MIN", editionDate: "2026-05-01", title: "May policy outlook", description: "Electricity pricing and fiscal implementation" },
  { id: "september", series: "AIU", editionDate: "2026-09-15", title: "Regulatory changes", description: "New electricity rules" },
  { id: "january", series: "PLM", editionDate: "2026-01-01", title: "January political transitions", description: "State elections and governance" },
  { id: "undated", series: "MIN", editionDate: null, title: "Undated briefing", description: null },
]
const find = (filters = {}, items = editions) => searchLibrary(items, { ...EMPTY_LIBRARY_FILTERS, ...filters })
const ids = (result) => result.entries.map((entry) => entry.id)

test("clearing filters restores every permitted edition without reordering or changing the input", () => {
  const before = structuredClone(editions)
  assert.deepEqual(ids(find({ query: "  " })), editions.map((entry) => entry.id))
  assert.equal(find().active, false)
  assert.deepEqual(editions, before)
})

test("keywords match titles and descriptions regardless of case, spacing or accents", () => {
  assert.deepEqual(ids(find({ query: "  ELECTRICITY   pricing " })), ["may"])
  const local = [{ ...editions[0], title: "Ọ̀ṣun policy note", description: null }]
  assert.deepEqual(ids(find({ query: "osun" }, local)), ["may"])
})

test("all keywords must match, including when they occur in different metadata fields", () => {
  assert.deepEqual(ids(find({ query: "may fiscal" })), ["may"])
  assert.deepEqual(ids(find({ query: "may elections" })), [])
})

test("publication type accepts each of MIN, AIU and PLM and combines with keywords", () => {
  assert.deepEqual(ids(find({ series: "MIN" })), ["may", "undated"])
  assert.deepEqual(ids(find({ series: "AIU", query: "electricity" })), ["september"])
  assert.deepEqual(ids(find({ series: "PLM", query: "electricity" })), [])
})

test("keywords search titles and descriptions only, not the publication-type name", () => {
  // The type has its own filter; matching its name would pull in a whole series.
  assert.deepEqual(ids(find({ query: "Monthly Intelligence Note" })), [])
  assert.deepEqual(ids(find({ query: "update" })), [])
  assert.deepEqual(ids(find({ query: "MIN" })), [])
  const named = [{ ...editions[0], title: "Monthly Intelligence Note — May 2026" }]
  assert.deepEqual(ids(find({ query: "monthly intelligence" }, named)), ["may"], "a title that names its series still matches")
})

test("typographic apostrophes and dashes match their plain forms, both ways", () => {
  const typeset = [{ id: "t", series: "MIN", editionDate: "2026-05-01", title: "Nigeria’s fiscal outlook", description: "State–owned enterprises and the 2026–2027 budget" }]
  const plain = [{ id: "p", series: "MIN", editionDate: "2026-05-01", title: "Nigeria's fiscal outlook", description: "State-owned enterprises" }]
  assert.deepEqual(ids(find({ query: "nigeria's" }, typeset)), ["t"])
  assert.deepEqual(ids(find({ query: "state-owned 2026-2027" }, typeset)), ["t"])
  assert.deepEqual(ids(find({ query: "nigeria’s state—owned" }, plain)), ["p"])
})

test("issue dates are inclusive and an equal start and end selects that day", () => {
  assert.deepEqual(ids(find({ from: "2026-01-01", to: "2026-05-01" })), ["may", "january"])
  assert.deepEqual(ids(find({ from: "2026-09-15", to: "2026-09-15" })), ["september"])
})

test("open-ended date ranges work and missing or invalid issue dates cannot pass a date filter", () => {
  assert.deepEqual(ids(find({ from: "2026-05-01" })), ["may", "september"])
  assert.deepEqual(ids(find({ to: "2026-05-01" })), ["may", "january"])
  assert.deepEqual(ids(find({ from: "2026-01-01" }, [{ ...editions[0], editionDate: "2026-02-30" }])), [])
})

test("impossible dates, malformed dates and reversed ranges give an actionable error", () => {
  for (const from of ["2026-02-30", "2026-13-01", "2026-2-01", "not a date", "82026-02-02", UNREADABLE_DATE]) {
    const result = find({ from })
    assert.match(result.error, /valid start date/, from)
    assert.equal(result.errorField, "from")
    assert.equal(result.active, true, "Clear filters can clear it")
    assert.deepEqual(ids(result), [])
  }
  assert.match(find({ to: UNREADABLE_DATE }).error, /valid end date/)
  assert.equal(find({ to: UNREADABLE_DATE }).errorField, "to")
  const reversed = find({ from: "2026-09-01", to: "2026-05-01" })
  assert.match(reversed.error, /end date must be on or after the start date/)
  assert.equal(reversed.errorField, "range")
  assert.equal(find({ from: "2024-02-29" }).error, null)
  assert.match(find({ from: "2026-02-29" }).error, /valid start date/)
})

test("a year still being typed is neither an error nor a filter", () => {
  // A browser's date field reports 0002, 0020 and 0202 while 2026 is typed.
  for (const to of ["0002-05-31", "0020-05-31", "0202-05-31"]) {
    const result = find({ from: "2026-01-01", to })
    assert.equal(result.error, null, to)
    assert.deepEqual(ids(result), ["may", "september", "january"], "only the finished start date applies")
  }
  const typing = find({ from: "0202-01-01" })
  assert.equal(typing.active, false)
  assert.deepEqual(ids(typing), editions.map((entry) => entry.id))
  assert.deepEqual(ids(find({ from: "2026-01-01", to: "2026-05-31" })), ["may", "january"], "then the finished year applies")
})

test("unknown publication types do not silently broaden results", () => {
  assert.match(find({ series: "L4" }).error, /publication type/)
  assert.equal(find({ series: "L4" }).errorField, "series")
  assert.deepEqual(ids(find({ series: "L4" })), [])
})

test("search treats markup and regular-expression text as ordinary keywords", () => {
  assert.deepEqual(ids(find({ query: ".*" })), [])
  assert.deepEqual(ids(find({ query: "<script>alert(1)</script>" })), [])
  assert.deepEqual(ids(find({ query: "' or true --" })), [])
})

test("combined filters return only their intersection, with zero-result and empty libraries supported", () => {
  assert.deepEqual(ids(find({ query: "electricity", series: "MIN", from: "2026-05-01", to: "2026-05-31" })), ["may"])
  assert.deepEqual(ids(find({ query: "electricity", series: "MIN", to: "2026-04-30" })), [])
  assert.deepEqual(find({}, []), { entries: [], active: false, error: null, errorField: null })
})

test("sync dates do not substitute for an editorial issue date", () => {
  const synced = [{ ...editions[2], papermarkUpdatedAt: "2026-11-14" }]
  assert.deepEqual(ids(find({ from: "2026-05-01" }, synced)), [])
})

test("search never changes the full library's single Latest selection", () => {
  const latest = newestEdition(editions)
  find({ series: "PLM" })
  assert.equal(newestEdition(editions), latest)
  assert.equal(latest.id, "september")
})

test("January versus May access and individual Allow/Block remain the access policy's decisions", () => {
  const source = editions.filter((entry) => entry.editionDate)
  const permitted = (start, exceptions = {}) => source.filter((entry) => decideAccess({
    subscription: { state: "active", termStart: start, termEnd: "2026-12-31" },
    plan: "Individual Access", periods: [], exception: exceptions[entry.id] ?? null,
    publication: {
      publicationId: entry.id, editionDate: entry.editionDate, series: entry.series,
      visibility: "L1", paidRelease: "released", editorialStatus: "published", plans: ["Individual Access"],
    },
  }).outcome === "allowed")
  assert.deepEqual(ids(find({ query: "january" }, permitted("2026-05-01"))), [])
  assert.deepEqual(ids(find({ query: "january" }, permitted("2026-01-01"))), ["january"])
  assert.deepEqual(ids(find({ query: "january" }, permitted("2026-05-01", { january: "allow" }))), ["january"])
  assert.deepEqual(ids(find({ query: "january" }, permitted("2026-01-01", { january: "block" }))), [])
})
