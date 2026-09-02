/**
 * Complimentary Review Library — regression tests.
 *
 * Covers: owner-only administration, no duplicate publications, one review
 * item per publication, approved descriptions, editing/saving, preserving
 * admin edits, display ordering, enabled/disabled behaviour, and that
 * existing subscriber and public flows remain unchanged.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { prefillReviewCard } from '../src/lib/review-prefill.ts'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// ---------------------------------------------------------------------------
// 1. Owner-only administration
// ---------------------------------------------------------------------------

test('admin: review library page requires owner', () => {
  const src = read('src/app/admin/review-library/page.tsx')
  assert.match(src, /requireOwner/)
})

test('actions: saveReviewLibrarySettings requires owner', () => {
  const src = read('src/app/actions/review-library.ts')
  const fn = src.slice(src.indexOf('async function saveReviewLibrarySettings'))
  assert.match(fn, /requireOwner/)
})

test('actions: addReviewItem requires owner', () => {
  const src = read('src/app/actions/review-library.ts')
  const fn = src.slice(src.indexOf('async function addReviewItem'))
  assert.match(fn, /requireOwner/)
})

test('actions: removeReviewItem requires owner', () => {
  const src = read('src/app/actions/review-library.ts')
  const fn = src.slice(src.indexOf('async function removeReviewItem'))
  assert.match(fn, /requireOwner/)
})

test('actions: reorderReviewItems requires owner', () => {
  const src = read('src/app/actions/review-library.ts')
  const fn = src.slice(src.indexOf('async function reorderReviewItems'))
  assert.match(fn, /requireOwner/)
})

test('actions: saveReviewItemDetails requires owner', () => {
  const src = read('src/app/actions/review-library.ts')
  const fn = src.slice(src.indexOf('async function saveReviewItemDetails'))
  assert.match(fn, /requireOwner/)
})

test('actions: regenerateReviewItemDetails requires owner', () => {
  const src = read('src/app/actions/review-library.ts')
  const fn = src.slice(src.indexOf('async function regenerateReviewItemDetails'))
  assert.match(fn, /requireOwner/)
})

// ---------------------------------------------------------------------------
// 2. No duplicate publication records
// ---------------------------------------------------------------------------

test('schema: complimentary_review_items has unique constraint on publication_id', () => {
  const schema = read('db/schema.sql')
  assert.match(schema, /complimentary_review_items_publication_key/)
  assert.match(schema, /unique index.*complimentary_review_items_publication_key/)
})

test('migration: unique index on publication_id', () => {
  const mig = read('db/migrations/20260902_complimentary_review_library.sql')
  assert.match(mig, /create unique index if not exists complimentary_review_items_publication_key/)
})

// ---------------------------------------------------------------------------
// 3. One review item per publication
// ---------------------------------------------------------------------------

test('actions: addReviewItem checks for existing item before insert', () => {
  const src = read('src/app/actions/review-library.ts')
  const fn = src.slice(src.indexOf('async function addReviewItem'))
  const checkPos = fn.indexOf('select id from complimentary_review_items')
  const insertPos = fn.indexOf('insert into complimentary_review_items')
  assert.ok(checkPos > 0, 'should check for existing item')
  assert.ok(insertPos > checkPos, 'check should precede insert')
})

test('actions: addReviewItem returns message when already added', () => {
  const src = read('src/app/actions/review-library.ts')
  const fn = src.slice(src.indexOf('async function addReviewItem'))
  assert.match(fn, /already in the review library/)
})

// ---------------------------------------------------------------------------
// 4. Automatic approved descriptions
// ---------------------------------------------------------------------------

test('prefill: MIN gets approved Chancellor wording', () => {
  const result = prefillReviewCard({
    title: 'Monthly Intelligence Note',
    series: 'MIN',
    product_line: '',
    frequency: 'Monthly',
    summary: '',
    description: '',
  })
  assert.equal(result.publicationType, 'Monthly Intelligence Note')
  assert.match(result.description, /monthly assessment of Nigeria/)
  assert.equal(result.frequency, 'Monthly')
})

test('prefill: AIU gets approved Chancellor wording', () => {
  const result = prefillReviewCard({
    title: 'Athena Intelligence Update',
    series: 'AIU',
    product_line: '',
    frequency: '',
    summary: '',
    description: '',
  })
  assert.equal(result.publicationType, 'Periodic Focused Briefing')
  assert.match(result.description, /focused intelligence update/)
  assert.equal(result.frequency, 'As developments require')
})

test('prefill: PLM gets approved Chancellor wording', () => {
  const result = prefillReviewCard({
    title: 'Political Landscape Monitor',
    series: 'PLM',
    product_line: '',
    frequency: 'Monthly',
    summary: '',
    description: '',
  })
  assert.equal(result.publicationType, 'Monthly Strategic Assessment')
  assert.match(result.description, /monthly monitoring product/)
  assert.equal(result.frequency, 'Monthly')
})

test('prefill: QIB gets series template', () => {
  const result = prefillReviewCard({
    title: 'Quarterly Intelligence Brief',
    series: 'QIB',
    product_line: '',
    frequency: 'Quarterly',
    summary: '',
    description: '',
  })
  assert.equal(result.publicationType, 'Quarterly Intelligence Brief')
  assert.equal(result.frequency, 'Quarterly')
})

test('prefill: unknown series falls back to publication fields', () => {
  const result = prefillReviewCard({
    title: 'Special Report',
    series: '',
    product_line: 'Custom Line',
    frequency: 'Annual',
    summary: 'A summary',
    description: 'A description',
  })
  assert.equal(result.publicationType, 'Custom Line')
  assert.equal(result.description, 'A description')
  assert.equal(result.frequency, 'Annual')
})

test('prefill: empty series with no product line defaults to Publication', () => {
  const result = prefillReviewCard({
    title: 'Unknown',
    series: '',
    product_line: '',
    frequency: '',
    summary: '',
    description: '',
  })
  assert.equal(result.publicationType, 'Publication')
})

// ---------------------------------------------------------------------------
// 5. Editing and saving generated descriptions
// ---------------------------------------------------------------------------

test('actions: saveReviewItemDetails updates all card fields', () => {
  const src = read('src/app/actions/review-library.ts')
  const fn = src.slice(src.indexOf('async function saveReviewItemDetails'))
  assert.match(fn, /publication_type =/)
  assert.match(fn, /description =/)
  assert.match(fn, /frequency =/)
  assert.match(fn, /audience =/)
})

test('admin form: each item card has editable fields', () => {
  const src = read('src/app/admin/review-library/review-form.tsx')
  assert.match(src, /name="publicationType"/)
  assert.match(src, /name="description"/)
  assert.match(src, /name="frequency"/)
  assert.match(src, /name="audience"/)
})

test('admin form: save card details button exists', () => {
  const src = read('src/app/admin/review-library/review-form.tsx')
  assert.match(src, /Save card details/)
})

// ---------------------------------------------------------------------------
// 6. Preserving administrator changes
// ---------------------------------------------------------------------------

test('actions: regenerateReviewItemDetails requires explicit call and confirmation', () => {
  const src = read('src/app/actions/review-library.ts')
  assert.match(src, /async function regenerateReviewItemDetails/)
  const formSrc = read('src/app/admin/review-library/review-form.tsx')
  assert.match(formSrc, /confirm.*Regenerate/)
})

test('actions: saveReviewItemDetails does not call prefillReviewCard', () => {
  const src = read('src/app/actions/review-library.ts')
  const fn = src.slice(
    src.indexOf('async function saveReviewItemDetails'),
    src.indexOf('async function regenerateReviewItemDetails'),
  )
  assert.doesNotMatch(fn, /prefillReviewCard/)
})

// ---------------------------------------------------------------------------
// 7. Display ordering
// ---------------------------------------------------------------------------

test('actions: reorderReviewItems updates display_order for each item', () => {
  const src = read('src/app/actions/review-library.ts')
  const fn = src.slice(src.indexOf('async function reorderReviewItems'))
  assert.match(fn, /display_order =/)
})

test('admin page: items ordered by display_order', () => {
  const src = read('src/app/admin/review-library/page.tsx')
  assert.match(src, /order by ri\.display_order/)
})

test('public page: items ordered by display_order', () => {
  const src = read('src/app/complimentary-review/page.tsx')
  assert.match(src, /order by ri\.display_order/)
})

test('admin form: reorder section with up/down controls', () => {
  const src = read('src/app/admin/review-library/review-form.tsx')
  assert.match(src, /moveUp/)
  assert.match(src, /moveDown/)
  assert.match(src, /Save order/)
})

// ---------------------------------------------------------------------------
// 8. Enabled/disabled behaviour
// ---------------------------------------------------------------------------

test('public page: returns notFound when library disabled', () => {
  const src = read('src/app/complimentary-review/page.tsx')
  assert.match(src, /notFound/)
  assert.match(src, /review_library_enabled/)
})

test('public page: returns notFound when no Papermark URL set', () => {
  const src = read('src/app/complimentary-review/page.tsx')
  const getLib = src.slice(src.indexOf('async function getReviewLibrary'))
  assert.match(getLib, /if.*!papermarkUrl.*return null/)
})

test('admin page: enabled toggle exists', () => {
  const src = read('src/app/admin/review-library/review-form.tsx')
  assert.match(src, /name="enabled"/)
  assert.match(src, /Enable complimentary review library/)
})

// ---------------------------------------------------------------------------
// 9. Existing subscriber and public flows remain unchanged
// ---------------------------------------------------------------------------

test('publications page: unchanged query for published documents', () => {
  const src = read('src/lib/publications.ts')
  assert.match(src, /is_published = true and status = 'published'/)
  assert.doesNotMatch(src, /complimentary/)
})

test('portal: no reference to complimentary review', () => {
  const portalSrc = read('src/app/portal/page.tsx')
  assert.doesNotMatch(portalSrc, /complimentary/i)
  assert.doesNotMatch(portalSrc, /review.library/i)
})

test('subscriber entitlements: unchanged', () => {
  const src = read('src/lib/entitlements.ts')
  assert.doesNotMatch(src, /complimentary/i)
  assert.doesNotMatch(src, /review.library/i)
})

test('watermark contract: unchanged', () => {
  const src = read('src/lib/papermark-dataroom-contract.ts')
  assert.doesNotMatch(src, /complimentary/i)
})

test('Open editions: open_link_url constraint unchanged', () => {
  const schema = read('db/schema.sql')
  assert.match(schema, /open_link_url is null or visibility = 'OPEN'/)
})

test('documents table: no complimentary column added', () => {
  const schema = read('db/schema.sql')
  const docsSection = schema.slice(
    schema.indexOf('create table if not exists documents'),
    schema.indexOf('create unique index if not exists documents_slug_key'),
  )
  assert.doesNotMatch(docsSection, /complimentary/)
})

// ---------------------------------------------------------------------------
// 10. Migration is idempotent
// ---------------------------------------------------------------------------

test('migration: uses IF NOT EXISTS for table creation', () => {
  const mig = read('db/migrations/20260902_complimentary_review_library.sql')
  assert.match(mig, /create table if not exists complimentary_review_items/)
})

test('migration: uses ON CONFLICT for settings', () => {
  const mig = read('db/migrations/20260902_complimentary_review_library.sql')
  assert.match(mig, /on conflict \(key\) do nothing/)
})

test('migration: uses IF NOT EXISTS for indexes', () => {
  const mig = read('db/migrations/20260902_complimentary_review_library.sql')
  assert.match(mig, /create unique index if not exists/)
  assert.match(mig, /create index if not exists/)
})

// ---------------------------------------------------------------------------
// 11. Review items reference existing documents, not duplicate them
// ---------------------------------------------------------------------------

test('schema: review items reference documents via FK', () => {
  const schema = read('db/schema.sql')
  const section = schema.slice(schema.indexOf('complimentary_review_items'))
  assert.match(section, /references documents \(id\)/)
})

test('actions: addReviewItem looks up existing publication, not creating new', () => {
  const src = read('src/app/actions/review-library.ts')
  const fn = src.slice(src.indexOf('async function addReviewItem'))
  assert.match(fn, /from documents where id =/)
  assert.doesNotMatch(fn, /insert into documents/)
})

// ---------------------------------------------------------------------------
// 12. Page hidden from public navigation
// ---------------------------------------------------------------------------

test('SiteHeader: no link to complimentary review', () => {
  const src = read('src/components/SiteHeader.tsx')
  assert.doesNotMatch(src, /complimentary/i)
})

test('public review page: robots noindex', () => {
  const src = read('src/app/complimentary-review/page.tsx')
  assert.match(src, /index: false/)
  assert.match(src, /follow: false/)
})

// ---------------------------------------------------------------------------
// 13. Public page displays correct structure
// ---------------------------------------------------------------------------

test('public page: shows page title', () => {
  const src = read('src/app/complimentary-review/page.tsx')
  assert.match(src, /APRI Complimentary Review Copy/)
})

test('public page: shows introductory text', () => {
  const src = read('src/app/complimentary-review/page.tsx')
  assert.match(src, /complimentary review page provides selected sample publications/)
})

test('public page: shows verified email badge', () => {
  const src = read('src/app/complimentary-review/page.tsx')
  assert.match(src, /Complimentary Review Copy.*verified email required/)
})

test('public page: access review copy button links to Papermark URL', () => {
  const src = read('src/app/complimentary-review/page.tsx')
  assert.match(src, /href=\{library\.papermarkUrl\}/)
  assert.match(src, /Access review copy/)
})

test('public page: shows publication cards with all required fields', () => {
  const src = read('src/app/complimentary-review/page.tsx')
  assert.match(src, /card\.pubTitle/)
  assert.match(src, /card\.publicationType/)
  assert.match(src, /card\.description/)
  assert.match(src, /card\.frequency/)
  assert.match(src, /card\.audience/)
})

test('public page: all access buttons open same single URL', () => {
  const src = read('src/app/complimentary-review/page.tsx')
  const cardSection = src.slice(src.indexOf('library.items.map'))
  const hrefCount = (cardSection.match(/library\.papermarkUrl/g) || []).length
  assert.equal(hrefCount, 1, 'single papermarkUrl reference inside map')
})

// ---------------------------------------------------------------------------
// 14. Admin nav includes Review Library for owners
// ---------------------------------------------------------------------------

test('AdminShell: Review Library nav item for owners', () => {
  const src = read('src/components/AdminShell.tsx')
  assert.match(src, /\/admin\/review-library/)
  assert.match(src, /Review Library/)
})

// ---------------------------------------------------------------------------
// 15. Settings validation
// ---------------------------------------------------------------------------

test('actions: settings rejects non-https URLs', () => {
  const src = read('src/app/actions/review-library.ts')
  const fn = src.slice(src.indexOf('async function saveReviewLibrarySettings'))
  assert.match(fn, /https:\/\//)
})

test('actions: settings uses app_settings upsert pattern', () => {
  const src = read('src/app/actions/review-library.ts')
  const fn = src.slice(src.indexOf('async function saveReviewLibrarySettings'))
  assert.match(fn, /on conflict \(key\) do update/)
})
