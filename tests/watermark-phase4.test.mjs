/**
 * Phase 4 — Watermark, subscriber link, legacy cleanup and end-to-end tests.
 *
 * Covers the Chancellor-approved Subscriber Edition watermark format, prospect
 * exclusion, Preview + Apply actions, link preservation, idempotency, legacy
 * Open Edition audit, and regression checks.
 */

import { test, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  subscriberWatermarkText,
  subscriberWatermarkConfig,
  watermarkText,
  watermarkConfig,
  dataRoomLinkSettings,
  documentLinkSettings,
} from '../src/lib/papermark-dataroom-contract.ts'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// ---------------------------------------------------------------------------
// 1. Subscriber Edition watermark format
// ---------------------------------------------------------------------------

describe('subscriberWatermarkText', () => {
  it('matches the exact Chancellor-approved format', () => {
    const text = subscriberWatermarkText('reader@example.com')
    assert.equal(
      text,
      'APRI Subscriber Edition · reader@example.com · {{date}} {{time}} · Confidential · Not for redistribution'
    )
  })

  it('normalises email to lowercase', () => {
    const text = subscriberWatermarkText('Reader@EXAMPLE.COM')
    assert.match(text, /reader@example\.com/)
    assert.doesNotMatch(text, /Reader/)
  })

  it('does not contain subscriber name', () => {
    const text = subscriberWatermarkText('test@example.com')
    assert.doesNotMatch(text, /Nwaokike/)
    assert.doesNotMatch(text, /Desmond/)
    assert.doesNotMatch(text, /Unnamed/)
  })

  it('does not contain IP address token', () => {
    assert.doesNotMatch(subscriberWatermarkText('a@b.com'), /ipAddress/i)
  })

  it('does not contain access level', () => {
    const text = subscriberWatermarkText('a@b.com')
    assert.doesNotMatch(text, /L[1-4]/)
    assert.doesNotMatch(text, /Individual/)
    assert.doesNotMatch(text, /Political/)
    assert.doesNotMatch(text, /Executive/)
    assert.doesNotMatch(text, /Board/)
  })

  it('does not contain "Assigned to"', () => {
    assert.doesNotMatch(subscriberWatermarkText('a@b.com'), /Assigned to/)
  })

  it('does not contain "APRI CONFIDENTIAL"', () => {
    assert.doesNotMatch(subscriberWatermarkText('a@b.com'), /APRI CONFIDENTIAL/)
  })

  it('does not contain Complimentary Review wording', () => {
    assert.doesNotMatch(subscriberWatermarkText('a@b.com'), /Complimentary/)
    assert.doesNotMatch(subscriberWatermarkText('a@b.com'), /Review Copy/)
  })

  it('contains date and time tokens', () => {
    const text = subscriberWatermarkText('a@b.com')
    assert.match(text, /\{\{date\}\}/)
    assert.match(text, /\{\{time\}\}/)
  })

  it('contains Confidential and Not for redistribution', () => {
    const text = subscriberWatermarkText('a@b.com')
    assert.match(text, /Confidential/)
    assert.match(text, /Not for redistribution/)
  })

  it('trims and lowercases whitespace-padded email', () => {
    const text = subscriberWatermarkText('  Spaced@Email.COM  ')
    assert.match(text, /spaced@email\.com/)
  })
})

// ---------------------------------------------------------------------------
// 2. subscriberWatermarkConfig
// ---------------------------------------------------------------------------

describe('subscriberWatermarkConfig', () => {
  it('returns all seven required WatermarkConfig fields', () => {
    const c = subscriberWatermarkConfig('a@b.com')
    assert.equal(typeof c.text, 'string')
    assert.equal(c.is_tiled, true)
    assert.equal(c.position, 'middle-center')
    assert.equal(c.rotation, 45)
    assert.equal(typeof c.color, 'string')
    assert.equal(typeof c.font_size, 'number')
    assert.equal(typeof c.opacity, 'number')
  })

  it('uses reduced opacity and font size compared to former settings', () => {
    const c = subscriberWatermarkConfig('a@b.com')
    assert.ok(c.opacity <= 0.18, 'opacity should be reduced or equal to former 0.18')
    assert.ok(c.font_size <= 20, 'font_size should be reduced or equal to former 20')
  })

  it('text matches subscriberWatermarkText output', () => {
    const c = subscriberWatermarkConfig('reader@example.com')
    assert.equal(c.text, subscriberWatermarkText('reader@example.com'))
  })
})

// ---------------------------------------------------------------------------
// 3. Deprecated shims delegate to new functions
// ---------------------------------------------------------------------------

describe('deprecated watermarkText shim', () => {
  it('produces subscriber edition format regardless of name', () => {
    const text = watermarkText('Any Name', 'test@example.com')
    assert.match(text, /APRI Subscriber Edition/)
    assert.match(text, /test@example\.com/)
    assert.doesNotMatch(text, /Any Name/)
  })
})

describe('deprecated watermarkConfig shim', () => {
  it('delegates to subscriberWatermarkConfig', () => {
    const old = watermarkConfig('Name', 'test@example.com')
    const fresh = subscriberWatermarkConfig('test@example.com')
    assert.deepEqual(old, fresh)
  })
})

// ---------------------------------------------------------------------------
// 4. Link settings use Subscriber Edition watermark
// ---------------------------------------------------------------------------

describe('dataRoomLinkSettings watermark', () => {
  const settings = dataRoomLinkSettings({
    dataroomId: 'dr-1',
    assignedName: 'Test User',
    assignedEmail: 'user@example.com',
    expiresAt: null,
  })

  it('enables watermark', () => {
    assert.equal(settings.enable_watermark, true)
  })

  it('uses Subscriber Edition format in watermark text', () => {
    assert.match(settings.watermark_config.text, /APRI Subscriber Edition/)
    assert.match(settings.watermark_config.text, /user@example\.com/)
  })

  it('does not contain subscriber name in watermark', () => {
    assert.doesNotMatch(settings.watermark_config.text, /Test User/)
  })

  it('does not require Papermark email verification', () => {
    assert.equal(settings.email_protected, false)
    assert.equal(settings.email_authenticated, false)
  })
})

describe('documentLinkSettings watermark', () => {
  const settings = documentLinkSettings({
    documentId: 'doc-1',
    assignedName: 'Another User',
    assignedEmail: 'another@example.com',
    expiresAt: null,
  })

  it('uses Subscriber Edition format', () => {
    assert.match(settings.watermark_config.text, /APRI Subscriber Edition/)
    assert.match(settings.watermark_config.text, /another@example\.com/)
  })

  it('does not contain subscriber name in watermark', () => {
    assert.doesNotMatch(settings.watermark_config.text, /Another User/)
  })
})

// ---------------------------------------------------------------------------
// 5. Prospect and subscriber watermark policies are separate
// ---------------------------------------------------------------------------

test('prospect watermark format is never built by subscriberWatermarkText', () => {
  const prospectFormat = 'APRI Complimentary Review Copy'
  const subText = subscriberWatermarkText('prospect@example.com')
  assert.doesNotMatch(subText, new RegExp(prospectFormat))
})

test('subscriber watermark never says "Review Copy"', () => {
  assert.doesNotMatch(subscriberWatermarkText('a@b.com'), /Review Copy/)
})

// ---------------------------------------------------------------------------
// 6. Prospect Data Room link exclusion
// ---------------------------------------------------------------------------

test('preview action source excludes prospect links by Data Room ID', () => {
  const src = read('src/app/actions/datarooms.ts')
  assert.match(src, /review_library_papermark_dataroom_id/)
  assert.match(src, /prospectRoomId/)
  assert.match(src, /Prospect.*Complimentary Review/i)
})

test('the prospect Data Room link is never selected by the subscriber bulk updater', () => {
  const src = read('src/app/actions/datarooms.ts')
  const previewSection = src.slice(
    src.indexOf('previewSubscriberWatermarkUpdate'),
    src.indexOf('applySubscriberWatermarkUpdate')
  )
  assert.match(previewSection, /dataroomId === prospectRoomId/)
})

// ---------------------------------------------------------------------------
// 7. Preview mode does not PATCH
// ---------------------------------------------------------------------------

test('preview action does not call updateLinkWatermark or PATCH', () => {
  const src = read('src/app/actions/datarooms.ts')
  const previewFn = src.slice(
    src.indexOf('export async function previewSubscriberWatermarkUpdate'),
    src.indexOf('export async function applySubscriberWatermarkUpdate')
  )
  assert.doesNotMatch(previewFn, /updateLinkWatermark/)
  assert.doesNotMatch(previewFn, /PATCH/i)
})

// ---------------------------------------------------------------------------
// 8. Apply mode PATCHes watermark fields only
// ---------------------------------------------------------------------------

test('updateLinkWatermark sends only enable_watermark and watermark_config', () => {
  const src = read('src/lib/papermark-datarooms.ts')
  const fn = src.slice(
    src.indexOf('export async function updateLinkWatermark'),
    src.indexOf('export async function revokeDataRoomLink')
  )
  assert.match(fn, /enable_watermark/)
  assert.match(fn, /watermark_config/)
  assert.doesNotMatch(fn, /expires_at/)
  assert.doesNotMatch(fn, /allow_download/)
  assert.doesNotMatch(fn, /email_protected/)
  assert.doesNotMatch(fn, /enable_screenshot_protection/)
})

// ---------------------------------------------------------------------------
// 9. Link preservation — apply action does not recreate links
// ---------------------------------------------------------------------------

test('apply action does not create new links', () => {
  const src = read('src/app/actions/datarooms.ts')
  const applyFn = src.slice(
    src.indexOf('export async function applySubscriberWatermarkUpdate'),
    src.indexOf('// ----', src.indexOf('export async function applySubscriberWatermarkUpdate') + 1)
  )
  assert.doesNotMatch(applyFn, /createDataRoomLink/)
  assert.doesNotMatch(applyFn, /createDocumentLink/)
  assert.doesNotMatch(applyFn, /POST/)
})

test('apply action does not send emails', () => {
  const src = read('src/app/actions/datarooms.ts')
  const applyFn = src.slice(
    src.indexOf('export async function applySubscriberWatermarkUpdate'),
    src.indexOf('// ----', src.indexOf('export async function applySubscriberWatermarkUpdate') + 1)
  )
  assert.doesNotMatch(applyFn, /sendEmail/)
  assert.doesNotMatch(applyFn, /notify/)
})

// ---------------------------------------------------------------------------
// 10. Revoked and expired links are excluded
// ---------------------------------------------------------------------------

test('getAllLiveLinksForWatermark only queries live links', () => {
  const src = read('src/lib/dataroom-dal.ts')
  const fn = src.slice(
    src.indexOf('async function getAllLiveLinksForWatermark'),
    src.indexOf('async function updateLocalWatermarkText')
  )
  assert.match(fn, /revoke_state = 'live'/)
  assert.doesNotMatch(fn, /revoke_state = 'revoked'/)
})

// ---------------------------------------------------------------------------
// 11. Idempotency — already-correct links are skipped
// ---------------------------------------------------------------------------

test('preview identifies already-correct links', () => {
  const src = read('src/app/actions/datarooms.ts')
  assert.match(src, /alreadyCorrect/)
  assert.match(src, /currentWatermarkText === expected/)
})

// ---------------------------------------------------------------------------
// 12. No API token or private portal token in client code
// ---------------------------------------------------------------------------

test('no PAPERMARK_API_TOKEN in client components', () => {
  const publicFiles = [
    'src/components/PublicationAccess.tsx',
    'src/app/publications/page.tsx',
    'src/app/publications/[slug]/page.tsx',
    'src/app/page.tsx',
    'src/app/admin/datarooms/dataroom-form.tsx',
  ]
  for (const f of publicFiles) {
    const src = read(f)
    assert.doesNotMatch(src, /PAPERMARK_API_TOKEN/)
    assert.doesNotMatch(src, /process\.env\.PAPERMARK/)
  }
})

test('no subscriber portal tokens in watermark actions', () => {
  const src = read('src/app/actions/datarooms.ts')
  const wmSection = src.slice(src.indexOf('Subscriber watermark update'))
  assert.doesNotMatch(wmSection, /AUTH_SECRET/)
  assert.doesNotMatch(wmSection, /portal_token/)
})

// ---------------------------------------------------------------------------
// 13. Legacy Open Edition audit
// ---------------------------------------------------------------------------

test('audit action is owner-gated', () => {
  const src = read('src/app/actions/datarooms.ts')
  const fn = src.slice(
    src.indexOf('async function auditLegacyOpenEditions'),
    src.indexOf('// ----', src.indexOf('async function auditLegacyOpenEditions') + 1)
  )
  assert.match(fn, /requireOwner/)
})

test('audit never hard-deletes', () => {
  const src = read('src/app/actions/datarooms.ts')
  const fn = src.slice(
    src.indexOf('async function auditLegacyOpenEditions'),
    src.indexOf('// ----', src.indexOf('async function auditLegacyOpenEditions') + 1)
  )
  assert.doesNotMatch(fn, /delete from documents/)
  assert.doesNotMatch(fn, /DROP/)
})

test('audit archives only unreferenced records', () => {
  const src = read('src/app/actions/datarooms.ts')
  assert.match(src, /isUnreferenced && doc\.status !== "archived"/)
})

test('audit checks review items, candidates, subscriber access and engagement', () => {
  const src = read('src/app/actions/datarooms.ts')
  const fn = src.slice(
    src.indexOf('async function auditLegacyOpenEditions'),
    src.indexOf('// ----', src.indexOf('async function auditLegacyOpenEditions') + 1)
  )
  assert.match(fn, /complimentary_review_items/)
  assert.match(fn, /review_sync_candidates/)
  assert.match(fn, /publication_access/)
  assert.match(fn, /document_views/)
})

// ---------------------------------------------------------------------------
// 14. Prospect flow — review library
// ---------------------------------------------------------------------------

test('review library page still queries three approved cards', () => {
  const src = read('src/lib/review-prefill.ts')
  assert.match(src, /APPROVED_CARDS/)
  assert.match(src, /MIN/)
  assert.match(src, /AIU/)
  assert.match(src, /PLM/)
})

test('complimentary review section exists on publications page', () => {
  const src = read('src/app/publications/page.tsx')
  assert.match(src, /Complimentary Review/)
  assert.match(src, /complimentary-review/)
})

// ---------------------------------------------------------------------------
// 15. /complimentary-review route remains absent
// ---------------------------------------------------------------------------

test('/complimentary-review route does not exist', () => {
  let found = false
  try {
    read('src/app/complimentary-review/page.tsx')
    found = true
  } catch {}
  assert.equal(found, false)
})

// ---------------------------------------------------------------------------
// 16. No new public route
// ---------------------------------------------------------------------------

test('Phase 4 does not introduce a new public route', () => {
  const src = read('src/app/actions/datarooms.ts')
  assert.doesNotMatch(src, /export async function GET/)
})

// ---------------------------------------------------------------------------
// 17. Paid links do not require Papermark email verification
// ---------------------------------------------------------------------------

test('dataRoomLinkSettings disables email protection', () => {
  const s = dataRoomLinkSettings({
    dataroomId: 'dr', assignedName: 'N', assignedEmail: 'e@e.com', expiresAt: null,
  })
  assert.equal(s.email_protected, false)
  assert.equal(s.email_authenticated, false)
})

test('documentLinkSettings disables email protection', () => {
  const s = documentLinkSettings({
    documentId: 'doc', assignedName: 'N', assignedEmail: 'e@e.com', expiresAt: null,
  })
  assert.equal(s.email_protected, false)
  assert.equal(s.email_authenticated, false)
})

// ---------------------------------------------------------------------------
// 18. Two-step admin watermark flow
// ---------------------------------------------------------------------------

test('admin UI imports preview and apply actions, not updateAllWatermarks', () => {
  const src = read('src/app/admin/datarooms/dataroom-form.tsx')
  assert.match(src, /previewSubscriberWatermarkUpdate/)
  assert.match(src, /applySubscriberWatermarkUpdate/)
  assert.doesNotMatch(src, /updateAllWatermarks/)
})

test('admin UI shows confirmation before apply', () => {
  const src = read('src/app/admin/datarooms/dataroom-form.tsx')
  assert.match(src, /window\.confirm/)
  assert.match(src, /Subscriber Edition watermark/)
  assert.match(src, /Complimentary Review Data Room link is excluded/)
})

// ---------------------------------------------------------------------------
// 19. Cover/version label checklist in admin
// ---------------------------------------------------------------------------

test('admin UI includes cover/version label checklist', () => {
  const src = read('src/app/admin/datarooms/dataroom-form.tsx')
  assert.match(src, /Version: Complimentary Review Copy/)
  assert.match(src, /Version: Subscriber Edition/)
  assert.match(src, /Internal masters remain private/)
})

// ---------------------------------------------------------------------------
// 20. Phase 3 review sync tests still importable
// ---------------------------------------------------------------------------

test('review-classify module still exports core functions', () => {
  const src = read('src/lib/review-classify.ts')
  assert.match(src, /export function classifyReviewDocument/)
  assert.match(src, /export function generateReviewMetadata/)
})

// ---------------------------------------------------------------------------
// 21. OPEN enum preserved in schema
// ---------------------------------------------------------------------------

test('OPEN remains in visibility check constraint', () => {
  const schema = read('db/schema.sql')
  assert.match(schema, /'OPEN'/)
})

// ---------------------------------------------------------------------------
// 22. updateLinkWatermark only takes email, not name
// ---------------------------------------------------------------------------

test('updateLinkWatermark signature takes email only', () => {
  const src = read('src/lib/papermark-datarooms.ts')
  const fn = src.slice(
    src.indexOf('export async function updateLinkWatermark'),
    src.indexOf('}', src.indexOf('export async function updateLinkWatermark') + 200) + 1
  )
  assert.match(fn, /assignedEmail/)
  assert.doesNotMatch(fn, /assignedName/)
})

// ---------------------------------------------------------------------------
// 23. Watermark text does not use the old name|email|date format
// ---------------------------------------------------------------------------

test('no link builder produces the old name | email | date format', () => {
  const email = 'test@example.com'
  const drSettings = dataRoomLinkSettings({
    dataroomId: 'dr', assignedName: 'Name', assignedEmail: email, expiresAt: null,
  })
  assert.doesNotMatch(drSettings.watermark_config.text, /\|/)
  const docSettings = documentLinkSettings({
    documentId: 'doc', assignedName: 'Name', assignedEmail: email, expiresAt: null,
  })
  assert.doesNotMatch(docSettings.watermark_config.text, /\|/)
})

// ---------------------------------------------------------------------------
// 24. Callers migrated from watermarkText to subscriberWatermarkText
// ---------------------------------------------------------------------------

test('document-links.ts uses subscriberWatermarkText', () => {
  const src = read('src/lib/document-links.ts')
  assert.match(src, /subscriberWatermarkText/)
  assert.doesNotMatch(src, /watermarkText\(/)
})

test('dataroom-lifecycle.ts uses subscriberWatermarkText', () => {
  const src = read('src/lib/dataroom-lifecycle.ts')
  assert.match(src, /subscriberWatermarkText/)
  assert.doesNotMatch(src, /watermarkText\(/)
})

test('subscribers action uses subscriberWatermarkText', () => {
  const src = read('src/app/actions/subscribers.ts')
  assert.match(src, /subscriberWatermarkText/)
  assert.doesNotMatch(src, /watermarkText\(/)
})

test('datarooms action uses subscriberWatermarkText', () => {
  const src = read('src/app/actions/datarooms.ts')
  assert.match(src, /subscriberWatermarkText/)
  const imports = src.slice(0, src.indexOf('const UUID'))
  assert.doesNotMatch(imports, /watermarkText[^T]/)
})

// ---------------------------------------------------------------------------
// 25. papermark-datarooms.ts uses subscriberWatermarkConfig
// ---------------------------------------------------------------------------

test('papermark-datarooms.ts imports subscriberWatermarkConfig', () => {
  const src = read('src/lib/papermark-datarooms.ts')
  assert.match(src, /subscriberWatermarkConfig/)
  assert.doesNotMatch(src, /import.*watermarkConfig[^}]/)
})

// ---------------------------------------------------------------------------
// 26. Legacy audit admin section exists
// ---------------------------------------------------------------------------

test('admin UI has legacy Open Edition audit section', () => {
  const src = read('src/app/admin/datarooms/dataroom-form.tsx')
  assert.match(src, /auditLegacyOpenEditions/)
  assert.match(src, /Legacy Open Edition audit/)
  assert.match(src, /Audit legacy OPEN records/)
})

// ---------------------------------------------------------------------------
// 27. Successful PATCH updates local state, failed PATCH does not
// ---------------------------------------------------------------------------

test('apply action updates local only after Papermark confirms', () => {
  const src = read('src/app/actions/datarooms.ts')
  const applyFn = src.slice(
    src.indexOf('export async function applySubscriberWatermarkUpdate'),
    src.indexOf('// ----', src.indexOf('export async function applySubscriberWatermarkUpdate') + 1)
  )
  assert.match(applyFn, /if \(result\.ok\)/)
  assert.match(applyFn, /updateLocalWatermarkText/)
})

// ---------------------------------------------------------------------------
// 28. Partial failures do not stop the batch
// ---------------------------------------------------------------------------

test('apply action continues after individual failures', () => {
  const src = read('src/app/actions/datarooms.ts')
  const applyFn = src.slice(
    src.indexOf('export async function applySubscriberWatermarkUpdate'),
    src.indexOf('// ----', src.indexOf('export async function applySubscriberWatermarkUpdate') + 1)
  )
  assert.match(applyFn, /for \(const link of eligible\)/)
  assert.match(applyFn, /failed\+\+/)
})

// ---------------------------------------------------------------------------
// 29. Rerunning is idempotent
// ---------------------------------------------------------------------------

test('preview detects already-correct links so rerun is a no-op', () => {
  const src = read('src/app/actions/datarooms.ts')
  assert.match(src, /currentWatermarkText === expected/)
  assert.match(src, /alreadyCorrect\+\+/)
})

// ---------------------------------------------------------------------------
// 30. No links are recreated during watermark update
// ---------------------------------------------------------------------------

test('watermark update never calls a link creation function', () => {
  const src = read('src/app/actions/datarooms.ts')
  const section = src.slice(
    src.indexOf('Subscriber watermark update'),
    src.indexOf('Legacy Open Edition')
  )
  assert.doesNotMatch(section, /createDataRoomLink/)
  assert.doesNotMatch(section, /createDocumentLink/)
  assert.doesNotMatch(section, /mintSubscriberLink/)
})

// ---------------------------------------------------------------------------
// 31. No emails sent during watermark update or legacy audit
// ---------------------------------------------------------------------------

test('watermark and audit sections do not send emails', () => {
  const src = read('src/app/actions/datarooms.ts')
  const section = src.slice(
    src.indexOf('Subscriber watermark update'),
    src.indexOf('Link/unlink editorial')
  )
  assert.doesNotMatch(section, /sendEmail/)
  assert.doesNotMatch(section, /resend/)
})

// ---------------------------------------------------------------------------
// 32. Prospect link requires verified email (unchanged)
// ---------------------------------------------------------------------------

test('prospect review library requires verified email', () => {
  const src = read('src/lib/publications.ts')
  assert.match(src, /getReviewLibrary/)
})

test('prospect access badge says verified email required', () => {
  const src = read('src/lib/entitlements.ts')
  assert.match(src, /Complimentary Review Copy.*verified email required/)
})

// ---------------------------------------------------------------------------
// 33. Phase 3 sync route still runs
// ---------------------------------------------------------------------------

test('cron dataroom-sync route handles both paid and review sync', () => {
  const src = read('src/app/api/cron/dataroom-sync/route.ts')
  assert.match(src, /reconcileAllDataRooms/)
  assert.match(src, /backgroundReviewSync/)
})

// ---------------------------------------------------------------------------
// 34. Watermark opacity is restrained
// ---------------------------------------------------------------------------

test('subscriber watermark opacity is at most 0.18', () => {
  const c = subscriberWatermarkConfig('a@b.com')
  assert.ok(c.opacity <= 0.18)
})

test('subscriber watermark font size is at most 20', () => {
  const c = subscriberWatermarkConfig('a@b.com')
  assert.ok(c.font_size <= 20)
})

// ---------------------------------------------------------------------------
// 35. Watermark does not include {{ipAddress}}
// ---------------------------------------------------------------------------

test('subscriber watermark config text does not reference IP', () => {
  const c = subscriberWatermarkConfig('a@b.com')
  assert.doesNotMatch(c.text, /ipAddress/)
  assert.doesNotMatch(c.text, /IP/)
})

// ---------------------------------------------------------------------------
// 36. DAL returns fields needed for preview exclusion
// ---------------------------------------------------------------------------

test('getAllLiveLinksForWatermark returns dataroomId and currentWatermarkText', () => {
  const src = read('src/lib/dataroom-dal.ts')
  const type = src.slice(
    src.indexOf('export type LiveLinkForWatermark'),
    src.indexOf('}', src.indexOf('export type LiveLinkForWatermark')) + 1
  )
  assert.match(type, /currentWatermarkText/)
  assert.match(type, /dataroomId/)
})

// ---------------------------------------------------------------------------
// 37. The former "name | email | {{date}}" format is fully superseded
// ---------------------------------------------------------------------------

test('subscriberWatermarkText never produces pipe-separated format', () => {
  const text = subscriberWatermarkText('any@example.com')
  assert.doesNotMatch(text, /\|/)
})

test('link settings builders use subscriberWatermarkConfig not watermarkConfig', () => {
  const src = read('src/lib/papermark-dataroom-contract.ts')
  const builders = src.slice(src.indexOf('export function dataRoomLinkSettings'))
  assert.match(builders, /subscriberWatermarkConfig/)
  assert.doesNotMatch(builders, /watermarkConfig\(/)
})
