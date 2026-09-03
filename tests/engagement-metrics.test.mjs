/**
 * Phase 6 — exact metric definitions.
 *
 * These test the arithmetic directly rather than asserting on SQL text, which
 * is why `engagement-metrics.ts` has no imports: every rule below is exercised
 * with real inputs and real expected numbers.
 *
 * The definitions exist because the previous dashboard got each of them wrong
 * in a specific way — row counts passed off as views, one reader's repeat
 * visits counted as many readers, missing data reported as zero — so each rule
 * here has a test for the wrong answer as well as the right one.
 */

import { describe, it, test } from 'node:test'
import assert from 'node:assert/strict'

import {
  accessClicks,
  uniqueClickers,
  viewSessions,
  uniqueReaders,
  uniquePaidReaders,
  uniqueProspectReaders,
  readerKey,
  documentsOpened,
  downloadEvents,
  uniqueDownloaders,
  repeatSessions,
  averageEngagedTime,
  averageCompletion,
  completionFromPages,
  enrichmentCoverage,
  isValidCompletion,
  formatMetric,
  resolveWindow,
  formatLagos,
  normaliseEmail,
  isExcludedReader,
  isReaderType,
  isPaidReaderType,
  isProspectReaderType,
  isAccessEventType,
  READER_TYPES,
  ACCESS_EVENT_TYPES,
  UNAVAILABLE,
  UNAVAILABLE_LABEL,
  NOT_APPLICABLE_LABEL,
  DISPLAY_TIME_ZONE,
  NEVER_COMBINE,
  combinedViewsAreForbidden,
} from '../src/lib/engagement-metrics.ts'

// ---------------------------------------------------------------------------
// access_clicks
// ---------------------------------------------------------------------------

describe('access_clicks', () => {
  it('counts unique event ids', () => {
    assert.equal(accessClicks([{ eventId: 'a' }, { eventId: 'b' }, { eventId: 'c' }]), 3)
  })

  it('a retried beacon is one click, not two', () => {
    assert.equal(accessClicks([{ eventId: 'a' }, { eventId: 'a' }]), 1)
  })

  it('is zero for no events', () => {
    assert.equal(accessClicks([]), 0)
  })
})

// ---------------------------------------------------------------------------
// unique_clickers
// ---------------------------------------------------------------------------

describe('unique_clickers', () => {
  it('counts distinct visitor ids', () => {
    assert.equal(uniqueClickers([{ visitorId: 'v1' }, { visitorId: 'v2' }]), 2)
  })

  it('one visitor clicking five times is one clicker', () => {
    const rows = Array.from({ length: 5 }, () => ({ visitorId: 'v1' }))
    assert.equal(uniqueClickers(rows), 1)
  })

  it('blank visitor ids are not merged into a phantom reader', () => {
    assert.equal(uniqueClickers([{ visitorId: '' }, { visitorId: '   ' }]), 0)
  })
})

// ---------------------------------------------------------------------------
// view_sessions
// ---------------------------------------------------------------------------

describe('view_sessions', () => {
  it('counts distinct Papermark view ids', () => {
    assert.equal(viewSessions([{ papermarkViewId: 'v1' }, { papermarkViewId: 'v2' }]), 2)
  })

  it('the same view delivered twice is one session', () => {
    // The specific fault this guards: webhook and poll both writing view v1.
    assert.equal(viewSessions([{ papermarkViewId: 'v1' }, { papermarkViewId: 'v1' }]), 1)
  })

  it('is never a row count', () => {
    const rows = Array.from({ length: 10 }, () => ({ papermarkViewId: 'same' }))
    assert.equal(viewSessions(rows), 1)
    assert.notEqual(viewSessions(rows), rows.length)
  })
})

// ---------------------------------------------------------------------------
// unique_reader
// ---------------------------------------------------------------------------

describe('unique_reader', () => {
  it('a subscriber is identified by subscriber id', () => {
    assert.equal(readerKey({ subscriberId: 's1', viewerEmail: 'a@b.com' }), 'sub:s1')
  })

  it('a prospect is identified by normalised email', () => {
    assert.equal(readerKey({ subscriberId: null, viewerEmail: 'A@B.COM' }), 'email:a@b.com')
  })

  it('an unattributed session has no reader key', () => {
    assert.equal(readerKey({ subscriberId: null, viewerEmail: null }), null)
  })

  it('repeated views by one email produce ONE unique reader', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({
      papermarkViewId: `v${i}`,
      subscriberId: null,
      viewerEmail: 'prospect@example.org',
    }))
    assert.equal(viewSessions(rows), 8)
    assert.equal(uniqueReaders(rows), 1)
  })

  it('one subscriber viewing under two addresses is one reader', () => {
    const rows = [
      { subscriberId: 's1', viewerEmail: 'work@x.com' },
      { subscriberId: 's1', viewerEmail: 'personal@y.com' },
    ]
    assert.equal(uniqueReaders(rows), 1)
  })

  it('email case and whitespace do not create two readers', () => {
    const rows = [
      { subscriberId: null, viewerEmail: '  Reader@Example.Org ' },
      { subscriberId: null, viewerEmail: 'reader@example.org' },
    ]
    assert.equal(uniqueReaders(rows), 1)
  })

  it('unattributed sessions are excluded rather than counted as one reader', () => {
    const rows = [
      { subscriberId: null, viewerEmail: null },
      { subscriberId: null, viewerEmail: null },
      { subscriberId: 's1', viewerEmail: null },
    ]
    assert.equal(uniqueReaders(rows), 1)
  })
})

describe('paid and prospect readers are separated', () => {
  const rows = [
    { papermarkViewId: 'v1', subscriberId: 's1', viewerEmail: 'sub@x.com', readerType: 'subscriber', publicationId: 'p1', viewedAt: '', durationSeconds: null, completionPct: null },
    { papermarkViewId: 'v2', subscriberId: null, viewerEmail: 'pro@y.com', readerType: 'complimentary_review', publicationId: 'p1', viewedAt: '', durationSeconds: null, completionPct: null },
    { papermarkViewId: 'v3', subscriberId: null, viewerEmail: 'pro@y.com', readerType: 'complimentary_review', publicationId: 'p1', viewedAt: '', durationSeconds: null, completionPct: null },
  ]

  it('counts one paid reader', () => {
    assert.equal(uniquePaidReaders(rows), 1)
  })

  it('counts one prospect reader from two sessions', () => {
    assert.equal(uniqueProspectReaders(rows), 1)
  })

  it('a prospect never raises the paid count', () => {
    const prospectsOnly = rows.filter((r) => r.readerType === 'complimentary_review')
    assert.equal(uniquePaidReaders(prospectsOnly), 0)
  })
})

// ---------------------------------------------------------------------------
// documents_opened
// ---------------------------------------------------------------------------

describe('documents_opened', () => {
  it('counts distinct publication ids', () => {
    assert.equal(documentsOpened([{ publicationId: 'p1' }, { publicationId: 'p2' }, { publicationId: 'p1' }]), 2)
  })

  it('ignores views with no publication', () => {
    assert.equal(documentsOpened([{ publicationId: null }, { publicationId: 'p1' }]), 1)
  })
})

// ---------------------------------------------------------------------------
// download_events and unique_downloaders
// ---------------------------------------------------------------------------

describe('downloads', () => {
  it('download_events counts distinct source event ids', () => {
    assert.equal(downloadEvents([{ sourceEventId: 'd1' }, { sourceEventId: 'd2' }]), 2)
  })

  it('one reader downloading four times is four events and one downloader', () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({
      sourceEventId: `d${i}`,
      subscriberId: 's1',
      viewerEmail: 'sub@x.com',
    }))
    assert.equal(downloadEvents(rows), 4)
    assert.equal(uniqueDownloaders(rows), 1)
  })

  it('the same download delivered by webhook and poll is one event', () => {
    // Both collectors key on view:<id>, so the ids collide by design.
    const rows = [{ sourceEventId: 'view:v1' }, { sourceEventId: 'view:v1' }]
    assert.equal(downloadEvents(rows), 1)
  })

  it('a prospect downloader is identified by verified email', () => {
    const rows = [
      { sourceEventId: 'd1', subscriberId: null, viewerEmail: 'pro@y.com' },
      { sourceEventId: 'd2', subscriberId: null, viewerEmail: 'PRO@Y.COM' },
    ]
    assert.equal(downloadEvents(rows), 2)
    assert.equal(uniqueDownloaders(rows), 1)
  })

  it('an unattributed download has no downloader', () => {
    assert.equal(uniqueDownloaders([{ sourceEventId: 'd1', subscriberId: null, viewerEmail: null }]), 0)
  })
})

// ---------------------------------------------------------------------------
// repeat_sessions
// ---------------------------------------------------------------------------

describe('repeat_sessions', () => {
  it('is sessions minus readers', () => {
    assert.equal(repeatSessions(10, 4), 6)
  })

  it('is zero when every reader visited once', () => {
    assert.equal(repeatSessions(4, 4), 0)
  })

  it('never goes below zero', () => {
    // Unattributed sessions raise the session count without raising the reader
    // count, so the subtraction can legitimately go negative.
    assert.equal(repeatSessions(2, 5), 0)
    assert.equal(repeatSessions(0, 3), 0)
  })
})

// ---------------------------------------------------------------------------
// average_engaged_time
// ---------------------------------------------------------------------------

describe('average_engaged_time', () => {
  it('averages only across views that reported a duration', () => {
    const avg = averageEngagedTime([
      { durationSeconds: 100 },
      { durationSeconds: 200 },
      { durationSeconds: null },
    ])
    assert.equal(avg, 150)
  })

  it('a missing duration is NOT treated as zero', () => {
    const withNull = averageEngagedTime([{ durationSeconds: 100 }, { durationSeconds: null }])
    assert.equal(withNull, 100)
    // Were nulls counted as zero the answer would be 50.
    assert.notEqual(withNull, 50)
  })

  it('is unavailable, not zero, when nothing reported a duration', () => {
    assert.equal(averageEngagedTime([{ durationSeconds: null }, { durationSeconds: null }]), UNAVAILABLE)
    assert.equal(averageEngagedTime([]), UNAVAILABLE)
  })

  it('a genuine zero duration is still counted', () => {
    assert.equal(averageEngagedTime([{ durationSeconds: 0 }, { durationSeconds: 10 }]), 5)
  })

  it('rejects negative and non-finite readings', () => {
    assert.equal(averageEngagedTime([{ durationSeconds: -5 }]), UNAVAILABLE)
    assert.equal(averageEngagedTime([{ durationSeconds: NaN }]), UNAVAILABLE)
  })
})

// ---------------------------------------------------------------------------
// completion
// ---------------------------------------------------------------------------

describe('completion', () => {
  it('averages only across valid readings', () => {
    assert.equal(averageCompletion([{ completionPct: 50 }, { completionPct: 100 }, { completionPct: null }]), 75)
  })

  it('is unavailable when no view has a reading', () => {
    assert.equal(averageCompletion([{ completionPct: null }]), UNAVAILABLE)
  })

  it('rejects out-of-range readings rather than clamping them', () => {
    assert.equal(averageCompletion([{ completionPct: 150 }]), UNAVAILABLE)
    assert.equal(averageCompletion([{ completionPct: -1 }]), UNAVAILABLE)
  })

  it('isValidCompletion accepts 0 and 100 and rejects the rest', () => {
    assert.equal(isValidCompletion(0), true)
    assert.equal(isValidCompletion(100), true)
    assert.equal(isValidCompletion(101), false)
    assert.equal(isValidCompletion(null), false)
    assert.equal(isValidCompletion('50'), false)
  })
})

describe('completionFromPages', () => {
  it('computes a percentage from page data', () => {
    assert.equal(completionFromPages(5, 10), 50)
  })

  it('is unavailable when the page count is missing', () => {
    assert.equal(completionFromPages(5, null), UNAVAILABLE)
    assert.equal(completionFromPages(null, 10), UNAVAILABLE)
  })

  it('is unavailable rather than zero when total pages is zero', () => {
    // Dividing by zero must not silently become "read 0%".
    assert.equal(completionFromPages(0, 0), UNAVAILABLE)
  })

  it('caps at 100', () => {
    assert.equal(completionFromPages(12, 10), 100)
  })

  it('a genuine zero pages viewed is 0%, not unavailable', () => {
    assert.equal(completionFromPages(0, 10), 0)
  })
})

// ---------------------------------------------------------------------------
// Unavailable display
// ---------------------------------------------------------------------------

describe('missing values display as Unavailable', () => {
  it('formatMetric renders null as Unavailable, never 0', () => {
    assert.equal(formatMetric(null), UNAVAILABLE_LABEL)
    assert.notEqual(formatMetric(null), '0')
  })

  it('formatMetric renders NaN as Unavailable', () => {
    assert.equal(formatMetric(NaN), UNAVAILABLE_LABEL)
  })

  it('formatMetric renders a genuine zero as 0', () => {
    assert.equal(formatMetric(0), '0')
  })

  it('applies the caller format when a value exists', () => {
    assert.equal(formatMetric(42, (n) => `${n}s`), '42s')
  })

  it('the label is the word, not a dash or a zero', () => {
    assert.equal(UNAVAILABLE_LABEL, 'Unavailable')
    assert.equal(NOT_APPLICABLE_LABEL, 'Not applicable')
  })
})

// ---------------------------------------------------------------------------
// Clicks and views are never combined
// ---------------------------------------------------------------------------

describe('clicks and view sessions stay apart', () => {
  it('the rule is documented in the module', () => {
    assert.match(NEVER_COMBINE, /never added together/)
    assert.equal(combinedViewsAreForbidden(), true)
  })

  it('there is no helper that sums them', async () => {
    const mod = await import('../src/lib/engagement-metrics.ts')
    // No exported function RETURNS a combined figure. combinedViewsAreForbidden
    // is the assertion of the rule, not a violation of it, so it is excluded.
    const names = Object.keys(mod).filter((n) => n !== 'combinedViewsAreForbidden')
    assert.equal(names.some((n) => /totalViews|combinedViews|allViews|clicksPlus/i.test(n)), false)
  })

  it('clicks and sessions are computed from different row shapes', () => {
    const clicks = [{ eventId: 'c1', visitorId: 'v1' }]
    const views = [{ papermarkViewId: 'v1' }]
    // Deliberately equal counts from unrelated sources: the point is that
    // nothing in the module adds them.
    assert.equal(accessClicks(clicks), 1)
    assert.equal(viewSessions(views), 1)
  })
})

// ---------------------------------------------------------------------------
// Date windows
// ---------------------------------------------------------------------------

describe('date windows', () => {
  const now = new Date('2026-09-03T12:00:00.000Z')

  it('defaults to 30 days', () => {
    const w = resolveWindow({ now })
    assert.equal(w.preset, '30d')
    assert.equal(w.days, 30)
  })

  it('supports 7, 30 and 90 day presets', () => {
    for (const [preset, days] of [['7d', 7], ['30d', 30], ['90d', 90]]) {
      const w = resolveWindow({ preset, now })
      assert.equal(w.preset, preset)
      assert.equal(w.days, days)
    }
  })

  it('the 7-day window starts exactly 7 days back', () => {
    const w = resolveWindow({ preset: '7d', now })
    assert.equal(w.fromIso, '2026-08-27T12:00:00.000Z')
    assert.equal(w.toIso, '2026-09-03T12:00:00.000Z')
  })

  it('accepts a valid custom range', () => {
    const w = resolveWindow({
      preset: 'custom',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-31T00:00:00.000Z',
      now,
    })
    assert.equal(w.preset, 'custom')
    assert.equal(w.days, 30)
  })

  it('falls back to 30 days for a reversed custom range', () => {
    const w = resolveWindow({ preset: 'custom', from: '2026-02-01', to: '2026-01-01', now })
    assert.equal(w.preset, '30d')
  })

  it('falls back to 30 days for an unparseable custom range', () => {
    assert.equal(resolveWindow({ preset: 'custom', from: 'nonsense', to: 'x', now }).preset, '30d')
  })

  it('ignores an unrecognised preset rather than producing an empty window', () => {
    assert.equal(resolveWindow({ preset: 'all-time', now }).preset, '30d')
  })

  it('bounds are UTC ISO strings', () => {
    const w = resolveWindow({ preset: '30d', now })
    assert.match(w.fromIso, /Z$/)
    assert.match(w.toIso, /Z$/)
  })
})

// ---------------------------------------------------------------------------
// Africa/Lagos display
// ---------------------------------------------------------------------------

describe('Africa/Lagos display', () => {
  it('the display zone is Africa/Lagos', () => {
    assert.equal(DISPLAY_TIME_ZONE, 'Africa/Lagos')
  })

  it('renders a UTC timestamp shifted to Lagos (+01:00)', () => {
    // 12:00 UTC is 13:00 in Lagos, which observes no daylight saving.
    const out = formatLagos('2026-09-03T12:00:00.000Z')
    assert.match(out, /13:00/)
    assert.match(out, /3 Sept? 2026/)
  })

  it('renders midnight UTC as 01:00 the same day in Lagos', () => {
    assert.match(formatLagos('2026-09-03T00:00:00.000Z'), /01:00/)
  })

  it('renders a null or invalid time as Unavailable', () => {
    assert.equal(formatLagos(null), UNAVAILABLE_LABEL)
    assert.equal(formatLagos('not a date'), UNAVAILABLE_LABEL)
  })
})

// ---------------------------------------------------------------------------
// Reader and event types
// ---------------------------------------------------------------------------

describe('type guards', () => {
  it('the four reader types are exactly as specified', () => {
    assert.deepEqual([...READER_TYPES], ['subscriber', 'briefing', 'complimentary_review', 'unknown'])
  })

  it('the four access event types are exactly as specified', () => {
    assert.deepEqual([...ACCESS_EVENT_TYPES], [
      'review_access_clicked',
      'publication_details_clicked',
      'subscriber_document_view_clicked',
      'subscriber_document_download_clicked',
    ])
  })

  it('isReaderType rejects anything else', () => {
    assert.equal(isReaderType('subscriber'), true)
    assert.equal(isReaderType('open_edition'), false)
    assert.equal(isReaderType(null), false)
  })

  it('isAccessEventType rejects anything else', () => {
    assert.equal(isAccessEventType('review_access_clicked'), true)
    assert.equal(isAccessEventType('portal_opened'), false)
  })

  it('only a subscriber is a paid reader', () => {
    assert.equal(isPaidReaderType('subscriber'), true)
    assert.equal(isPaidReaderType('complimentary_review'), false)
    assert.equal(isPaidReaderType('briefing'), false)
  })

  it('only complimentary_review is a prospect', () => {
    assert.equal(isProspectReaderType('complimentary_review'), true)
    assert.equal(isProspectReaderType('subscriber'), false)
  })

  it('there is no Open Edition reader type', () => {
    assert.equal(READER_TYPES.includes('open_edition'), false)
    assert.equal(isReaderType('open_edition'), false)
  })
})

// ---------------------------------------------------------------------------
// Email normalisation and exclusions
// ---------------------------------------------------------------------------

describe('normaliseEmail', () => {
  it('lowercases and trims', () => {
    assert.equal(normaliseEmail('  Reader@Example.ORG '), 'reader@example.org')
  })

  it('rejects a value with no @', () => {
    assert.equal(normaliseEmail('notanemail'), null)
  })

  it('rejects an absurdly long value', () => {
    assert.equal(normaliseEmail(`${'a'.repeat(250)}@x.com`), null)
  })

  it('rejects null and empty', () => {
    assert.equal(normaliseEmail(null), null)
    assert.equal(normaliseEmail(''), null)
  })
})

describe('isExcludedReader', () => {
  it('excludes a named admin address', () => {
    assert.equal(isExcludedReader('owner@aibt.ng', ['Owner@AIBT.ng']), true)
  })

  it('excludes obvious test addresses', () => {
    assert.equal(isExcludedReader('qa.test@somewhere.org'), true)
    assert.equal(isExcludedReader('anyone@example.com'), true)
  })

  it('does not exclude a genuine reader', () => {
    assert.equal(isExcludedReader('desmond@onekobotech.com'), false)
  })

  it('does not exclude a null address', () => {
    assert.equal(isExcludedReader(null), false)
  })
})

// ---------------------------------------------------------------------------
// Enrichment coverage
// ---------------------------------------------------------------------------

describe('enrichmentCoverage', () => {
  it('reports a percentage', () => {
    assert.equal(enrichmentCoverage(10, 5), 50)
  })

  it('is unavailable rather than zero when there are no views', () => {
    assert.equal(enrichmentCoverage(0, 0), UNAVAILABLE)
  })

  it('caps at 100', () => {
    assert.equal(enrichmentCoverage(5, 10), 100)
  })

  it('is 0 when views exist but none are enriched', () => {
    assert.equal(enrichmentCoverage(10, 0), 0)
  })
})
