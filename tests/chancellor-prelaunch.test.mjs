/**
 * Chancellor's pre-launch instructions -- comprehensive tests.
 *
 * Covers every section of the task: copy, hierarchy, form, access-flow,
 * display-name mapping, link separation, security wording and delivery notices.
 *
 * All tests are static -- they read source files and exported functions rather
 * than spinning up a running server, so `node --test` runs them in seconds.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  tierDisplayName,
  TIER_DESCRIPTIONS,
  PUBLIC_TIERS,
  PUBLIC_TIER_NAMES,
  levelName,
  minimumLevelLabel,
  accessBadge,
} from '../src/lib/entitlements.ts'
// delivery.ts has `import 'server-only'` so it cannot be imported in tests.
// Test its wording by reading the source text instead.

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// ---------------------------------------------------------------------------
// Section 1 – Masthead: stacked "APRI" + full name
// ---------------------------------------------------------------------------

test('S1: masthead renders APRI on its own line with full name beneath', () => {
  const header = read('src/components/SiteHeader.tsx')
  assert.match(header, /font-serif.*APRI/)
  assert.match(header, /Athena Political &amp; Regulatory Intelligence/)
  assert.doesNotMatch(header, /\|/, 'the single-line separator pipe is gone')
})

// ---------------------------------------------------------------------------
// Section 2 – Hero copy
// ---------------------------------------------------------------------------

test('S2: hero uses approved headline and sub-copy', () => {
  const page = read('src/app/page.tsx')
  assert.match(page, /Athena Political &amp; Regulatory Intelligence/)
  assert.match(page, /Independent political, regulatory and political-economy intelligence/)
  assert.match(page, /operating, investing and making strategic decisions in Nigeria/)
})

// ---------------------------------------------------------------------------
// Section 3 – Hero CTAs: subscriber library + request a briefing
// ---------------------------------------------------------------------------

test('S3: hero has two CTAs with correct targets', () => {
  const page = read('src/app/page.tsx')
  assert.match(page, /href="\/portal"/)
  assert.match(page, /Access Subscriber Library/)
  assert.match(page, /href="\/services"/)
  assert.match(page, /Request a Briefing/)
})

// ---------------------------------------------------------------------------
// Section 4 – Publications section heading and intro
// ---------------------------------------------------------------------------

test('S4: publications section uses correct heading and copy', () => {
  const page = read('src/app/page.tsx')
  assert.match(page, /Publications &amp; Briefings/)
  assert.match(page, /publishes written intelligence on Nigeria/)
})

test('S4: empty publications state renders nothing, not a developer box', () => {
  const page = read('src/app/page.tsx')
  assert.match(page, /documents\.length === 0 \? null/)
})

// ---------------------------------------------------------------------------
// Section 5 – "What APRI Tracks" (8 approved items)
// ---------------------------------------------------------------------------

test('S5: What APRI Tracks lists exactly the 8 approved items', () => {
  const page = read('src/app/page.tsx')
  const items = [
    'Political Power & Coalition Dynamics',
    'Executive & Legislative Watch',
    'Government & Regulatory Intelligence',
    'Policy Implementation & Institutional Behaviour',
    'Sector Exposure & Operating Risk',
    'State-Level Political Risk',
    'Election & Transition Risk',
    'Political Economy Outlook',
  ]
  for (const item of items) {
    assert.ok(page.includes(item), `missing: ${item}`)
  }
})

// ---------------------------------------------------------------------------
// Section 6 – "Built for consequential decisions."
// ---------------------------------------------------------------------------

test('S6: "Built for consequential decisions." section with approved copy', () => {
  const page = read('src/app/page.tsx')
  assert.match(page, /Built for consequential decisions\./)
  assert.match(page, /boards and executives responsible for strategy/)
  assert.match(page, /government relations and regulated operations in Nigeria/)
})

// ---------------------------------------------------------------------------
// Section 7 – The APRI Approach
// ---------------------------------------------------------------------------

test('S7: The APRI Approach section with signal-interpretation-implication', () => {
  const page = read('src/app/page.tsx')
  assert.match(page, /The APRI Approach/)
  assert.match(page, /Signal\. Interpretation\. Implication\./)
  assert.match(page, /APRI distinguishes political noise/)
  assert.match(page, /What changed/)
  assert.match(page, /Why it matters/)
  assert.match(page, /What to watch/)
})

// ---------------------------------------------------------------------------
// Section 8 – Subscription levels: display names + approved descriptions
// ---------------------------------------------------------------------------

test('S8: all five tiers have approved descriptions', () => {
  const expected = {
    'Individual Access': 'Core APRI publications for one named reader.',
    'Professional Team Access': 'The same core access for a small team of individually named readers.',
    'Political Monitor': /continuing political and regulatory monitoring/,
    'Executive Intelligence': /Full APRI intelligence plus the executive layer/,
    'Board Briefing': /Full APRI intelligence, priority bespoke analysis/,
  }

  for (const [tier, desc] of Object.entries(expected)) {
    assert.ok(TIER_DESCRIPTIONS[tier], `missing description for ${tier}`)
    if (typeof desc === 'string') {
      assert.equal(TIER_DESCRIPTIONS[tier], desc)
    } else {
      assert.match(TIER_DESCRIPTIONS[tier], desc)
    }
  }
})

test('S8: Board Briefing displays as Board Intelligence everywhere', () => {
  assert.equal(tierDisplayName('Board Briefing'), 'Board Intelligence')
})

test('S8: non-overridden tiers display as themselves', () => {
  assert.equal(tierDisplayName('Individual Access'), 'Individual Access')
  assert.equal(tierDisplayName('Political Monitor'), 'Political Monitor')
  assert.equal(tierDisplayName('Executive Intelligence'), 'Executive Intelligence')
})

test('S8: PUBLIC_TIERS still stores Board Briefing as the L4 name', () => {
  const l4 = PUBLIC_TIERS.find((t) => t.level === 'L4')
  assert.equal(l4?.name, 'Board Briefing')
})

test('S8: access page cards use "Request Access" CTA, not subscribe', () => {
  const page = read('src/app/access/page.tsx')
  assert.match(page, /Request Access/)
  assert.doesNotMatch(page, /Subscribe to/)
})

// ---------------------------------------------------------------------------
// Section 9 – tierDisplayName used across all surfaces
// ---------------------------------------------------------------------------

test('S9: admin subscriber list uses tierDisplayName', () => {
  const page = read('src/app/admin/subscribers/page.tsx')
  assert.match(page, /tierDisplayName\(sub\.public_tier\)/)
})

test('S9: admin subscriber form uses tierDisplayName', () => {
  const form = read('src/app/admin/subscribers/[id]/subscriber-form.tsx')
  assert.match(form, /tierDisplayName\(t\.name\)/)
})

test('S9: admin datarooms page uses tierDisplayName', () => {
  const page = read('src/app/admin/datarooms/page.tsx')
  assert.match(page, /tierDisplayName\(m\.publicTier\)/)
})

test('S9: admin dataroom form uses tierDisplayName', () => {
  const form = read('src/app/admin/datarooms/dataroom-form.tsx')
  assert.match(form, /tierDisplayName\(tier\)/)
})

test('S9: welcome email uses tierDisplayName', () => {
  const email = read('src/lib/subscriber-email.ts')
  assert.match(email, /tierDisplayName\(args\.publicTier\)/)
})

test('S9: admin notification email uses tierDisplayName', () => {
  const email = read('src/lib/email.ts')
  assert.match(email, /tierDisplayName/)
})

test('S9: portal page uses tierDisplayName', () => {
  const portal = read('src/app/portal/page.tsx')
  assert.match(portal, /tierDisplayName/)
})

test('S9: access form dropdown uses tierDisplayName', () => {
  const form = read('src/app/access-form.tsx')
  assert.match(form, /tierDisplayName\(level\)/)
})

test('S9: access page tier cards use tierDisplayName', () => {
  const page = read('src/app/access/page.tsx')
  assert.match(page, /tierDisplayName\(storedName\)/)
})

// ---------------------------------------------------------------------------
// Section 10 – Form: phone and notes fields removed
// ---------------------------------------------------------------------------

test('S10: public access form has no phone field', () => {
  const form = read('src/app/access-form.tsx')
  assert.doesNotMatch(form, /name="phone"/)
  assert.doesNotMatch(form, /type="tel"/)
  assert.doesNotMatch(form, /htmlFor="phone"/)
})

test('S10: public access form has no "Anything we should know?" field', () => {
  const form = read('src/app/access-form.tsx')
  assert.doesNotMatch(form, /Anything we should know/)
  assert.doesNotMatch(form, /name="note"/)
})

test('S10: terms checkbox remains required', () => {
  const form = read('src/app/access-form.tsx')
  assert.match(form, /name="acceptedTerms"/)
  assert.match(form, /required/)
  assert.match(form, /terms of use/)
  assert.match(form, /privacy notice/)
})

test('S10: one-business-day commitment remains', () => {
  const form = read('src/app/access-form.tsx')
  assert.match(form, /one business day/)
})

test('S10: server action handles missing phone field gracefully', () => {
  const action = read('src/app/actions/public.ts')
  assert.match(action, /formData\.get\("phone"\) \?\? ""/)
})

test('S10: Zod phone schema accepts empty string', () => {
  const defs = read('src/lib/definitions.ts')
  assert.match(defs, /phone: z\.string\(\)\.trim\(\)\.max\(40\)\.default\(''\)/)
})

// ---------------------------------------------------------------------------
// Section 11 – Security and delivery wording
// ---------------------------------------------------------------------------

test('S11: accessNotice ends with correct redistribution clause', () => {
  const delivery = read('src/lib/delivery.ts')
  assert.match(delivery, /exclusive use of authorised readers and may not be redistributed/)
})

test('S11: portalNotice ends with correct redistribution clause', () => {
  const delivery = read('src/lib/delivery.ts')
  const portalBlock = delivery.slice(delivery.indexOf('function portalNotice'))
  assert.match(portalBlock, /exclusive use of authorised readers and may not be redistributed/)
})

test('S11: emailNotice ends with correct redistribution clause', () => {
  const delivery = read('src/lib/delivery.ts')
  const emailBlock = delivery.slice(delivery.indexOf('function emailNotice'))
  assert.match(emailBlock, /exclusive use of authorised readers and may not be redistributed/)
})

test('S11: briefings separate notice uses approved wording', () => {
  const delivery = read('src/lib/delivery.ts')
  assert.match(delivery, /Briefing entitlements vary by subscription level/)
  assert.match(delivery, /Additional bespoke and in-person briefings may be commissioned separately/)
})

test('S11: link verification says downloads are enabled, not view-only', () => {
  const lv = read('src/lib/link-verification.ts')
  assert.match(lv, /Downloads are enabled on this link/)
  assert.doesNotMatch(lv, /All documents are view-only/)
})

test('S11: portal footer uses approved security wording', () => {
  const portal = read('src/app/portal/page.tsx')
  assert.match(portal, /exclusive use of authorised readers/)
  // "may not be\n        redistributed" spans lines in JSX
  const flat = portal.replace(/\s+/g, ' ')
  assert.match(flat, /may not be redistributed/)
})

// ---------------------------------------------------------------------------
// Section 12 – Link audit: subscriber library vs request access
// ---------------------------------------------------------------------------

test('S12: hero "Access Subscriber Library" links to /portal', () => {
  const page = read('src/app/page.tsx')
  const heroBlock = page.slice(page.indexOf('Access Subscriber Library') - 200, page.indexOf('Access Subscriber Library') + 50)
  assert.match(heroBlock, /href="\/portal"/)
})

test('S12: header nav includes "Subscription Access" linking to /access', () => {
  const header = read('src/components/SiteHeader.tsx')
  assert.match(header, /label: 'Subscription Access', href: '\/access'/)
})

test('S12: header nav has no sign-in or library link in NAV_ITEMS', () => {
  const header = read('src/components/SiteHeader.tsx')
  const navBlock = header.slice(header.indexOf('NAV_ITEMS'), header.indexOf(']'))
  assert.doesNotMatch(navBlock, /Sign in/)
  assert.doesNotMatch(navBlock, /\/portal/)
})

test('S12: subscription cards on /access link to the form, not /portal', () => {
  const page = read('src/app/access/page.tsx')
  assert.match(page, /\/access\?level=/)
  assert.doesNotMatch(page, /href="\/portal"/)
})

test('S12: publications empty state links to /access', () => {
  const page = read('src/app/publications/page.tsx')
  assert.match(page, /href="\/access"/)
  assert.match(page, /Request Access/)
})

test('S12: subscriber-only publication CTA always goes to /access with level', () => {
  const pa = read('src/components/PublicationAccess.tsx')
  assert.match(pa, /\/access\?level=/)
  assert.doesNotMatch(pa, /href.*\/portal/)
})

// ---------------------------------------------------------------------------
// Section 13 – Level display names (admin, public, internal)
// ---------------------------------------------------------------------------

test('S13: L4 level name is Board Intelligence', () => {
  assert.equal(levelName('L4'), 'Board Intelligence')
})

test('S13: minimum level label for L4 omits "and above"', () => {
  assert.equal(minimumLevelLabel('L4'), 'Board Intelligence')
})

test('S13: minimum level labels for other levels end with "and above"', () => {
  assert.match(minimumLevelLabel('L1'), /Individual Access and above/)
  assert.match(minimumLevelLabel('L2'), /Political Monitor and above/)
  assert.match(minimumLevelLabel('L3'), /Executive Intelligence and above/)
})

// ---------------------------------------------------------------------------
// Section 14 – Publications page empty state
// ---------------------------------------------------------------------------

test('S14: publications page has no developer-facing empty state box', () => {
  const page = read('src/app/publications/page.tsx')
  assert.doesNotMatch(page, /No publications are currently listed/)
  assert.match(page, /Publications will be listed here once available/)
})

// ---------------------------------------------------------------------------
// Section 15 – Responsive: no horizontal overflow, mobile-safe typography
// ---------------------------------------------------------------------------

test('S15: homepage uses responsive text sizes (sm: breakpoints)', () => {
  const page = read('src/app/page.tsx')
  assert.match(page, /text-3xl sm:text-4xl/)
  assert.match(page, /sm:text-xl/)
})

test('S15: access page uses responsive text sizes', () => {
  const page = read('src/app/access/page.tsx')
  assert.match(page, /text-4xl sm:text-5xl/)
})

test('S15: APRI approach uses responsive grid', () => {
  const page = read('src/app/page.tsx')
  assert.match(page, /grid-cols-1 sm:grid-cols-3/)
})

test('S15: masthead uses responsive text sizing', () => {
  const header = read('src/components/SiteHeader.tsx')
  assert.match(header, /text-\[10px\] sm:text-xs/)
})

// ---------------------------------------------------------------------------
// Section 16 – Accessibility: labels, semantic structure
// ---------------------------------------------------------------------------

test('S16: access form has labels for every input', () => {
  const form = read('src/app/access-form.tsx')
  const fields = ['name', 'email', 'organization', 'roleTitle', 'subscriptionLevel', 'seats', 'acceptedTerms']
  for (const id of fields) {
    assert.match(form, new RegExp(`htmlFor="${id}"`), `missing label for ${id}`)
    assert.match(form, new RegExp(`id="${id}"`), `missing id for ${id}`)
  }
})

test('S16: header toggle has aria-expanded and aria-label', () => {
  const header = read('src/components/SiteHeader.tsx')
  assert.match(header, /aria-expanded=/)
  assert.match(header, /aria-label="Toggle navigation"/)
})

test('S16: homepage heading hierarchy starts with h1 before h2', () => {
  const page = read('src/app/page.tsx')
  const h1Pos = page.indexOf('<h1')
  const firstH2 = page.indexOf('<h2')
  assert.ok(h1Pos > -1, 'h1 present')
  assert.ok(firstH2 > -1, 'h2 present')
  assert.ok(h1Pos < firstH2, 'h1 should come before first h2')
})

test('S16: access page heading hierarchy is sequential', () => {
  const page = read('src/app/access/page.tsx')
  const h1Pos = page.indexOf('<h1')
  const firstH2 = page.indexOf('<h2')
  const firstH3 = page.indexOf('<h3')
  assert.ok(h1Pos < firstH2, 'h1 should come before first h2')
  assert.ok(firstH2 < firstH3, 'h2 should come before first h3')
})

// ---------------------------------------------------------------------------
// Section 17 – Honeypot and anti-spam
// ---------------------------------------------------------------------------

test('S17: form has a hidden honeypot field', () => {
  const form = read('src/app/access-form.tsx')
  assert.match(form, /name="websiteUrl"/)
  assert.match(form, /aria-hidden="true"/)
  assert.match(form, /tabIndex=\{-1\}/)
})

// ---------------------------------------------------------------------------
// Broad regressions – nothing that existed before should break
// ---------------------------------------------------------------------------

test('PUBLIC_TIER_NAMES still has exactly 5 entries', () => {
  assert.equal(PUBLIC_TIER_NAMES.length, 5)
})

test('PUBLIC_TIERS stored names have not changed', () => {
  const names = PUBLIC_TIERS.map((t) => t.name)
  assert.deepEqual(names, [
    'Individual Access',
    'Professional Team Access',
    'Political Monitor',
    'Executive Intelligence',
    'Board Briefing',
  ])
})

test('TIER_DESCRIPTIONS has an entry for every public tier', () => {
  for (const tier of PUBLIC_TIER_NAMES) {
    assert.ok(TIER_DESCRIPTIONS[tier], `missing description for ${tier}`)
    assert.ok(TIER_DESCRIPTIONS[tier].length > 10, `description too short for ${tier}`)
  }
})

test('accessBadge produces subscriber labels with "and above" phrasing', () => {
  assert.match(accessBadge('L1'), /Individual Access and above/)
  assert.match(accessBadge('L2'), /Political Monitor and above/)
  assert.match(accessBadge('L3'), /Executive Intelligence and above/)
  assert.match(accessBadge('L4'), /Board Intelligence/)
  assert.doesNotMatch(accessBadge('L4'), /and above/)
})

test('no curly/smart quotes in source files', () => {
  const files = [
    'src/app/access/page.tsx',
    'src/app/page.tsx',
    'src/lib/entitlements.ts',
    'src/lib/delivery.ts',
    'src/components/SiteHeader.tsx',
    'src/app/access-form.tsx',
  ]
  for (const f of files) {
    const src = read(f)
    assert.doesNotMatch(src, /[‘’“”]/, `curly quote found in ${f}`)
  }
})
