/**
 * Document link delivery — regression tests.
 *
 * Covers: the broken ?documentId= construction is gone, document-target links
 * use document_id not dataroom_id, category classification from folder paths,
 * security boundaries, and the wider portal layout.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  categoriseDataRoomDocument,
  normaliseSegment,
  categoryToSeries,
  categoryToDefaultVisibility,
  documentLinkSettings,
  humaniseFilename,
  subscriberWatermarkText,
  watermarkText,
  portalTypeLabel,
  portalCategoryLabel,
  parseEditionDate,
  generateEditionCode,
  derivePublicationMetadata,
} from '../src/lib/papermark-dataroom-contract.ts'
import {
  papermarkDocumentEmbedUrl,
} from '../src/lib/papermark-embed.ts'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

function levelBackfillFn() {
  const src = read('src/app/actions/datarooms.ts')
  const start = src.indexOf('async function prepareDocumentLinksForLevel')
  const nextExport = src.indexOf('export async function', start + 10)
  return src.slice(start, nextExport > start ? nextExport : undefined)
}

// ---------------------------------------------------------------------------
// 1. Broken ?documentId= construction is removed
// ---------------------------------------------------------------------------

test('viewer: no buildDataRoomDocumentUrl function', () => {
  const src = read('src/app/portal/document/[id]/page.tsx')
  assert.doesNotMatch(src, /buildDataRoomDocumentUrl/)
})

test('viewer: no ?documentId= query parameter construction', () => {
  const src = read('src/app/portal/document/[id]/page.tsx')
  assert.doesNotMatch(src, /documentId/)
})

test('download: no buildDownloadUrl function', () => {
  const src = read('src/app/portal/document/[id]/download/route.ts')
  assert.doesNotMatch(src, /buildDownloadUrl/)
})

test('download: no ?documentId= query parameter construction', () => {
  const src = read('src/app/portal/document/[id]/download/route.ts')
  assert.doesNotMatch(src, /documentId/)
})

// ---------------------------------------------------------------------------
// 2. Document link settings use document_id not dataroom_id
// ---------------------------------------------------------------------------

test('documentLinkSettings includes document_id', () => {
  const settings = documentLinkSettings({
    documentId: 'doc-123',
    assignedName: 'Test User',
    assignedEmail: 'test@example.com',
    expiresAt: null,
  })
  assert.equal(settings.document_id, 'doc-123')
  assert.equal('dataroom_id' in settings, false)
})

test('documentLinkSettings has correct security settings', () => {
  const settings = documentLinkSettings({
    documentId: 'doc-123',
    assignedName: 'Test User',
    assignedEmail: 'test@example.com',
    expiresAt: null,
  })
  assert.equal(settings.email_protected, false)
  assert.equal(settings.email_authenticated, false)
  assert.equal(settings.allow_download, true)
  assert.equal(settings.enable_watermark, true)
  assert.equal(settings.enable_screenshot_protection, true)
  assert.equal(settings.show_banner, false)
  assert.equal(settings.enable_agreement, false)
})

test('documentLinkSettings watermark uses Subscriber Edition format with email only', () => {
  const settings = documentLinkSettings({
    documentId: 'doc-123',
    assignedName: 'Nwaokike Desmond',
    assignedEmail: 'desmond@example.com',
    expiresAt: null,
  })
  assert.match(settings.watermark_config.text, /APRI Subscriber Edition/)
  assert.match(settings.watermark_config.text, /desmond@example\.com/)
  assert.doesNotMatch(settings.watermark_config.text, /Nwaokike Desmond/)
  assert.match(settings.watermark_config.text, /\{\{date\}\}/)
})

test('documentLinkSettings name includes document title when provided', () => {
  const settings = documentLinkSettings({
    documentId: 'doc-123',
    assignedName: 'Test User',
    assignedEmail: 'test@example.com',
    expiresAt: null,
    documentTitle: 'APRI_End_to_End_Flow_Guide.pdf',
  })
  assert.match(settings.name, /APRI_End_to_End_Flow_Guide/)
})

// ---------------------------------------------------------------------------
// 3. Category classification from folder paths
// ---------------------------------------------------------------------------

test('category: folder path "Monthly Intelligence Notes" classifies as MIN', () => {
  assert.equal(
    categoriseDataRoomDocument({
      title: 'APRI_End_to_End_Flow_Guide.pdf',
      folderPath: 'Monthly Intelligence Notes',
    }),
    'MIN',
  )
})

test('category: folder path "/MIN - Reports" classifies as MIN by code', () => {
  assert.equal(
    categoriseDataRoomDocument({
      title: 'some-file.pdf',
      folderPath: '/MIN - Reports',
    }),
    'MIN',
  )
})

test('category: folder path "Political Landscape Monitor" classifies as PLM', () => {
  assert.equal(
    categoriseDataRoomDocument({
      title: 'report.pdf',
      folderPath: 'Political Landscape Monitor',
    }),
    'PLM',
  )
})

test('category: folder path "Election & Democratic Governance Monitor" classifies as AEO', () => {
  assert.equal(
    categoriseDataRoomDocument({
      title: 'report.pdf',
      folderPath: 'Election & Democratic Governance Monitor',
    }),
    'AEO',
  )
})

test('category: folder path "Quarterly Intelligence Briefs" classifies as QIB', () => {
  assert.equal(
    categoriseDataRoomDocument({
      title: 'report.pdf',
      folderPath: 'Quarterly Intelligence Briefs',
    }),
    'QIB',
  )
})

test('category: stored category "MIN" still works for re-classification', () => {
  assert.equal(
    categoriseDataRoomDocument({ title: 'any.pdf', category: 'MIN' }),
    'MIN',
  )
})

test('category: title leading code PLM-Report classifies correctly', () => {
  assert.equal(
    categoriseDataRoomDocument({ title: 'PLM-2026-08-Report.pdf' }),
    'PLM',
  )
})

test('category: no folder, no code falls to OTHER', () => {
  assert.equal(
    categoriseDataRoomDocument({ title: 'random_document.pdf' }),
    'OTHER',
  )
})

test('category: folderPath takes precedence over title code', () => {
  assert.equal(
    categoriseDataRoomDocument({
      title: 'PLM-Report.pdf',
      folderPath: 'Monthly Intelligence Notes',
    }),
    'MIN',
  )
})

// ---------------------------------------------------------------------------
// 4. Viewer uses documentLinkUrl, not Data Room linkUrl
// ---------------------------------------------------------------------------

test('viewer: uses documentLinkUrl prop', () => {
  const src = read('src/app/portal/document/[id]/page.tsx')
  assert.match(src, /documentLinkUrl/)
})

test('viewer: no reference to "linkUrl" as DR URL prop', () => {
  const src = read('src/app/portal/document/[id]/page.tsx')
  // The component should not receive or use a Data Room link URL
  assert.doesNotMatch(src, /linkUrl={drResult\.linkUrl}/)
})

test('download: uses documentLinkUrl from result', () => {
  const src = read('src/app/portal/document/[id]/download/route.ts')
  assert.match(src, /documentLinkUrl/)
})

// ---------------------------------------------------------------------------
// 5. Client library returns documentLinkUrl
// ---------------------------------------------------------------------------

test('client library: getDataRoomDocumentForSubscriber returns documentLinkUrl', () => {
  const src = read('src/lib/papermark-client-library.ts')
  const fn = src.slice(src.indexOf('async function getDataRoomDocumentForSubscriber'))
  assert.match(fn, /documentLinkUrl/)
})

test('client library: imports getDocumentLinkByDocRowId', () => {
  const src = read('src/lib/papermark-client-library.ts')
  assert.match(src, /getDocumentLinkByDocRowId/)
})

// ---------------------------------------------------------------------------
// 6. Security: no secrets in portal/viewer code
// ---------------------------------------------------------------------------

test('viewer: no PAPERMARK_API_TOKEN reference', () => {
  const src = read('src/app/portal/document/[id]/page.tsx')
  assert.doesNotMatch(src, /PAPERMARK_API_TOKEN/)
})

test('download: no PAPERMARK_API_TOKEN reference', () => {
  const src = read('src/app/portal/document/[id]/download/route.ts')
  assert.doesNotMatch(src, /PAPERMARK_API_TOKEN/)
})

test('portal: no PAPERMARK_API_TOKEN reference', () => {
  const src = read('src/app/portal/page.tsx')
  assert.doesNotMatch(src, /PAPERMARK_API_TOKEN/)
})

test('document-links service is server-only', () => {
  const src = read('src/lib/document-links.ts')
  assert.match(src, /import 'server-only'/)
})

// ---------------------------------------------------------------------------
// 7. Document link DAL has unique constraint
// ---------------------------------------------------------------------------

test('migration: subscriber_document_links table exists', () => {
  const src = read('db/migrations/20260830_subscriber_document_links.sql')
  assert.match(src, /create table if not exists papermark_subscriber_document_links/)
})

test('migration: unique index on live subscriber+document', () => {
  const src = read('db/migrations/20260830_subscriber_document_links.sql')
  assert.match(src, /papermark_sub_doc_links_live_key/)
  assert.match(src, /subscriber_id, papermark_document_id/)
  assert.match(src, /revoke_state = 'live'/)
})

test('migration: folder_path added to dataroom_documents', () => {
  const src = read('db/migrations/20260830_subscriber_document_links.sql')
  assert.match(src, /folder_path/)
})

// ---------------------------------------------------------------------------
// 8. Lifecycle: document links revoked with DR links
// ---------------------------------------------------------------------------

test('lifecycle: revokeAllDataRoomLinks also revokes document links', () => {
  const src = read('src/lib/dataroom-lifecycle.ts')
  assert.match(src, /revokeAllDocumentLinks/)
})

test('lifecycle: reassignDataRoomOnLevelChange revokes then recreates document links', () => {
  const src = read('src/lib/dataroom-lifecycle.ts')
  assert.match(src, /revokeAllDocumentLinks/)
  assert.match(src, /ensureAllDocumentLinks/)
})

test('lifecycle: updateDataRoomLinkExpiry also updates document link expiry', () => {
  const src = read('src/lib/dataroom-lifecycle.ts')
  assert.match(src, /updateDocumentLinkExpiry/)
})

// ---------------------------------------------------------------------------
// 9. Admin backfill action exists
// ---------------------------------------------------------------------------

test('admin: prepareDocumentLinks per-subscriber action exists', () => {
  const src = read('src/app/actions/datarooms.ts')
  assert.match(src, /async function prepareDocumentLinks\(subscriberId/)
})

test('admin: per-subscriber backfill requires owner', () => {
  const src = read('src/app/actions/datarooms.ts')
  const fn = src.slice(
    src.indexOf('async function prepareDocumentLinks(subscriberId'),
    src.indexOf('async function prepareDocumentLinksForLevel'),
  )
  assert.match(fn, /requireOwner/)
})

test('admin: prepareDocumentLinksForLevel action exists', () => {
  const src = read('src/app/actions/datarooms.ts')
  assert.match(src, /async function prepareDocumentLinksForLevel\(publicTier/)
})

test('admin: level backfill requires owner', () => {
  const src = read('src/app/actions/datarooms.ts')
  const fn = src.slice(src.indexOf('async function prepareDocumentLinksForLevel'))
  assert.match(fn, /requireOwner/)
})

test('admin: level backfill validates tier against PUBLIC_TIER_NAMES', () => {
  const fn = levelBackfillFn()
  assert.match(fn, /PUBLIC_TIER_NAMES/)
  assert.match(fn, /\.includes\(publicTier\)/)
})

test('admin: level backfill does not call syncAndNotify', () => {
  const fn = levelBackfillFn()
  assert.doesNotMatch(fn, /syncAndNotify/)
  assert.doesNotMatch(fn, /sendNotification/)
  assert.doesNotMatch(fn, /notifySubscribers/)
})

test('admin: level backfill reports created/skipped/failed counts', () => {
  const fn = levelBackfillFn()
  assert.match(fn, /totalCreated/)
  assert.match(fn, /totalSkipped/)
  assert.match(fn, /totalFailed/)
})

test('admin: level backfill does not expose Papermark API details in errors', () => {
  const fn = levelBackfillFn()
  assert.doesNotMatch(fn, /PAPERMARK_API_TOKEN/)
})

test('admin: level backfill button exists in Quick Actions', () => {
  const src = read('src/app/admin/datarooms/dataroom-form.tsx')
  assert.match(src, /Prepare document links/)
  assert.match(src, /prepareDocumentLinksForLevel/)
  assert.match(src, /handlePrepareLinks/)
})

test('admin: DAL has getActiveSubscriberIdsForRoom', () => {
  const src = read('src/lib/dataroom-dal.ts')
  assert.match(src, /async function getActiveSubscriberIdsForRoom/)
  const fn = src.slice(src.indexOf('async function getActiveSubscriberIdsForRoom'))
  assert.match(fn, /revoke_state = 'live'/)
  assert.match(fn, /lower\(s\.status\) = 'active'/)
})

// ---------------------------------------------------------------------------
// 10. Portal category label: "Other Assigned Publications" exists as fallback
// ---------------------------------------------------------------------------

test('portal category label: OTHER returns "Other Assigned Publications"', () => {
  assert.equal(portalCategoryLabel('OTHER'), 'Other Assigned Publications')
})

test('portal type label: OTHER returns "Publication"', () => {
  assert.equal(portalTypeLabel('OTHER'), 'Publication')
})

test('portal type label: MIN returns "Monthly Intelligence Note"', () => {
  assert.equal(portalTypeLabel('MIN'), 'Monthly Intelligence Note')
})

// ---------------------------------------------------------------------------
// 11. Portal layout: one full-width card per row
// ---------------------------------------------------------------------------

test('portal: document grid uses single column only', () => {
  const src = read('src/app/portal/page.tsx')
  assert.match(src, /grid grid-cols-1 gap/)
  assert.doesNotMatch(src, /sm:grid-cols-2/)
  assert.doesNotMatch(src, /xl:grid-cols-3/)
  assert.doesNotMatch(src, /2xl:grid-cols-4/)
})

test('portal: cards are full width', () => {
  const src = read('src/app/portal/page.tsx')
  assert.match(src, /w-full max-w-none/)
})

test('portal: shell uses max-w-[1800px]', () => {
  const src = read('src/app/portal/page.tsx')
  assert.match(src, /max-w-\[1800px\]/)
})

test('portal: mobile padding starts at px-4', () => {
  const src = read('src/app/portal/page.tsx')
  assert.match(src, /px-4/)
})

test('viewer: shell uses max-w-[1800px]', () => {
  const src = read('src/app/portal/document/[id]/page.tsx')
  assert.match(src, /max-w-\[1800px\]/)
})

test('viewer: uses viewport-relative height for embed', () => {
  const src = read('src/app/portal/document/[id]/page.tsx')
  assert.match(src, /100dvh/)
})

test('viewer: is full width with responsive padding', () => {
  const src = read('src/app/portal/document/[id]/page.tsx')
  assert.match(src, /w-full/)
  assert.match(src, /px-4/)
})

// ---------------------------------------------------------------------------
// 15. Embed URL uses app.papermark.com/view/{linkId}/embed
// ---------------------------------------------------------------------------

test('embed helper: valid link ID produces app.papermark.com URL', () => {
  const url = papermarkDocumentEmbedUrl('clxyz123abc')
  assert.equal(url, 'https://app.papermark.com/view/clxyz123abc/embed')
})

test('embed helper: null link ID returns null', () => {
  assert.equal(papermarkDocumentEmbedUrl(null), null)
  assert.equal(papermarkDocumentEmbedUrl(undefined), null)
  assert.equal(papermarkDocumentEmbedUrl(''), null)
})

test('embed helper: link ID with special chars returns null', () => {
  assert.equal(papermarkDocumentEmbedUrl('abc<script>'), null)
  assert.equal(papermarkDocumentEmbedUrl('abc def'), null)
  assert.equal(papermarkDocumentEmbedUrl('abc/def'), null)
})

test('viewer: iframe uses papermarkDocumentEmbedUrl, not papermarkEmbedUrl for DR docs', () => {
  const src = read('src/app/portal/document/[id]/page.tsx')
  assert.match(src, /papermarkDocumentEmbedUrl\(papermarkLinkId\)/)
})

test('viewer: no www.papermark.com iframe construction', () => {
  const src = read('src/app/portal/document/[id]/page.tsx')
  assert.doesNotMatch(src, /www\.papermark\.com/)
})

test('viewer: passes papermarkLinkId from drResult', () => {
  const src = read('src/app/portal/document/[id]/page.tsx')
  assert.match(src, /papermarkLinkId={drResult\.papermarkLinkId}/)
})

test('viewer: shows fallback when embed URL is unavailable', () => {
  const src = read('src/app/portal/document/[id]/page.tsx')
  assert.match(src, /Document viewer unavailable/)
  assert.match(src, /Open in a new tab instead/)
})

test('client library: returns papermarkLinkId', () => {
  const src = read('src/lib/papermark-client-library.ts')
  const fn = src.slice(src.indexOf('async function getDataRoomDocumentForSubscriber'))
  assert.match(fn, /papermarkLinkId/)
})

// ---------------------------------------------------------------------------
// 16. CSP permits app.papermark.com frames
// ---------------------------------------------------------------------------

test('CSP: frame-src includes *.papermark.com wildcard', () => {
  const src = read('next.config.ts')
  assert.match(src, /\*\.papermark\.com/)
})

// ---------------------------------------------------------------------------
// 17. Cross-subscriber isolation intact
// ---------------------------------------------------------------------------

test('viewer: subscriber-document ownership verified server-side', () => {
  const src = read('src/app/portal/document/[id]/page.tsx')
  assert.match(src, /requirePortalPrincipal\(\)/)
  assert.match(src, /getDataRoomDocumentForSubscriber\(principal\.id, decodedId\)/)
  assert.doesNotMatch(src, /await searchParams|\.searchParams\)\.get/)
})

test('download: subscriber-document ownership verified server-side', () => {
  const src = read('src/app/portal/document/[id]/download/route.ts')
  assert.match(src, /requirePortalPrincipal\(\)/)
  assert.match(src, /getDataRoomDocumentForSubscriber\(principal\.id/)
})

// ---------------------------------------------------------------------------
// 12. Watermark text format
// ---------------------------------------------------------------------------

test('watermark: uses Subscriber Edition format with email, date, time and confidential', () => {
  const text = subscriberWatermarkText('desmond@example.com')
  assert.match(text, /APRI Subscriber Edition/)
  assert.match(text, /desmond@example\.com/)
  assert.match(text, /\{\{date\}\}/)
  assert.match(text, /\{\{time\}\}/)
  assert.match(text, /Confidential/)
  assert.match(text, /Not for redistribution/)
})

test('watermark: no IP address, no name, no access level', () => {
  const text = subscriberWatermarkText('test@x.com')
  assert.doesNotMatch(text, /\{\{ipAddress\}\}/)
  assert.doesNotMatch(text, /Assigned to/)
  assert.doesNotMatch(text, /L[1-4]/)
})

// ---------------------------------------------------------------------------
// 13. Sync stores folder_path
// ---------------------------------------------------------------------------

test('sync: dataroom-dal accepts folderPath in syncDataRoomDocuments', () => {
  const src = read('src/lib/dataroom-dal.ts')
  const fn = src.slice(src.indexOf('async function syncDataRoomDocuments'))
  assert.match(fn, /folderPath/)
  assert.match(fn, /folder_path/)
})

test('sync action: passes folderPath from Papermark', () => {
  const src = read('src/app/actions/datarooms.ts')
  assert.match(src, /folderPath: d\.folder_path/)
})

// ---------------------------------------------------------------------------
// 14. createDocumentLink uses POST /v1/links with document_id
// ---------------------------------------------------------------------------

test('API: createDocumentLink exists in papermark-datarooms', () => {
  const src = read('src/lib/papermark-datarooms.ts')
  assert.match(src, /async function createDocumentLink/)
})

test('API: createDocumentLink posts to /v1/links', () => {
  const src = read('src/lib/papermark-datarooms.ts')
  const fn = src.slice(src.indexOf('async function createDocumentLink'))
  assert.match(fn, /\/v1\/links/)
  assert.match(fn, /method: 'POST'/)
})

test('API: DocumentLinkSettings type has document_id, not dataroom_id', () => {
  const src = read('src/lib/papermark-dataroom-contract.ts')
  const start = src.indexOf('export type DocumentLinkSettings')
  const end = src.indexOf('}', start) + 1
  const typeDef = src.slice(start, end)
  assert.match(typeDef, /document_id: string/)
  assert.doesNotMatch(typeDef, /dataroom_id/)
})

// ---------------------------------------------------------------------------
// 18. humaniseFilename fallback
// ---------------------------------------------------------------------------

test('humanise: strips .pdf extension', () => {
  assert.equal(humaniseFilename('APRI_Monthly_Report.pdf'), 'APRI Monthly Report')
})

test('humanise: strips .PDF (case-insensitive)', () => {
  assert.equal(humaniseFilename('report.PDF'), 'report')
})

test('humanise: replaces underscores and hyphens with spaces', () => {
  assert.equal(humaniseFilename('PLM-2026-08-Report'), 'PLM 2026 08 Report')
})

test('humanise: collapses multiple separators', () => {
  assert.equal(humaniseFilename('a__b--c___d.pdf'), 'a b c d')
})

test('humanise: returns raw input when result would be empty', () => {
  assert.equal(humaniseFilename(''), '')
  assert.equal(humaniseFilename('.pdf'), '.pdf')
})

test('humanise: trims whitespace around the name', () => {
  assert.equal(humaniseFilename('  spaced_out  '), 'spaced out')
})

// ---------------------------------------------------------------------------
// 19. Editorial metadata on portal cards
// ---------------------------------------------------------------------------

test('portal: DataRoomCard renders displayTitle, not raw title', () => {
  const src = read('src/app/portal/page.tsx')
  const drCard = src.slice(
    src.indexOf('function DataRoomCard('),
    src.indexOf('\nfunction', src.indexOf('function DataRoomCard(') + 10),
  )
  assert.match(drCard, /document\.displayTitle/)
  assert.doesNotMatch(drCard, /\{document\.title\}/)
})

test('portal: card renders kicker when present', () => {
  const src = read('src/app/portal/page.tsx')
  assert.match(src, /document\.kicker/)
})

test('portal: card renders summary when present', () => {
  const src = read('src/app/portal/page.tsx')
  assert.match(src, /document\.summary/)
})

test('portal: card prefers editionDate over Papermark dates', () => {
  const src = read('src/app/portal/page.tsx')
  assert.match(src, /document\.editionDate \|\| document\.papermarkUpdatedAt/)
})

test('viewer: uses displayTitle for page title', () => {
  const src = read('src/app/portal/document/[id]/page.tsx')
  assert.match(src, /drResult\.document\.displayTitle/)
})

// ---------------------------------------------------------------------------
// 20. Client library LEFT JOINs editorial data
// ---------------------------------------------------------------------------

test('client library: DataRoomDocument type has editorial fields', () => {
  const src = read('src/lib/papermark-client-library.ts')
  const start = src.indexOf('export type DataRoomDocument')
  const end = src.indexOf('}', start) + 1
  const typeDef = src.slice(start, end)
  assert.match(typeDef, /displayTitle: string/)
  assert.match(typeDef, /summary: string \| null/)
  assert.match(typeDef, /kicker: string \| null/)
  assert.match(typeDef, /editionDate: string \| null/)
  assert.match(typeDef, /series: string \| null/)
  assert.match(typeDef, /editorialPageCount: number \| null/)
})

test('client library: list query LEFT JOINs documents table', () => {
  const src = read('src/lib/papermark-client-library.ts')
  const fn = src.slice(src.indexOf('async function getDataRoomDocumentsForSubscriber'))
  assert.match(fn, /left join documents d on d\.id = dd\.publication_id/i)
})

test('client library: single-doc query LEFT JOINs documents table', () => {
  const src = read('src/lib/papermark-client-library.ts')
  const fn = src.slice(src.indexOf('async function getDataRoomDocumentForSubscriber'))
  assert.match(fn, /left join documents d on d\.id = dd\.publication_id/i)
})

test('client library: displayTitle falls back to humanised filename', () => {
  const src = read('src/lib/papermark-client-library.ts')
  assert.match(src, /displayTitle: row\.ed_title \|\| humaniseFilename\(row\.title\)/)
})

test('client library: imports humaniseFilename from contract module', () => {
  const src = read('src/lib/papermark-client-library.ts')
  assert.match(src, /import[\s\S]*humaniseFilename[\s\S]*from ['"]\.\/papermark-dataroom-contract['"]/)
})

// ---------------------------------------------------------------------------
// 21. Category classifier: singular folder name fix
// ---------------------------------------------------------------------------

test('category: singular "Monthly Intelligence Note" classifies as MIN', () => {
  assert.equal(
    categoriseDataRoomDocument({
      title: 'any.pdf',
      folderPath: '/Monthly Intelligence Note',
    }),
    'MIN',
  )
})

test('category: singular "Quarterly Intelligence Brief" classifies as QIB', () => {
  assert.equal(
    categoriseDataRoomDocument({
      title: 'any.pdf',
      folderPath: 'Quarterly Intelligence Brief',
    }),
    'QIB',
  )
})

test('category: nested path "/Publications/Monthly Intelligence Note" classifies as MIN', () => {
  assert.equal(
    categoriseDataRoomDocument({
      title: 'any.pdf',
      folderPath: '/Publications/Monthly Intelligence Note',
    }),
    'MIN',
  )
})

test('category: case-insensitive folder match still works', () => {
  assert.equal(
    categoriseDataRoomDocument({
      title: 'any.pdf',
      folderPath: 'monthly intelligence note',
    }),
    'MIN',
  )
})

test('category: folder classification takes priority over title code', () => {
  assert.equal(
    categoriseDataRoomDocument({
      title: 'PLM-Report-2026.pdf',
      folderPath: 'Monthly Intelligence Notes',
    }),
    'MIN',
  )
})

test('category: OTHER used only when no folder or title matches', () => {
  assert.equal(
    categoriseDataRoomDocument({
      title: 'random_doc.pdf',
      folderPath: '/Miscellaneous',
    }),
    'OTHER',
  )
})

// ---------------------------------------------------------------------------
// 22. DAL upsert backfills folder_path when version_key unchanged
// ---------------------------------------------------------------------------

test('DAL: upsert updates folder_path with COALESCE on unchanged version_key', () => {
  const src = read('src/lib/dataroom-dal.ts')
  const fn = src.slice(src.indexOf('async function syncDataRoomDocuments'))
  const elseBranch = fn.slice(fn.indexOf('} else {'))
  assert.match(elseBranch, /folder_path = coalesce\(/)
  assert.match(elseBranch, /folder_id = coalesce\(/)
  assert.match(elseBranch, /category =/)
})

test('DAL: upsert unchanged branch updates last_seen_at', () => {
  const src = read('src/lib/dataroom-dal.ts')
  const fn = src.slice(src.indexOf('async function syncDataRoomDocuments'))
  const elseBranch = fn.slice(fn.indexOf('} else {'))
  assert.match(elseBranch, /last_seen_at = now\(\)/)
})

// ---------------------------------------------------------------------------
// 23. Migration: publication_id column
// ---------------------------------------------------------------------------

test('migration: editorial link adds publication_id column', () => {
  const src = read('db/migrations/20260829_editorial_link.sql')
  assert.match(src, /publication_id uuid/)
  assert.match(src, /REFERENCES documents\(id\)/)
  assert.match(src, /ON DELETE SET NULL/)
})

test('migration: editorial link has partial index on publication_id', () => {
  const src = read('db/migrations/20260829_editorial_link.sql')
  assert.match(src, /idx_pdd_publication_id/)
  assert.match(src, /WHERE publication_id IS NOT NULL/)
})

test('migration: editorial link is idempotent', () => {
  const src = read('db/migrations/20260829_editorial_link.sql')
  assert.match(src, /IF NOT EXISTS/)
  assert.match(src, /CREATE INDEX IF NOT EXISTS/)
})

// ---------------------------------------------------------------------------
// 24. Admin: editorial status and auto-link
// ---------------------------------------------------------------------------

test('admin: synced documents table shows editorial status', () => {
  const src = read('src/app/admin/datarooms/page.tsx')
  assert.match(src, /editorialStatus/)
  assert.match(src, /Complete/)
  assert.match(src, /Missing:/)
})

test('admin: synced documents table shows folder path and category', () => {
  const src = read('src/app/admin/datarooms/page.tsx')
  assert.match(src, /doc\.folderPath/)
  assert.match(src, /portalCategoryLabel/)
})

test('admin: auto-link publications button exists', () => {
  const src = read('src/app/admin/datarooms/dataroom-form.tsx')
  assert.match(src, /Auto-link publications/)
  assert.match(src, /autoLinkPublicationsByPapermarkId/)
  assert.match(src, /handleAutoLink/)
})

test('admin: auto-link action requires owner', () => {
  const src = read('src/app/actions/datarooms.ts')
  const fn = src.slice(src.indexOf('async function autoLinkPublicationsByPapermarkId'))
  assert.match(fn, /requireOwner/)
})

test('admin: link and unlink publication actions exist', () => {
  const src = read('src/app/actions/datarooms.ts')
  assert.match(src, /async function linkPublicationToSyncedDocument/)
  assert.match(src, /async function unlinkPublicationFromSyncedDocument/)
})

test('admin: getSyncedDocumentsForRoom exists in DAL', () => {
  const src = read('src/lib/dataroom-dal.ts')
  assert.match(src, /async function getSyncedDocumentsForRoom/)
})

test('admin: autoLinkByPapermarkId matches on papermark_document_id', () => {
  const src = read('src/lib/dataroom-dal.ts')
  const fn = src.slice(src.indexOf('async function autoLinkByPapermarkId'))
  assert.match(fn, /papermark_document_id/)
})

// ---------------------------------------------------------------------------
// 25. Sync safety: no notifications, no duplicate links
// ---------------------------------------------------------------------------

test('sync: syncDataRoomDocuments does not send notifications', () => {
  const src = read('src/lib/dataroom-dal.ts')
  const fn = src.slice(src.indexOf('async function syncDataRoomDocuments'))
  const end = src.indexOf('\nexport', src.indexOf('async function syncDataRoomDocuments') + 10)
  const body = src.slice(src.indexOf('async function syncDataRoomDocuments'), end > 0 ? end : undefined)
  assert.doesNotMatch(body, /sendNotification|notifySubscribers|sendEmail/)
})

test('cross-subscriber isolation: viewer requires principal match', () => {
  const src = read('src/app/portal/document/[id]/page.tsx')
  assert.match(src, /principal\.id/)
  assert.doesNotMatch(src, /searchParams.*get\(['"]subscriberId/)
})

// ---------------------------------------------------------------------------
// 26. Slug-path normalisation
// ---------------------------------------------------------------------------

test('normalise: hyphens become spaces', () => {
  assert.equal(normaliseSegment('monthly-intelligence-note'), 'monthly intelligence note')
})

test('normalise: underscores become spaces', () => {
  assert.equal(normaliseSegment('monthly_intelligence_note'), 'monthly intelligence note')
})

test('normalise: numeric prefix removed', () => {
  assert.equal(normaliseSegment('04-monthly-intelligence-note'), 'monthly intelligence note')
})

test('normalise: numeric prefix with underscore removed', () => {
  assert.equal(normaliseSegment('04_monthly_intelligence_note'), 'monthly intelligence note')
})

test('normalise: URI-encoded chars decoded', () => {
  assert.equal(normaliseSegment('Monthly%20Intelligence%20Note'), 'monthly intelligence note')
})

test('normalise: mixed case lowered', () => {
  assert.equal(normaliseSegment('Monthly-Intelligence-Note'), 'monthly intelligence note')
})

test('normalise: collapses repeated whitespace', () => {
  assert.equal(normaliseSegment('monthly   intelligence   note'), 'monthly intelligence note')
})

// ---------------------------------------------------------------------------
// 27. Slug-path classifier: exact live path
// ---------------------------------------------------------------------------

test('category: exact live path /monthly-intelligence-note classifies as MIN', () => {
  assert.equal(
    categoriseDataRoomDocument({
      title: 'APRI_End_to_End_Flow_Guide.pdf',
      folderPath: '/monthly-intelligence-note',
    }),
    'MIN',
  )
})

test('category: slug /athena-intelligence-updates classifies as AIU', () => {
  assert.equal(
    categoriseDataRoomDocument({
      title: 'any.pdf',
      folderPath: '/athena-intelligence-updates',
    }),
    'AIU',
  )
})

test('category: slug /quarterly-intelligence-brief classifies as QIB', () => {
  assert.equal(
    categoriseDataRoomDocument({
      title: 'any.pdf',
      folderPath: '/quarterly-intelligence-brief',
    }),
    'QIB',
  )
})

test('category: slug /political-landscape-monitor classifies as PLM', () => {
  assert.equal(
    categoriseDataRoomDocument({
      title: 'any.pdf',
      folderPath: '/political-landscape-monitor',
    }),
    'PLM',
  )
})

test('category: slug /election-democratic-governance-monitor classifies as AEO', () => {
  assert.equal(
    categoriseDataRoomDocument({
      title: 'any.pdf',
      folderPath: '/election-democratic-governance-monitor',
    }),
    'AEO',
  )
})

test('category: slug /election-watch classifies as AEO', () => {
  assert.equal(
    categoriseDataRoomDocument({
      title: 'any.pdf',
      folderPath: '/election-watch',
    }),
    'AEO',
  )
})

test('category: numeric prefix /04-monthly-intelligence-note classifies as MIN', () => {
  assert.equal(
    categoriseDataRoomDocument({
      title: 'any.pdf',
      folderPath: '/04-monthly-intelligence-note',
    }),
    'MIN',
  )
})

test('category: nested slug /publications/monthly-intelligence-note classifies as MIN', () => {
  assert.equal(
    categoriseDataRoomDocument({
      title: 'any.pdf',
      folderPath: '/publications/monthly-intelligence-note',
    }),
    'MIN',
  )
})

// ---------------------------------------------------------------------------
// 28. DAL: category recalculated on unchanged version_key
// ---------------------------------------------------------------------------

test('DAL: upsert recalculates category unconditionally in unchanged branch', () => {
  const src = read('src/lib/dataroom-dal.ts')
  const fn = src.slice(src.indexOf('async function syncDataRoomDocuments'))
  const elseBranch = fn.slice(fn.indexOf('} else {'))
  assert.match(elseBranch, /category = \$\{doc\.category\}/)
  assert.doesNotMatch(elseBranch, /category = coalesce/)
})

test('DAL: upsert unchanged branch does not bump version_key', () => {
  const src = read('src/lib/dataroom-dal.ts')
  const fn = src.slice(src.indexOf('async function syncDataRoomDocuments'))
  const elseBranch = fn.slice(fn.indexOf('} else {'), fn.indexOf('} else {') + 500)
  assert.doesNotMatch(elseBranch, /version_key/)
})

test('DAL: upsert unchanged branch does not update updated_at', () => {
  const src = read('src/lib/dataroom-dal.ts')
  const fn = src.slice(src.indexOf('async function syncDataRoomDocuments'))
  const elseBranch = fn.slice(fn.indexOf('} else {'), fn.indexOf('} else {') + 500)
  assert.doesNotMatch(elseBranch, /updated_at/)
})

test('sync action: syncDataRoomForLevel does not call syncAndNotify or sendNotification', () => {
  const src = read('src/app/actions/datarooms.ts')
  const start = src.indexOf('async function syncDataRoomForLevel')
  const end = src.indexOf('\n// ---', start + 10)
  const fn = src.slice(start, end > start ? end : undefined)
  assert.doesNotMatch(fn, /syncAndNotify/)
  assert.doesNotMatch(fn, /sendNotification/)
})

// ---------------------------------------------------------------------------
// 29. Admin: Create / Edit publication details buttons
// ---------------------------------------------------------------------------

test('admin: missing publication shows Create publication details button', () => {
  const src = read('src/app/admin/datarooms/page.tsx')
  assert.match(src, /CreatePublicationButton/)
})

test('admin: linked publication shows Edit publication details link', () => {
  const src = read('src/app/admin/datarooms/page.tsx')
  assert.match(src, /Edit publication details/)
})

test('admin: Link existing publication action available', () => {
  const src = read('src/app/admin/datarooms/page.tsx')
  assert.match(src, /LinkExistingPublication/)
})

test('admin: createPublicationForDocument action exists and requires owner', () => {
  const src = read('src/app/actions/datarooms.ts')
  assert.match(src, /async function createPublicationForDocument/)
  const fn = src.slice(src.indexOf('async function createPublicationForDocument'))
  assert.match(fn, /requireOwner/)
})

test('admin: createPublicationForDocument creates draft, unpublished record', () => {
  const src = read('src/lib/dataroom-dal.ts')
  const insertFn = src.slice(src.indexOf('async function insertWithSafeSlug'))
  assert.match(insertFn, /\$\{'draft'\}/)
  assert.match(insertFn, /\$\{false\}/)
})

test('admin: createPublicationForSyncedDocument sets papermark_document_id', () => {
  const src = read('src/lib/dataroom-dal.ts')
  const fn = src.slice(src.indexOf('async function createPublicationForSyncedDocument'))
  assert.match(fn, /papermark_document_id/)
})

test('admin: createPublicationForSyncedDocument links publication_id immediately', () => {
  const src = read('src/lib/dataroom-dal.ts')
  const fn = src.slice(src.indexOf('async function createPublicationForSyncedDocument'))
  assert.match(fn, /set publication_id =/)
})

test('admin: createPublicationForSyncedDocument reuses existing record by Papermark ID', () => {
  const src = read('src/lib/dataroom-dal.ts')
  const matchFn = src.slice(src.indexOf('async function findCanonicalMatch'))
  assert.match(matchFn, /select id from documents/)
  assert.match(matchFn, /where papermark_document_id =/)
  const createFn = src.slice(src.indexOf('async function createPublicationForSyncedDocument'))
  assert.match(createFn, /findCanonicalMatch/)
})

test('admin: createPublicationForSyncedDocument does not create open_link_url', () => {
  const src = read('src/lib/dataroom-dal.ts')
  const fn = src.slice(src.indexOf('async function createPublicationForSyncedDocument'))
  assert.doesNotMatch(fn, /open_link_url/)
})

// ---------------------------------------------------------------------------
// 30. categoryToSeries and categoryToDefaultVisibility
// ---------------------------------------------------------------------------

test('categoryToSeries: MIN returns MIN', () => {
  assert.equal(categoryToSeries('MIN'), 'MIN')
})

test('categoryToSeries: OTHER returns empty string', () => {
  assert.equal(categoryToSeries('OTHER'), '')
})

test('categoryToDefaultVisibility: Individual Access tier returns L1', () => {
  assert.equal(categoryToDefaultVisibility('MIN', 'Individual Access'), 'L1')
})

test('categoryToDefaultVisibility: PLM with no tier returns L1', () => {
  assert.equal(categoryToDefaultVisibility('PLM'), 'L1')
})

test('categoryToDefaultVisibility: QIB with no tier returns L3', () => {
  assert.equal(categoryToDefaultVisibility('QIB'), 'L3')
})

// ---------------------------------------------------------------------------
// 31. Auto-link result message is clear
// ---------------------------------------------------------------------------

test('admin: autoLinkByPapermarkId returns detailed counts', () => {
  const src = read('src/lib/dataroom-dal.ts')
  const fn = src.slice(src.indexOf('async function autoLinkByPapermarkId'))
  assert.match(fn, /linked/)
  assert.match(fn, /alreadyLinked/)
  assert.match(fn, /noMatch/)
})

test('admin: auto-link action message includes linked, already linked, no match', () => {
  const src = read('src/app/actions/datarooms.ts')
  const fn = src.slice(src.indexOf('async function autoLinkPublicationsByPapermarkId'))
  assert.match(fn, /linked/)
  assert.match(fn, /already linked/)
  assert.match(fn, /no matching publication/)
})

// ---------------------------------------------------------------------------
// 32. Personal document links remain unchanged
// ---------------------------------------------------------------------------

test('viewer: personal document links not affected by editorial changes', () => {
  const src = read('src/app/portal/document/[id]/page.tsx')
  assert.match(src, /documentLinkUrl/)
  assert.match(src, /papermarkLinkId/)
  assert.doesNotMatch(src, /publication_id/)
})

test('download route: not affected by editorial changes', () => {
  const src = read('src/app/portal/document/[id]/download/route.ts')
  assert.match(src, /documentLinkUrl/)
  assert.doesNotMatch(src, /publication_id/)
})

// ---------------------------------------------------------------------------
// 33. Enhanced filename cleaning
// ---------------------------------------------------------------------------

test('humaniseFilename: removes (1) copy indicator', () => {
  assert.equal(humaniseFilename('MIN-2026-08 (1).pdf'), 'MIN 2026 08')
})

test('humaniseFilename: removes (2) copy indicator', () => {
  assert.equal(humaniseFilename('Report (2).pdf'), 'Report')
})

test('humaniseFilename: removes trailing "copy" suffix', () => {
  assert.equal(humaniseFilename('PLM-August-2026 copy.pdf'), 'PLM August 2026')
})

test('humaniseFilename: removes trailing "Copy 2" suffix', () => {
  assert.equal(humaniseFilename('QIB-Q3-2026 Copy 2.pdf'), 'QIB Q3 2026')
})

test('humaniseFilename: still handles basic .pdf and underscores', () => {
  assert.equal(humaniseFilename('some_report_name.pdf'), 'some report name')
})

// ---------------------------------------------------------------------------
// 34. Edition date parsing
// ---------------------------------------------------------------------------

test('parseEditionDate: YYYY-MM format', () => {
  assert.equal(parseEditionDate('MIN-2026-08'), '2026-08-01')
})

test('parseEditionDate: YYYY-MM-DD format', () => {
  assert.equal(parseEditionDate('AIU-2026-08-15'), '2026-08-15')
})

test('parseEditionDate: month name with year', () => {
  assert.equal(parseEditionDate('PLM-August-2026'), '2026-08-01')
})

test('parseEditionDate: abbreviated month name', () => {
  assert.equal(parseEditionDate('PLM Sep 2026'), '2026-09-01')
})

test('parseEditionDate: quarter Q3', () => {
  assert.equal(parseEditionDate('QIB-Q3-2026'), '2026-07-01')
})

test('parseEditionDate: quarter Q1', () => {
  assert.equal(parseEditionDate('QIB Q1 2026'), '2026-01-01')
})

test('parseEditionDate: returns null for unrecognised', () => {
  assert.equal(parseEditionDate('Some Random Title'), null)
})

test('parseEditionDate: year before month name', () => {
  assert.equal(parseEditionDate('PLM 2026 January'), '2026-01-01')
})

// ---------------------------------------------------------------------------
// 35. Edition code generation
// ---------------------------------------------------------------------------

test('generateEditionCode: standard MIN', () => {
  assert.equal(generateEditionCode('MIN', '2026-08-01'), 'APRI-MIN-2026-08')
})

test('generateEditionCode: QIB quarterly', () => {
  assert.equal(generateEditionCode('QIB', '2026-07-01'), 'APRI-QIB-2026-07')
})

test('generateEditionCode: empty series returns empty', () => {
  assert.equal(generateEditionCode('', '2026-08-01'), '')
})

test('generateEditionCode: null date returns empty', () => {
  assert.equal(generateEditionCode('MIN', null), '')
})

// ---------------------------------------------------------------------------
// 36. Metadata derivation
// ---------------------------------------------------------------------------

test('derivePublicationMetadata: MIN with date', () => {
  const meta = derivePublicationMetadata({
    filename: 'MIN-2026-08.pdf',
    category: 'MIN',
    numPages: 12,
  })
  assert.equal(meta.title, 'MIN 2026 08')
  assert.equal(meta.series, 'MIN')
  assert.equal(meta.editionDate, '2026-08-01')
  assert.equal(meta.editionCode, 'APRI-MIN-2026-08')
  assert.equal(meta.frequency, 'Monthly')
  assert.equal(meta.pageCount, 12)
  assert.equal(meta.kicker, 'August 2026')
  assert.ok(meta.summary.length > 0)
  assert.ok(meta.description.length > 0)
  assert.ok(meta.coverageAreas.length > 0)
  assert.equal(meta.productLine, 'Political Intelligence')
})

test('derivePublicationMetadata: QIB quarterly', () => {
  const meta = derivePublicationMetadata({
    filename: 'QIB-Q3-2026.pdf',
    category: 'QIB',
    numPages: 30,
  })
  assert.equal(meta.series, 'QIB')
  assert.equal(meta.editionDate, '2026-07-01')
  assert.equal(meta.frequency, 'Quarterly')
  assert.equal(meta.kicker, 'July 2026')
})

test('derivePublicationMetadata: OTHER category gets no template', () => {
  const meta = derivePublicationMetadata({
    filename: 'random-doc.pdf',
    category: 'OTHER',
  })
  assert.equal(meta.series, '')
  assert.equal(meta.frequency, '')
  assert.equal(meta.productLine, '')
  assert.equal(meta.editionCode, '')
})

test('derivePublicationMetadata: slug is lowercase with hyphens', () => {
  const meta = derivePublicationMetadata({
    filename: 'PLM August 2026 Report.pdf',
    category: 'PLM',
  })
  assert.equal(meta.slug, 'plm-august-2026-report')
})

test('derivePublicationMetadata: visibility from tier', () => {
  const meta = derivePublicationMetadata({
    filename: 'test.pdf',
    category: 'MIN',
    publicTier: 'Executive Intelligence',
  })
  assert.equal(meta.visibility, 'L3')
})

test('derivePublicationMetadata: AEO series', () => {
  const meta = derivePublicationMetadata({
    filename: 'AEO-2026-09.pdf',
    category: 'AEO',
  })
  assert.equal(meta.series, 'AEO')
  assert.equal(meta.frequency, 'Event-driven')
})

// ---------------------------------------------------------------------------
// 37. Auto-creation during sync
// ---------------------------------------------------------------------------

test('sync action: auto-creates publications for unlinked documents', () => {
  const src = read('src/app/actions/datarooms.ts')
  const fn = src.slice(src.indexOf('async function syncDataRoomForLevel'))
  assert.match(fn, /autoCreatePublicationsForRoom/)
})

test('DAL: autoCreatePublicationsForRoom exists and queries unlinked docs', () => {
  const src = read('src/lib/dataroom-dal.ts')
  const fn = src.slice(src.indexOf('async function autoCreatePublicationsForRoom'))
  assert.match(fn, /publication_id is null/)
  assert.match(fn, /is_present = true/)
  assert.match(fn, /createPublicationForSyncedDocument/)
})

test('DAL: autoCreatePublicationsForRoom tracks created, linked, skipped', () => {
  const src = read('src/lib/dataroom-dal.ts')
  const fn = src.slice(src.indexOf('async function autoCreatePublicationsForRoom'))
  assert.match(fn, /created\+\+/)
  assert.match(fn, /linked\+\+/)
  assert.match(fn, /skipped\+\+/)
})

// ---------------------------------------------------------------------------
// 38. Canonical matching
// ---------------------------------------------------------------------------

test('DAL: findCanonicalMatch checks papermark_document_id first', () => {
  const src = read('src/lib/dataroom-dal.ts')
  const fn = src.slice(
    src.indexOf('async function findCanonicalMatch'),
    src.indexOf('async function createPublicationForSyncedDocument'),
  )
  const pmIdPos = fn.indexOf('papermark_document_id')
  const canonicalPos = fn.indexOf('series =')
  assert.ok(pmIdPos < canonicalPos, 'Papermark ID match should come before canonical match')
})

test('DAL: findCanonicalMatch uses series + lower(title) + edition_date', () => {
  const src = read('src/lib/dataroom-dal.ts')
  const fn = src.slice(
    src.indexOf('async function findCanonicalMatch'),
    src.indexOf('async function createPublicationForSyncedDocument'),
  )
  assert.match(fn, /series =/)
  assert.match(fn, /lower\(title\)/)
  assert.match(fn, /edition_date =/)
})

test('DAL: findCanonicalMatch limits to 2 to detect ambiguity', () => {
  const src = read('src/lib/dataroom-dal.ts')
  const fn = src.slice(
    src.indexOf('async function findCanonicalMatch'),
    src.indexOf('async function createPublicationForSyncedDocument'),
  )
  assert.match(fn, /limit 2/)
  assert.match(fn, /\.length === 1/)
})

// ---------------------------------------------------------------------------
// 39. Race-safe slug generation
// ---------------------------------------------------------------------------

test('DAL: insertWithSafeSlug retries on slug conflict', () => {
  const src = read('src/lib/dataroom-dal.ts')
  const fn = src.slice(
    src.indexOf('async function insertWithSafeSlug'),
    src.indexOf('async function findCanonicalMatch'),
  )
  assert.match(fn, /23505/)
  assert.match(fn, /documents_slug_key/)
  assert.match(fn, /for.*attempt/)
})

test('DAL: insertWithSafeSlug appends suffix on conflict', () => {
  const src = read('src/lib/dataroom-dal.ts')
  const fn = src.slice(
    src.indexOf('async function insertWithSafeSlug'),
    src.indexOf('async function findCanonicalMatch'),
  )
  assert.match(fn, /`\$\{baseSlug\}-\$\{attempt \+ 1\}`/)
})

// ---------------------------------------------------------------------------
// 40. Generate missing details action
// ---------------------------------------------------------------------------

test('admin: generateMissingDetails action exists and requires owner', () => {
  const src = read('src/app/actions/datarooms.ts')
  assert.match(src, /async function generateMissingDetails/)
  const fn = src.slice(src.indexOf('async function generateMissingDetails'))
  assert.match(fn, /requireOwner/)
})

test('admin: generateMissingDetails calls generateMissingDetailsForRoom', () => {
  const src = read('src/app/actions/datarooms.ts')
  const fn = src.slice(src.indexOf('async function generateMissingDetails'))
  assert.match(fn, /generateMissingDetailsForRoom/)
})

test('DAL: generateMissingDetailsForRoom preserves admin edits', () => {
  const src = read('src/lib/dataroom-dal.ts')
  const fn = src.slice(src.indexOf('async function generateMissingDetailsForRoom'))
  assert.match(fn, /case when kicker = '' then/)
  assert.match(fn, /case when summary = '' then/)
  assert.match(fn, /case when description = '' then/)
  assert.match(fn, /case when series = '' then/)
})

test('DAL: generateMissingDetailsForRoom only fills empty fields', () => {
  const src = read('src/lib/dataroom-dal.ts')
  const fn = src.slice(src.indexOf('async function generateMissingDetailsForRoom'))
  assert.match(fn, /case when code is null then/)
  assert.match(fn, /case when edition_date is null then/)
  assert.match(fn, /case when page_count is null then/)
})

// ---------------------------------------------------------------------------
// 41. Generate missing details button in admin UI
// ---------------------------------------------------------------------------

test('admin: Generate missing details button exists', () => {
  const src = read('src/app/admin/datarooms/dataroom-form.tsx')
  assert.match(src, /Generate missing details/)
  assert.match(src, /generateMissingDetails/)
})

test('admin: Generate missing details imported from actions', () => {
  const src = read('src/app/admin/datarooms/dataroom-form.tsx')
  const importBlock = src.slice(src.indexOf('import {'), src.indexOf('} from "@/app/actions/datarooms"'))
  assert.match(importBlock, /generateMissingDetails/)
})

// ---------------------------------------------------------------------------
// 42. Same PDF across levels does not create duplicates
// ---------------------------------------------------------------------------

test('DAL: createPublicationForSyncedDocument checks for existing pub before insert', () => {
  const src = read('src/lib/dataroom-dal.ts')
  const createFn = src.slice(src.indexOf('async function createPublicationForSyncedDocument'))
  const matchPos = createFn.indexOf('findCanonicalMatch')
  const insertPos = createFn.indexOf('insertWithSafeSlug')
  assert.ok(matchPos > 0 && insertPos > 0, 'both match and insert calls should exist')
  assert.ok(matchPos < insertPos, 'canonical match should precede insert')
})

test('DAL: createPublicationForSyncedDocument returns created:false for matched pub', () => {
  const src = read('src/lib/dataroom-dal.ts')
  const fn = src.slice(src.indexOf('async function createPublicationForSyncedDocument'))
  const matchBlock = fn.slice(fn.indexOf('if (matchId)'))
  assert.match(matchBlock, /created: false/)
})

// ---------------------------------------------------------------------------
// 43. Repeated sync does not duplicate publications
// ---------------------------------------------------------------------------

test('DAL: createPublicationForSyncedDocument bails if publication_id already set', () => {
  const src = read('src/lib/dataroom-dal.ts')
  const fn = src.slice(src.indexOf('async function createPublicationForSyncedDocument'))
  const earlyReturn = fn.slice(0, fn.indexOf('derivePublicationMetadata'))
  assert.match(earlyReturn, /if \(doc\.publication_id\)/)
  assert.match(earlyReturn, /created: false/)
})

// ---------------------------------------------------------------------------
// 44. Full metadata is prefilled on auto-creation
// ---------------------------------------------------------------------------

test('DAL: insertWithSafeSlug writes all metadata fields', () => {
  const src = read('src/lib/dataroom-dal.ts')
  const fn = src.slice(
    src.indexOf('async function insertWithSafeSlug'),
    src.indexOf('async function findCanonicalMatch'),
  )
  const fields = [
    'slug', 'title', 'kicker', 'strapline', 'summary', 'description',
    'series', 'product_line', 'frequency', 'code', 'edition_date',
    'visibility', 'page_count', 'coverage_areas', 'papermark_document_id',
  ]
  for (const f of fields) {
    assert.match(fn, new RegExp(f), `insertWithSafeSlug should include ${f}`)
  }
})

// ---------------------------------------------------------------------------
// 45. Publications remain draft and editable
// ---------------------------------------------------------------------------

test('auto-created publications are draft and not published', () => {
  const src = read('src/lib/dataroom-dal.ts')
  const fn = src.slice(
    src.indexOf('async function insertWithSafeSlug'),
    src.indexOf('async function findCanonicalMatch'),
  )
  assert.match(fn, /\$\{'draft'\}/)
  assert.match(fn, /\$\{false\}/)
  assert.doesNotMatch(fn, /is_published.*true/)
})

// ---------------------------------------------------------------------------
// 46. Sync message reports publication counts
// ---------------------------------------------------------------------------

test('sync action: message includes publication creation counts', () => {
  const src = read('src/app/actions/datarooms.ts')
  const fn = src.slice(
    src.indexOf('async function syncDataRoomForLevel'),
    src.indexOf('// ---', src.indexOf('async function syncDataRoomForLevel') + 10),
  )
  assert.match(fn, /pubCounts\.created/)
  assert.match(fn, /pubCounts\.linked/)
})

// ---------------------------------------------------------------------------
// 47. derivePublicationMetadata uses contract functions
// ---------------------------------------------------------------------------

test('contract: derivePublicationMetadata exists and is exported', () => {
  assert.equal(typeof derivePublicationMetadata, 'function')
})

test('contract: parseEditionDate exists and is exported', () => {
  assert.equal(typeof parseEditionDate, 'function')
})

test('contract: generateEditionCode exists and is exported', () => {
  assert.equal(typeof generateEditionCode, 'function')
})
