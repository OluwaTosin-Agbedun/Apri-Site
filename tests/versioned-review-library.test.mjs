import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const migration = read(
  "db/migrations/20260922_versioned_review_publications.sql",
)
const workflowMigration = read(
  "db/migrations/20260923_review_publication_edition_workflow.sql",
)
const actions = read("src/app/actions/review-library.ts")
const publications = read("src/lib/publications.ts")
const archivePage = read("src/app/publications/page.tsx")
const home = read("src/app/page.tsx")
const header = read("src/components/SiteHeader.tsx")

test("editions support multiple rows per series but one latest", () => {
  assert.match(migration, /series\s+text not null/)
  assert.match(
    migration,
    /on review_publication_editions \(series\) where is_latest/,
  )
  assert.doesNotMatch(migration, /unique[^;]+\(series\)(?! where is_latest)/s)
})

test("legacy live rows and sync history are backfilled without guessed IDs", () => {
  assert.match(migration, /select ri\.id, ri\.slot_key/)
  assert.match(migration, /from review_sync_candidates c/)
  assert.match(migration, /on conflict \(papermark_document_id\) do nothing/)
})

test("promotion preserves August MIN and an older PLM", () => {
  const fn = migration.slice(
    migration.indexOf("promote_review_publication_edition"),
  )
  assert.match(fn, /set is_latest = false/)
  assert.match(fn, /set publication_state = 'published', is_latest = true/)
  assert.doesNotMatch(fn, /delete from|archive|revoke/i)
})

test("promotion fails closed unless the exact link is verified", () => {
  assert.match(migration, /secure_link_verified_at is null/)
  assert.match(
    migration,
    /secure_link_document_id is distinct from target\.papermark_document_id/,
  )
})

test("public archive returns all published editions deterministically", () => {
  const fn = publications.slice(
    publications.indexOf("getReviewPublicationArchive"),
  )
  assert.match(fn, /publication_state = 'published'/)
  assert.doesNotMatch(fn, /limit 3/)
  assert.match(
    fn,
    /edition_date desc nulls last[\s\S]+edition_order desc[\s\S]+id desc/,
  )
})

test("homepage selects one deterministic latest per series", () => {
  const fn = publications.slice(
    publications.indexOf("getReviewLibrary"),
    publications.indexOf("getReviewPublicationArchive"),
  )
  assert.match(fn, /distinct on \(e\.series\)/)
  assert.match(fn, /e\.is_latest desc/)
  assert.match(fn, /new Set\(items\.map/)
})

test("public review queries never select approved recipients", () => {
  const archive = publications.slice(
    publications.indexOf("getReviewPublicationArchive"),
  )
  assert.match(archive, /select id, title as pub_title/)
  assert.doesNotMatch(archive, /emails:|approvedRecipients/)
})

test("recipient policy applies to every published edition", () => {
  const fn = actions.slice(
    actions.indexOf("applyEmailRestrictions"),
    actions.indexOf("updateSlotPublicationTitle"),
  )
  assert.match(fn, /from review_publication_editions/)
  assert.match(fn, /publication_state = 'published'/)
  assert.doesNotMatch(fn, /is_latest = true/)
})

test("pending candidates can be assigned to populated series", () => {
  const form = read("src/app/admin/review-library/review-form.tsx")
  assert.match(form, /<option>[\s\S]*?MIN[\s\S]*?<\/option>/)
  assert.match(form, /<option>[\s\S]*?AIU[\s\S]*?<\/option>/)
  assert.match(form, /<option>[\s\S]*?PLM[\s\S]*?<\/option>/)
  assert.doesNotMatch(form, /unmappedSlots|SlotCard|fixed slots/i)
  assert.match(actions, /series = \$\{details\.series\}/)
})

test("admin renders one detailed versioned edition interface", () => {
  const page = read("src/app/admin/review-library/page.tsx")
  const form = read("src/app/admin/review-library/review-form.tsx")
  assert.match(page, /from review_publication_editions/)
  assert.doesNotMatch(page, /from complimentary_review_items/)
  for (const text of [
    "Papermark PDF filename",
    "Page count",
    "Mapping status",
    "Last synced",
    "Secure-link ID",
    "Current secure URL",
    "Publication type",
    "Frequency",
    "Audience",
  ])
    assert.match(form, new RegExp(text))
})

test("sync upserts private editions without resetting ignored or published state", () => {
  const fn = actions.slice(
    actions.indexOf("export async function syncReviewLibrary"),
    actions.indexOf("export async function repairMissingMappings"),
  )
  assert.match(fn, /publication_state, is_latest[\s\S]+?'draft', false/)
  assert.match(fn, /on conflict \(papermark_document_id\) do update/)
  assert.doesNotMatch(
    fn.slice(fn.indexOf("on conflict (papermark_document_id) do update")),
    /publication_state\s*=/,
  )
})

test("follow-up migration preserves identifiers while correcting four labels and August metadata", () => {
  assert.match(workflowMigration, /add column if not exists edition_label/)
  assert.match(workflowMigration, /'September 2026'/)
  assert.match(workflowMigration, /'August 2026'/)
  assert.match(workflowMigration, /'Issue 001 \(2026\)'/)
  assert.match(workflowMigration, /'Issue 01 · July 2026'/)
  assert.doesNotMatch(
    workflowMigration,
    /set\s+secure_link_id|set\s+papermark_document_id|delete from/i,
  )
})

test("publishing re-verifies the exact document and recipient policy through Papermark", () => {
  const fn = actions.slice(
    actions.indexOf("async function verifyEditionForPublishing"),
  )
  assert.match(fn, /verifyReviewDocumentLink/)
  assert.match(fn, /expectedDocumentId: rows\[0\]\.papermark_document_id/)
  assert.match(fn, /expectedAllowList: approved/)
})

test("review route remains and navigation omits its old item", () => {
  assert.ok(read("src/app/review/page.tsx").length > 0)
  assert.doesNotMatch(header, /label: "Complimentary Review"/)
})

test("home and archive have separate review invitations", () => {
  for (const source of [home, archivePage]) {
    assert.match(source, /Request Complimentary Review Access/)
    assert.match(source, /href="\/review"/)
  }
})

test("subscriber publications remain separate from review editions", () => {
  assert.match(archivePage, /getPublishedPublications/)
  assert.match(archivePage, /getReviewPublicationArchive/)
  assert.doesNotMatch(
    publications.slice(publications.indexOf("getReviewPublicationArchive")),
    /papermark_link/,
  )
})

test("August MIN recovery reuses the synced PDF and never uploads or duplicates it", () => {
  const fn = actions.slice(
    actions.indexOf("export async function recoverAugustMinEdition"),
    actions.indexOf("export async function publishEditionAsLatest"),
  )
  assert.match(fn, /join review_sync_candidates c/)
  assert.match(fn, /c\.detected_edition_date = '2026-08-01'/)
  assert.match(fn, /c\.papermark_dataroom_id = \$\{roomId\}/)
  assert.match(fn, /documentId: august\.papermark_document_id/)
  assert.doesNotMatch(fn, /upload|insert into review_publication_editions/i)
})

test("August recovery verifies the complete policy before publishing historical", () => {
  const fn = actions.slice(
    actions.indexOf("export async function recoverAugustMinEdition"),
    actions.indexOf("export async function publishEditionAsLatest"),
  )
  assert.match(fn, /expectedDocumentId: august\.papermark_document_id/)
  assert.match(fn, /expectedAllowList: approved/)
  assert.ok(
    fn.indexOf("verifyReviewDocumentLink") <
      fn.indexOf("publication_state = 'published'"),
  )
  assert.match(fn, /is_latest = false/)
  assert.doesNotMatch(
    fn,
    /update complimentary_review_items|series = 'AIU'|series = 'PLM'/,
  )
})

test("Papermark review policy enforces every required August protection", () => {
  const papermark = read("src/lib/papermark-datarooms.ts")
  const policy = papermark.slice(
    papermark.indexOf("function reviewPolicyProblem"),
    papermark.indexOf("function reviewLinkDomain"),
  )
  for (const requirement of [
    /email_protected !== true/,
    /email_authenticated !== true/,
    /allow_download !== false/,
    /enable_watermark !== true/,
    /enable_screenshot_protection !== true/,
    /approved-recipient allow list/,
  ])
    assert.match(policy, requirement)
})
