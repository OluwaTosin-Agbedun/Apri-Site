import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { editionsBySeries, newestEdition } from "../src/lib/portal-library.ts"

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("edition dates, not ingestion order, determine Latest and library order", () => {
  const outOfOrder = [
    { id: "new-upload", series: "MIN", editionDate: "2025-01-01" },
    { id: "current", series: "PLM", editionDate: "2026-08-01" },
    { id: "newest", series: "AIU", editionDate: "2026-09-12" },
    { id: "older-uploaded-last", series: "AIU", editionDate: "2024-03-10" },
  ]
  assert.equal(newestEdition(outOfOrder)?.id, "newest")
  assert.deepEqual(
    editionsBySeries(outOfOrder).AIU.map((item) => item.id),
    ["newest", "older-uploaded-last"],
  )
})

test("equal dates have a deterministic id tie-breaker and missing dates sit last", () => {
  const editions = [
    { id: "b", series: "MIN", editionDate: "2026-09-01" },
    { id: "undated", series: "MIN", editionDate: null },
    { id: "a", series: "MIN", editionDate: "2026-09-01" },
  ]
  assert.deepEqual(
    editionsBySeries(editions).MIN.map((item) => item.id),
    ["a", "b", "undated"],
  )
})

test("portal renders one Latest card and all three libraries with mobile-first grids", () => {
  const portal = read("src/app/portal/page.tsx")
  assert.match(portal, /<DataRoomGrid documents=\{\[latest\]\} featured/)
  assert.match(portal, /PORTAL_SERIES\.map/)
  assert.match(portal, /Browse libraries/)
  assert.match(portal, /grid grid-cols-1 md:grid-cols-3/)
})

test("activity comes only from confirmed Papermark view and download rows scoped to subscriber", () => {
  const dal = read("src/lib/papermark-client-library.ts")
  assert.match(dal, /from document_views v/)
  assert.match(dal, /v\.subscriber_id = \$\{subscriberId\}/)
  assert.match(dal, /from document_download_events de/)
  assert.match(dal, /de\.subscriber_id = \$\{subscriberId\}/)
  // Activity is now read once per subscriber and matched to each document in
  // code rather than by a per-row SQL join: a download counts only for that
  // exact Papermark document, and a view for that publication or document.
  assert.match(dal, /select distinct de\.papermark_document_id as key\s+from document_download_events de/)
  assert.match(dal, /downloadedBySubscriber: options\.downloaded\.has\(d\.papermarkDocumentId\)/)
  assert.match(dal, /select distinct coalesce\(v\.publication_id::text, v\.papermark_document_id\) as key\s+from document_views v/)
  assert.match(dal, /viewedBySubscriber: options\.viewed\.has\(d\.papermarkDocumentId\) \|\| \(d\.publicationId !== null && options\.viewed\.has\(d\.publicationId\)\)/)

  const portal = read("src/app/portal/page.tsx")
  // "Viewed" is small text at the bottom right, shown only for a recorded view.
  assert.match(portal, /\{document\.viewedBySubscriber && \(\s*<p className="mt-3 text-right text-\[0\.7rem\] text-muted-foreground">Viewed<\/p>/)
  // The download icon only for a recorded download.
  assert.match(portal, /aria-label="Downloaded by you"/)
  assert.match(portal, /if \(!document\.downloadedBySubscriber\) return null/)
})

test("subscriber cards do not use review links or enable downloads", () => {
  const portal = read("src/app/portal/page.tsx")
  assert.doesNotMatch(portal, /Complimentary Review|secure_link_url/)
  const card = portal.slice(
    portal.indexOf("function DataRoomCard"),
    portal.indexOf("function LegacyDocumentGrid"),
  )
  assert.doesNotMatch(card, /\/download/)
})

test("publishing a paid portal edition requires its editorial date", () => {
  const actions = read("src/app/actions/documents.ts")
  assert.match(actions, /\[.PLM., .MIN., .AIU.\]\.includes\(row\.series\)/)
  assert.match(actions, /Add the edition date before publishing/)
})
