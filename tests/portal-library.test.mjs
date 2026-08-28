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
  // The list is fetched and grouped on the page, not deferred to a button.
  assert.match(portal, /getSyncedClientDocuments\(principal, \{ previousVisit \}\)/)
  assert.match(portal, /groupBySection\(documents\)/)
  assert.match(portal, /function DocumentGrid/)
  assert.match(portal, /function DocumentCard/)
})

test('every section the brief names is rendered, and empty ones are hidden', () => {
  assert.equal(SECTION_LABELS.MIN, 'Monthly Intelligence Notes')
  assert.equal(SECTION_LABELS.AIU, 'Athena Intelligence Updates')
  assert.equal(SECTION_LABELS.OTHER, 'Other Assigned Publications')

  assert.match(portal, /"Latest updates"/)
  assert.match(portal, /LIBRARY_SECTIONS\.map/)
  // A section with nothing in it renders nothing at all.
  assert.match(portal, /sections\[section\]\.length === 0 \? null/)
})

test('Latest Updates keeps an empty state instead of disappearing', () => {
  assert.match(portal, /latest\.length === 0 \?/)
  assert.match(portal, /Nothing new since your last visit/)
})

test('a card shows the title, the type, a date and a New badge only when earned', () => {
  assert.match(portal, /\{document\.typeLabel\}/)
  assert.match(portal, /\{document\.title\}/)
  assert.match(portal, /document\.changedAt \? formatDate\(document\.changedAt\)/)
  assert.match(portal, /\{document\.isNew && \(/)
})

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

test('the portal uses the desktop width, with safe gutters and a column grid', () => {
  // Up to 1600px, gutters of 24px rising to 32px -- not a reading measure.
  assert.match(portal, /max-w-\[1600px\]/)
  assert.match(portal, /px-6 sm:px-8/)
  assert.doesNotMatch(portal.slice(0, portal.indexOf('function LockedLibrary')), /max-w-3xl/)

  // Multiple columns on a desktop, one on a phone.
  assert.match(portal, /grid-cols-1 md:grid-cols-2 xl:grid-cols-3/)
})

test('the viewer fills the content width and has a practical desktop height', () => {
  const embed = read('src/components/PapermarkEmbed.tsx')
  assert.match(embed, /min-h-\[70vh\] lg:min-h-\[78vh\]/)
  assert.match(embed, /w-full/)
  assert.match(viewer, /max-w-\[1600px\]/)
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
  assert.match(portal, /w-full max-w-\[1600px\]/)
})

// ---------------------------------------------------------------------------
// Who can open what
// ---------------------------------------------------------------------------

test('a document route resolves through the session, never through the URL', () => {
  assert.match(viewer, /requirePortalPrincipal\(\)/)
  assert.match(viewer, /getSyncedClientDocument\(principal, decodeURIComponent\(id\)\)/)
  assert.match(viewer, /if \(!document\) notFound\(\)/)
  assert.match(viewer, /if \(!principal\.hasAccess\) notFound\(\)/)

  // No share URL, email or token is ever read from the query string.
  assert.doesNotMatch(viewer, /searchParams/)
})

test('a document lookup is always bound to the principal, so it cannot cross clients', () => {
  const lookup = dataLayer.slice(
    dataLayer.indexOf('export async function getSyncedClientDocument('),
    dataLayer.indexOf('export async function getPreviousPortalVisit'),
  )

  // Both branches filter by the principal's own id as well as the document id.
  assert.match(lookup, /where subscriber_id=\$\{principal\.id\} and papermark_document_id=/)
  assert.match(lookup, /where briefing_request_id=\$\{principal\.id\} and papermark_document_id=/)

  // And there is no lookup by document id alone anywhere in the module.
  assert.doesNotMatch(dataLayer, /where papermark_document_id=\$\{[^}]+\}\s*\n?\s*limit/)
})

test('subscriber and briefing libraries never read each other', () => {
  assert.match(dataLayer, /principal\.type === "subscriber"/)
  // Each branch names exactly one owning column.
  const subscriberQueries = dataLayer.match(/where subscriber_id=/g) ?? []
  const briefingQueries = dataLayer.match(/where briefing_request_id=/g) ?? []
  assert.ok(subscriberQueries.length >= 2)
  assert.ok(briefingQueries.length >= 2)
  assert.doesNotMatch(dataLayer, /subscriber_id=.*or briefing_request_id=/)
})

test('a briefing client sees a briefing and none of the subscriber furniture', () => {
  const briefingPortal = portal.slice(
    portal.indexOf('async function BriefingPortal'),
    portal.indexOf('function PortalSection'),
  )

  assert.match(briefingPortal, /Your private briefing/)
  assert.doesNotMatch(briefingPortal, /SECTION_LABELS|groupBySection|Published editions/)
  assert.doesNotMatch(briefingPortal, /getLibraryFor/)

  // And the subscriber path is only reached after the briefing path returns.
  const briefingBranch = portal.indexOf('if (principal.type === "briefing")')
  const subscriberFetch = portal.indexOf('getLibraryFor(principal)')
  assert.ok(briefingBranch > -1 && briefingBranch < subscriberFetch)
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
  assert.match(viewer, /Papermark&rsquo;s own document-security check/)
  assert.match(viewer, /not be asked to sign in to APRI again/)
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

test('a share URL is never handed to the browser as a link target on the list', () => {
  // Cards carry a document id; the share URL is resolved server-side on the
  // viewer page. A grid full of private URLs would leak every one of them into
  // the page source.
  assert.match(portal, /href=\{`\/portal\/document\/\$\{encodeURIComponent\(document\.id\)\}`\}/)
  assert.doesNotMatch(portal, /href=\{document\.shareUrl\}/)
})
