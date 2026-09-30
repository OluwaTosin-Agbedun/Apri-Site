/**
 * Page-level viewing progress and the monitor's rules, exercised directly: no
 * database, no network, invented values only.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"

// The rules module imports its sibling without an extension, as the app does.
registerHooks({
  resolve(specifier, context, next) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.includes("/src/") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      const base = join(dirname(fileURLToPath(context.parentURL)), specifier)
      if (existsSync(`${base}.ts`)) return { url: pathToFileURL(`${base}.ts`).href, shortCircuit: true }
    }
    return next(specifier, context)
  },
})

const {
  parseViewAnalytics,
  versionForView,
  sessionProgress,
  cumulativeCoverage,
  formatPageList,
  nextEnrichmentAt,
  REFRESH_WINDOW_MS,
  MAX_ENRICHMENT_ATTEMPTS,
} = await import("../src/lib/page-progress.ts")
const rules = await import("../src/lib/reader-monitoring-rules.ts")

const pages = (...list) => list.map(([pageNumber, durationSeconds]) => ({ pageNumber, durationSeconds }))

describe("reading Papermark's per-view analytics", () => {
  it("takes page_durations as 1-based pages with recorded time", () => {
    const r = parseViewAnalytics({
      view_id: "v",
      page_durations: [
        { page_number: 2, duration_seconds: 4 },
        { page_number: 1, duration_seconds: 10 },
      ],
      total_duration_seconds: 14,
    })
    assert.equal(r.ok, true)
    assert.deepEqual(r.pages, pages([1, 10], [2, 4]))
    assert.equal(r.totalDurationSeconds, 14)
    assert.equal(r.convertedFromMilliseconds, false)
  })

  it("refuses a page numbered 0 rather than shifting the numbering by guesswork", () => {
    const r = parseViewAnalytics({ page_durations: [{ page_number: 0, duration_seconds: 3 }], total_duration_seconds: 3 })
    assert.equal(r.ok, false)
    assert.match(r.reason, /numbered below 1/)
  })

  it("refuses negative or missing durations and non-integer pages", () => {
    assert.equal(parseViewAnalytics({ page_durations: [{ page_number: 1, duration_seconds: -1 }] }).ok, false)
    assert.equal(parseViewAnalytics({ page_durations: [{ page_number: 1 }] }).ok, false)
    assert.equal(parseViewAnalytics({ page_durations: [{ page_number: 1.5, duration_seconds: 1 }] }).ok, false)
    assert.equal(parseViewAnalytics({ page_durations: "x" }).ok, false)
    assert.equal(parseViewAnalytics(null).ok, false)
  })

  it("converts milliseconds when the page times are about a thousand times the total", () => {
    const r = parseViewAnalytics({
      page_durations: [
        { page_number: 1, duration_seconds: 6000 },
        { page_number: 2, duration_seconds: 4000 },
      ],
      total_duration_seconds: 10,
    })
    assert.equal(r.convertedFromMilliseconds, true)
    assert.deepEqual(r.pages, pages([1, 6], [2, 4]))
  })

  it("merges a page reported twice, and uses the page times when no total is given", () => {
    const r = parseViewAnalytics({
      page_durations: [
        { page_number: 3, duration_seconds: 2 },
        { page_number: 3, duration_seconds: 5 },
      ],
    })
    assert.deepEqual(r.pages, pages([3, 7]))
    assert.equal(r.totalDurationSeconds, 7)
  })

  it("keeps missing time missing: no pages and no total is not zero", () => {
    const r = parseViewAnalytics({ page_durations: [] })
    assert.equal(r.ok, true)
    assert.equal(r.totalDurationSeconds, null)
    assert.deepEqual(r.pages, [])
  })
})

describe("the version a session was on", () => {
  const v1 = { versionId: "a", versionNumber: 1, numPages: 20, createdAt: "2026-08-01T00:00:00Z", isPrimary: false }
  const v2 = { versionId: "b", versionNumber: 2, numPages: 24, createdAt: "2026-09-01T00:00:00Z", isPrimary: true }

  it("is the newest version created at or before the session", () => {
    assert.equal(versionForView([v2, v1], "2026-08-15T10:00:00Z").versionNumber, 1)
    assert.equal(versionForView([v2, v1], "2026-09-02T10:00:00Z").versionNumber, 2)
  })

  it("is the only version of a single-version document", () => {
    assert.equal(versionForView([v1], null).versionNumber, 1)
  })

  it("is unknown when it cannot be decided, rather than borrowed", () => {
    assert.equal(versionForView([v2, v1], "2026-07-01T00:00:00Z"), null)
    assert.equal(versionForView([v2, v1], null), null)
    assert.equal(versionForView([], "2026-09-02T00:00:00Z"), null)
  })
})

describe("pages viewed", () => {
  it("pages 1 and 20 of a 20-page PDF are 2 pages (10%), with the furthest page kept apart", () => {
    const session = pages([1, 30], [20, 5])
    assert.deepEqual(sessionProgress(session, 20), { pagesViewed: 2, furthestPage: 20, outOfRange: 0 })
    const c = cumulativeCoverage([{ pages: session }], 20)
    assert.equal(c.available, true)
    assert.equal(c.pagesViewed, 2)
    assert.equal(c.percent, 10)
    assert.equal(c.furthestPage, 20)
  })

  it("deduplicates pages across sessions instead of adding or averaging percentages", () => {
    const c = cumulativeCoverage([{ pages: pages([1, 3], [2, 3]) }, { pages: pages([2, 9], [3, 1]) }], 10)
    assert.equal(c.pagesViewed, 3)
    assert.equal(c.percent, 30, "3 distinct pages of 10, not 20% + 20%, nor their average")
  })

  it("counts skipped pages as not viewed and ignores pages with no recorded time", () => {
    const c = cumulativeCoverage([{ pages: pages([1, 2], [5, 0], [9, 4]) }], 10)
    assert.equal(c.pagesViewed, 2)
  })

  it("ignores page numbers beyond the version's page total", () => {
    const p = sessionProgress(pages([1, 2], [25, 3]), 20)
    assert.equal(p.pagesViewed, 1)
    assert.equal(p.outOfRange, 1)
  })

  it("is unavailable without a page total or without any page evidence, never 0%", () => {
    assert.deepEqual(cumulativeCoverage([{ pages: pages([1, 3]) }], null), { available: false })
    assert.deepEqual(cumulativeCoverage([{ pages: [] }], 20), { available: false })
    assert.equal(rules.progressLabel({ available: false }), "Progress unavailable")
  })

  it("lists pages compactly", () => {
    assert.equal(formatPageList([9, 1, 2, 3, 5, 3]), "1–3, 5, 9")
    assert.equal(formatPageList([]), "")
  })
})

describe("when a session's analytics are fetched again", () => {
  const now = Date.parse("2026-09-30T12:00:00Z")
  it("refreshes a recent session so later reading appears, and settles an old one", () => {
    const recent = nextEnrichmentAt({ outcome: "complete", viewedAt: new Date(now - 60 * 60_000), attempts: 0, now })
    assert.ok(recent && recent.getTime() > now)
    assert.equal(nextEnrichmentAt({ outcome: "complete", viewedAt: new Date(now - REFRESH_WINDOW_MS - 1), attempts: 0, now }), null)
  })

  it("retries a failure with a growing delay, then stops", () => {
    const first = nextEnrichmentAt({ outcome: "failed", viewedAt: null, attempts: 1, now })
    const third = nextEnrichmentAt({ outcome: "failed", viewedAt: null, attempts: 3, now })
    assert.ok(third.getTime() > first.getTime())
    assert.equal(nextEnrichmentAt({ outcome: "failed", viewedAt: null, attempts: MAX_ENRICHMENT_ATTEMPTS, now }), null)
  })

  it("waits for the provider's rate-limit reset, and settles what the provider does not have", () => {
    const later = nextEnrichmentAt({ outcome: "rate_limited", viewedAt: null, attempts: 0, now, retryAfterMs: 120_000 })
    assert.equal(later.getTime(), now + 120_000)
    assert.equal(nextEnrichmentAt({ outcome: "unavailable", viewedAt: null, attempts: 0, now }), null)
  })
})

describe("the monitor's date range", () => {
  it("includes the whole end day in Africa/Lagos", () => {
    const r = rules.lagosDateRange("2026-09-01", "2026-09-30")
    assert.equal(r.fromIso, "2026-08-31T23:00:00.000Z")
    assert.equal(r.toIso, "2026-09-30T23:00:00.000Z", "exclusive end at the start of 1 October, Lagos")
  })

  it("accepts a same-day range as that whole day", () => {
    const r = rules.lagosDateRange("2026-09-15", "2026-09-15")
    assert.equal(Date.parse(r.toIso) - Date.parse(r.fromIso), 24 * 60 * 60_000)
  })

  it("refuses a reversed, missing or impossible range instead of guessing", () => {
    assert.equal(rules.lagosDateRange("2026-09-30", "2026-09-01"), null)
    assert.equal(rules.lagosDateRange("2026-09-30", ""), null)
    assert.equal(rules.lagosDateRange("2026-02-30", "2026-03-01"), null)
    assert.equal(rules.lagosDateRange("30/09/2026", "2026-10-01"), null)
  })

  it("knows today's Lagos date across the UTC midnight", () => {
    assert.equal(rules.lagosToday(new Date("2026-09-30T23:30:00Z")), "2026-10-01")
  })
})

describe("the monitor's filters from the address bar", () => {
  const tiers = ["Individual Access", "Professional Team Access"]
  it("treats an absent filter as empty, never the text \"undefined\"", () => {
    const { filters, rangeInvalid } = rules.readMonitorFilters({}, tiers)
    assert.deepEqual([filters.series, filters.level, filters.status, filters.range], ["", "", "", null])
    assert.equal(rangeInvalid, false)
  })

  it("keeps only known values", () => {
    const { filters } = rules.readMonitorFilters(
      { series: "MIN", level: "Individual Access", status: "lapsed", from: "2026-09-01", to: "2026-09-02" },
      tiers,
    )
    assert.deepEqual([filters.series, filters.level, filters.status], ["MIN", "Individual Access", "lapsed"])
    assert.ok(filters.range)
    const odd = rules.readMonitorFilters({ series: "undefined", level: "'; drop table", status: "x" }, tiers)
    assert.deepEqual([odd.filters.series, odd.filters.level, odd.filters.status], ["", "", ""])
  })

  it("reports a range it could not use", () => {
    assert.equal(rules.readMonitorFilters({ from: "2026-09-10", to: "2026-09-01" }, tiers).rangeInvalid, true)
  })

  it("never carries a name or email search in the address bar", () => {
    assert.equal(rules.readMonitorFilters({ q: "someone@example.invalid" }, tiers).filters.q, "")
  })
})

describe("the monitor's words", () => {
  it("names access status, including an active seat past its term", () => {
    assert.equal(rules.accessStatus("active", "2026-12-31", "2026-09-30").label, "Active")
    assert.equal(rules.accessStatus("Active", "2026-09-01", "2026-09-30").label, "Active, term ended")
    assert.equal(rules.accessStatus("Pending", null, "2026-09-30").key, "pending")
  })

  it("shows missing time as unavailable, never zero", () => {
    assert.equal(rules.durationLabel(null), "Unavailable")
    assert.equal(rules.durationLabel(45), "45 s")
    assert.equal(rules.durationLabel(3900), "1 h 5 min")
  })

  it("names direct review access truthfully", () => {
    assert.match(rules.accessRouteLabel("review-edition-link"), /opened directly/)
    assert.doesNotMatch(rules.accessRouteLabel("review-edition-link"), /login|portal/i)
  })

  it("escapes search wildcards", () => {
    assert.equal(rules.likePattern("50%_off"), "%50\\%\\_off%")
    assert.equal(rules.likePattern("   "), null)
  })
})

describe("sessions into one row per exact edition and version", () => {
  const base = {
    title: "Monthly Intelligence Note",
    editionLabel: "MIN",
    durationSeconds: 60,
    totalPages: 20,
    downloaded: false,
    accessRoute: "Portal Data Room link",
  }
  const s = (id, over) => ({ viewId: id, papermarkViewId: id, editionKey: "pm:doc-1", versionNumber: 1, viewedAt: "2026-09-10T10:00:00Z", pages: [], ...base, ...over })

  it("never merges two versions of the same PDF", () => {
    const rows = rules.editionActivity(
      [s("a", { pages: pages([1, 5]) }), s("b", { versionNumber: 2, totalPages: 24, pages: pages([1, 5], [2, 5]), viewedAt: "2026-09-20T10:00:00Z" })],
      [],
    )
    assert.equal(rows.length, 2)
    assert.ok(rows.every((r) => r.otherVersions))
    assert.deepEqual(rows.map((r) => r.versionNumber).sort(), [1, 2])
  })

  it("adds up recorded time, marks partial time, and keeps all-missing time unavailable", () => {
    const [row] = rules.editionActivity([s("a"), s("b", { durationSeconds: null, viewedAt: "2026-09-11T10:00:00Z" })], [])
    assert.equal(row.viewingSeconds, 60)
    assert.equal(row.viewingPartial, true)
    const [none] = rules.editionActivity([s("c", { durationSeconds: null })], [])
    assert.equal(none.viewingSeconds, null)
  })

  it("reports first and latest confirmed view, sessions, and confirmed downloads with their date and count", () => {
    const rows = rules.editionActivity(
      [s("a", { viewedAt: "2026-09-01T09:00:00Z" }), s("b", { viewedAt: "2026-09-05T09:00:00Z" })],
      [
        { sourceEventId: "view:b", papermarkViewId: "b", editionKey: "pm:doc-1", downloadedAt: "2026-09-05T09:10:00Z" },
        { sourceEventId: "view:b", papermarkViewId: "b", editionKey: "pm:doc-1", downloadedAt: "2026-09-05T09:10:00Z" },
      ],
    )
    const [row] = rows
    assert.equal(row.firstViewedAt, "2026-09-01T09:00:00Z")
    assert.equal(row.latestViewedAt, "2026-09-05T09:00:00Z")
    assert.equal(row.sessions, 2)
    assert.deepEqual(row.downloads, { count: 1, latestAt: "2026-09-05T09:10:00Z", downloaded: true })
  })

  it("does not count a download that is not confirmed by Papermark", () => {
    const [row] = rules.editionActivity([s("a")], [])
    assert.equal(row.downloads.downloaded, false)
    assert.equal(row.downloads.count, 0)
  })

  it("treats a page total the sessions disagree on as unknown", () => {
    const [row] = rules.editionActivity([s("a", { pages: pages([1, 2]) }), s("b", { totalPages: 30, pages: pages([2, 2]) })], [])
    assert.equal(row.coverage.available, false)
  })
})
