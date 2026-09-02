import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  watermarkText,
  watermarkConfig,
  dataRoomLinkSettings,
  categoriseDataRoomDocument,
  documentBadge,
  documentVersionKey,
  newestFirst,
  portalCategoryLabel,
  portalTypeLabel,
  PORTAL_CATEGORIES,
} from '../src/lib/papermark-dataroom-contract.ts'

// ---------------------------------------------------------------------------
// Watermark
// ---------------------------------------------------------------------------

describe('watermarkText', () => {
  it('contains exactly name, email and dynamic date', () => {
    const text = watermarkText('Nwaokike Desmond', 'nwaokike32@gmail.com')
    assert.equal(text, 'Nwaokike Desmond | nwaokike32@gmail.com | {{date}}')
  })

  it('does not contain time, IP, access level or confidential wording', () => {
    const text = watermarkText('Test User', 'test@example.com')
    assert.doesNotMatch(text, /\{\{time\}\}/)
    assert.doesNotMatch(text, /\{\{ipAddress\}\}/)
    assert.doesNotMatch(text, /CONFIDENTIAL/i)
    assert.doesNotMatch(text, /Assigned to/)
    assert.doesNotMatch(text, /L[1-4]/)
  })

  it('falls back to "Unnamed recipient" when name is blank', () => {
    const text = watermarkText('', 'test@example.com')
    assert.equal(text, 'Unnamed recipient | test@example.com | {{date}}')
  })
})

describe('watermarkConfig', () => {
  it('returns all seven required fields', () => {
    const config = watermarkConfig('Name', 'email@test.com')
    assert.equal(typeof config.text, 'string')
    assert.equal(config.is_tiled, true)
    assert.equal(config.position, 'middle-center')
    assert.equal(config.rotation, 45)
    assert.equal(typeof config.color, 'string')
    assert.equal(typeof config.font_size, 'number')
    assert.equal(typeof config.opacity, 'number')
  })
})

// ---------------------------------------------------------------------------
// Link settings
// ---------------------------------------------------------------------------

describe('dataRoomLinkSettings', () => {
  it('builds settings with downloads enabled by default', () => {
    const settings = dataRoomLinkSettings({
      dataroomId: 'dr_123',
      assignedName: 'Test User',
      assignedEmail: 'test@example.com',
      expiresAt: '2027-12-31T23:59:59.999Z',
    })
    assert.equal(settings.dataroom_id, 'dr_123')
    assert.equal(settings.email_protected, false)
    assert.equal(settings.email_authenticated, false)
    assert.equal(settings.allow_download, true)
    assert.equal(settings.enable_watermark, true)
    assert.equal(settings.enable_screenshot_protection, true)
    assert.ok(settings.name.includes('Test User'))
  })

  it('respects allowDownload: false', () => {
    const settings = dataRoomLinkSettings({
      dataroomId: 'dr_123',
      assignedName: 'X',
      assignedEmail: 'x@example.com',
      expiresAt: null,
      allowDownload: false,
    })
    assert.equal(settings.allow_download, false)
  })

  it('includes the label in the name', () => {
    const settings = dataRoomLinkSettings({
      dataroomId: 'dr_123',
      assignedName: 'X',
      assignedEmail: 'x@example.com',
      expiresAt: null,
      label: 'Seat 1',
    })
    assert.ok(settings.name.includes('Seat 1'))
  })
})

// ---------------------------------------------------------------------------
// Portal categories
// ---------------------------------------------------------------------------

describe('categoriseDataRoomDocument', () => {
  it('matches folder-based category', () => {
    assert.equal(categoriseDataRoomDocument({ title: 'Something', category: 'PLM' }), 'PLM')
  })

  it('matches title-based prefix', () => {
    assert.equal(categoriseDataRoomDocument({ title: 'MIN-2026-08 Intelligence Note' }), 'MIN')
    assert.equal(categoriseDataRoomDocument({ title: 'AIU-2026-001 Update' }), 'AIU')
    assert.equal(categoriseDataRoomDocument({ title: 'QIB-2026-Q3 Brief' }), 'QIB')
    assert.equal(categoriseDataRoomDocument({ title: 'AEO-2026-01 Election' }), 'AEO')
    assert.equal(categoriseDataRoomDocument({ title: 'PLM-2026 Monitor' }), 'PLM')
  })

  it('does not match a prefix without a separator', () => {
    assert.equal(categoriseDataRoomDocument({ title: 'ADMIN-notes' }), 'OTHER')
    assert.equal(categoriseDataRoomDocument({ title: 'MINIMAL report' }), 'OTHER')
  })

  it('returns OTHER for unrecognised titles', () => {
    assert.equal(categoriseDataRoomDocument({ title: 'Random document' }), 'OTHER')
  })

  it('folder wins over title', () => {
    assert.equal(categoriseDataRoomDocument({ title: 'MIN-2026-08 Note', category: 'AIU' }), 'AIU')
  })
})

describe('portalCategoryLabel / portalTypeLabel', () => {
  it('returns labels for known keys', () => {
    assert.ok(portalCategoryLabel('PLM').length > 0)
    assert.ok(portalTypeLabel('MIN').length > 0)
  })

  it('PORTAL_CATEGORIES has six entries', () => {
    assert.equal(PORTAL_CATEGORIES.length, 6)
  })
})

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

describe('documentBadge', () => {
  it('returns null when no previous visit', () => {
    assert.equal(documentBadge({ firstSeenAt: '2026-08-01', updatedAt: null, previousVisit: null }), null)
  })

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

  it('returns null when nothing changed since previous visit', () => {
    assert.equal(
      documentBadge({ firstSeenAt: '2026-07-01', updatedAt: '2026-07-05', previousVisit: '2026-08-15' }),
      null,
    )
  })
})

// ---------------------------------------------------------------------------
// Version key
// ---------------------------------------------------------------------------

describe('documentVersionKey', () => {
  it('produces a stable key', () => {
    const a = documentVersionKey({ title: 'PLM-2026', numPages: 12, updatedAt: '2026-08-01T00:00:00Z' })
    const b = documentVersionKey({ title: 'PLM-2026', numPages: 12, updatedAt: '2026-08-01T00:00:00Z' })
    assert.equal(a, b)
  })

  it('changes when the page count changes', () => {
    const a = documentVersionKey({ title: 'PLM-2026', numPages: 12 })
    const b = documentVersionKey({ title: 'PLM-2026', numPages: 14 })
    assert.notEqual(a, b)
  })
})

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

describe('newestFirst', () => {
  it('sorts by the most reliable timestamp', () => {
    const docs = [
      { papermarkUpdatedAt: '2026-01-01', papermarkCreatedAt: null, firstSeenAt: null },
      { papermarkUpdatedAt: '2026-08-01', papermarkCreatedAt: null, firstSeenAt: null },
      { papermarkUpdatedAt: null, papermarkCreatedAt: '2026-06-01', firstSeenAt: null },
    ]
    docs.sort(newestFirst)
    assert.ok(docs[0].papermarkUpdatedAt === '2026-08-01')
  })
})
