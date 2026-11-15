/**
 * Publication editorial metadata, tags and protected summaries: the pure rules
 * (src/lib/publication-metadata.ts) and what a subscriber card shows from them
 * (src/components/PublicationReaderDetails.tsx, rendered with React's server
 * renderer from the component's own source).
 *
 *  - every metadata field is optional, validated, and stored as nothing when
 *    empty: nothing is computed or invented;
 *  - a card shows only what was entered, and a card with nothing entered is
 *    unchanged;
 *  - the approved copy is read strictly, so a malformed or incomplete one is
 *    never shown.
 *
 * Plus source guards: the rules import nothing that talks to a database,
 * Papermark, storage or the network. Invented values only.
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

const m = await import("../src/lib/publication-metadata.ts")
const { PublicationFacts, ProtectedSummary } = await import("../src/components/PublicationReaderDetails.tsx")

const SUMMARY = {
  whatChanged: "The regulator gazetted a revised tariff order.",
  whyItMatters: "Distribution margins narrow from January.",
  implications: "Two scenarios: a phased pass-through or a court-ordered pause.",
  watchNext: "The consultation closes on 30 November.",
  sourceDate: "2026-10-02",
  uncertainty: "The pass-through schedule is not yet published.",
}
const details = (overrides = {}) => ({
  authorEditor: null,
  coveredPeriod: null,
  informationCutoff: null,
  readingMinutes: null,
  tags: { subject: [], sector: [], geography: [] },
  summary: null,
  summaryText: "",
  ...overrides,
})

describe("editorial metadata validation", () => {
  const valid = (input) => m.validateEditorialMetadata(input)

  it("treats every field as optional: an empty form stores nothing at all", () => {
    assert.deepEqual(valid({ authorEditor: "", coveredPeriodStart: "", coveredPeriodEnd: "", informationCutoff: "", readingMinutes: "" }), { ok: true, value: m.EMPTY_METADATA })
    assert.deepEqual(valid({}), { ok: true, value: m.EMPTY_METADATA })
  })

  it("keeps what an editor entered, cleaned to one line, and nothing else", () => {
    const result = valid({ authorEditor: "  APRI   Research\nTeam ", coveredPeriodStart: "2026-09-01", coveredPeriodEnd: "2026-09-30", informationCutoff: "2026-09-28", readingMinutes: "12" })
    assert.deepEqual(result, { ok: true, value: { authorEditor: "APRI Research Team", coveredPeriodStart: "2026-09-01", coveredPeriodEnd: "2026-09-30", informationCutoff: "2026-09-28", readingMinutes: 12 } })
  })

  it("needs both ends of a covered period, ending on or after its start (a single day is allowed)", () => {
    assert.match(valid({ coveredPeriodStart: "2026-09-01" }).errors.coveredPeriodEnd[0], /end of the covered period too/)
    assert.match(valid({ coveredPeriodEnd: "2026-09-30" }).errors.coveredPeriodStart[0], /start of the covered period too/)
    assert.match(valid({ coveredPeriodStart: "2026-09-30", coveredPeriodEnd: "2026-09-01" }).errors.coveredPeriodEnd[0], /on or after its start/)
    assert.equal(valid({ coveredPeriodStart: "2026-09-15", coveredPeriodEnd: "2026-09-15" }).ok, true)
  })

  it("refuses impossible dates, each on its own field", () => {
    const result = valid({ coveredPeriodStart: "2026-02-30", coveredPeriodEnd: "2026-03-01", informationCutoff: "31/09/2026" })
    assert.equal(result.ok, false)
    assert.deepEqual(Object.keys(result.errors).sort(), ["coveredPeriodStart", "informationCutoff"])
  })

  it("takes reading time only as whole minutes from 1 to 600, entered by the editor", () => {
    for (const bad of ["0", "-3", "1.5", "601", "ten", "12 min"]) assert.ok(valid({ readingMinutes: bad }).errors.readingMinutes, bad)
    assert.equal(valid({ readingMinutes: "600" }).value.readingMinutes, 600)
    assert.equal(valid({ readingMinutes: " 1 " }).value.readingMinutes, 1)
  })

  it("limits the author/editor to 200 characters", () => {
    assert.ok(valid({ authorEditor: "x".repeat(201) }).errors.authorEditor)
    assert.equal(valid({ authorEditor: "x".repeat(200) }).ok, true)
  })
})

describe("tags", () => {
  it("normalises labels to one consistent line and refuses empty or over-long ones", () => {
    assert.equal(m.normaliseTagLabel("  Electricity \n tariffs "), "Electricity tariffs")
    assert.equal(m.normaliseTagLabel("Lagos\u0000"), "Lagos")
    for (const bad of ["", "   ", null, 42, "x".repeat(81)]) assert.equal(m.normaliseTagLabel(bad), null)
    assert.equal(m.tagLabelKey("Electricity Tariffs"), m.tagLabelKey("electricity tariffs"))
  })

  it("accepts only subject, sector and geography", () => {
    assert.deepEqual([...m.TAG_KINDS], ["subject", "sector", "geography"])
    assert.equal(m.isTagKind("sector"), true)
    for (const bad of ["Sector", "topic", "", null]) assert.equal(m.isTagKind(bad), false)
  })

  it("accepts submitted tag ids only when every one is a uuid, de-duplicated, within the limit", () => {
    const a = "11111111-1111-4111-8111-111111111111"
    assert.deepEqual(m.parseTagIds([a, a.toUpperCase()]), [a])
    assert.equal(m.parseTagIds([a, "1; drop table x"]), null)
    const many = Array.from({ length: m.MAX_TAGS_PER_PUBLICATION + 1 }, (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`)
    assert.equal(m.parseTagIds(many), null)
  })

  it("groups labels by kind in a stable, case-insensitive order", () => {
    const grouped = m.labelsByKind([
      { kind: "subject", label: "tariffs" },
      { kind: "subject", label: "Elections" },
      { kind: "geography", label: "Lagos" },
      { kind: "bogus", label: "ignored" },
    ])
    assert.deepEqual(grouped, { subject: ["Elections", "tariffs"], sector: [], geography: ["Lagos"] })
  })
})

describe("protected summaries", () => {
  it("cleans and validates the fields; an incomplete draft is allowed but cannot be approved", () => {
    const result = m.validateSummaryInput({ whatChanged: " Line one\r\nLine two ", whyItMatters: "", implications: "", watchNext: "", sourceDate: "", uncertainty: "" })
    assert.equal(result.ok, true)
    assert.equal(result.value.whatChanged, "Line one\nLine two")
    assert.equal(result.value.sourceDate, null)
    assert.equal(m.isCompleteSummary(result.value), false)
    assert.equal(m.isCompleteSummary(SUMMARY), true)
    assert.equal(m.isCompleteSummary({ ...SUMMARY, uncertainty: "", sourceDate: null }), true, "source date and uncertainty are optional")
  })

  it("refuses over-long text and an impossible source date", () => {
    const result = m.validateSummaryInput({ ...SUMMARY, implications: "x".repeat(m.MAX_SUMMARY_FIELD_LENGTH + 1), sourceDate: "2026-13-01" })
    assert.equal(result.ok, false)
    assert.deepEqual(Object.keys(result.errors).sort(), ["implications", "sourceDate"])
  })

  it("compares every field, the source date included", () => {
    assert.equal(m.sameSummary(SUMMARY, { ...SUMMARY }), true)
    for (const key of Object.keys(SUMMARY)) {
      assert.equal(m.sameSummary(SUMMARY, { ...SUMMARY, [key]: key === "sourceDate" ? "2026-10-03" : `${SUMMARY[key]}!` }), false, key)
    }
  })

  it("reads an approved copy strictly: complete, known fields, strings, a real source date", () => {
    assert.deepEqual(m.readApprovedSummary(SUMMARY), SUMMARY)
    assert.deepEqual(m.readApprovedSummary(JSON.stringify({ ...SUMMARY, sourceDate: null })), { ...SUMMARY, sourceDate: null })
    for (const bad of [null, "not json", [], { ...SUMMARY, watchNext: "" }, { ...SUMMARY, implications: 7 }, { ...SUMMARY, sourceDate: "soon" }, { whatChanged: "only one" }]) {
      assert.equal(m.readApprovedSummary(bad), null, JSON.stringify(bad))
    }
    // Extra keys in the stored copy are never carried through.
    assert.deepEqual(Object.keys(m.readApprovedSummary({ ...SUMMARY, approvedBy: "someone" })).sort(), Object.keys(SUMMARY).sort())
  })

  it("says where a summary stands", () => {
    assert.equal(m.summaryStatus(null), "none")
    assert.equal(m.summaryStatus({ text: m.EMPTY_SUMMARY, approved: null, removedReason: null }), "none")
    assert.equal(m.summaryStatus({ text: SUMMARY, approved: null, removedReason: null }), "draft")
    assert.equal(m.summaryStatus({ text: SUMMARY, approved: SUMMARY, removedReason: null }), "approved")
    assert.equal(m.summaryStatus({ text: { ...SUMMARY, watchNext: "Edited." }, approved: SUMMARY, removedReason: null }), "changed", "an approval of other text never counts as approved")
    assert.equal(m.summaryStatus({ text: { ...SUMMARY, watchNext: "Edited." }, approved: null, removedReason: "edited" }), "changed")
    assert.equal(m.summaryStatus({ text: SUMMARY, approved: null, removedReason: "withdrawn" }), "draft")
  })

  it("searches the approved words, not the source date", () => {
    const text = m.summarySearchText(SUMMARY)
    for (const key of ["whatChanged", "whyItMatters", "implications", "watchNext", "uncertainty"]) assert.ok(text.includes(SUMMARY[key]), key)
    assert.ok(!text.includes("2026-10-02"))
    assert.equal(m.summarySearchText(null), "")
  })
})

describe("formatting on the card", () => {
  it("formats days without time-zone drift and periods compactly", () => {
    assert.equal(m.formatDay("2026-09-01"), "1 September 2026")
    assert.equal(m.formatDay("2026-09-01T23:30:00Z"), "1 September 2026")
    assert.equal(m.formatDay("nonsense"), "")
    assert.equal(m.coveredPeriodLabel("2026-09-01", "2026-09-30"), "1–30 September 2026")
    assert.equal(m.coveredPeriodLabel("2026-09-01", "2026-10-15"), "1 September – 15 October 2026")
    assert.equal(m.coveredPeriodLabel("2025-12-01", "2026-01-15"), "1 December 2025 – 15 January 2026")
    assert.equal(m.coveredPeriodLabel("2026-09-15", "2026-09-15"), "15 September 2026")
    assert.equal(m.readingTimeLabel(1), "1 minute")
    assert.equal(m.readingTimeLabel(12), "12 minutes")
  })
})

describe("what a subscriber card shows", () => {
  const facts = (d) => renderToStaticMarkup(createElement(PublicationFacts, { details: d }))
  const summary = (s, props = {}) => renderToStaticMarkup(createElement(ProtectedSummary, { summary: s, ...props }))

  it("shows nothing at all when nothing was entered (the card is unchanged)", () => {
    assert.equal(facts(null), "")
    assert.equal(facts(undefined), "")
    assert.equal(facts(details()), "")
    assert.equal(summary(null), "")
    assert.equal(m.hasReaderFacts(details()), false)
  })

  it("shows only the details that were entered, never a placeholder or estimate", () => {
    const html = facts(details({ readingMinutes: 12 }))
    assert.match(html, /Reading time:<\/dt><dd[^>]*>12 minutes</)
    for (const absent of ["Covers", "Information to", "Author/editor", "Subjects", "Sectors", "Geography", "min read", "undefined", "null"]) {
      assert.ok(!html.includes(absent), absent)
    }
  })

  it("shows every entered detail and tag label", () => {
    const html = facts(details({
      authorEditor: "APRI Research Team",
      coveredPeriod: { start: "2026-09-01", end: "2026-09-30" },
      informationCutoff: "2026-09-28",
      readingMinutes: 1,
      tags: { subject: ["Elections", "Tariffs"], sector: ["Power"], geography: ["Lagos"] },
    }))
    for (const text of ["1 minute", "1–30 September 2026", "28 September 2026", "APRI Research Team", "Elections, Tariffs", "Power", "Lagos", "Subjects:", "Sectors:", "Geography:"]) {
      assert.ok(html.includes(text), text)
    }
  })

  it("renders the approved summary as a native disclosure, with only filled fields", () => {
    const html = summary({ ...SUMMARY, uncertainty: "" })
    assert.match(html, /^<details[^>]*><summary[^>]*>[\s\S]*Summary<\/summary>/)
    for (const label of ["What changed", "Why it matters", "Implications and relevant risks/scenarios", "What to watch next"]) assert.ok(html.includes(label), label)
    assert.ok(!html.includes("Uncertainty"), "an empty optional field is not shown")
    assert.match(html, /Source date: 2 October 2026/)
    assert.doesNotMatch(summary({ ...SUMMARY, sourceDate: null }), /Source date/)
    assert.doesNotMatch(html, / open=""/, "collapsed unless asked")
  })
})

describe("source guards", () => {
  it("the rules import only the search rules, and use no database, network, storage or analytics", () => {
    const source = read("src/lib/publication-metadata.ts")
    const imports = [...source.matchAll(/^import .* from "([^"]+)"/gm)].map((x) => x[1])
    assert.deepEqual(imports, ["./library-search.ts"])
    assert.doesNotMatch(source, /fetch\(|localStorage|sessionStorage|document\.cookie|getSql|neon|server-only/)
  })

  it("the card components receive only reader details: no ids, links, Papermark or approval details", () => {
    const source = read("src/components/PublicationReaderDetails.tsx")
    assert.doesNotMatch(source, /^["']use client["']/m, "server-rendered only")
    assert.doesNotMatch(source, /papermark|linkUrl|href=|approvedBy|approved_by|revision|getSql|fetch\(/i)
  })
})
