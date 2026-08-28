import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'

import {
  watermarkText,
  watermarkConfig,
  dataRoomLinkSettings,
  categoriseDataRoomDocument,
  documentBadge,
  documentVersionKey,
  PORTAL_CATEGORIES,
  PORTAL_CATEGORY_KEYS,
  portalCategoryLabel,
  portalTypeLabel,
} from '../src/lib/papermark-dataroom-contract.ts'

import {
  classifySyncedDocument,
  SECTION_LABELS,
  LIBRARY_SECTIONS,
  sectionTypeLabel,
  papermarkExpiresAt,
} from '../src/lib/papermark-contract.ts'

// ---------------------------------------------------------------------------
// Webhook signature verification
// ---------------------------------------------------------------------------

describe('webhook signature verification', () => {
  const hmacKey = 'test-webhook-hmac-1234'

  function sign(body, key) {
    return createHmac('sha256', key).update(body).digest('hex')
  }

  it('produces a valid HMAC-SHA256 digest', () => {
    const body = JSON.stringify({ type: 'view', data: { id: 'v_123' } })
    const sig = sign(body, hmacKey)
    assert.equal(sig.length, 64)
    assert.ok(/^[0-9a-f]+$/.test(sig))
  })

  it('different body produces different signature', () => {
    const sig1 = sign('{"a":1}', secret)
    const sig2 = sign('{"a":2}', secret)
    assert.notEqual(sig1, sig2)
  })

  it('different secret produces different signature', () => {
    const body = '{"test":true}'
    const sig1 = sign(body, 'secret-a')
    const sig2 = sign(body, 'secret-b')
    assert.notEqual(sig1, sig2)
  })

  it('sha256= prefix is standard', () => {
    const body = '{"event":"view"}'
    const sig = sign(body, secret)
    const prefixed = `sha256=${sig}`
    assert.ok(prefixed.startsWith('sha256='))
    assert.equal(prefixed.slice(7), sig)
  })
})

// ---------------------------------------------------------------------------
// Portal categories — all 6 sections
// ---------------------------------------------------------------------------

describe('portal categories completeness', () => {
  it('PORTAL_CATEGORIES has exactly 6 entries', () => {
    assert.equal(PORTAL_CATEGORIES.length, 6)
  })

  it('PORTAL_CATEGORY_KEYS matches the 6 categories', () => {
    assert.deepEqual(PORTAL_CATEGORY_KEYS, ['PLM', 'AEO', 'AIU', 'MIN', 'QIB', 'OTHER'])
  })

  it('LIBRARY_SECTIONS matches PORTAL_CATEGORY_KEYS', () => {
    assert.deepEqual(LIBRARY_SECTIONS, ['PLM', 'AEO', 'AIU', 'MIN', 'QIB', 'OTHER'])
  })

  it('SECTION_LABELS covers all 6 sections', () => {
    for (const section of LIBRARY_SECTIONS) {
      assert.ok(SECTION_LABELS[section], `Missing label for ${section}`)
      assert.ok(SECTION_LABELS[section].length > 0)
    }
  })

  it('portalCategoryLabel covers all 6 keys', () => {
    for (const key of PORTAL_CATEGORY_KEYS) {
      assert.ok(portalCategoryLabel(key).length > 0)
    }
  })

  it('portalTypeLabel covers all 6 keys', () => {
    for (const key of PORTAL_CATEGORY_KEYS) {
      assert.ok(portalTypeLabel(key).length > 0)
    }
  })

  it('sectionTypeLabel covers all 6 sections', () => {
    for (const section of LIBRARY_SECTIONS) {
      assert.ok(sectionTypeLabel(section).length > 0)
    }
  })
})

// ---------------------------------------------------------------------------
// classifySyncedDocument — extended for 6 categories
// ---------------------------------------------------------------------------

describe('classifySyncedDocument (all 6 categories)', () => {
  it('recognises PLM prefix', () => {
    assert.equal(classifySyncedDocument('PLM-2026-08 Political Monitor'), 'PLM')
  })

  it('recognises AEO prefix', () => {
    assert.equal(classifySyncedDocument('AEO-2026-01 Election Report'), 'AEO')
  })

  it('recognises AIU prefix', () => {
    assert.equal(classifySyncedDocument('AIU-2026-003 Intelligence Update'), 'AIU')
  })

  it('recognises MIN prefix', () => {
    assert.equal(classifySyncedDocument('MIN-2026-08 Monthly Intelligence Note'), 'MIN')
  })

  it('recognises QIB prefix', () => {
    assert.equal(classifySyncedDocument('QIB-2026-Q3 Quarterly Brief'), 'QIB')
  })

  it('returns OTHER for unknown titles', () => {
    assert.equal(classifySyncedDocument('Random Document 2026'), 'OTHER')
  })

  it('requires separator after prefix', () => {
    assert.equal(classifySyncedDocument('PLMONITOR report'), 'OTHER')
    assert.equal(classifySyncedDocument('MINIMAL report'), 'OTHER')
    assert.equal(classifySyncedDocument('QIBBLE notes'), 'OTHER')
  })

  it('accepts underscore separator', () => {
    assert.equal(classifySyncedDocument('PLM_2026 Monitor'), 'PLM')
  })

  it('accepts space separator', () => {
    assert.equal(classifySyncedDocument('AEO 2026 Election'), 'AEO')
  })

  it('is case insensitive', () => {
    assert.equal(classifySyncedDocument('plm-2026 monitor'), 'PLM')
    assert.equal(classifySyncedDocument('qib-2026 brief'), 'QIB')
  })
})

// ---------------------------------------------------------------------------
// categoriseDataRoomDocument — folder wins over title
// ---------------------------------------------------------------------------

describe('categoriseDataRoomDocument (Data Room)', () => {
  it('folder-based category takes priority', () => {
    assert.equal(categoriseDataRoomDocument({ title: 'MIN-2026-08 Note', category: 'PLM' }), 'PLM')
    assert.equal(categoriseDataRoomDocument({ title: 'Something', category: 'QIB' }), 'QIB')
    assert.equal(categoriseDataRoomDocument({ title: 'Something', category: 'AEO' }), 'AEO')
  })

  it('title fallback works for all 6 categories', () => {
    assert.equal(categoriseDataRoomDocument({ title: 'PLM-2026 Monitor' }), 'PLM')
    assert.equal(categoriseDataRoomDocument({ title: 'AEO-2026 Election' }), 'AEO')
    assert.equal(categoriseDataRoomDocument({ title: 'AIU-2026-001 Update' }), 'AIU')
    assert.equal(categoriseDataRoomDocument({ title: 'MIN-2026-08 Note' }), 'MIN')
    assert.equal(categoriseDataRoomDocument({ title: 'QIB-2026-Q3 Brief' }), 'QIB')
    assert.equal(categoriseDataRoomDocument({ title: 'Random document' }), 'OTHER')
  })
})

// ---------------------------------------------------------------------------
// Notification dedup via version key
// ---------------------------------------------------------------------------

describe('notification dedup (version key)', () => {
  it('same document same version produces same key', () => {
    const a = documentVersionKey({ title: 'PLM-2026', numPages: 12, updatedAt: '2026-08-01T00:00:00Z' })
    const b = documentVersionKey({ title: 'PLM-2026', numPages: 12, updatedAt: '2026-08-01T00:00:00Z' })
    assert.equal(a, b)
  })

  it('different page count produces different key', () => {
    const a = documentVersionKey({ title: 'PLM-2026', numPages: 12 })
    const b = documentVersionKey({ title: 'PLM-2026', numPages: 14 })
    assert.notEqual(a, b)
  })

  it('different update time produces different key', () => {
    const a = documentVersionKey({ title: 'PLM-2026', numPages: 12, updatedAt: '2026-08-01T00:00:00Z' })
    const b = documentVersionKey({ title: 'PLM-2026', numPages: 12, updatedAt: '2026-08-02T00:00:00Z' })
    assert.notEqual(a, b)
  })

  it('different title produces different key', () => {
    const a = documentVersionKey({ title: 'PLM-2026', numPages: 12 })
    const b = documentVersionKey({ title: 'PLM-2027', numPages: 12 })
    assert.notEqual(a, b)
  })
})

// ---------------------------------------------------------------------------
// Lifecycle: expiry conversion
// ---------------------------------------------------------------------------

describe('lifecycle: expiry conversion', () => {
  it('converts date-only to end of day UTC', () => {
    const result = papermarkExpiresAt('2026-12-31')
    assert.ok(result.ok)
    assert.equal(result.value, '2026-12-31T23:59:59.999Z')
  })

  it('passes through a full ISO datetime', () => {
    const result = papermarkExpiresAt('2026-12-31T23:59:59.000Z')
    assert.ok(result.ok)
    assert.ok(result.value.startsWith('2026-12-31'))
  })

  it('returns null for null input', () => {
    const result = papermarkExpiresAt(null)
    assert.ok(result.ok)
    assert.equal(result.value, null)
  })

  it('returns null for empty string', () => {
    const result = papermarkExpiresAt('')
    assert.ok(result.ok)
    assert.equal(result.value, null)
  })

  it('rejects an invalid date', () => {
    const result = papermarkExpiresAt('not-a-date')
    assert.ok(!result.ok)
  })
})

// ---------------------------------------------------------------------------
// Lifecycle: link settings defaults
// ---------------------------------------------------------------------------

describe('lifecycle: Data Room link settings', () => {
  it('downloads default to true', () => {
    const settings = dataRoomLinkSettings({
      dataroomId: 'dr_test',
      assignedName: 'Test',
      assignedEmail: 'test@example.com',
      expiresAt: null,
    })
    assert.equal(settings.allow_download, true)
    assert.equal(settings.email_protected, false)
    assert.equal(settings.enable_watermark, true)
    assert.equal(settings.enable_screenshot_protection, true)
  })

  it('downloads can be disabled', () => {
    const settings = dataRoomLinkSettings({
      dataroomId: 'dr_test',
      assignedName: 'Test',
      assignedEmail: 'test@example.com',
      expiresAt: null,
      allowDownload: false,
    })
    assert.equal(settings.allow_download, false)
  })

  it('watermark includes all 7 fields', () => {
    const config = watermarkConfig('Test User', 'test@example.com')
    assert.equal(typeof config.text, 'string')
    assert.equal(config.is_tiled, true)
    assert.equal(typeof config.position, 'string')
    assert.equal(typeof config.rotation, 'number')
    assert.equal(typeof config.color, 'string')
    assert.equal(typeof config.font_size, 'number')
    assert.equal(typeof config.opacity, 'number')
  })
})

// ---------------------------------------------------------------------------
// Subscriber/briefing isolation
// ---------------------------------------------------------------------------

describe('subscriber/briefing isolation', () => {
  it('link settings carry the assigned name', () => {
    const settingsA = dataRoomLinkSettings({
      dataroomId: 'dr_1',
      assignedName: 'Alice',
      assignedEmail: 'alice@example.com',
      expiresAt: null,
    })
    const settingsB = dataRoomLinkSettings({
      dataroomId: 'dr_1',
      assignedName: 'Bob',
      assignedEmail: 'bob@example.com',
      expiresAt: null,
    })
    assert.notEqual(settingsA.name, settingsB.name)
    assert.ok(settingsA.name.includes('Alice'))
    assert.ok(settingsB.name.includes('Bob'))
  })

  it('watermark texts differ per person', () => {
    const a = watermarkText('Alice', 'alice@example.com')
    const b = watermarkText('Bob', 'bob@example.com')
    assert.notEqual(a, b)
    assert.ok(a.includes('Alice'))
    assert.ok(b.includes('Bob'))
  })

  it('watermark configs differ per person', () => {
    const a = watermarkConfig('Alice', 'alice@example.com')
    const b = watermarkConfig('Bob', 'bob@example.com')
    assert.notEqual(a.text, b.text)
  })
})

// ---------------------------------------------------------------------------
// Document badges
// ---------------------------------------------------------------------------

describe('document badges (lifecycle)', () => {
  it('returns new when first seen after previous visit', () => {
    assert.equal(
      documentBadge({ firstSeenAt: '2026-08-20', updatedAt: null, previousVisit: '2026-08-15' }),
      'new',
    )
  })

  it('returns updated when version changed after previous visit', () => {
    assert.equal(
      documentBadge({ firstSeenAt: '2026-07-01', updatedAt: '2026-08-20', previousVisit: '2026-08-15' }),
      'updated',
    )
  })

  it('returns null when nothing is new', () => {
    assert.equal(
      documentBadge({ firstSeenAt: '2026-07-01', updatedAt: '2026-07-05', previousVisit: '2026-08-15' }),
      null,
    )
  })

  it('returns null with no previous visit', () => {
    assert.equal(
      documentBadge({ firstSeenAt: '2026-08-01', updatedAt: null, previousVisit: null }),
      null,
    )
  })
})
