import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SECTION_LABELS } from '../src/lib/papermark-contract.ts'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const portal = read('src/app/portal/page.tsx')
const viewer = read('src/app/portal/document/[id]/page.tsx')
const dataLayer = read('src/lib/papermark-client-library.ts')

// ---------------------------------------------------------------------------
// What the subscriber lands on
// ---------------------------------------------------------------------------

test('the portal has no Open Private Library button', () => {
  for (const source of [portal, viewer]) {
    assert.doesNotMatch(source, /Open Private Library/i)
    assert.doesNotMatch(source, /Open your briefing/i)
  }
  // Nothing anywhere sends a reader out to the old redirect as a primary route.
  assert.doesNotMatch(portal, /portal\/open-private/)
})

test('documents render on the portal itself rather than behind a link out', () => {
  // Legacy pipeline still fetched and grouped on the page.
  assert.match(portal, /getSyncedClientDocuments\(principal, \{ previousVisit \}\)/)
  assert.match(portal, /groupBySection\(documents\)/)
  // DR pipeline uses its own grid and cards.
  assert.match(portal, /function DataRoomGrid/)
  assert.match(portal, /function DataRoomCard/)
  // Legacy pipeline keeps its own grid and cards.
  assert.match(portal, /function LegacyDocumentGrid/)
  assert.match(portal, /function LegacyDocumentCard/)
})

test('every section the brief names is rendered, and empty ones are hidden', () => {
  assert.equal(SECTION_LABELS.MIN, 'Monthly Intelligence Notes')
  assert.equal(SECTION_LABELS.AIU, 'Athena Intelligence Updates')
  assert.equal(SECTION_LABELS.OTHER, 'Other Assigned Publications')

  // Legacy pipeline uses LIBRARY_SECTIONS
  assert.match(portal, /LIBRARY_SECTIONS\.map/)
  assert.match(portal, /sections\[section\]\.length === 0 \? null/)

  // DR pipeline uses PORTAL_CATEGORIES (filtered then mapped)
  assert.match(portal, /PORTAL_CATEGORIES\.filter/)
})

test('Latest Publications always shows content for DR subscribers', () => {
  // When fewer new docs exist, the most recent documents are shown instead.
  assert.match(portal, /latestToShow\.length === 0 \?/)
  assert.match(portal, /latest\.length > 0 \? latest : documents\.slice\(0, 6\)/)
})

test('a card shows the title, the type, a date and a badge only when earned', () => {
  // Legacy cards
  assert.match(portal, /\{document\.typeLabel\}/)
  assert.match(portal, /\{document\.title\}/)
  assert.match(portal, /document\.changedAt \? formatDate\(document\.changedAt\)/)
  assert.match(portal, /\{document\.isNew && \(/)
  // DR cards
  assert.match(portal, /\{document\.categoryLabel\}/)
  assert.match(portal, /\{document\.badge && \(/)
})

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

test('the portal uses full width with safe gutters and single-column grid', () => {
  // Up to 1800px, gutters of 16px rising to 24px, 32px then 48px.
  assert.match(portal, /max-w-\[1800px\]/)
  assert.match(portal, /px-4 sm:px-6/)
  assert.doesNotMatch(portal.slice(0, portal.indexOf('function LockedLibrary')), /max-w-3xl/)

  // One card per row at every breakpoint — no multi-column grids.
  assert.doesNotMatch(portal, /sm:grid-cols-2/)
  assert.doesNotMatch(portal, /xl:grid-cols-3/)
  assert.doesNotMatch(portal, /2xl:grid-cols-4/)
})

test('the viewer fills the content width and has a viewport-height embed', () => {
  const embed = read('src/components/PapermarkEmbed.tsx')
  assert.match(embed, /min-h-\[70vh\] lg:min-h-\[78vh\]/)
  assert.match(embed, /w-full/)
  assert.match(viewer, /max-w-\[1800px\]/)
  assert.match(viewer, /100dvh/)
})

test('nothing forces the page to scroll sideways on a phone', () => {
  // Every grid starts at one column and only widens at a breakpoint.
  const grids = portal.match(/grid grid-cols-[^"]*/g) ?? []
  assert.ok(grids.length > 0, 'the portal no longer uses a grid')
  for (const grid of grids) {
    assert.match(grid, /grid-cols-1\b/, `a grid starts wider than one column: ${grid}`)
  }

  // The width is capped, never fixed: a max-width shrinks on a narrow screen,
  // a plain width does not.
  assert.doesNotMatch(portal, /(?<!max-)(?<!min-)\bw-\[\d+px\]/)
  assert.doesNotMatch(portal, /\bmin-w-\[\d{3,}px\]/)
  assert.doesNotMatch(portal, /overflow-x-(?:scroll|auto)/)
  assert.match(portal, /w-full max-w-\[1800px\]/)
})

// ---------------------------------------------------------------------------
// Who can open what
// ---------------------------------------------------------------------------

test('a document route resolves through the session, never through the URL', () => {
  assert.match(viewer, /requirePortalPrincipal\(\)/)
  // DR pipeline tried first, legacy fallback second — both scoped to the principal.
  assert.match(viewer, /getDataRoomDocumentForSubscriber\(principal\.id, decodedId\)/)
  assert.match(viewer, /getSyncedClientDocument\(principal, decodedId\)/)
  assert.match(viewer, /if \(!document\) notFound\(\)/)
  assert.match(viewer, /if \(!principal\.hasAccess\) notFound\(\)/)

  // No share URL, email or token is ever read from the page's query string.
  // url.searchParams.set() is used to construct a deep-link URL, not to read
  // untrusted input from the page's own URL.
  assert.doesNotMatch(viewer, /await searchParams|props\.searchParams|\.searchParams\)\.get/)
})

test('a document lookup is always bound to the subscriber, so it cannot cross clients', () => {
  const lookup = dataLayer.slice(
    dataLayer.indexOf('export async function getSyncedClientDocument('),
    dataLayer.indexOf('export async function getPreviousPortalVisit'),
  )

  assert.match(lookup, /where subscriber_id=\$\{principal\.id\} and papermark_document_id=/)
  assert.doesNotMatch(dataLayer, /where papermark_document_id=\$\{[^}]+\}\s*\n?\s*limit/)
})

test('the portal has no briefing portal path', () => {
  assert.doesNotMatch(portal, /BriefingPortal/)
  assert.doesNotMatch(portal, /principal\.type === "briefing"/)
  assert.doesNotMatch(portal, /Your private briefing/)
})

test('the data layer has no briefing branches', () => {
  assert.doesNotMatch(dataLayer, /briefing_request_id=\$\{principal/)
  assert.doesNotMatch(dataLayer, /principal\.type === "briefing"/)
})

test('the folders APRI must never expose stay excluded', () => {
  const action = read('src/app/actions/papermark-client-library.ts')
  assert.match(action, /"00 Masters"/)
  assert.match(action, /"07 Open Editions"/)
  assert.match(action, /PAPERMARK_OPEN_EDITIONS_FOLDER_ID/)
})

// ---------------------------------------------------------------------------
// Sign-in, once per device
// ---------------------------------------------------------------------------

test('the site header no longer carries a Sign in link', () => {
  const header = read('src/components/SiteHeader.tsx')
  assert.doesNotMatch(header, />\s*Sign in\s*</)
  assert.doesNotMatch(header, /PORTAL_ENABLED/)
})

test('a verified device goes straight to the library, whichever kind of client it is', () => {
  const signIn = read('src/app/portal/sign-in/page.tsx')
  const home = read('src/app/page.tsx')
  const dal = read('src/lib/subscriber-dal.ts')

  assert.match(signIn, /if \(await hasPortalSession\(\)\) redirect\("\/portal"\)/)
  assert.doesNotMatch(signIn, /getCurrentSubscriber/)
  assert.match(dal, /export async function hasPortalSession/)

  // The public call to action goes to the library, not to a form.
  assert.match(home, /href="\/portal"\s*\n?\s*className="btn-primary"/)
})

test('the portal explains the Papermark check rather than adding an APRI one', () => {
  // Both legacy and DR viewer paths explain the Papermark check.
  assert.match(viewer, /Papermark/)
  assert.match(viewer, /document-security check/)
  // No second APRI verification screen is introduced.
  assert.doesNotMatch(viewer, /Verify your email|Confirm your identity/i)
})

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

test('no Papermark credential can reach a client component', () => {
  for (const path of [
    'src/app/portal/page.tsx',
    'src/app/portal/document/[id]/page.tsx',
    'src/components/PapermarkFolderSelector.tsx',
    'src/components/PapermarkEmbed.tsx',
  ]) {
    const source = read(path)
    assert.doesNotMatch(source, /PAPERMARK_API_TOKEN|PAPERMARK_API_KEY/)
    assert.doesNotMatch(source, /NEXT_PUBLIC_PAPERMARK/)
  }

  // The API client is server-only, so importing it from a client component is
  // a build error rather than a leak.
  assert.match(read('src/lib/papermark.ts'), /^import 'server-only'/m)
  assert.match(read('src/lib/papermark-client-library.ts'), /^import "server-only"/m)
})

test('DR cards show both Download and View buttons', () => {
  const cardSection = portal.slice(
    portal.indexOf('function DataRoomCard'),
    portal.indexOf('function LegacyDocumentGrid') > -1
      ? portal.indexOf('function LegacyDocumentGrid')
      : portal.length,
  )
  assert.match(cardSection, /Download/)
  assert.match(cardSection, /View/)
  assert.match(cardSection, /\/portal\/document\/.*\/download/)
  assert.match(cardSection, /\/portal\/document\/.*[^/]`\}/)
})

test('the download route validates the subscriber server-side', () => {
  const downloadRoute = read('src/app/portal/document/[id]/download/route.ts')
  assert.match(downloadRoute, /requirePortalPrincipal\(\)/)
  assert.match(downloadRoute, /getDataRoomDocumentForSubscriber\(principal\.id/)
  assert.match(downloadRoute, /document_downloaded/)
  assert.match(downloadRoute, /recordClientEvent/)
  assert.doesNotMatch(downloadRoute, /PAPERMARK_API_TOKEN|PAPERMARK_API_KEY/)
})

test('a share URL is never handed to the browser as a link target on the list', () => {
  // Cards carry a document id; the share URL is resolved server-side on the
  // viewer page. A grid full of private URLs would leak every one of them into
  // the page source.
  assert.match(portal, /href=\{`\/portal\/document\/\$\{encodeURIComponent\(document\.id\)\}`\}/)
  assert.doesNotMatch(portal, /href=\{document\.shareUrl\}/)
})
