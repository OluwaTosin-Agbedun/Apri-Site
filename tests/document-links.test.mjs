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
  documentLinkSettings,
  humaniseFilename,
  watermarkText,
  portalTypeLabel,
  portalCategoryLabel,
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

test('documentLinkSettings watermark contains name and email literally', () => {
  const settings = documentLinkSettings({
    documentId: 'doc-123',
    assignedName: 'Nwaokike Desmond',
    assignedEmail: 'desmond@example.com',
    expiresAt: null,
  })
  assert.match(settings.watermark_config.text, /Nwaokike Desmond/)
  assert.match(settings.watermark_config.text, /desmond@example\.com/)
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

test('watermark: contains APRI CONFIDENTIAL', () => {
  const text = watermarkText('Test User', 'test@example.com')
  assert.match(text, /APRI CONFIDENTIAL/)
})

test('watermark: contains assigned name and email', () => {
  const text = watermarkText('Nwaokike Desmond', 'desmond@example.com')
  assert.match(text, /Nwaokike Desmond/)
  assert.match(text, /desmond@example\.com/)
})

test('watermark: contains dynamic date token', () => {
  const text = watermarkText('Test', 'test@x.com')
  assert.match(text, /\{\{date\}\}/)
  assert.match(text, /\{\{time\}\}/)
  assert.match(text, /\{\{ipAddress\}\}/)
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
  assert.match(src, /Needs details/)
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
