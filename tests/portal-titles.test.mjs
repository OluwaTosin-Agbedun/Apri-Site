/**
 * Paid portal titles and activity indicators.
 *
 * Titles: Admin → Data Rooms showed documents' renamed Papermark names while
 * the portal kept the titles APRI generated from the old filenames, because a
 * stored editorial title always won. The synced Papermark name is now the
 * title everywhere -- Latest, every library card and the viewer heading --
 * unless an editorial title is explicitly marked as an intentional override.
 *
 * Indicators: "Viewed" is small text at the bottom right, shown only for a view
 * Papermark recorded for this subscriber; the download icon only for a
 * download Papermark recorded for this subscriber and this exact document. A
 * click in the portal is neither.
 */

import { describe, it, test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import {
  syncedDisplayTitle,
  portalDocumentTitle,
  humaniseFilename,
} from "../src/lib/papermark-dataroom-contract.ts"

const ROOT = resolve(import.meta.dirname, "..")
const read = (p) => readFileSync(join(ROOT, p), "utf8")

describe("the synced Papermark name is shown as named", () => {
  it("keeps edition numbers, years in brackets and every word", () => {
    for (const name of [
      "Athena Intelligence Update — Periodic Focused Briefing — Issue 001 (2026)",
      "Athena Political Landscape Monitor Issue 02 August 2026 - Complimentary Review",
      "Athena Political Landscape Monitor Issue 01 July 2026",
      "Quarterly Brief (3)",
      "Board paper final",
    ]) {
      assert.equal(syncedDisplayTitle(name), name)
    }
  })

  it("tidies only presentation: a trailing .pdf and underscores", () => {
    assert.equal(syncedDisplayTitle("Monthly_Intelligence_Note_September_2026.pdf"), "Monthly Intelligence Note September 2026")
    assert.equal(syncedDisplayTitle("  Issue 001  (2026).PDF "), "Issue 001 (2026)")
  })

  it("the old filename rule would have dropped the year -- which is why it is not used for display", () => {
    assert.equal(humaniseFilename("Issue 001 (2026)"), "Issue 001")
    assert.equal(syncedDisplayTitle("Issue 001 (2026)"), "Issue 001 (2026)")
  })
})

describe("which title wins", () => {
  const renamed = "Athena Intelligence Update — Periodic Focused Briefing — Issue 001 (2026)"
  const generated = "Athena Intelligence Update 001 2026 Osun 3"

  it("a title APRI generated from an old filename does not outlive a rename", () => {
    assert.equal(portalDocumentTitle({ syncedName: renamed, editorialTitle: generated, editorialTitleIsOverride: false }), renamed)
    assert.equal(
      portalDocumentTitle({
        syncedName: "Athena Monthly Intelligence Note August 2026 Update - Complimentary Review",
        editorialTitle: "Athena Nigeria Monthly Intelligence Note August 2026 final",
        editorialTitleIsOverride: false,
      }),
      "Athena Monthly Intelligence Note August 2026 Update - Complimentary Review",
    )
  })

  it("an editorial title explicitly marked as an override is kept", () => {
    assert.equal(
      portalDocumentTitle({ syncedName: renamed, editorialTitle: "Osun Governorship Briefing", editorialTitleIsOverride: true }),
      "Osun Governorship Briefing",
    )
  })

  it("an override with no text never blanks a card; nor does a missing Papermark name", () => {
    assert.equal(portalDocumentTitle({ syncedName: renamed, editorialTitle: "  ", editorialTitleIsOverride: true }), renamed)
    assert.equal(portalDocumentTitle({ syncedName: "", editorialTitle: "Fallback title", editorialTitleIsOverride: false }), "Fallback title")
    assert.equal(portalDocumentTitle({ syncedName: "", editorialTitle: null, editorialTitleIsOverride: false }), "Untitled document")
  })
})

describe("every paid surface uses it", () => {
  const library = read("src/lib/papermark-client-library.ts")
  const portal = read("src/app/portal/page.tsx")
  const viewer = read("src/app/portal/document/[id]/page.tsx")

  it("the library list and the single-document lookup both build displayTitle from the synced name", () => {
    // Both now shape documents through one portalDocument(), built from the
    // access policy's record, so displayTitle is made in exactly one place.
    assert.equal((library.match(/displayTitle: portalDocumentTitle\(/g) ?? []).length, 1)
    assert.match(
      library,
      /displayTitle: portalDocumentTitle\(\{ syncedName: d\.fileTitle, editorialTitle: d\.editorialTitle, editorialTitleIsOverride: d\.titleOverride \}\)/,
    )
    const list = library.slice(library.indexOf("export async function getDataRoomDocumentsForSubscriber("), library.indexOf("export async function getDataRoomDocumentForSubscriber("))
    const single = library.slice(library.indexOf("export async function getDataRoomDocumentForSubscriber("), library.indexOf("export function groupDataRoomByCategory("))
    assert.match(list, /portalDocument\(d, /)
    assert.match(single, /portalDocument\(found, /)
    // fileTitle is the synced Papermark name; the publication's title is only the editorial one.
    const dal = read("src/lib/access-policy-dal.ts")
    assert.match(dal, /select dd\.id, dd\.papermark_document_id, dd\.papermark_dataroom_id, dd\.title,/)
    assert.match(dal, /d\.title as editorial_title/)
    assert.match(dal, /fileTitle: \(r\.title as string \| null\) \?\? ""/)
  })

  it("Latest and every library render the same card, which shows displayTitle", () => {
    assert.match(portal, /<PortalSection title="Latest">\s*\{latest \? <DataRoomGrid documents=\{\[latest\]\} featured \/>/)
    assert.match(portal, /<DataRoomGrid documents=\{libraries\[series\]\} \/>/)
    const card = portal.slice(portal.indexOf("function DataRoomCard("), portal.indexOf("function ActivityStatus("))
    assert.match(card, /\{document\.displayTitle\}/)
  })

  it("the viewer heading is the same title", () => {
    assert.match(viewer, /title=\{drResult\.document\.displayTitle\}/)
  })
})

describe("activity indicators", () => {
  const portal = read("src/app/portal/page.tsx")
  const card = portal.slice(portal.indexOf("function DataRoomCard("), portal.indexOf("function LibraryNavigation("))

  it('"Viewed" is small text at the bottom right, only for a recorded view', () => {
    assert.match(card, /\{document\.viewedBySubscriber && \(\s*<p className="mt-3 text-right text-\[0\.7rem\] text-muted-foreground">Viewed<\/p>/)
    assert.doesNotMatch(card, /title="Viewed by you"/, "no eye icon any more")
  })

  it("the download icon needs a recorded download of this exact document", () => {
    assert.match(card, /if \(!document\.downloadedBySubscriber\) return null/)
    const library = read("src/lib/papermark-client-library.ts")
    // Downloads are now read once per subscriber, keyed by Papermark document
    // id, and matched against each document's own id.
    assert.match(library, /select distinct de\.papermark_document_id as key\s+from document_download_events de where de\.subscriber_id = \$\{subscriberId\}::uuid/)
    assert.match(library, /downloadedBySubscriber: options\.downloaded\.has\(d\.papermarkDocumentId\)/)
    assert.doesNotMatch(library, /de\.publication_id/, "a download of another document of the same publication does not count")
  })

  it("views are recorded for this subscriber", () => {
    const library = read("src/lib/papermark-client-library.ts")
    assert.match(library, /from document_views v where v\.subscriber_id = \$\{subscriberId\}::uuid/)
    assert.match(library, /viewedBySubscriber: options\.viewed\.has\(d\.papermarkDocumentId\)/)
  })

  it("views and downloads are written only from Papermark's own events, never from a portal click", () => {
    const writers = ["src/lib/view-attribution.ts"]
    for (const f of [
      "src/components/TrackedAccessLink.tsx",
      "src/app/actions/datarooms.ts",
      "src/app/portal/page.tsx",
      "src/app/portal/document/[id]/page.tsx",
      "src/app/portal/document/[id]/download/route.ts",
      "src/lib/client-engagement.ts",
    ]) {
      assert.doesNotMatch(read(f), /insert into (document_views|document_download_events)/, f)
    }
    for (const f of writers) {
      assert.match(read(f), /insert into document_views/)
      assert.match(read(f), /insert into document_download_events/)
    }
    // The portal's own download click is an engagement event, not a download.
    const click = read("src/app/actions/datarooms.ts")
    const fn = click.slice(click.indexOf("export async function recordPortalDownloadClick"))
    assert.match(fn.slice(0, 900), /insert into client_engagement_events/)
  })

  it("the legacy library follows the same rule", () => {
    assert.match(portal, /function LegacyViewed\(\{ item \}: \{ item: Item \}\) \{\s*if \(!item\.viewedBySubscriber\) return null/)
    assert.doesNotMatch(portal, /◉/)
  })
})

test("Complimentary Review titles are untouched", () => {
  assert.doesNotMatch(read("src/lib/publications.ts"), /portalDocumentTitle|syncedDisplayTitle/)
})

describe("an explicit title override", () => {
  it("is an additive, idempotent migration that starts every publication off", () => {
    const sql = read("db/migrations/20260930_portal_title_override.sql").replace(/--.*$/gm, "")
    assert.match(sql, /add column if not exists portal_title_override boolean not null default false/)
    assert.match(sql, /^begin;$/m)
    assert.match(sql, /^commit;$/m)
    assert.doesNotMatch(sql, /update documents/, "no existing title is marked as an override")
  })

  it("is read only once the migration exists, so the code is safe to deploy first", () => {
    // The portal's documents now come from the access policy's one query,
    // which reads the flag through to_jsonb so it never names a column that
    // may not exist yet, and treats a missing or non-true value as no override.
    const dal = read("src/lib/access-policy-dal.ts")
    assert.match(dal, /coalesce\(\(to_jsonb\(d\) ->> 'portal_title_override'\)::boolean, false\) as title_override/)
    assert.doesNotMatch(dal.replace(/to_jsonb\(d\) ->> 'portal_title_override'/g, ""), /portal_title_override/, "never read as a bare column")
    assert.match(dal, /titleOverride: r\.title_override === true/)
    assert.doesNotMatch(read("src/lib/papermark-client-library.ts"), /portal_title_override/, "the library has no query of its own")
  })

  it("is set only by an administrator's explicit tick, never by saving the form", () => {
    const actions = read("src/app/actions/documents.ts")
    const fn = actions.slice(actions.indexOf("export async function saveDocument("), actions.indexOf("export async function setAutoSync("))
    assert.match(fn, /await requireAdmin\(\)/)
    assert.match(fn, /if \(id && formData\.has\('portalTitleOverrideField'\)\)/)
    assert.match(fn, /const keep = formData\.get\('portalTitleOverride'\) === 'on'/)
    assert.match(fn, /portalTitleOverrideReady\(sql, \{ fresh: true \}\)/)
  })

  it("is offered in the publication editor, and disabled until the migration has run", () => {
    const form = read("src/app/admin/documents/[id]/document-form.tsx")
    assert.match(form, /Show this title to subscribers instead of the document&apos;s Papermark name/)
    assert.match(form, /disabled=\{draft\.portalTitleOverride === null \|\| draft\.portalTitleOverride === undefined\}/)
  })
})
