/**
 * The one publication catalogue (src/lib/publication-catalogue.ts): its
 * built-in defaults, the owner's saved edits laid over them, exact folder
 * mapping, how one edition's category is decided, library sections, search
 * type options and the owner-edit validation. Plus the modules that used to
 * hold their own lists now reading from it.
 *
 * Pure rules only (the database side is in publication-catalogue-db.test.mjs
 * and publication-catalogue-migration.test.mjs). Invented values only.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  CATALOGUE_CODES,
  DEFAULT_CATALOGUE,
  DEFAULT_FOLDER_MAPPINGS,
  UNASSIGNED_KEY,
  UNASSIGNED_LABEL,
  catalogueOrder,
  categoryLabel,
  categorySections,
  categorySingularLabel,
  folderSlug,
  isCatalogueCode,
  isReviewCode,
  leadingCatalogueCode,
  mergeCatalogue,
  resolveCategory,
  resolveFolder,
  reviewCodes,
  searchTypeOptions,
  seriesChoices,
  validateCategoryEdit,
  validateFolderInput,
} from "../src/lib/publication-catalogue.ts"
import { categoriseDataRoomDocument, categoryToSeries, derivePublicationMetadata } from "../src/lib/papermark-dataroom-contract.ts"
import { SERIES, SERIES_CODES, seriesLabel } from "../src/lib/entitlements.ts"
import { editionsByCategory, newestEdition, legacyLibraryView, dataRoomLibraryView, legacyCategory } from "../src/lib/portal-library.ts"
import { searchLibrary, EMPTY_LIBRARY_FILTERS, dataRoomSearchEntry, legacySearchEntry } from "../src/lib/library-search.ts"
import { classifyReviewDocument, generateReviewMetadata, hasApprovedReviewCopy, isReviewSeries, reviewCopyProblem, SUPPORTED_SERIES } from "../src/lib/review-classify.ts"
import { selectOfferedCards, REVIEW_SERIES } from "../src/lib/review-withdrawal.ts"

const ROOT = new URL("../", import.meta.url)
const read = (p) => readFileSync(new URL(p, ROOT), "utf8")

describe("the built-in catalogue", () => {
  it("has exactly the stored codes, in the agreed default order, with the agreed labels", () => {
    assert.deepEqual([...CATALOGUE_CODES], ["MIN", "AIU", "PLM", "AEO", "QIB", "OTHER", "BP"])
    assert.deepEqual(catalogueOrder(), ["MIN", "AIU", "PLM", "AEO", "QIB", "OTHER", "BP"])
    const byCode = Object.fromEntries(DEFAULT_CATALOGUE.map((c) => [c.code, c]))
    assert.deepEqual(
      DEFAULT_CATALOGUE.map((c) => [c.code, c.label, c.singularLabel, c.active]),
      [
        ["MIN", "Monthly Intelligence Notes", "Monthly Intelligence Note", true],
        ["AIU", "Athena Intelligence Updates", "Athena Intelligence Update", true],
        ["PLM", "Political Landscape Monitor", "Political Landscape Monitor", true],
        ["AEO", "Election & Democratic Governance Monitor", "Election & Democratic Governance Monitor", true],
        ["QIB", "Quarterly Intelligence Briefs", "Quarterly Intelligence Brief", true],
        ["OTHER", "Other Assigned Publications", "Other assigned publication", true],
        ["BP", "Board Papers", "Board Paper", false],
      ],
    )
    assert.deepEqual(byCode.AEO.aliases, ["Election Observatory"], "the historical name is kept as an alias")
  })

  it("lets a Complimentary Review edition use every code but BP", () => {
    assert.deepEqual(reviewCodes(), ["MIN", "AIU", "PLM", "AEO", "QIB", "OTHER"])
    assert.ok(!isReviewCode("BP"))
    assert.ok(!isReviewCode("L1") && !isReviewCode("") && !isReviewCode(null))
  })

  it("is the one list the other modules read: entitlements, review, withdrawal and the contract agree with it", () => {
    assert.deepEqual(SERIES_CODES, [...CATALOGUE_CODES])
    for (const c of DEFAULT_CATALOGUE) assert.equal(SERIES[c.code], c.singularLabel)
    assert.equal(seriesLabel("AEO"), "Election & Democratic Governance Monitor")
    assert.equal(seriesLabel("L9"), "L9")
    assert.deepEqual([...SUPPORTED_SERIES], reviewCodes())
    assert.deepEqual([...REVIEW_SERIES], reviewCodes())
    for (const code of ["MIN", "AIU", "PLM", "AEO", "QIB", "OTHER"]) assert.ok(isReviewSeries(code), code)
    assert.ok(!isReviewSeries("BP") && !isReviewSeries(""))
  })

  it("no source file keeps its own list of the three old series or a hard-coded SQL series order", () => {
    const files = []
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) walk(path)
        else if (/\.(ts|tsx)$/.test(name)) files.push(path)
      }
    }
    walk(fileURLToPath(new URL("src", ROOT)))
    const offenders = []
    for (const file of files) {
      const source = readFileSync(file, "utf8")
      if (/case e\.series when 'MIN'/.test(source)) offenders.push(`${file}: SQL case ordering`)
      if (/\[\s*["']MIN["'],\s*["']AIU["'],\s*["']PLM["']\s*\]/.test(source)) offenders.push(`${file}: MIN/AIU/PLM list`)
      if (/\[\s*["']PLM["'],\s*["']MIN["'],\s*["']AIU["']\s*\]/.test(source)) offenders.push(`${file}: PLM/MIN/AIU list`)
      if (/z\.enum\(\[['"]MIN['"]/.test(source)) offenders.push(`${file}: series enum`)
    }
    assert.deepEqual(offenders, [])
    assert.doesNotMatch(read("src/lib/portal-library.ts"), /PORTAL_SERIES/)
    assert.doesNotMatch(read("src/lib/papermark-dataroom-contract.ts"), /PORTAL_CATEGORIES|upper\.includes\(code\)/)
  })
})

describe("the owner's saved edits over the defaults", () => {
  it("changes labels, order and the active flag, and keeps every code", () => {
    const merged = mergeCatalogue([
      { code: "QIB", label: "Quarterly Briefs", singular_label: "Quarterly Brief", sort_order: 5, active: true, aliases: [] },
      { code: "MIN", label: "Monthly Notes", singular_label: "Monthly Note", sort_order: 15, active: "f", aliases: "{}" },
      { code: "BP", label: "Board Papers", singular_label: "Board Paper", sort_order: 70, active: "t", aliases: '{"Board Briefing","Old, name"}' },
    ])
    assert.deepEqual(merged.map((c) => c.code), ["QIB", "MIN", "AIU", "PLM", "AEO", "OTHER", "BP"])
    assert.equal(merged.find((c) => c.code === "QIB").label, "Quarterly Briefs")
    assert.equal(merged.find((c) => c.code === "MIN").active, false)
    assert.equal(merged.find((c) => c.code === "BP").active, true)
    assert.deepEqual(merged.find((c) => c.code === "BP").aliases, ["Board Briefing", "Old, name"])
    assert.equal(merged.length, CATALOGUE_CODES.length)
  })

  it("ignores unknown codes and falls back to the default for any invalid stored value", () => {
    const merged = mergeCatalogue([
      { code: "ZZZ", label: "Injected", singular_label: "Injected", sort_order: 0, active: true },
      { code: "AIU", label: "   ", singular_label: "x".repeat(81), sort_order: -4, active: null, aliases: null },
    ])
    assert.ok(!merged.some((c) => c.code === "ZZZ"))
    const aiu = merged.find((c) => c.code === "AIU")
    assert.deepEqual([aiu.label, aiu.singularLabel, aiu.sortOrder, aiu.active], ["Athena Intelligence Updates", "Athena Intelligence Update", 20, true])
  })

  it("with no saved rows is exactly the defaults (the pre-migration catalogue)", () => {
    assert.deepEqual(mergeCatalogue([]).map((c) => [c.code, c.label, c.sortOrder, c.active]), DEFAULT_CATALOGUE.map((c) => [c.code, c.label, c.sortOrder, c.active]))
  })
})

describe("folders are matched exactly, never guessed", () => {
  it("normalises a folder name to the slug it is mapped by, spelling & as 'and' as Papermark does", () => {
    assert.equal(folderSlug("Election & Democratic Governance Monitor"), "election-and-democratic-governance-monitor")
    assert.equal(folderSlug("Election %26 Democratic Governance Monitor"), "election-and-democratic-governance-monitor")
    assert.equal(folderSlug("04_Monthly_Intelligence_Notes"), "monthly-intelligence-notes")
    assert.equal(folderSlug("Monthly%20Intelligence%20Note"), "monthly-intelligence-note")
    assert.equal(folderSlug("Élections"), "elections")
  })

  // Papermark stores a folder's path as safeSlugify(name) -- @sindresorhus/slugify
  // with its defaults, which spell "&" as "and". These are the paths it
  // creates for the six folders in the owner's screenshot.
  const PAPERMARK_PATHS = {
    "Athena Intelligence Updates": ["/athena-intelligence-updates", "AIU"],
    "Election & Democratic Governance Monitor": ["/election-and-democratic-governance-monitor", "AEO"],
    "Monthly Intelligence Notes": ["/monthly-intelligence-notes", "MIN"],
    "Other Assigned Publications": ["/other-assigned-publications", "OTHER"],
    "Political Landscape Monitor": ["/political-landscape-monitor", "PLM"],
    "Quarterly Intelligence Briefs": ["/quarterly-intelligence-briefs", "QIB"],
  }

  it("every screenshot folder, at the path Papermark actually stores, files its documents into its category", () => {
    for (const [name, [path, code]] of Object.entries(PAPERMARK_PATHS)) {
      assert.equal(`/${folderSlug(name)}`, path, `the key for "${name}" is Papermark's own slug`)
      assert.deepEqual(resolveFolder(path, DEFAULT_FOLDER_MAPPINGS), { kind: "mapped", code, folderSlug: path.slice(1) }, path)
      assert.equal(categoriseDataRoomDocument({ title: "Edition July 2026.pdf", folderPath: path }), code, path)
      assert.equal(resolveFolder(`/2026-archive${path}`, DEFAULT_FOLDER_MAPPINGS).code, code, `${path} nested`)
    }
    // The "&"-dropped form of the AEO folder (the lead's seeded slug) still maps.
    assert.equal(resolveFolder("/election-democratic-governance-monitor", DEFAULT_FOLDER_MAPPINGS).code, "AEO")
  })

  it("maps only the default folders: the screenshot labels and the slugs already seen", () => {
    assert.deepEqual(
      DEFAULT_FOLDER_MAPPINGS.map((m) => [m.folderSlug, m.code]),
      [
        ["monthly-intelligence-notes", "MIN"],
        ["monthly-intelligence-note", "MIN"],
        ["athena-intelligence-updates", "AIU"],
        ["political-landscape-monitor", "PLM"],
        ["election-and-democratic-governance-monitor", "AEO"],
        ["election-democratic-governance-monitor", "AEO"],
        ["election-watch", "AEO"],
        ["quarterly-intelligence-briefs", "QIB"],
        ["other-assigned-publications", "OTHER"],
      ],
    )
    assert.ok(!DEFAULT_FOLDER_MAPPINGS.some((m) => m.folderSlug === "board-intelligence-updates"), "Board Intelligence Updates is left for an owner to decide")
  })

  it("an Admin folder is not a Monthly Intelligence Note, and other look-alikes are not guessed", () => {
    const m = DEFAULT_FOLDER_MAPPINGS
    for (const path of ["/Admin", "/ADMIN", "/Minutes", "/aiu-drafts", "/monthly-intelligence-notes-archive", "/Plmonitor", "/QIB"]) {
      assert.deepEqual(resolveFolder(path, m).kind, "unmapped", path)
    }
    assert.equal(categoriseDataRoomDocument({ title: "Board pack.pdf", folderPath: "/Admin" }), null)
    assert.equal(categoriseDataRoomDocument({ title: "Pack.pdf", folderPath: "/board-intelligence-updates" }), null)
  })

  it("a mapped folder matches at any depth, and the innermost mapped folder wins", () => {
    const m = DEFAULT_FOLDER_MAPPINGS
    assert.deepEqual(resolveFolder("/Publications/Quarterly Intelligence Briefs", m), { kind: "mapped", code: "QIB", folderSlug: "quarterly-intelligence-briefs" })
    assert.equal(resolveFolder("/other-assigned-publications/monthly-intelligence-notes", m).code, "MIN")
    assert.deepEqual(resolveFolder("", m), { kind: "none" })
    assert.deepEqual(resolveFolder(null, m), { kind: "none" })
    assert.deepEqual(resolveFolder("/", m), { kind: "none" })
  })

  it("Other Assigned Publications only when a folder is explicitly mapped to it, or the record says OTHER", () => {
    const m = DEFAULT_FOLDER_MAPPINGS
    assert.equal(resolveCategory({ folderPath: "/Other Assigned Publications", title: "x", mappings: m }).code, "OTHER")
    assert.equal(resolveCategory({ series: "OTHER", folderPath: "/Admin", title: "x", mappings: m }).code, "OTHER")
    assert.equal(resolveCategory({ folderPath: "/Miscellaneous", title: "x", mappings: m }).code, null)
    assert.equal(resolveCategory({ title: "random.pdf", mappings: m }).code, null)
    assert.equal(resolveCategory({ folderPath: "/Miscellaneous", title: "x", mappings: m }).unmappedFolder, "miscellaneous")
  })
})

describe("one edition's category", () => {
  const m = DEFAULT_FOLDER_MAPPINGS
  it("the publication record's series wins over the folder and the name", () => {
    assert.deepEqual(resolveCategory({ series: "QIB", folderPath: "/monthly-intelligence-notes", title: "MIN-2026", mappings: m }), { code: "QIB", source: "series" })
    assert.equal(resolveCategory({ series: "BP", folderPath: "/Admin", title: "x", mappings: m }).code, "BP")
  })

  it("then the mapped folder", () => {
    assert.deepEqual(resolveCategory({ series: "", folderPath: "/athena-intelligence-updates", title: "PLM-x", mappings: m }), { code: "AIU", source: "folder" })
  })

  it("a code at the start of the name only for a document in no folder -- never in an unmapped folder", () => {
    assert.deepEqual(resolveCategory({ title: "QIB-2026-Q3 Brief.pdf", mappings: m }), { code: "QIB", source: "title" })
    assert.equal(resolveCategory({ title: "QIB-2026-Q3 Brief.pdf", folderPath: "/Admin", mappings: m }).code, null)
    assert.equal(leadingCatalogueCode("ADMIN-notes"), null)
    assert.equal(leadingCatalogueCode("MINIMAL report"), null)
    assert.equal(leadingCatalogueCode("aeo_2026 election"), "AEO")
  })

  it("an owner's mapping changes placement at once, with no re-sync", () => {
    const mine = [...m, { folderSlug: "board-intelligence-updates", code: "OTHER" }]
    assert.equal(categoriseDataRoomDocument({ title: "Pack.pdf", folderPath: "/board-intelligence-updates", mappings: mine }), "OTHER")
    assert.equal(categoriseDataRoomDocument({ title: "Pack.pdf", folderPath: "/board-intelligence-updates", mappings: [] }), null)
  })

  it("an auto-created record stores OTHER only from an explicit mapping once the migration allows it, never a guessed series", () => {
    assert.equal(categoryToSeries("OTHER"), "", "before the migration: no series, the folder mapping still places it")
    assert.equal(categoryToSeries("OTHER", { otherStorable: true }), "OTHER")
    assert.equal(categoryToSeries(null, { otherStorable: true }), "")
    assert.equal(categoryToSeries("QIB"), "QIB")
    assert.equal(derivePublicationMetadata({ filename: "x 2026 05.pdf", category: null, otherStorable: true }).series, "")
    const other = derivePublicationMetadata({ filename: "Assigned paper 2026 05.pdf", category: "OTHER", otherStorable: true })
    assert.deepEqual([other.series, other.editionCode], ["OTHER", ""], "no edition code is invented for the mixed Other group")
    assert.equal(derivePublicationMetadata({ filename: "Brief 2026 05.pdf", category: "QIB" }).editionCode, "APRI-QIB-2026-05")
  })
})

describe("library sections", () => {
  const items = [
    { id: "q1", code: "QIB", editionDate: "2026-04-01" },
    { id: "m1", code: "MIN", editionDate: "2026-03-01" },
    { id: "b1", code: "BP", editionDate: "2026-02-01" },
    { id: "u1", code: null, editionDate: "2026-06-01" },
    { id: "m2", code: "MIN", editionDate: "2026-05-01" },
  ]
  const sections = (list, categories = DEFAULT_CATALOGUE) => editionsByCategory(list, categories, (i) => i.code)

  it("every active category in order (empty ones too), an inactive one only with something in it, and awaiting a category last", () => {
    const s = sections(items)
    assert.deepEqual(s.map((x) => x.key), ["MIN", "AIU", "PLM", "AEO", "QIB", "OTHER", "BP", UNASSIGNED_KEY])
    assert.deepEqual(s.find((x) => x.key === "MIN").items.map((i) => i.id), ["m2", "m1"], "newest first")
    assert.equal(s.at(-1).label, UNASSIGNED_LABEL)
    assert.equal(s.find((x) => x.key === "AIU").items.length, 0)
    assert.deepEqual(sections(items.filter((i) => i.code !== "BP" && i.code !== null)).map((x) => x.key), ["MIN", "AIU", "PLM", "AEO", "QIB", "OTHER"])
  })

  it("follow the owner's order and labels, and an inactive category with nothing in it disappears", () => {
    const owner = mergeCatalogue([
      { code: "QIB", label: "Quarterly Briefs", singular_label: "Quarterly Brief", sort_order: 1, active: true },
      { code: "AEO", label: "Election & Democratic Governance Monitor", singular_label: "Election & Democratic Governance Monitor", sort_order: 40, active: false },
    ])
    const s = sections(items, owner)
    assert.deepEqual(s.map((x) => x.key).slice(0, 2), ["QIB", "MIN"])
    assert.equal(s[0].label, "Quarterly Briefs")
    assert.ok(!s.some((x) => x.key === "AEO"))
  })

  it("the portal's helpers place, search and pick Latest from one list, in the catalogue they are given", () => {
    const owner = mergeCatalogue([{ code: "QIB", label: "Quarterly Briefs", singular_label: "Quarterly Brief", sort_order: 1, active: true }])
    const legacy = [
      { id: "l1", series: "QIB", editionDate: "2026-05-01", title: "Brief" },
      { id: "l2", series: "AEO", editionDate: "2026-06-01", title: "Election" },
      { id: "l3", series: "OTHER", editionDate: "2026-04-01", title: "Assigned" },
      { id: "l4", series: "", editionDate: "2026-07-01", title: "Unfiled" },
    ]
    const v = legacyLibraryView(legacy, owner)
    const placed = Object.fromEntries(v.sections.map((s) => [s.key, s.items.map((i) => i.id)]))
    assert.deepEqual(v.sections.map((s) => s.key), ["QIB", "MIN", "AIU", "PLM", "AEO", "OTHER", UNASSIGNED_KEY], "the owner's order")
    assert.equal(v.sections[0].label, "Quarterly Briefs", "the owner's label")
    assert.deepEqual([placed.QIB, placed.AEO, placed.OTHER, placed[UNASSIGNED_KEY]], [["l1"], ["l2"], ["l3"], ["l4"]], "every category its own section; none narrowed to three")
    assert.deepEqual(v.types.map((t) => [t.value, t.label]), [["QIB", "Quarterly Briefs"], ["AEO", "Election & Democratic Governance Monitor"], ["OTHER", "Other Assigned Publications"], [UNASSIGNED_KEY, UNASSIGNED_LABEL]])
    assert.equal(v.latest.id, "l4")
    // Each search record is filed under the section its card is in.
    for (const s of v.sections) for (const item of s.items) assert.equal(v.entries.find((e) => e.id === item.id).series, s.key)
    assert.deepEqual([legacyCategory({ series: "QIB" }), legacyCategory({ series: "" }), legacyCategory({ series: "ZZZ" })], ["QIB", null, null])

    const docs = [
      { id: "d1", category: "AEO", editionDate: "2026-03-01", displayTitle: "Election" },
      { id: "d2", category: null, editionDate: "2026-08-01", displayTitle: "Board pack" },
    ]
    const d = dataRoomLibraryView(docs, owner)
    assert.deepEqual(d.sections.find((s) => s.key === "AEO").items.map((i) => i.id), ["d1"])
    assert.deepEqual(d.sections.at(-1).items.map((i) => i.id), ["d2"])
    assert.deepEqual(d.types.map((t) => t.value), ["AEO", UNASSIGNED_KEY])
    assert.equal(d.latest.id, "d2")
  })

  it("never drop an item, and Latest is the newest across every category", () => {
    const s = sections(items)
    assert.equal(s.reduce((n, x) => n + x.items.length, 0), items.length)
    assert.equal(newestEdition(items).id, "u1")
  })

  it("labels: plural for sections, singular for cards, a neutral pair for awaiting a category", () => {
    assert.equal(categoryLabel("QIB"), "Quarterly Intelligence Briefs")
    assert.equal(categorySingularLabel("QIB"), "Quarterly Intelligence Brief")
    assert.equal(categoryLabel(null), "Publications awaiting a category")
    assert.equal(categorySingularLabel(UNASSIGNED_KEY), "Publication")
  })
})

describe("search over every category (Step 1, extended)", () => {
  const entries = [
    dataRoomSearchEntry({ id: "a", category: "QIB", editionDate: "2026-04-01", displayTitle: "Quarterly outlook", summary: "Budget" }),
    dataRoomSearchEntry({ id: "b", category: null, editionDate: "2026-05-01", displayTitle: "Board pack", summary: null }),
    dataRoomSearchEntry({ id: "c", category: "MIN", editionDate: "2026-03-01", displayTitle: "March note", summary: "Budget" }),
    legacySearchEntry({ id: "d", series: "AEO", editionDate: "2026-02-01", title: "Election note" }),
    legacySearchEntry({ id: "e", series: "", editionDate: null, title: "Unfiled" }),
  ]
  const find = (filters, types) => searchLibrary(entries, { ...EMPTY_LIBRARY_FILTERS, ...filters }, types)

  it("type options are only the categories present, in catalogue order, with awaiting a category last", () => {
    assert.deepEqual(searchTypeOptions(entries).map((o) => o.value), ["MIN", "AEO", "QIB", UNASSIGNED_KEY])
    assert.deepEqual(searchTypeOptions(entries).map((o) => o.label), ["Monthly Intelligence Notes", "Election & Democratic Governance Monitor", "Quarterly Intelligence Briefs", "Publications awaiting a category"])
  })

  it("filters by any present category, including awaiting a category, and refuses one not offered", () => {
    assert.deepEqual(find({ series: "QIB" }).entries.map((e) => e.id), ["a"])
    assert.deepEqual(find({ series: UNASSIGNED_KEY }).entries.map((e) => e.id), ["b", "e"])
    assert.match(find({ series: "PLM" }).error, /publication type/, "a category with no permitted edition is not offered")
    assert.match(find({ series: "QIB" }, ["MIN"]).error, /publication type/, "the caller's list of types is binding")
    assert.deepEqual(find({ query: "budget" }).entries.map((e) => e.id), ["a", "c"])
  })

  it("search entries still carry display fields only", () => {
    for (const e of entries) assert.deepEqual(Object.keys(e).sort(), ["description", "editionDate", "id", "series", "title"])
  })
})

describe("owner edits are validated", () => {
  it("accepts a clean edit and tidies it", () => {
    const ok = validateCategoryEdit({ code: "QIB", label: "  Quarterly   Briefs ", singularLabel: "Quarterly Brief", sortOrder: "5", active: "on", aliases: "QB, quarterly brief, QB" })
    assert.deepEqual(ok, { ok: true, value: { code: "QIB", label: "Quarterly Briefs", singularLabel: "Quarterly Brief", sortOrder: 5, active: true, aliases: ["QB", "quarterly brief"] } })
  })

  it("refuses a new code, empty or long labels, bad positions and too many names", () => {
    assert.equal(validateCategoryEdit({ code: "NEW", label: "x", singularLabel: "x", sortOrder: "1", active: "on", aliases: "" }).field, "code")
    assert.equal(validateCategoryEdit({ code: "MIN", label: " ", singularLabel: "x", sortOrder: "1", aliases: "" }).field, "label")
    assert.equal(validateCategoryEdit({ code: "MIN", label: "x", singularLabel: "y".repeat(81), sortOrder: "1", aliases: "" }).field, "singularLabel")
    for (const sortOrder of ["-1", "10000", "1.5", "abc", ""]) {
      assert.equal(validateCategoryEdit({ code: "MIN", label: "x", singularLabel: "x", sortOrder, aliases: "" }).field, "sortOrder", sortOrder)
    }
    assert.equal(validateCategoryEdit({ code: "MIN", label: "x", singularLabel: "x", sortOrder: "1", aliases: Array.from({ length: 11 }, (_, i) => `n${i}`).join(",") }).field, "aliases")
    assert.equal(validateCategoryEdit({ code: "MIN", label: "x", singularLabel: "x", sortOrder: "1", aliases: "" }).value.active, false, "an unticked box deactivates")
  })

  it("a folder is one name, turned into its slug; a path or punctuation alone is refused", () => {
    assert.deepEqual(validateFolderInput("Board Intelligence Updates"), { ok: true, value: "board-intelligence-updates" })
    assert.deepEqual(validateFolderInput("Election & Democratic Governance Monitor"), { ok: true, value: "election-and-democratic-governance-monitor" }, "the name an owner types matches the path Papermark stores")
    assert.equal(validateFolderInput("/a/b").ok, false)
    // Punctuation alone is refused; "&" is a word ("and"), as in Papermark's own folder paths.
    assert.equal(validateFolderInput("!!!").ok, false)
    assert.equal(validateFolderInput("- _ -").ok, false)
    assert.deepEqual(validateFolderInput("R&D"), { ok: true, value: "r-and-d" })
    assert.equal(validateFolderInput("").ok, false)
    assert.equal(validateFolderInput("x".repeat(201)).ok, false)
  })

  it("refuses a folder named only with digits: a year folder sits inside every category's folder, and the innermost mapping wins", () => {
    const year = validateFolderInput("2026")
    assert.equal(year.ok, false)
    assert.match(year.message, /folder above it/)
    // What mapping one would have done: every 2026 subfolder captured, whatever its parent.
    const withYear = [...DEFAULT_FOLDER_MAPPINGS, { folderSlug: "2026", code: "OTHER" }]
    assert.equal(resolveFolder("/monthly-intelligence-notes/2026", withYear).code, "OTHER")
    assert.equal(validateFolderInput("Q3 2026").ok, true, "a name with letters is still accepted")
  })

  it("Admin pre-fills the outermost folder of an unmapped path, never a generic subfolder", () => {
    const page = read("src/app/admin/categories/page.tsx")
    assert.match(page, /folder=\{outermostFolder\(f\.folder\)\}/)
    assert.doesNotMatch(page, /f\.folder\.split\("\/"\)\.pop\(\)/)
  })
})

describe("Complimentary Review over the catalogue", () => {
  it("sync proposes a category by the owner's folder mapping first, then the approved names in the filename", () => {
    assert.equal(classifyReviewDocument("June 2026.pdf", "/Quarterly Intelligence Briefs").series, "QIB")
    assert.equal(classifyReviewDocument("Issue 03.pdf", "/election-and-democratic-governance-monitor").series, "AEO", "the AEO folder at the path Papermark stores")
    assert.equal(classifyReviewDocument("Monthly Intelligence Note June 2026.pdf", "/election-democratic-governance-monitor").series, "AEO")
    assert.equal(classifyReviewDocument("Monthly Intelligence Note June 2026.pdf", "/Complimentary Review").series, "MIN")
    assert.equal(classifyReviewDocument("QIB-2026-Q2 Quarterly Intelligence Brief.pdf").series, null, "a name alone never guesses a new category")
    assert.equal(classifyReviewDocument("June 2026.pdf", "/board-intelligence-updates").series, null)
    assert.equal(classifyReviewDocument("June 2026.pdf", "/Board Papers", [{ folderSlug: "board-papers", code: "BP" }]).series, null, "BP is never a review category")
  })

  it("approved card copy only for MIN, AIU and PLM; nothing is invented for another category", () => {
    assert.ok(hasApprovedReviewCopy("MIN") && hasApprovedReviewCopy("AIU") && hasApprovedReviewCopy("PLM"))
    assert.ok(!hasApprovedReviewCopy("QIB") && !hasApprovedReviewCopy("AEO") && !hasApprovedReviewCopy("OTHER"))
    const qib = generateReviewMetadata("QIB", "Quarterly Intelligence Brief Q2 2026.pdf")
    assert.deepEqual([qib.displayTitle, qib.publicationType, qib.description, qib.frequency, qib.audience], ["", "", "", "", ""])
    assert.equal(qib.editionLabel, "April 2026", "only the period is suggested")
    assert.ok(generateReviewMetadata("MIN", "x June 2026.pdf").description.length > 50)
  })

  it("the copy rule: outside MIN, AIU and PLM an edition needs its own saved title and description, never another category's approved copy", () => {
    const min = generateReviewMetadata("MIN", "x June 2026.pdf")
    const all = ["title", "edition_label", "publication_type", "description", "frequency", "audience"]
    // A MIN draft moved to QIB and saved unchanged: every field is marked owner-edited, but the copy is MIN's.
    assert.match(reviewCopyProblem({ series: "QIB", title: min.displayTitle, description: min.description, ownerEditedFields: all }), /approved MIN card copy/)
    assert.match(reviewCopyProblem({ series: "QIB", title: "Q2 brief", description: `  ${min.description.toUpperCase()}  `, ownerEditedFields: all }), /approved MIN/, "case and spacing do not disguise it")
    assert.match(reviewCopyProblem({ series: "AEO", title: "Political Landscape Monitor", description: "Own words.", ownerEditedFields: all }), /approved PLM/)
    assert.equal(reviewCopyProblem({ series: "QIB", title: "Quarterly outlook Q2", description: "Owner-written description.", ownerEditedFields: all }), null)
    assert.match(reviewCopyProblem({ series: "QIB", title: "Quarterly outlook", description: " ", ownerEditedFields: all }), /Enter and save/)
    assert.match(reviewCopyProblem({ series: "OTHER", title: "x", description: "y", ownerEditedFields: [] }), /Enter and save/)
    assert.equal(reviewCopyProblem({ series: null, title: "x", description: "y", ownerEditedFields: all }), "Assign a category first.")
    assert.equal(reviewCopyProblem({ series: "MIN", title: min.displayTitle, description: min.description, ownerEditedFields: [] }), null, "MIN publishes its own approved copy")
  })

  it("homepage cards keep one per category in the owner's order, and only for rows the query chose", () => {
    const card = (slotKey, accessConfigured = true) => ({ slotKey, accessConfigured, id: slotKey })
    assert.deepEqual(selectOfferedCards([card("QIB"), card("MIN"), card("AEO")]).map((c) => c.slotKey), ["MIN", "AEO", "QIB"])
    assert.deepEqual(selectOfferedCards([card("QIB"), card("MIN")], ["QIB", "MIN"]).map((c) => c.slotKey), ["QIB", "MIN"])
    assert.deepEqual(selectOfferedCards([card("QIB"), card("MIN")], ["MIN", "AIU", "PLM"]).map((c) => c.slotKey), ["MIN"], "an order without a category shows no card for it")
    assert.deepEqual(selectOfferedCards([card("BP")]), [])
  })
})

describe("server paths that are not exercised against Papermark here", () => {
  const actions = read("src/app/actions/review-library.ts")

  it("both Review Data Room syncs classify through the owner's folder mapping, and before the migration store only what the database accepts", () => {
    assert.equal((actions.match(/const classification = reviewClassification\(d\.document_name, d\.folder_path, catalogue\)/g) ?? []).length, 2)
    assert.match(actions, /classifyReviewDocument\(filename, folderPath, catalogue\.folders\)/)
    assert.match(actions, /const storable = classification\.series && \(catalogue\.migrated \|\| hasApprovedReviewCopy\(classification\.series\)\)/)
    // A synced edition is always a draft with no readers.
    assert.match(actions, /now\(\), now\(\), 'draft', false\r?\n\s*\)\r?\n\s*on conflict \(papermark_document_id\) do update set/)
  })

  it("publishing an edition outside MIN, AIU and PLM is refused until the owner has written and saved its title and description", () => {
    const verify = actions.slice(actions.indexOf("async function verifyEditionForPublishing"), actions.indexOf("export async function ignoreCandidate"))
    assert.match(verify, /if \(!hasApprovedReviewCopy\(edition\.series\)\) \{/)
    assert.match(verify, /select title, description, owner_edited_fields from review_publication_editions where id = \$\{editionId\}::uuid/)
    assert.match(verify, /const problem = reviewCopyProblem\(\{\s*series: edition\.series,/)
    assert.match(verify, /if \(problem\) return \{ message: `Not published: \$\{problem\}` \}/)
    assert.ok(verify.indexOf("hasApprovedReviewCopy") < verify.indexOf("verifyReviewDocumentLink"), "checked before Papermark is asked anything")
    const update = actions.slice(actions.indexOf("export async function updateEditionDetails"), actions.indexOf("export async function generateEditionDefaults"))
    assert.ok(update.indexOf("await requireOwner()") < update.indexOf("getSql()"))
    assert.match(update, /if \(!hasApprovedReviewCopy\(details\.series\) && !\(await getPublicationCatalogue\(\{ fresh: true \}\)\)\.migrated\)/)
  })

  it("the Data Room sync stores the owner's exact-mapping category, never the old substring guess", () => {
    const sync = read("src/app/actions/datarooms.ts")
    assert.match(sync, /const \{ folders \} = await getPublicationCatalogue\(\{ fresh: true \}\)/)
    assert.match(sync, /categoriseDataRoomDocument\(\{\r?\n\s*title: d\.document_name,\r?\n\s*folderPath: d\.folder_path,\r?\n\s*mappings: folders,\r?\n\s*\}\) \?\? ""/)
  })

  it("the homepage keeps the older automatic-offer rule to the original series, so a new category adds no card by itself", () => {
    const lib = read("src/lib/publications.ts")
    assert.match(lib, /offering \? order : order\.filter\(hasApprovedReviewCopy\)/)
  })

  it("the portal lists every permitted edition on both paths, with a neutral last section", () => {
    const page = read("src/app/portal/page.tsx")
    assert.doesNotMatch(page, /\.filter\(\(document\) =>|library\.filter\(/)
    // The page builds both libraries with the helpers the database tests run,
    // over the owner's catalogue -- never the built-in defaults.
    assert.match(page, /dataRoomLibraryView\(editions, categories\)/)
    assert.match(page, /legacyLibraryView\(portalLibrary, categories\)/)
    assert.match(page, /const \{ categories \} = await getPublicationCatalogue\(\)/)
    assert.match(page, /categories=\{library\.categories\}/)
    assert.doesNotMatch(page, /DEFAULT_CATALOGUE|DEFAULT_FOLDER_MAPPINGS/)
    assert.equal(UNASSIGNED_LABEL, "Publications awaiting a category")
  })
})

describe("Admin series choices and filters use the owner's catalogue", () => {
  it("a record's series choices: active categories in the owner's order and labels, plus its current one if inactive", () => {
    const owner = mergeCatalogue([
      { code: "QIB", label: "Quarterly Briefs", singular_label: "Quarterly Brief", sort_order: 1, active: true },
      { code: "AEO", label: "Election & Democratic Governance Monitor", singular_label: "Election & Democratic Governance Monitor", sort_order: 40, active: false },
    ])
    const fresh = seriesChoices(owner, "", { migrated: true })
    assert.deepEqual(fresh.map((c) => c.code), ["QIB", "MIN", "AIU", "PLM", "OTHER"], "no inactive BP or AEO offered for a new choice")
    assert.equal(fresh[0].label, "Quarterly Brief")
    const kept = seriesChoices(owner, "AEO", { migrated: true })
    assert.deepEqual(kept.find((c) => c.code === "AEO"), { code: "AEO", label: "Election & Democratic Governance Monitor (inactive)", disabled: false }, "the record's current series stays selectable")
    assert.equal(seriesChoices(DEFAULT_CATALOGUE, "", { migrated: false }).find((c) => c.code === "OTHER").disabled, true, "OTHER waits for the migration")
    assert.equal(seriesChoices(DEFAULT_CATALOGUE, "BP", { migrated: false }).find((c) => c.code === "BP").label, "Board Paper (inactive)")
  })

  it("the record form, the records list and the Engagement filter read the owner's catalogue; the filter says it matches the saved series", () => {
    const docPage = read("src/app/admin/documents/[id]/page.tsx")
    assert.equal((docPage.match(/seriesOptions=\{seriesOptions\(catalogue, /g) ?? []).length, 2)
    assert.match(docPage, /seriesChoices\(catalogue\.categories, current, \{ migrated: catalogue\.migrated \}\)/)
    assert.match(read("src/app/admin/documents/[id]/document-form.tsx"), /\{seriesOptions\.map\(\(o\) => \(/)
    assert.match(read("src/app/admin/documents/page.tsx"), /categorySingularLabel\(doc\.series, categories\)/)
    const engagement = read("src/app/admin/engagement/page.tsx")
    assert.match(engagement, /const \{ categories \} = await getPublicationCatalogue\(\)/)
    assert.match(engagement, /<FilterBar tab=\{tab\} filters=\{filters\} seriesOptions=\{seriesOptions\} \/>/)
    assert.match(engagement, /placed only by its\s+folder mapping has no saved series, so it is not matched/)
  })
})

describe("the catalogue is placement only", () => {
  it("the access policy never reads a category, folder or the catalogue", () => {
    const policy = read("src/lib/access-policy.ts")
    assert.doesNotMatch(policy, /publication-catalogue|folder|category/i)
    assert.ok(isCatalogueCode("OTHER"))
  })
})
