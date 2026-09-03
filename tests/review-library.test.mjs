/**
 * Complimentary Review Library — Phase 2 regression tests.
 *
 * Covers: /complimentary-review removed, admin still owner-only, no public
 * "Open Edition" wording, OPEN cards excluded from public listings,
 * /publications has the Complimentary Review section, card metadata from
 * review items, homepage links to #complimentary-review, secure Papermark
 * access, legacy OPEN detail redirects, paid routes unchanged, config
 * validation, revalidation paths, and no secrets exposed.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

import { prefillReviewCard } from '../src/lib/review-prefill.ts'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const exists = (path) => existsSync(new URL(`../${path}`, import.meta.url))

// ---------------------------------------------------------------------------
// 1. /complimentary-review no longer exists
// ---------------------------------------------------------------------------

test('standalone /complimentary-review route is deleted', () => {
  assert.ok(!exists('src/app/complimentary-review'), 'route directory must not exist')
  assert.ok(!exists('src/app/complimentary-review/page.tsx'), 'page file must not exist')
})

// ---------------------------------------------------------------------------
// 2. /admin/review-library still works and is owner-only
// ---------------------------------------------------------------------------

test('admin: review library page requires owner', () => {
  const src = read('src/app/admin/review-library/page.tsx')
  assert.match(src, /requireOwner/)
})

test('actions: all review library actions require owner', () => {
  const src = read('src/app/actions/review-library.ts')
  const actions = [
    'saveReviewLibrarySettings',
    'saveReviewItemDetails',
    'updateSlotSecureLink',
    'makeVersionCurrent',
    'generateSlotDetails',
  ]
  for (const name of actions) {
    const fn = src.slice(src.indexOf(`async function ${name}`))
    assert.match(fn, /requireOwner/, `${name} must call requireOwner`)
  }
})

// ---------------------------------------------------------------------------
// 3. No public page renders "Open Edition", "Open Editions" or "Access Open Edition"
// ---------------------------------------------------------------------------

test('publications page: no "Open Edition" wording', () => {
  const src = read('src/app/publications/page.tsx')
  assert.doesNotMatch(src, /Open Edition/i)
  assert.doesNotMatch(src, /Open Editions/i)
  assert.doesNotMatch(src, /Access Open Edition/i)
})

test('homepage: no "Open Edition" wording', () => {
  const src = read('src/app/page.tsx')
  assert.doesNotMatch(src, /Open Edition/i)
  assert.doesNotMatch(src, /Open Editions/i)
  assert.doesNotMatch(src, /Access Open Edition/i)
})

test('publication detail page: no "Open Edition" wording', () => {
  const src = read('src/app/publications/[slug]/page.tsx')
  assert.doesNotMatch(src, /Open Edition/i)
  assert.doesNotMatch(src, /Access Open Edition/i)
})

test('PublicationAccess component: no "Open Edition" wording', () => {
  const src = read('src/components/PublicationAccess.tsx')
  assert.doesNotMatch(src, /Open Edition/i)
  assert.doesNotMatch(src, /Access Open Edition/i)
})

test('entitlements accessBadge: OPEN no longer says "Open Edition"', () => {
  const src = read('src/lib/entitlements.ts')
  const fn = src.slice(src.indexOf('function accessBadge'))
  assert.doesNotMatch(fn, /Open Edition/)
  assert.match(fn, /Complimentary Review Copy/)
})

// ---------------------------------------------------------------------------
// 4. Two legacy OPEN edition cards absent from public listings
// ---------------------------------------------------------------------------

test('getPublishedPublications excludes OPEN visibility', () => {
  const src = read('src/lib/publications.ts')
  const fn = src.slice(
    src.indexOf('async function getPublishedPublications'),
    src.indexOf('async function getOpenPublications') !== -1
      ? src.indexOf('async function getOpenPublications')
      : src.indexOf('async function getPublicationBySlug'),
  )
  assert.match(fn, /visibility <> 'OPEN'/)
})

// ---------------------------------------------------------------------------
// 5. /publications contains the Complimentary Review section
// ---------------------------------------------------------------------------

test('publications page: has #complimentary-review anchor', () => {
  const src = read('src/app/publications/page.tsx')
  assert.match(src, /id="complimentary-review"/)
})

test('publications page: shows section title', () => {
  const src = read('src/app/publications/page.tsx')
  assert.match(src, /APRI Complimentary Review Copy/)
})

test('publications page: shows introductory text', () => {
  const src = read('src/app/publications/page.tsx')
  // Chancellor-corrected wording.
  assert.match(src, /This complimentary review provides prospective subscribers with/)
  assert.match(src, /selected examples of publications and analytical products/)
})

test('publications page: shows verified email badge', () => {
  const src = read('src/app/publications/page.tsx')
  assert.match(src, /Complimentary Review Copy.*verified email required/)
})

// ---------------------------------------------------------------------------
// 6. Exactly three active review cards from complimentary_review_items
// ---------------------------------------------------------------------------

test('publications page: renders cards from library.items', () => {
  const src = read('src/app/publications/page.tsx')
  assert.match(src, /library\.items\.map/)
})

test('getReviewLibrary: queries complimentary_review_items with slot_key filter', () => {
  const src = read('src/lib/publications.ts')
  const fn = src.slice(src.indexOf('async function getReviewLibrary'))
  assert.match(fn, /from complimentary_review_items ri/)
  assert.match(fn, /ri\.is_active = true/)
  assert.match(fn, /ri\.slot_key in \('MIN', 'AIU', 'PLM'\)/)
  assert.match(fn, /ri\.secure_link_url <> ''/)
})

test('getReviewLibrary: returns null unless exactly 3 items', () => {
  const src = read('src/lib/publications.ts')
  const fn = src.slice(src.indexOf('async function getReviewLibrary'))
  assert.match(fn, /items\.length !== 3.*return null/)
})

// ---------------------------------------------------------------------------
// 7. Saved display order is respected
// ---------------------------------------------------------------------------

test('getReviewLibrary: orders by display_order', () => {
  const src = read('src/lib/publications.ts')
  const fn = src.slice(src.indexOf('async function getReviewLibrary'))
  assert.match(fn, /order by ri\.display_order/)
})

test('admin page: slots ordered by display_order', () => {
  const src = read('src/app/admin/review-library/page.tsx')
  assert.match(src, /order by.*display_order/)
})

// ---------------------------------------------------------------------------
// 8. Inactive items not displayed
// ---------------------------------------------------------------------------

test('getReviewLibrary: filters by is_active and slot_key', () => {
  const src = read('src/lib/publications.ts')
  const fn = src.slice(src.indexOf('async function getReviewLibrary'))
  assert.match(fn, /ri\.is_active = true/)
  assert.match(fn, /ri\.slot_key in/)
})

// ---------------------------------------------------------------------------
// 9. Card metadata from complimentary_review_items
// ---------------------------------------------------------------------------

test('publications page: cards display all required fields', () => {
  const src = read('src/app/publications/page.tsx')
  assert.match(src, /card\.pubTitle/)
  assert.match(src, /card\.publicationType/)
  assert.match(src, /card\.description/)
  assert.match(src, /card\.frequency/)
  assert.match(src, /card\.audience/)
})

// ---------------------------------------------------------------------------
// 10. Homepage actions lead to /publications#complimentary-review
// ---------------------------------------------------------------------------

test('homepage: review cards link to /publications#complimentary-review', () => {
  const src = read('src/app/page.tsx')
  assert.match(src, /\/publications#complimentary-review/)
})

test('homepage: does not link review cards directly to Papermark', () => {
  const src = read('src/app/page.tsx')
  const reviewSection = src.slice(
    src.indexOf('Complimentary Review preview'),
    src.indexOf('Publications'),
  )
  assert.doesNotMatch(reviewSection, /papermarkUrl/)
  assert.doesNotMatch(reviewSection, /papermark\.com/)
})

// ---------------------------------------------------------------------------
// 11. Single secure Papermark access button on publications page
// ---------------------------------------------------------------------------

test('publications page: has per-card Access review copy button', () => {
  const src = read('src/app/publications/page.tsx')
  assert.match(src, /Access review copy/)
})

test('publications page: each card uses its own secure URL', () => {
  const src = read('src/app/publications/page.tsx')
  assert.match(src, /card\.secureUrl/)
  assert.doesNotMatch(src, /library\.papermarkUrl/)
})

test('publications page: secure area has confidentiality notice', () => {
  const src = read('src/app/publications/page.tsx')
  assert.match(src, /Verified email access is required/)
  assert.match(src, /confidential/)
  assert.match(src, /not for redistribution/)
})

// ---------------------------------------------------------------------------
// 12. Legacy OPEN edition detail URLs redirect
// ---------------------------------------------------------------------------

test('publication detail: OPEN visibility redirects to #complimentary-review', () => {
  const src = read('src/app/publications/[slug]/page.tsx')
  assert.match(src, /visibility === 'OPEN'/)
  assert.match(src, /redirect.*\/publications#complimentary-review/)
})

test('publication detail: non-OPEN publications render normally', () => {
  const src = read('src/app/publications/[slug]/page.tsx')
  const renderSection = src.slice(src.indexOf('return ('))
  assert.match(renderSection, /doc\.title/)
  assert.match(renderSection, /AccessBadge/)
  assert.match(renderSection, /AccessAction/)
})

// ---------------------------------------------------------------------------
// 13. Paid-subscriber routes unchanged
// ---------------------------------------------------------------------------

test('portal: no reference to complimentary review', () => {
  const src = read('src/app/portal/page.tsx')
  assert.doesNotMatch(src, /complimentary/i)
  assert.doesNotMatch(src, /review.library/i)
})

test('subscriber entitlements: unchanged', () => {
  const src = read('src/lib/entitlements.ts')
  assert.doesNotMatch(src, /review.library/i)
})

test('watermark contract: subscriber wording free of review wording', () => {
  // Phase 5.1 added the prospect (Complimentary Review) watermark to this same
  // contract file, which is the right home for it. What must stay true is that
  // the two watermarks never bleed into each other: a paid subscriber's pages
  // must never be stamped as a review copy.
  const src = read('src/lib/papermark-dataroom-contract.ts')

  const subscriberBlock = src.slice(
    src.indexOf('export function subscriberWatermarkText'),
    src.indexOf('// Watermark — Complimentary Review'),
  )
  assert.doesNotMatch(subscriberBlock, /complimentary/i)
  assert.doesNotMatch(subscriberBlock, /Review Copy/)

  const subscriberConfig = src.slice(
    src.indexOf('export function subscriberWatermarkConfig'),
    src.indexOf('export function watermarkConfig'),
  )
  assert.doesNotMatch(subscriberConfig, /complimentary/i)
})

test('subscriber DAL: no reference to complimentary review', () => {
  const src = read('src/lib/subscriber-dal.ts')
  assert.doesNotMatch(src, /complimentary/i)
})

// ---------------------------------------------------------------------------
// 14. Papermark URL not exposed when disabled or invalid
// ---------------------------------------------------------------------------

test('getReviewLibrary: returns null when disabled', () => {
  const src = read('src/lib/publications.ts')
  const fn = src.slice(src.indexOf('async function getReviewLibrary'))
  assert.match(fn, /review_library_enabled/)
  assert.match(fn, /!== 'true'.*return null/)
})

test('getReviewLibrary: returns null unless exactly 3 slots with secure links', () => {
  const src = read('src/lib/publications.ts')
  const fn = src.slice(src.indexOf('async function getReviewLibrary'))
  assert.match(fn, /items\.length !== 3/)
  assert.match(fn, /secure_link_url <> ''/)
})

test('publications page: review section hidden when library is null', () => {
  const src = read('src/app/publications/page.tsx')
  assert.match(src, /\{library &&/)
})

// ---------------------------------------------------------------------------
// 15. Enabling requires valid URL and exactly three active items
// ---------------------------------------------------------------------------

test('actions: enable validation checks all three fixed slots exist', () => {
  const src = read('src/app/actions/review-library.ts')
  const fn = src.slice(src.indexOf('async function saveReviewLibrarySettings'))
  assert.match(fn, /Cannot enable.*three fixed slots/)
  assert.match(fn, /slots\.length !== 3/)
})

test('actions: enable validation checks mapped documents and secure links', () => {
  const src = read('src/app/actions/review-library.ts')
  const fn = src.slice(src.indexOf('async function saveReviewLibrarySettings'))
  assert.match(fn, /no mapped document/)
  assert.match(fn, /no secure link URL/)
})

// ---------------------------------------------------------------------------
// 16. Admin changes revalidate / and /publications
// ---------------------------------------------------------------------------

test('actions: refresh revalidates / and /publications', () => {
  const src = read('src/app/actions/review-library.ts')
  const fn = src.slice(src.indexOf('function refresh'), src.indexOf('// -----'))
  assert.match(fn, /revalidatePath\("\/"\)/)
  assert.match(fn, /revalidatePath\("\/publications"\)/)
})

test('actions: refresh does not revalidate /complimentary-review', () => {
  const src = read('src/app/actions/review-library.ts')
  const fn = src.slice(src.indexOf('function refresh'), src.indexOf('// -----'))
  assert.doesNotMatch(fn, /complimentary-review/)
})

// ---------------------------------------------------------------------------
// 17. No Papermark API token or secret exposed to client
// ---------------------------------------------------------------------------

test('no PAPERMARK_API_KEY in public pages', () => {
  const publicFiles = [
    'src/app/publications/page.tsx',
    'src/app/publications/[slug]/page.tsx',
    'src/app/page.tsx',
    'src/components/PublicationAccess.tsx',
  ]
  for (const file of publicFiles) {
    const src = read(file)
    assert.doesNotMatch(src, /PAPERMARK_API_KEY/)
    assert.doesNotMatch(src, /process\.env\.PAPERMARK/)
  }
})

// ---------------------------------------------------------------------------
// 18. Prefill logic still works (Phase 1 carry-over)
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
  assert.equal(result.publicationType, 'ATHENA ELECTION OBSERVATORY')
  assert.match(result.description, /monthly monitoring publication from the Athena Election Observatory/)
  assert.equal(result.frequency, 'Monthly')
})

// ---------------------------------------------------------------------------
// 19. Schema constraints unchanged
// ---------------------------------------------------------------------------

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
// 20. SiteHeader unchanged
// ---------------------------------------------------------------------------

test('SiteHeader: no link to complimentary review', () => {
  const src = read('src/components/SiteHeader.tsx')
  assert.doesNotMatch(src, /complimentary-review/)
})

// ---------------------------------------------------------------------------
// 21. Admin nav still includes Review Library for owners
// ---------------------------------------------------------------------------

test('AdminShell: Review Library nav item for owners', () => {
  const src = read('src/components/AdminShell.tsx')
  assert.match(src, /\/admin\/review-library/)
  assert.match(src, /Review Library/)
})

// ---------------------------------------------------------------------------
// 22. Unique constraint and idempotent migration remain
// ---------------------------------------------------------------------------

test('schema: unique constraint on publication_id', () => {
  const schema = read('db/schema.sql')
  assert.match(schema, /complimentary_review_items_publication_key/)
})

test('migration: idempotent', () => {
  const mig = read('db/migrations/20260902_complimentary_review_library.sql')
  assert.match(mig, /create table if not exists complimentary_review_items/)
  assert.match(mig, /on conflict \(key\) do nothing/)
})
