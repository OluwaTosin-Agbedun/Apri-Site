import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("Papermark client still uses folder-scoped fetch", () => {
  const client = read("src/lib/papermark.ts")

  assert.match(client, /export async function listDocumentsInFolder/)
  assert.match(client, /folderId\.trim\(\)/)
  assert.doesNotMatch(client, /\/v1\/documents\?folder_id=/)
  assert.doesNotMatch(client, /export async function listDocuments\(/)
  assert.doesNotMatch(client, /: '\/v1\/documents'/)
})

test("legacy sync route is retired and returns 410", () => {
  const route = read("src/app/api/admin/papermark/sync/route.ts")
  assert.match(route, /retired/)
  assert.match(route, /410/)
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
