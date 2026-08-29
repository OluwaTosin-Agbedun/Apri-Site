/**
 * Publication-access logic -- comprehensive tests.
 *
 * Covers: Open Edition behaviour, subscriber-only teasers, corrected L1/L2
 * hierarchy, admin validation, public interface badges and CTAs, and the
 * entitlement rule.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  PUBLIC_TIERS,
  LEVELS,
  accessBadge,
  isEntitled,
  levelName,
  minimumLevelLabel,
  visibilitiesForLevel,
  tierNameForVisibility,
  levelForPublicTier,
} from '../src/lib/entitlements.ts'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// ---------------------------------------------------------------------------
// 1. Corrected access hierarchy — L1 is Individual/Team, L2 is Political Monitor
// ---------------------------------------------------------------------------

test('hierarchy: Individual Access maps to L1', () => {
  assert.equal(levelForPublicTier('Individual Access'), 'L1')
})

test('hierarchy: Professional Team Access maps to L1', () => {
  assert.equal(levelForPublicTier('Professional Team Access'), 'L1')
})

test('hierarchy: Political Monitor maps to L2', () => {
  assert.equal(levelForPublicTier('Political Monitor'), 'L2')
})

test('hierarchy: Executive Intelligence maps to L3', () => {
  assert.equal(levelForPublicTier('Executive Intelligence'), 'L3')
})

test('hierarchy: Board Briefing maps to L4', () => {
  assert.equal(levelForPublicTier('Board Briefing'), 'L4')
})

test('hierarchy: rank order is L1 < L2 < L3 < L4 (verified via entitlement)', () => {
  assert.equal(isEntitled('L1', 'L2'), false, 'L1 cannot see L2')
  assert.equal(isEntitled('L2', 'L1'), true, 'L2 can see L1')
  assert.equal(isEntitled('L2', 'L3'), false, 'L2 cannot see L3')
  assert.equal(isEntitled('L3', 'L2'), true, 'L3 can see L2')
  assert.equal(isEntitled('L3', 'L4'), false, 'L3 cannot see L4')
  assert.equal(isEntitled('L4', 'L3'), true, 'L4 can see L3')
})

// ---------------------------------------------------------------------------
// 2. Entitlement visibility — who sees what
// ---------------------------------------------------------------------------

test('entitlement: L1 subscriber sees only L1 content', () => {
  assert.deepEqual(visibilitiesForLevel('L1'), ['L1'])
})

test('entitlement: L2 subscriber sees L1 + L2', () => {
  assert.deepEqual(visibilitiesForLevel('L2'), ['L1', 'L2'])
})

test('entitlement: L3 subscriber sees L1 + L2 + L3', () => {
  assert.deepEqual(visibilitiesForLevel('L3'), ['L1', 'L2', 'L3'])
})

test('entitlement: L4 subscriber sees all levels', () => {
  assert.deepEqual(visibilitiesForLevel('L4'), ['L1', 'L2', 'L3', 'L4'])
})

test('entitlement: OPEN is never included in subscriber visibility', () => {
  for (const level of LEVELS) {
    assert.ok(!visibilitiesForLevel(level).includes('OPEN'))
  }
})

test('entitlement: isEntitled rejects OPEN visibility', () => {
  for (const level of LEVELS) {
    assert.equal(isEntitled(level, 'OPEN'), false)
  }
})

test('entitlement: L1 subscriber is not entitled to L2 content', () => {
  assert.equal(isEntitled('L1', 'L2'), false)
})

test('entitlement: L2 subscriber is entitled to L1 content', () => {
  assert.equal(isEntitled('L2', 'L1'), true)
})

// ---------------------------------------------------------------------------
// 3. L1 seat disambiguation
// ---------------------------------------------------------------------------

test('levelName: L1 with 1 seat returns Individual Access', () => {
  assert.equal(levelName('L1', 1), 'Individual Access')
})

test('levelName: L1 with 5 seats returns Professional Team Access', () => {
  assert.equal(levelName('L1', 5), 'Professional Team Access')
})

test('levelName: L2 is always Political Monitor regardless of seats', () => {
  assert.equal(levelName('L2', 1), 'Political Monitor')
  assert.equal(levelName('L2', 5), 'Political Monitor')
})

// ---------------------------------------------------------------------------
// 4. Open Edition badge and CTA
// ---------------------------------------------------------------------------

test('accessBadge: OPEN shows "Open Edition — verified email required"', () => {
  assert.equal(accessBadge('OPEN'), 'Open Edition — verified email required')
})

test('accessBadge: paid levels say "Subscriber Access"', () => {
  for (const level of LEVELS) {
    assert.match(accessBadge(level), /^Subscriber Access — /)
  }
})

test('accessBadge: L1 subscriber badge says "Individual Access and above"', () => {
  assert.match(accessBadge('L1'), /Individual Access and above/)
})

test('accessBadge: L2 subscriber badge says "Political Monitor and above"', () => {
  assert.match(accessBadge('L2'), /Political Monitor and above/)
})

test('accessBadge: L4 subscriber badge says "Board Intelligence" without "and above"', () => {
  assert.match(accessBadge('L4'), /Board Intelligence/)
  assert.doesNotMatch(accessBadge('L4'), /and above/)
})

// ---------------------------------------------------------------------------
// 5. tierNameForVisibility — maps levels to stored tier names for URL params
// ---------------------------------------------------------------------------

test('tierNameForVisibility: L1 returns Individual Access', () => {
  assert.equal(tierNameForVisibility('L1'), 'Individual Access')
})

test('tierNameForVisibility: L2 returns Political Monitor', () => {
  assert.equal(tierNameForVisibility('L2'), 'Political Monitor')
})

test('tierNameForVisibility: L3 returns Executive Intelligence', () => {
  assert.equal(tierNameForVisibility('L3'), 'Executive Intelligence')
})

test('tierNameForVisibility: L4 returns Board Briefing', () => {
  assert.equal(tierNameForVisibility('L4'), 'Board Briefing')
})

// ---------------------------------------------------------------------------
// 6. PublicationAccess component — CTA text and link targets
// ---------------------------------------------------------------------------

test('AccessAction: OPEN CTA says "Access Open Edition"', () => {
  const src = read('src/components/PublicationAccess.tsx')
  assert.match(src, /Access Open Edition/)
  assert.doesNotMatch(src, /Read now/)
})

test('AccessAction: subscriber-only CTA says "Request Access"', () => {
  const src = read('src/components/PublicationAccess.tsx')
  assert.match(src, /Request Access/)
})

test('AccessAction: subscriber-only links to /access with level param', () => {
  const src = read('src/components/PublicationAccess.tsx')
  assert.match(src, /\/access\?level=/)
  assert.match(src, /#subscribe/)
})

test('AccessAction: subscriber-only never links to /portal', () => {
  const src = read('src/components/PublicationAccess.tsx')
  // The component should not reference /portal for public cards
  assert.doesNotMatch(src, /\/portal/)
})

test('PublicationAccess imports tierNameForVisibility', () => {
  const src = read('src/components/PublicationAccess.tsx')
  assert.match(src, /tierNameForVisibility/)
})

// ---------------------------------------------------------------------------
// 7. publications.ts — public queries return both types, strip private data
// ---------------------------------------------------------------------------

test('getPublishedPublications: does not filter by OPEN only', () => {
  const src = read('src/lib/publications.ts')
  const fn = src.slice(
    src.indexOf('async function getPublishedPublications'),
    src.indexOf('async function getOpenPublications') !== -1
      ? src.indexOf('async function getOpenPublications')
      : src.indexOf('async function getPublicationBySlug')
  )
  assert.doesNotMatch(fn, /visibility = 'OPEN'/)
})

test('getPublicationBySlug: does not filter by OPEN only', () => {
  const src = read('src/lib/publications.ts')
  const fn = src.slice(
    src.indexOf('async function getPublicationBySlug')
  )
  assert.doesNotMatch(fn, /visibility = 'OPEN'/)
})

test('publications.ts has toPublicPublication sanitizer', () => {
  const src = read('src/lib/publications.ts')
  assert.match(src, /function toPublicPublication/)
  assert.match(src, /papermarkLink: ''/)
  assert.match(src, /openLinkUrl: null/)
})

test('public queries apply toPublicPublication', () => {
  const src = read('src/lib/publications.ts')
  assert.match(src, /\.map\(toPublicPublication\)/)
})

// ---------------------------------------------------------------------------
// 8. Admin validation — OPEN needs public link, restricted clears it
// ---------------------------------------------------------------------------

test('admin: OPEN edition publish requires open_link_url', () => {
  const src = read('src/app/actions/documents.ts')
  assert.match(src, /visibility === 'OPEN' && !row\.open_link_url/)
})

test('admin: saveDocument clears openLinkUrl for non-OPEN visibility', () => {
  const src = read('src/app/actions/documents.ts')
  assert.match(src, /visibility === 'OPEN'/)
  // The ternary that nullifies openLinkUrl for restricted publications
  const saveSection = src.slice(src.indexOf('async function saveDocument'))
  assert.match(saveSection, /d\.visibility === 'OPEN' \? \(d\.openLinkUrl \|\| null\) : null/)
})

// ---------------------------------------------------------------------------
// 9. Admin page description updated for mixed types
// ---------------------------------------------------------------------------

test('admin documents page describes both OPEN and subscriber-only', () => {
  const src = read('src/app/admin/documents/page.tsx')
  assert.match(src, /Open editions/)
  assert.match(src, /subscriber-only/)
  assert.doesNotMatch(src, /Only Open items/)
})

// ---------------------------------------------------------------------------
// 10. Public page copy updated for mixed types
// ---------------------------------------------------------------------------

test('publications page describes both open and subscriber content', () => {
  const src = read('src/app/publications/page.tsx')
  assert.match(src, /Open editions/)
  assert.match(src, /subscriber/)
})

// ---------------------------------------------------------------------------
// 11. level-changes.ts rank is consistent with entitlements RANK
// ---------------------------------------------------------------------------

test('level-changes.ts rank matches canonical RANK', () => {
  const src = read('src/lib/level-changes.ts')
  assert.match(src, /L1: 1, L2: 2, L3: 3, L4: 4/)
})

// ---------------------------------------------------------------------------
// 12. Security: papermarkLink never reaches public components
// ---------------------------------------------------------------------------

test('PublicationAccess never uses papermarkLink as a prop or variable', () => {
  const src = read('src/components/PublicationAccess.tsx')
  // Strip comments before checking — the docstring mentions the column name
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')
  assert.doesNotMatch(code, /papermarkLink/)
  assert.doesNotMatch(code, /papermark_link/)
})

test('publication detail page never directly renders papermarkLink', () => {
  const src = read('src/app/publications/[slug]/page.tsx')
  assert.doesNotMatch(src, /papermarkLink/)
})

test('publications list page never directly renders papermarkLink', () => {
  const src = read('src/app/publications/page.tsx')
  assert.doesNotMatch(src, /papermarkLink/)
})

// ---------------------------------------------------------------------------
// 13. PUBLIC_TIERS level assignments after hierarchy correction
// ---------------------------------------------------------------------------

test('PUBLIC_TIERS: both L1 tiers are Individual Access and Professional Team', () => {
  const l1Tiers = PUBLIC_TIERS.filter((t) => t.level === 'L1').map((t) => t.name)
  assert.deepEqual(l1Tiers, ['Individual Access', 'Professional Team Access'])
})

test('PUBLIC_TIERS: L2 is Political Monitor only', () => {
  const l2Tiers = PUBLIC_TIERS.filter((t) => t.level === 'L2').map((t) => t.name)
  assert.deepEqual(l2Tiers, ['Political Monitor'])
})

// ---------------------------------------------------------------------------
// 14. Papermark sync source constraint
// ---------------------------------------------------------------------------

test('Papermark sync uses "07 Open Editions" folder only', () => {
  const src = read('src/app/api/admin/papermark/sync/route.ts')
  assert.match(src, /07 Open Editions/)
})

// ---------------------------------------------------------------------------
// 15. Subscriber DAL uses visibilitiesForLevel
// ---------------------------------------------------------------------------

test('subscriber library query uses visibilitiesForLevel', () => {
  const src = read('src/lib/subscriber-dal.ts')
  assert.match(src, /visibilitiesForLevel/)
})

// ---------------------------------------------------------------------------
// 16. No secrets in public components
// ---------------------------------------------------------------------------

test('no PAPERMARK_API_KEY reference in public components', () => {
  const publicFiles = [
    'src/components/PublicationAccess.tsx',
    'src/app/publications/page.tsx',
    'src/app/publications/[slug]/page.tsx',
    'src/app/page.tsx',
  ]
  for (const file of publicFiles) {
    const src = read(file)
    assert.doesNotMatch(src, /PAPERMARK_API_KEY/)
    assert.doesNotMatch(src, /process\.env\.PAPERMARK/)
  }
})
