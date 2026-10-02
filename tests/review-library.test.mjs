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


// The /publications review archive, and everything after it. The archive
// links each edition straight to its own secure link; the separate prospect
// journey (/review) is a call to action outside it.
const archiveSection = (src) => {
  const start = src.indexOf('<section id="review-publications"')
  return src.slice(start, src.indexOf('</section>', start))
}
const afterArchive = (src) => src.slice(src.indexOf('</section>', src.indexOf('<section id="review-publications"')))

const enableGate = (src) =>
  src.slice(src.indexOf('export async function saveReviewLibrarySettings'), src.indexOf('export async function fetchAvailableReviewDataRooms'))

// The body of review-library.ts's refresh(), up to its own closing brace. (The
// old slices ran to the first "// -----" in the file, which now comes before
// the function, so they checked an empty string.)
const refreshBody = (src) => {
  const start = src.indexOf('function refresh()')
  return src.slice(start, src.indexOf('\n}', start) + 2)
}

test('publications page: the review archive has its own anchor', () => {
  // The versioned archive replaced the three-card section and its
  // #complimentary-review anchor.
  const src = read('src/app/publications/page.tsx')
  assert.match(src, /<section id="review-publications"/)
})

test('publications page: shows section title', () => {
  const src = read('src/app/publications/page.tsx')
  assert.match(archiveSection(src), /Review Publication Archive/)
})

test('publications page: shows introductory text', { todo: "The Chancellor-approved introduction was removed from the site in 61cd5ee (PR #28, versioned library). Restore it, or confirm the current wording is approved, then update this test." }, () => {
  const src = read('src/app/publications/page.tsx')
  // Chancellor-corrected wording.
  assert.match(src, /This complimentary review provides prospective subscribers with/)
  assert.match(src, /selected examples of publications and analytical products/)
})

test('publications page: shows verified email badge', () => {
  const src = read('src/app/publications/page.tsx')
  assert.match(archiveSection(src), /Verified email required · Confidential/)
})

// ---------------------------------------------------------------------------
// 6. Exactly three active review cards from complimentary_review_items
// ---------------------------------------------------------------------------

test('publications page: renders every archived edition, grouped by series', () => {
  const src = read('src/app/publications/page.tsx')
  assert.match(src, /\(\["MIN", "AIU", "PLM"\] as const\)\.map\(\(series\) =>/)
  assert.match(src, /archive\.filter\(\(item\) => item\.slotKey === series\)/)
  assert.match(src, /\{cards\.map\(\(card\) => \(/)
})

// The three tests below replace ones written for complimentary_review_items.
// getReviewLibrary now reads the versioned edition library (and, since this
// release, has a pre-migration form), so each asserts the same rule on it.
const reviewLibraryFn = () => {
  const src = read('src/lib/publications.ts')
  return src.slice(
    src.indexOf('async function getReviewLibrary'),
    src.indexOf('export async function getReviewPublicationArchive'),
  )
}

test('getReviewLibrary: one published edition per series, from the versioned library', () => {
  const fn = reviewLibraryFn()
  // Once the withdrawal migration has run: only the edition each series offers.
  assert.match(fn, /from review_publication_editions e\s+where e\.complimentary_featured\s+and e\.publication_state = 'published'/)
  // Before it: each series' latest published edition, as always.
  assert.equal((fn.match(/select distinct on \(e\.series\)/g) ?? []).length, 2)
  assert.equal((fn.match(/from review_publication_editions e\s+where e\.publication_state = 'published'/g) ?? []).length, 2)
  assert.equal((fn.match(/e\.secure_link_url <> ''/g) ?? []).length, 3)
  assert.doesNotMatch(fn, /complimentary_review_items/)
})

test('getReviewLibrary: returns null only when no series has a card', () => {
  const src = read('src/lib/publications.ts')
  const fn = src.slice(src.indexOf('async function getReviewLibrary'), src.indexOf('export async function getReviewPublicationArchive'))
  assert.match(fn, /if \(cards\.length === 0\) return null/)
  assert.doesNotMatch(fn, /items\.length !== 3/)
})

// ---------------------------------------------------------------------------
// 7. Saved display order is respected
// ---------------------------------------------------------------------------

test('getReviewLibrary: each series shows its latest edition first', () => {
  const fn = reviewLibraryFn()
  assert.equal((fn.match(/order by e\.series, e\.is_latest desc, e\.edition_date desc nulls last/g) ?? []).length, 2)
})

test('admin page: editions ordered by series, then the owner\'s order, then latest first', () => {
  const src = read('src/app/admin/review-library/page.tsx')
  // An owner's arrangement (Order on the Publications page) comes first
  // within each series; without one, the latest edition leads as before.
  assert.match(src, /order by case e\.series when 'MIN' then 1 when 'AIU' then 2 when 'PLM' then 3 else 4 end,\s+\(to_jsonb\(e\) ->> 'display_position'\)::int asc nulls last,\s+e\.is_latest desc, e\.edition_sort_key desc/)
})

// ---------------------------------------------------------------------------
// 8. Inactive items not displayed
// ---------------------------------------------------------------------------

test('getReviewLibrary: each series stands alone, with no older substitute', () => {
  const fn = reviewLibraryFn()
  // A series that is missing or not ready drops only its own card; the choice
  // per series is made in SQL and the readiness check applied to it after.
  assert.match(fn, /const cards = selectOfferedCards\(/)
  assert.match(fn, /accessConfigured: item\.access_configured/)
  assert.doesNotMatch(fn, /requiredSlots/)
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
// 10. Homepage direct access and separate prospect action
// ---------------------------------------------------------------------------

test('homepage: review cards link to their corresponding secure URLs', () => {
  const src = read('src/app/page.tsx')
  // Library mode: the Review Library with this edition chosen (APRI's code
  // first). Papermark mode: the edition's own stored link.
  assert.match(src, /href=\{entryMode === "library" \? `\/review\/library\?edition=\$\{card\.id\}` : card\.secureUrl\}/)
  assert.doesNotMatch(src, /entryMode === "rooms"|"\/review\/read"/, 'no card leads to the retired rooms entry')
  assert.match(src, /slotKey=\{card\.slotKey\}/)
  assert.match(src, /Access review copy &rarr;/)
  assert.match(src, /newTab/)
})

test('homepage: keeps /review as a separate prospect CTA', () => {
  const src = read('src/app/page.tsx')
  const cards = src.slice(src.indexOf('{reviewLibrary && ('), src.indexOf('View all editions'))
  const cta = src.slice(src.indexOf('<aside', src.indexOf('View all editions')), src.indexOf('</aside>', src.indexOf('View all editions')))
  assert.ok(cards.length > 0 && cta.length > 0)
  assert.doesNotMatch(cards, /href="\/review"/, 'review cards never route to /review')
  assert.match(cta, /href="\/review"/)
  assert.match(cta, /Request Complimentary Review Access/)
})

// ---------------------------------------------------------------------------
// 11. Single secure Papermark access button on publications page
// ---------------------------------------------------------------------------

test('publications page: has per-card review access button', () => {
  const src = read('src/app/publications/page.tsx')
  assert.match(src, /Access review copy/)
})

test('publications page: uses separate secure URLs and never routes cards to /review', () => {
  const src = read('src/app/publications/page.tsx')
  const archive = archiveSection(src)
  assert.match(archive, /href=\{entryMode === "library" \? `\/review\/library\?edition=\$\{card\.id\}` : card\.secureUrl\}/)
  assert.doesNotMatch(archive, /entryMode === "rooms"|"\/review\/read"/, 'no card leads to the retired rooms entry')
  assert.match(archive, /key=\{card\.id\}/)
  assert.doesNotMatch(archive, /href="\/review"/)
  assert.doesNotMatch(src, /library\.papermarkUrl/)
  assert.match(afterArchive(src), /href="\/review"/, 'the prospect journey is its own call to action')
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
  assert.match(fn, /!== ["']true["'].*return null/)
})

test('getReviewLibrary: hides the section only when no series has a verified edition to offer', () => {
  const src = read('src/lib/publications.ts')
  const fn = src.slice(src.indexOf('async function getReviewLibrary'), src.indexOf('export async function getReviewPublicationArchive'))
  assert.match(fn, /secure_link_url <> ''/)
  assert.match(fn, /if \(cards\.length === 0\) return null/)
})

test('publications page: review section hidden when there is nothing to list', () => {
  const src = read('src/app/publications/page.tsx')
  assert.match(src, /\{archive\.length > 0 && \(\s*<section id="review-publications"/)
})

// ---------------------------------------------------------------------------
// 15. Enabling requires valid URL and exactly three active items
// ---------------------------------------------------------------------------

test('actions: enabling needs one series with a verified edition, not all three', () => {
  const fn = enableGate(read('src/app/actions/review-library.ts'))
  assert.match(fn, /Cannot enable: no series has a verified edition to offer\./)
  assert.match(fn, /offered = FIXED_SLOTS\.filter\(\(series\) => present\.has\(series\)\)/)
})

test('actions: enabling counts only verified links to the exact document', () => {
  const fn = enableGate(read('src/app/actions/review-library.ts'))
  // Both forms: the offered edition, and before the withdrawal migration the latest.
  assert.equal((fn.match(/secure_link_url <> '' and secure_link_verified_at is not null/g) ?? []).length, 2)
  assert.equal((fn.match(/and secure_link_document_id = papermark_document_id/g) ?? []).length, 2)
})

// ---------------------------------------------------------------------------
// 16. Admin changes revalidate / and /publications
// ---------------------------------------------------------------------------

test('actions: refresh revalidates / and /publications', () => {
  const fn = refreshBody(read('src/app/actions/review-library.ts'))
  assert.match(fn, /revalidatePath\("\/"\)/)
  assert.match(fn, /revalidatePath\("\/publications"\)/)
})

test('actions: refresh does not revalidate /complimentary-review', () => {
  const fn = refreshBody(read('src/app/actions/review-library.ts'))
  assert.ok(fn.length > 0)
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
