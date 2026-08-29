import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("Papermark Fetch has no unfiltered document-list path", () => {
  const client = read("src/lib/papermark.ts")
  const route = read("src/app/api/admin/papermark/sync/route.ts")

  assert.match(client, /export async function listDocumentsInFolder/)
  assert.match(client, /folderId\.trim\(\)/)
  // Not folder_id. Papermark spells this parameter folderId, and sending the
  // snake_case name is what made every folder sync fail input validation with
  // a bare "Papermark returned 422".
  assert.doesNotMatch(client, /\/v1\/documents\?folder_id=/)
  assert.match(client, /\$\{DOCUMENTS_FOLDER_PARAM\}=\$\{encodeURIComponent\(selectedFolderId\)\}/)
  assert.doesNotMatch(client, /export async function listDocuments\(/)
  assert.doesNotMatch(client, /: '\/v1\/documents'/)

  assert.match(route, /PAPERMARK_OPEN_EDITIONS_FOLDER_ID\?\.trim\(\)/)
  assert.match(route, /listDocumentsInFolder\(folderId\)/)
  assert.match(route, /07 Open Editions/)
  assert.doesNotMatch(route, /PAPERMARK_MASTERS_FOLDER_ID|PAPERMARK_FOLDER_0[1-6]_ID/)
})

test("new fetched records are unpublished OPEN drafts with no audience tags", () => {
  const route = read("src/app/api/admin/papermark/sync/route.ts")
  assert.match(
    route,
    /papermark_document_id, papermark_link, audience,[\s\S]*status, is_published, visibility/,
  )
  assert.match(route, /\$\{shareUrl \?\? ''\}, '',[\s\S]*'draft', false, 'OPEN'/)
  assert.doesNotMatch(route, /['"]L2['"]|Individual Access|Professional Access/)
})

test("public list and detail queries require published state and strip non-OPEN links", () => {
  const publications = read("src/lib/publications.ts")

  // Published list and detail queries filter on is_published + status.
  const publishedGuard = /is_published = true and status = 'published'/g
  assert.equal(publications.match(publishedGuard)?.length, 2)

  // Non-OPEN items have their share links stripped by toPublicPublication
  // so they appear as teasers on the public site.
  assert.match(publications, /toPublicPublication/)
  assert.match(publications, /if \(pub\.visibility === 'OPEN'\) return pub/)
  assert.match(publications, /papermarkLink: ''/)

  const listPage = read("src/app/publications/page.tsx")
  const detailPage = read("src/app/publications/[slug]/page.tsx")
  const homePage = read("src/app/page.tsx")
  assert.match(listPage, /getPublishedPublications/)
  assert.match(detailPage, /getPublicationBySlug/)
  assert.match(homePage, /getPublishedPublications/)
})

test("every admin publication row has a confirmed APRI-only delete control", () => {
  const page = read("src/app/admin/documents/page.tsx")
  const controls = read("src/app/admin/documents/row-actions.tsx")
  const actions = read("src/app/actions/documents.ts")

  assert.match(page, /documents\.map/)
  assert.match(page, /<RowActions/)
  assert.match(controls, /window\.confirm/)
  assert.match(controls, /deleteDocument\(id\)/)
  assert.match(controls, /Papermark document and link will not be deleted/)
  assert.match(actions, /admin\.role !== 'owner'/)
  assert.match(actions, /UUID\.test\(id\)/)
  assert.match(actions, /delete from documents where id=\$\{id\}/)
  assert.doesNotMatch(actions, /import .*papermark|listDocumentsInFolder|fetch\(/i)
})

test("publication deletion removes APRI associations without bulk-deleting imports", () => {
  const schema = read("db/schema.sql")
  const action = read("src/app/actions/documents.ts")

  for (const table of ["publication_access", "copy_gap_alerts", "alert_holds"]) {
    assert.match(
      schema,
      new RegExp(`create table if not exists ${table}[\\s\\S]*?references documents \\(id\\) on delete cascade`),
    )
  }
  assert.doesNotMatch(action, /delete from documents where papermark_document_id/i)
  assert.doesNotMatch(action, /delete from documents where title/i)
})
