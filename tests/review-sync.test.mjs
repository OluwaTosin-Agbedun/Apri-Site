/**
 * Complimentary Review Library — Phase 3 regression tests.
 *
 * Covers: Data Room configuration, document sync, classification,
 * owner-edit preservation, candidate workflow, room warnings, cron
 * isolation, legacy retirement, public display requirements, and
 * security constraints.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

import {
  classifyReviewDocument,
  generateReviewMetadata,
  cleanFilename,
  parseReviewEditionDate,
  isReviewSeries,
  SUPPORTED_SERIES,
} from '../src/lib/review-classify.ts'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const exists = (path) => existsSync(new URL(`../${path}`, import.meta.url))

// ---------------------------------------------------------------------------
// 1. Only the configured Complimentary Review Data Room is queried
// ---------------------------------------------------------------------------

test('sync action: reads Data Room ID from app_settings', () => {
  const src = read('src/app/actions/review-library.ts')
  const fn = src.slice(src.indexOf('async function syncReviewLibrary'))
  assert.match(fn, /review_library_papermark_dataroom_id/)
  assert.match(fn, /listDataRoomDocuments/)
})

test('sync action: requires Data Room to be configured', () => {
  const src = read('src/app/actions/review-library.ts')
  const fn = src.slice(src.indexOf('async function syncReviewLibrary'))
  assert.match(fn, /No Complimentary Review Data Room configured/)
})

// ---------------------------------------------------------------------------
// 2. The public share URL is not treated as the Data Room ID
// ---------------------------------------------------------------------------

test('admin page: stores Data Room ID separately from public URL', () => {
  const src = read('src/app/admin/review-library/page.tsx')
  assert.match(src, /review_library_papermark_dataroom_id/)
  assert.match(src, /review_library_papermark_url/)
})

test('actions: saveReviewDataRoom is separate from saveReviewLibrarySettings', () => {
  const src = read('src/app/actions/review-library.ts')
  assert.match(src, /async function saveReviewDataRoom/)
  assert.match(src, /async function saveReviewLibrarySettings/)
})

// ---------------------------------------------------------------------------
// 3. MIN, AIU and PLM filename variants classify correctly
// ---------------------------------------------------------------------------

test('classify: Monthly Intelligence Note → MIN', () => {
  const r = classifyReviewDocument('Nigeria Political & Regulatory Environment — Monthly Intelligence Note June 2026.pdf')
  assert.equal(r.series, 'MIN')
})

test('classify: MIN code → MIN', () => {
  const r = classifyReviewDocument('MIN-2026-06 Nigeria Monthly Intelligence Note.pdf')
  assert.equal(r.series, 'MIN')
})

test('classify: Nigeria Monthly Intelligence Note → MIN', () => {
  const r = classifyReviewDocument('Nigeria Monthly Intelligence Note — June 2026')
  assert.equal(r.series, 'MIN')
})

test('classify: Athena Intelligence Update → AIU', () => {
  const r = classifyReviewDocument('Athena Intelligence Update — Special Report August 2026.pdf')
  assert.equal(r.series, 'AIU')
})

test('classify: AIU code → AIU', () => {
  const r = classifyReviewDocument('AIU-2026-08 Athena Intelligence Update')
  assert.equal(r.series, 'AIU')
})

test('classify: Periodic Focused Briefing → AIU', () => {
  const r = classifyReviewDocument('Periodic Focused Briefing — September 2026.pdf')
  assert.equal(r.series, 'AIU')
})

test('classify: Political Landscape Monitor → PLM', () => {
  const r = classifyReviewDocument('Political Landscape Monitor — June 2026.pdf')
  assert.equal(r.series, 'PLM')
})

test('classify: PLM code → PLM', () => {
  const r = classifyReviewDocument('PLM-2026-06 Political Landscape Monitor')
  assert.equal(r.series, 'PLM')
})

test('classify: Monthly Strategic Assessment → PLM', () => {
  const r = classifyReviewDocument('Monthly Strategic Assessment — Q2 2026.pdf')
  assert.equal(r.series, 'PLM')
})

test('classify: Complimentary Review Copy variant → still classifies', () => {
  const r = classifyReviewDocument('Nigeria Political & Regulatory Environment Complimentary Review Copy June 2026.pdf')
  assert.equal(r.series, 'MIN')
})

test('classify: underscores and dashes → still classifies', () => {
  const r = classifyReviewDocument('Political_Landscape_Monitor-June-2026.pdf')
  assert.equal(r.series, 'PLM')
})

// ---------------------------------------------------------------------------
// 4. Unsupported files remain unrecognised
// ---------------------------------------------------------------------------

test('classify: unknown file → null series', () => {
  const r = classifyReviewDocument('Company Annual Report 2026.pdf')
  assert.equal(r.series, null)
})

test('classify: empty filename → null series', () => {
  const r = classifyReviewDocument('')
  assert.equal(r.series, null)
})

test('classify: QIB is not a review series', () => {
  const r = classifyReviewDocument('QIB-2026-Q2 Quarterly Intelligence Brief.pdf')
  assert.equal(r.series, null)
})

// ---------------------------------------------------------------------------
// 5. Repeated syncs do not create duplicates
// ---------------------------------------------------------------------------

test('sync: upserts by papermark_document_id', () => {
  const src = read('src/app/actions/review-library.ts')
  const fn = src.slice(src.indexOf('async function syncReviewLibrary'))
  assert.match(fn, /where papermark_document_id =/)
  assert.match(fn, /on conflict \(papermark_document_id\) do nothing/)
})

// ---------------------------------------------------------------------------
// 6. Existing three files can be mapped to existing three cards
// ---------------------------------------------------------------------------

test('actions: mapCandidateToCard stores papermark_document_id on review item', () => {
  const src = read('src/app/actions/review-library.ts')
  const fn = src.slice(src.indexOf('async function mapCandidateToCard'))
  assert.match(fn, /papermark_document_id/)
  assert.match(fn, /complimentary_review_items/)
})

// ---------------------------------------------------------------------------
// 7. Paid-publication Papermark IDs are never overwritten
// ---------------------------------------------------------------------------

test('sync: does not touch paid subscriber tables', () => {
  const src = read('src/app/actions/review-library.ts')
  assert.doesNotMatch(src, /papermark_dataroom_documents/)
  assert.doesNotMatch(src, /papermark_dataroom_links/)
  assert.doesNotMatch(src, /papermark_subscriber_document_links/)
})

// ---------------------------------------------------------------------------
// 8. Sync does not create duplicate documents rows
// ---------------------------------------------------------------------------

test('sync: only writes to review_sync_candidates, not documents', () => {
  const src = read('src/app/actions/review-library.ts')
  const fn = src.slice(src.indexOf('async function syncReviewLibrary'))
  assert.match(fn, /review_sync_candidates/)
  assert.doesNotMatch(fn, /insert into documents/)
})

// ---------------------------------------------------------------------------
// 9. Generated metadata uses Chancellor-approved descriptions
// ---------------------------------------------------------------------------

test('metadata: MIN gets approved description', () => {
  const meta = generateReviewMetadata('MIN', 'Monthly Intelligence Note June 2026.pdf')
  assert.equal(meta.publicationType, 'Monthly Intelligence Note')
  assert.match(meta.description, /monthly assessment of Nigeria/)
  assert.equal(meta.frequency, 'Monthly')
})

test('metadata: AIU gets approved description', () => {
  const meta = generateReviewMetadata('AIU', 'Athena Intelligence Update August 2026.pdf')
  assert.equal(meta.publicationType, 'Periodic Focused Briefing')
  assert.match(meta.description, /focused intelligence update/)
  assert.equal(meta.frequency, 'As developments require')
})

test('metadata: PLM gets approved description', () => {
  const meta = generateReviewMetadata('PLM', 'Political Landscape Monitor June 2026.pdf')
  assert.equal(meta.publicationType, 'Monthly Strategic Assessment')
  assert.match(meta.description, /monthly monitoring product/)
  assert.equal(meta.frequency, 'Monthly')
})

// ---------------------------------------------------------------------------
// 10. Owner edits survive later syncs
// ---------------------------------------------------------------------------

test('actions: saveReviewItemDetails records owner_edited_fields', () => {
  const src = read('src/app/actions/review-library.ts')
  const fn = src.slice(src.indexOf('async function saveReviewItemDetails'))
  assert.match(fn, /owner_edited_fields/)
  assert.match(fn, /editedFields/)
})

test('actions: approveCandidateReplacement preserves owner-edited fields', () => {
  const src = read('src/app/actions/review-library.ts')
  const fn = src.slice(src.indexOf('async function approveCandidateReplacement'))
  assert.match(fn, /owner_edited_fields/)
  assert.match(fn, /edited\.has/)
})

// ---------------------------------------------------------------------------
// 11. Regeneration requires confirmation
// ---------------------------------------------------------------------------

test('admin form: regenerate shows confirmation dialog', () => {
  const src = read('src/app/admin/review-library/review-form.tsx')
  assert.match(src, /window\.confirm.*Regenerate/)
})

test('actions: regenerate clears owner_edited_fields', () => {
  const src = read('src/app/actions/review-library.ts')
  const fn = src.slice(src.indexOf('async function regenerateReviewItemDetails'))
  assert.match(fn, /owner_edited_fields = '\{}'/)
})

// ---------------------------------------------------------------------------
// 12. New documents become pending candidates
// ---------------------------------------------------------------------------

test('sync: new documents get sync_status pending', () => {
  const src = read('src/app/actions/review-library.ts')
  const fn = src.slice(src.indexOf('async function syncReviewLibrary'))
  assert.match(fn, /'pending'/)
})

// ---------------------------------------------------------------------------
// 13. Candidates never publish automatically
// ---------------------------------------------------------------------------

test('sync: does not revalidate public pages', () => {
  const src = read('src/app/actions/review-library.ts')
  const bgFn = src.slice(src.indexOf('async function backgroundReviewSync'))
  assert.doesNotMatch(bgFn, /revalidatePath/)
})

test('background sync: never calls approveCandidateReplacement', () => {
  const src = read('src/app/actions/review-library.ts')
  const bgFn = src.slice(src.indexOf('async function backgroundReviewSync'))
  assert.doesNotMatch(bgFn, /approveCandidateReplacement/)
  assert.doesNotMatch(bgFn, /approve/)
})

// ---------------------------------------------------------------------------
// 14. Approval replaces only the matching series
// ---------------------------------------------------------------------------

test('actions: approval targets specific series', () => {
  const src = read('src/app/actions/review-library.ts')
  const fn = src.slice(src.indexOf('async function approveCandidateReplacement'))
  assert.match(fn, /d\.series = \$\{series\}/)
  assert.match(fn, /ri\.is_active = true/)
})

// ---------------------------------------------------------------------------
// 15. Exactly three active cards remain (validation)
// ---------------------------------------------------------------------------

test('enable validation: requires exactly three active items', () => {
  const src = read('src/app/actions/review-library.ts')
  const fn = src.slice(src.indexOf('async function saveReviewLibrarySettings'))
  assert.match(fn, /exactly three active review items/)
  assert.match(fn, /!== 3/)
})

// ---------------------------------------------------------------------------
// 16. Room-count warnings appear
// ---------------------------------------------------------------------------

test('admin form: room warnings component exists', () => {
  const src = read('src/app/admin/review-library/review-form.tsx')
  assert.match(src, /function RoomWarnings/)
  assert.match(src, /roomDocCount/)
})

test('admin form: warns when fewer than 3 documents', () => {
  const src = read('src/app/admin/review-library/review-form.tsx')
  assert.match(src, /roomDocCount < 3/)
})

test('admin form: warns when more than 3 documents', () => {
  const src = read('src/app/admin/review-library/review-form.tsx')
  assert.match(src, /roomDocCount > 3/)
})

test('admin form: warns about unrecognised documents', () => {
  const src = read('src/app/admin/review-library/review-form.tsx')
  assert.match(src, /unrecognised/)
})

test('admin form: warns about duplicate series', () => {
  const src = read('src/app/admin/review-library/review-form.tsx')
  assert.match(src, /duplicateSeries/)
})

test('admin form: shows room safety message', () => {
  const src = read('src/app/admin/review-library/review-form.tsx')
  assert.match(src, /This Papermark link shares the entire Data Room/)
})

// ---------------------------------------------------------------------------
// 17. No Papermark file is deleted or moved
// ---------------------------------------------------------------------------

test('sync: never calls Papermark delete or move', () => {
  const src = read('src/app/actions/review-library.ts')
  assert.doesNotMatch(src, /revokeDataRoomLink/)
  assert.doesNotMatch(src, /deleteDocument/)
  assert.doesNotMatch(src, /moveDocument/)
})

// ---------------------------------------------------------------------------
// 18. Scheduled sync never approves or emails
// ---------------------------------------------------------------------------

test('cron: calls backgroundReviewSync', () => {
  const src = read('src/app/api/cron/dataroom-sync/route.ts')
  assert.match(src, /backgroundReviewSync/)
})

test('background sync: never sends email', () => {
  const src = read('src/app/actions/review-library.ts')
  const bgFn = src.slice(src.indexOf('async function backgroundReviewSync'))
  assert.doesNotMatch(bgFn, /send.*[Ee]mail/)
  assert.doesNotMatch(bgFn, /sendEditionAlert/)
  assert.doesNotMatch(bgFn, /Resend/)
})

// ---------------------------------------------------------------------------
// 19. Review-sync errors do not break paid Data Room sync
// ---------------------------------------------------------------------------

test('cron: isolates review sync errors from paid sync', () => {
  const src = read('src/app/api/cron/dataroom-sync/route.ts')
  const fnBody = src.slice(src.indexOf('async function GET'))
  assert.match(fnBody, /reconcileAllDataRooms/)
  assert.match(fnBody, /backgroundReviewSync/)
  // Both wrapped in separate try/catch
  const tryCount = (fnBody.match(/try \{/g) || []).length
  assert.ok(tryCount >= 2, `Expected at least 2 try blocks, got ${tryCount}`)
})

// ---------------------------------------------------------------------------
// 20. Legacy 07 Open Editions Fetch UI/process is retired
// ---------------------------------------------------------------------------

test('sync panel: no "07 Open Editions" wording', () => {
  const src = read('src/app/admin/documents/sync-panel.tsx')
  assert.doesNotMatch(src, /07 Open Editions/)
  assert.doesNotMatch(src, /Fetch from Papermark/)
})

test('sync panel: directs to Review Library', () => {
  const src = read('src/app/admin/documents/sync-panel.tsx')
  assert.match(src, /Sync Complimentary Review Library/)
  assert.match(src, /\/admin\/review-library/)
})

test('sync route: returns 410 Gone', () => {
  const src = read('src/app/api/admin/papermark/sync/route.ts')
  assert.match(src, /410/)
  assert.match(src, /retired/)
})

test('admin documents page: no "Open editions" in description', () => {
  const src = read('src/app/admin/documents/page.tsx')
  const shell = src.slice(src.indexOf('<AdminShell'), src.indexOf('</AdminShell>'))
  assert.doesNotMatch(shell, /Open editions/)
})

// ---------------------------------------------------------------------------
// 21. /complimentary-review remains absent
// ---------------------------------------------------------------------------

test('standalone /complimentary-review route still absent', () => {
  assert.ok(!exists('src/app/complimentary-review'), 'route directory must not exist')
})

// ---------------------------------------------------------------------------
// 22. No public route is added
// ---------------------------------------------------------------------------

test('no new public route for review sync', () => {
  assert.ok(!exists('src/app/api/review-sync'), 'no public review sync API')
  assert.ok(!exists('src/app/review-library'), 'no public review library page')
})

// ---------------------------------------------------------------------------
// 23. Papermark API token and internal IDs never exposed publicly
// ---------------------------------------------------------------------------

test('no secrets in public pages', () => {
  const publicFiles = [
    'src/app/publications/page.tsx',
    'src/app/publications/[slug]/page.tsx',
    'src/app/page.tsx',
    'src/components/PublicationAccess.tsx',
  ]
  for (const file of publicFiles) {
    const src = read(file)
    assert.doesNotMatch(src, /PAPERMARK_API_KEY/)
    assert.doesNotMatch(src, /PAPERMARK_API_TOKEN/)
    assert.doesNotMatch(src, /process\.env\.PAPERMARK/)
    assert.doesNotMatch(src, /papermark_document_id/)
    assert.doesNotMatch(src, /review_sync_candidates/)
  }
})

test('review-classify.ts has no server dependencies', () => {
  const src = read('src/lib/review-classify.ts')
  assert.doesNotMatch(src, /server-only/)
  assert.doesNotMatch(src, /import.*from.*db/)
  assert.doesNotMatch(src, /process\.env/)
})

// ---------------------------------------------------------------------------
// 24. / and /publications are revalidated only after approved public change
// ---------------------------------------------------------------------------

test('refresh revalidates / and /publications', () => {
  const src = read('src/app/actions/review-library.ts')
  const fn = src.slice(src.indexOf('function refresh'), src.indexOf('// -----'))
  assert.match(fn, /revalidatePath\("\/"\)/)
  assert.match(fn, /revalidatePath\("\/publications"\)/)
})

test('background sync does not revalidate public paths', () => {
  const src = read('src/app/actions/review-library.ts')
  const bgFn = src.slice(src.indexOf('async function backgroundReviewSync'))
  assert.doesNotMatch(bgFn, /revalidatePath/)
})

// ---------------------------------------------------------------------------
// 25. Migration is additive and idempotent
// ---------------------------------------------------------------------------

test('migration: review_sync_candidates uses IF NOT EXISTS', () => {
  const mig = read('db/migrations/20260902_review_sync.sql')
  assert.match(mig, /create table if not exists review_sync_candidates/)
})

test('migration: indexes use IF NOT EXISTS', () => {
  const mig = read('db/migrations/20260902_review_sync.sql')
  assert.match(mig, /create unique index if not exists review_sync_candidates_pmk_doc_key/)
  assert.match(mig, /create index if not exists review_sync_candidates_series_idx/)
})

test('migration: alter table uses IF NOT EXISTS', () => {
  const mig = read('db/migrations/20260902_review_sync.sql')
  assert.match(mig, /add column if not exists papermark_document_id text/)
  assert.match(mig, /add column if not exists papermark_dataroom_id text/)
  assert.match(mig, /add column if not exists last_synced_at timestamptz/)
  assert.match(mig, /add column if not exists owner_edited_fields text/)
})

test('migration: settings use ON CONFLICT DO NOTHING', () => {
  const mig = read('db/migrations/20260902_review_sync.sql')
  const settingInserts = mig.match(/on conflict \(key\) do nothing/g) || []
  assert.ok(settingInserts.length >= 3, `Expected at least 3 ON CONFLICT DO NOTHING, got ${settingInserts.length}`)
})

// ---------------------------------------------------------------------------
// 26. Classification helpers
// ---------------------------------------------------------------------------

test('cleanFilename: strips .pdf extension', () => {
  assert.equal(cleanFilename('Document.pdf'), 'Document')
})

test('cleanFilename: strips Complimentary Review Copy', () => {
  const result = cleanFilename('MIN June 2026 Complimentary Review Copy.pdf')
  assert.doesNotMatch(result, /Complimentary Review Copy/i)
})

test('cleanFilename: strips copy indicators', () => {
  assert.equal(cleanFilename('Document (1).pdf'), 'Document')
})

test('parseReviewEditionDate: Month YYYY', () => {
  assert.equal(parseReviewEditionDate('Monthly Intelligence Note June 2026'), '2026-06-01')
})

test('parseReviewEditionDate: YYYY MM', () => {
  assert.equal(parseReviewEditionDate('MIN 2026 08'), '2026-08-01')
})

test('parseReviewEditionDate: abbreviated month', () => {
  assert.equal(parseReviewEditionDate('PLM Sep 2026'), '2026-09-01')
})

test('parseReviewEditionDate: no date → null', () => {
  assert.equal(parseReviewEditionDate('Unknown document'), null)
})

test('isReviewSeries: valid', () => {
  assert.ok(isReviewSeries('MIN'))
  assert.ok(isReviewSeries('AIU'))
  assert.ok(isReviewSeries('PLM'))
})

test('isReviewSeries: invalid', () => {
  assert.ok(!isReviewSeries('QIB'))
  assert.ok(!isReviewSeries('AEO'))
  assert.ok(!isReviewSeries(''))
})

test('SUPPORTED_SERIES is exactly MIN, AIU, PLM', () => {
  assert.deepEqual([...SUPPORTED_SERIES], ['MIN', 'AIU', 'PLM'])
})

// ---------------------------------------------------------------------------
// 27. Classify from folder path fallback
// ---------------------------------------------------------------------------

test('classify: folder path fallback to MIN', () => {
  const r = classifyReviewDocument('June 2026.pdf', '/Monthly Intelligence Notes')
  assert.equal(r.series, 'MIN')
})

test('classify: folder path fallback to PLM', () => {
  const r = classifyReviewDocument('June 2026.pdf', '/Political Landscape Monitor')
  assert.equal(r.series, 'PLM')
})

// ---------------------------------------------------------------------------
// 28. Public display unchanged
// ---------------------------------------------------------------------------

test('publications page: still shows library.items.map', () => {
  const src = read('src/app/publications/page.tsx')
  assert.match(src, /library\.items\.map/)
})

test('publications page: still has #complimentary-review anchor', () => {
  const src = read('src/app/publications/page.tsx')
  assert.match(src, /id="complimentary-review"/)
})

test('publications page: single papermarkUrl reference', () => {
  const src = read('src/app/publications/page.tsx')
  const matches = src.match(/library\.papermarkUrl/g) || []
  assert.equal(matches.length, 1, 'exactly one papermarkUrl reference')
})

// ---------------------------------------------------------------------------
// 29. Data Room selector on admin page
// ---------------------------------------------------------------------------

test('admin form: Data Room selector section exists', () => {
  const src = read('src/app/admin/review-library/review-form.tsx')
  assert.match(src, /function DataRoomSection/)
  assert.match(src, /fetchAvailableReviewDataRooms/)
  assert.match(src, /saveReviewDataRoom/)
})

// ---------------------------------------------------------------------------
// 30. Last sync shown in admin
// ---------------------------------------------------------------------------

test('admin page: queries last sync timestamp', () => {
  const src = read('src/app/admin/review-library/page.tsx')
  assert.match(src, /review_library_last_sync_at/)
  assert.match(src, /review_library_last_sync_result/)
})

test('admin form: shows last sync info', () => {
  const src = read('src/app/admin/review-library/review-form.tsx')
  assert.match(src, /lastSyncAt/)
  assert.match(src, /lastSyncResult/)
})

// ---------------------------------------------------------------------------
// 31. Phase 2 tests still valid
// ---------------------------------------------------------------------------

test('phase 2: admin still requires owner', () => {
  const src = read('src/app/admin/review-library/page.tsx')
  assert.match(src, /requireOwner/)
})

test('phase 2: enable validation still checks HTTPS URL', () => {
  const src = read('src/app/actions/review-library.ts')
  const fn = src.slice(src.indexOf('async function saveReviewLibrarySettings'))
  assert.match(fn, /Cannot enable.*valid HTTPS/)
})

test('phase 2: getPublishedPublications still excludes OPEN', () => {
  const src = read('src/lib/publications.ts')
  const fn = src.slice(
    src.indexOf('async function getPublishedPublications'),
    src.indexOf('async function getOpenPublications') !== -1
      ? src.indexOf('async function getOpenPublications')
      : src.indexOf('async function getPublicationBySlug'),
  )
  assert.match(fn, /visibility <> 'OPEN'/)
})
