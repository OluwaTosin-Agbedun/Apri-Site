/**
 * Final Phase 6 work — index and constraint review, analytics privacy,
 * Chancellor copy, and approved Complimentary Review recipients.
 */

import { describe, it, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  parseRecipients,
  isValidRecipient,
  serialiseRecipients,
  deserialiseRecipients,
  canProvisionLinks,
  MAX_RECIPIENTS,
} from '../src/lib/review-recipients.ts'
import {
  isExcludedAnalyticsPath,
  hasSensitiveParams,
  sanitizeBeacon,
  EXCLUDED_PREFIXES,
  SENSITIVE_PARAMS,
} from '../src/lib/analytics-privacy.ts'
import {
  reviewLinkSettings,
  prospectWatermarkConfig,
} from '../src/lib/papermark-dataroom-contract.ts'
import { approvedTitleForSlot, prefillReviewCard } from '../src/lib/review-prefill.ts'

const ROOT = resolve(import.meta.dirname, '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

const MIGRATION = 'db/migrations/20260903_publication_engagement_accuracy.sql'
const ACTIONS = 'src/app/actions/review-library.ts'
const SERVICE = 'src/lib/papermark-datarooms.ts'
const CONTRACT = 'src/lib/papermark-dataroom-contract.ts'
const RECIP_FORM = 'src/app/admin/review-library/recipients-form.tsx'
const TRACKED = 'src/components/TrackedAccessLink.tsx'

const codeOnly = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/(^|\s)\/\/.*$/, '$1').replace(/^\s*--.*$/, ''))
    .join('\n')

const fnBody = (src, name) => {
  const start = src.indexOf(`function ${name}`)
  assert.notEqual(start, -1, `${name} must exist`)
  const rest = src.slice(start + 1)
  const next = rest.indexOf('\nexport ')
  return next === -1 ? rest : rest.slice(0, next)
}

// ===========================================================================
// PART A1 — indexes
// ===========================================================================

describe('index review', () => {
  const mig = read(MIGRATION)

  const EXPECTED = [
    'publication_access_events_event_id_key',
    'publication_access_events_date_idx',
    'publication_access_events_pub_date_idx',
    'publication_access_events_slot_date_idx',
    'document_download_events_source_event_key',
    'document_download_events_date_idx',
    'document_download_events_pub_date_idx',
    'document_download_events_subscriber_date_idx',
    'document_download_events_email_date_idx',
    'document_views_date_idx',
    'document_views_pub_date_idx',
    'document_views_email_date_idx',
    'document_views_reader_type_date_idx',
    'document_views_enrichment_idx',
    'papermark_webhook_events_outcome_idx',
  ]

  it('creates exactly the fifteen indexes that queries need', () => {
    const created = [...mig.matchAll(/create (?:unique )?index if not exists (\w+)/g)].map((m) => m[1])
    assert.deepEqual(created.sort(), [...EXPECTED].sort())
  })

  it('drops the three exact duplicates of schema.sql indexes', () => {
    // schema.sql already has document_views (subscriber_id, viewed_at desc),
    // document_views (papermark_link_id), and a unique on
    // papermark_webhook_events (event_id). Recreating them under new names
    // would have doubled the write cost for no read benefit.
    assert.doesNotMatch(mig, /document_views_subscriber_date_idx/)
    assert.doesNotMatch(mig, /document_views_papermark_link_idx/)
    assert.doesNotMatch(mig, /papermark_webhook_events_event_id_key/)

    const schema = read('db/schema.sql')
    assert.match(schema, /on document_views \(subscriber_id, viewed_at desc\)/)
    assert.match(schema, /on document_views \(papermark_link_id\)/)
    assert.match(read('db/migrations/20260828_papermark_datarooms.sql'), /papermark_webhook_events_key/)
  })

  it('drops the six indexes no query filters on', () => {
    for (const gone of [
      'publication_access_events_type_date_idx',
      'publication_access_events_visitor_date_idx',
      'document_download_events_reader_type_date_idx',
      'document_download_events_view_idx',
      'document_download_events_link_idx',
      'document_download_events_document_idx',
      'document_views_papermark_document_idx',
    ]) {
      assert.doesNotMatch(mig, new RegExp(gone), `${gone} must not be created`)
    }
  })

  it('indexes email on lower(), matching how the queries compare it', () => {
    // A plain b-tree on viewer_email cannot serve `lower(viewer_email) = ...`,
    // so the obvious index would have been built and never used.
    assert.match(mig, /on document_views \(lower\(viewer_email\), viewed_at desc\)/)
    assert.match(mig, /on document_download_events \(lower\(viewer_email\), downloaded_at desc\)/)

    const analytics = read('src/lib/engagement-analytics.ts')
    assert.match(analytics, /lower\(dv\.viewer_email\)/)
  })

  it('makes the enrichment index partial so it stays small', () => {
    assert.match(mig, /document_views_enrichment_idx[\s\S]{0,120}where last_enriched_at is null/)
  })

  it('adds a full date index because the existing one is partial', () => {
    // schema.sql has (viewed_at desc) WHERE subscriber_id is null, which serves
    // the unmatched queue and not the windowed dashboard scans.
    assert.match(mig, /on document_views \(viewed_at desc\)/)
    assert.match(read('db/schema.sql'), /on document_views \(viewed_at desc\)\s*\n\s*where subscriber_id is null/)
  })

  it('every remaining index has a stated purpose', () => {
    for (const name of EXPECTED) {
      const at = mig.indexOf(name)
      const preceding = mig.slice(Math.max(0, at - 400), at)
      assert.match(preceding, /--/, `${name} must be preceded by a comment explaining it`)
    }
  })
})

// ===========================================================================
// PART A2 — constraints
// ===========================================================================

describe('constraint safety', () => {
  const mig = read(MIGRATION)

  it('runs as one transaction', () => {
    assert.match(mig, /^begin;$/m)
    assert.match(mig, /^commit;$/m)
    assert.ok(mig.indexOf('begin;') < mig.indexOf('commit;'))
  })

  it('drops no constraint at all', () => {
    // The previous version dropped four constraints in order to re-add them
    // identically. On a populated table that is a window in which the table has
    // no constraint, bought for nothing.
    assert.doesNotMatch(mig, /drop constraint/i)
  })

  it('declares new-table constraints inline', () => {
    assert.match(mig, /constraint publication_access_events_type_check check/)
    assert.match(mig, /constraint document_download_events_reader_type_check/)
    assert.match(mig, /constraint document_download_events_collection_source_check/)
  })

  it('adds the existing-table constraint only when absent', () => {
    assert.match(mig, /if not exists \(\s*select 1 from pg_constraint/)
    assert.match(mig, /conname = 'document_views_reader_type_check'/)
    assert.match(mig, /conrelid = 'document_views'::regclass/)
  })

  it('preserves legacy document_views rows by permitting NULL', () => {
    assert.match(mig, /check \(reader_type is null or reader_type in \(/)
  })

  it('never leaves a table unprotected after a failure', () => {
    // Inside the transaction, a failed ADD rolls the whole file back, so a
    // constraint cannot be lost. Nothing is dropped in the first place.
    const code = codeOnly(mig)
    assert.doesNotMatch(code, /drop constraint/i)
    assert.match(mig, /^begin;$/m)
  })

  it('remains free of destructive statements', () => {
    for (const bad of [/drop table/i, /drop column/i, /\btruncate\b/i, /delete from/i, /alter column/i]) {
      assert.doesNotMatch(mig, bad)
    }
  })

  it('seeds the recipient setting without overwriting it', () => {
    assert.match(mig, /'review_approved_recipients'/)
    assert.match(mig, /on conflict \(key\) do nothing/)
  })
})

// ===========================================================================
// PART A3 — analytics exclusions
// ===========================================================================

describe('Vercel Analytics exclusions', () => {
  it('excludes /admin and all descendants', () => {
    for (const p of ['/admin', '/admin/engagement', '/admin/review-library', '/admin/setup']) {
      assert.equal(isExcludedAnalyticsPath(p), true, p)
    }
  })

  it('excludes the admin login route', () => {
    assert.equal(isExcludedAnalyticsPath('/admin/login'), true)
  })

  it('excludes /api and all descendants', () => {
    for (const p of ['/api', '/api/engagement/click', '/api/papermark/webhook', '/api/cron/papermark-views']) {
      assert.equal(isExcludedAnalyticsPath(p), true, p)
    }
  })

  it('excludes /portal and all descendants', () => {
    for (const p of [
      '/portal',
      '/portal/sign-in',
      '/portal/verify',
      '/portal/open-private',
      '/portal/document/abc123',
      '/portal/document/abc123/download',
    ]) {
      assert.equal(isExcludedAnalyticsPath(p), true, p)
    }
  })

  it('excludes magic-link and token-bearing route prefixes', () => {
    for (const p of ['/verify', '/magic/abc', '/auth/callback', '/login', '/signin', '/sign-in']) {
      assert.equal(isExcludedAnalyticsPath(p), true, p)
    }
  })

  it('covers every real authenticated route in the app', () => {
    // Enumerated from src/app: all auth surfaces live under /admin or /portal.
    for (const p of ['/admin/login', '/admin/setup', '/portal/sign-in', '/portal/verify']) {
      assert.equal(isExcludedAnalyticsPath(p), true, p)
    }
  })

  it('still reports public pages', () => {
    for (const p of ['/', '/publications', '/publications/some-slug', '/services', '/access', '/privacy', '/terms', '/request-briefing']) {
      assert.equal(isExcludedAnalyticsPath(p), false, p)
    }
  })

  it('does not over-match a public path that merely starts with a word', () => {
    assert.equal(isExcludedAnalyticsPath('/administration-guide'), false)
    assert.equal(isExcludedAnalyticsPath('/apiary'), false)
  })

  it('treats an empty path as excluded', () => {
    assert.equal(isExcludedAnalyticsPath(''), true)
  })
})

describe('sensitive query parameters', () => {
  it('detects a token', () => {
    assert.equal(hasSensitiveParams('?token=abc'), true)
    assert.equal(hasSensitiveParams('?magic_token=abc'), true)
    assert.equal(hasSensitiveParams('?authToken=abc'), true)
  })

  it('detects an email', () => {
    assert.equal(hasSensitiveParams('?email=a@b.com'), true)
  })

  it('detects a subscriber id and a document id', () => {
    assert.equal(hasSensitiveParams('?subscriber_id=uuid'), true)
    assert.equal(hasSensitiveParams('?document_id=doc_1'), true)
  })

  it('detects a secret, a key and a signature', () => {
    for (const q of ['?secret=x', '?key=x', '?api_key=x', '?signature=x', '?sig=x']) {
      assert.equal(hasSensitiveParams(q), true, q)
    }
  })

  it('allows an innocuous parameter', () => {
    assert.equal(hasSensitiveParams('?page=2'), false)
    assert.equal(hasSensitiveParams('?window=30d'), false)
  })

  it('treats no query string as clean', () => {
    assert.equal(hasSensitiveParams(''), false)
  })

  it('the named list covers the required categories', () => {
    for (const p of ['token', 'email', 'subscriber_id', 'document_id', 'secret', 'session']) {
      assert.ok((SENSITIVE_PARAMS).includes(p), `${p} must be listed`)
    }
  })
})

describe('sanitizeBeacon', () => {
  it('drops an excluded area outright', () => {
    assert.equal(sanitizeBeacon({ url: 'https://a.test/admin/engagement' }), null)
    assert.equal(sanitizeBeacon({ url: 'https://a.test/portal/document/1' }), null)
    assert.equal(sanitizeBeacon({ url: 'https://a.test/api/engagement/click' }), null)
  })

  it('DROPS rather than cleans a URL carrying a token', () => {
    // The visit itself is credentialed; stripping the parameter and reporting
    // the page would still tell a third party the visit happened.
    assert.equal(sanitizeBeacon({ url: 'https://a.test/publications?token=abc' }), null)
  })

  it('drops a URL carrying an email or a document id', () => {
    assert.equal(sanitizeBeacon({ url: 'https://a.test/publications?email=a@b.com' }), null)
    assert.equal(sanitizeBeacon({ url: 'https://a.test/publications?document_id=doc_1' }), null)
  })

  it('strips the query string and hash from what it does send', () => {
    const out = sanitizeBeacon({ url: 'https://a.test/publications?page=2#complimentary-review' })
    assert.equal(out.url, 'https://a.test/publications')
  })

  it('drops an unparseable url', () => {
    assert.equal(sanitizeBeacon({ url: 'not a url' }), null)
  })

  it('sends only an origin and a path, never a query or fragment', () => {
    // Vercel's beforeSend receives the URL of the page being viewed, never an
    // outbound link, so a Papermark address cannot reach it. What is asserted
    // here is the property that matters: whatever it is handed, only the
    // origin and path survive.
    const out = sanitizeBeacon({ url: 'https://a.test/publications?x=1&y=2#frag' })
    assert.equal(out.url, 'https://a.test/publications')
    assert.doesNotMatch(out.url, /[?#]/)
  })

  it('the prefix list is non-empty and includes the three required areas', () => {
    for (const p of ['/admin', '/api', '/portal']) {
      assert.ok((EXCLUDED_PREFIXES).includes(p), `${p} must be excluded`)
    }
  })
})

// ===========================================================================
// PART A4 — click recording never blocks navigation
// ===========================================================================

describe('TrackedAccessLink', () => {
  const src = read(TRACKED)
  const code = codeOnly(src)

  it('uses navigator.sendBeacon when available', () => {
    assert.match(code, /navigator\.sendBeacon/)
  })

  it('falls back to fetch with keepalive', () => {
    assert.match(code, /keepalive: true/)
    assert.match(code, /if \(!queued\)/)
  })

  it('never prevents navigation', () => {
    assert.doesNotMatch(code, /preventDefault/)
    assert.doesNotMatch(code, /return false/)
  })

  it('never awaits the recording', () => {
    assert.doesNotMatch(code, /await recordAccessClick/)
    assert.doesNotMatch(code, /onClick = async/)
    assert.match(code, /const onClick = \(\) => \{/)
  })

  it('swallows every failure path', () => {
    assert.match(code, /catch \{/)
    assert.match(code, /\.catch\(\(\) => \{\}\)/)
  })

  it('sends no secure Papermark URL and no email', () => {
    const body = src.slice(src.indexOf('const body = JSON.stringify'), src.indexOf('let queued'))
    assert.doesNotMatch(body, /secureUrl|secure_link_url|papermark\.com|athenacentre/)
    assert.doesNotMatch(body, /email/i)
    assert.doesNotMatch(body, /token/i)
  })

  it('sends only the four permitted identifiers plus the path and time', () => {
    const body = src.slice(src.indexOf('const body = JSON.stringify'), src.indexOf('let queued'))
    // eventId is passed as a shorthand property, so it is followed by a comma
    // rather than a colon.
    const keys = [...body.matchAll(/^\s*(\w+)[,:]/gm)].map((m) => m[1])
    assert.deepEqual([...new Set(keys)].sort(), [
      'eventId', 'eventType', 'occurredAt', 'originPath', 'papermarkDocumentId',
      'publicationId', 'slotKey',
    ].sort())
  })
})

// ===========================================================================
// PART B — Chancellor corrections
// ===========================================================================

describe('Chancellor copy', () => {
  const pubs = read('src/app/publications/page.tsx')

  it('the Publications heading sentence is the approved wording', () => {
    assert.match(
      pubs,
      /Publications and analytical products available to APRI subscribers\s*\n?\s*and authorised readers\./,
    )
  })

  it('the old Publications wording is gone', () => {
    assert.doesNotMatch(pubs, /APRI intelligence products for subscribers and authorised readers/)
  })

  it('the Complimentary Review introduction is the approved wording', () => {
    assert.match(
      pubs,
      /This complimentary review provides prospective subscribers with\s*\n?\s*selected examples of publications and analytical products\s*\n?\s*available through APRI\./,
    )
  })

  it('the old review introduction is gone', () => {
    assert.doesNotMatch(pubs, /complimentary review page provides selected sample publications/)
  })

  it('the Political Monitor description names the Athena Election Observatory', () => {
    const ent = read('src/lib/entitlements.ts')
    // entitlements.ts is on the straight-quotes-only list enforced by
    // chancellor-prelaunch.test.mjs, so the possessive apostrophe is an escaped
    // ASCII one rather than the curly character in the supplied copy.
    assert.match(
      ent,
      /Organisational access to continuing political and regulatory monitoring, including the Monthly Intelligence Note, the Athena Election Observatory\\'s Political Landscape Monitor, Quarterly Outlook, Election Watch and relevant intelligence updates\./,
    )
  })

  it('entitlements.ts stays free of curly quotes', () => {
    assert.doesNotMatch(read('src/lib/entitlements.ts'), /[‘’“”]/)
  })

  it('the homepage hero statement is untouched', () => {
    const home = read('src/app/page.tsx')
    // The hero copy is pinned by the existing homepage tests; assert only that
    // this work did not introduce the publications sentence into it.
    assert.doesNotMatch(
      home,
      /Publications and analytical products available to APRI subscribers/,
    )
  })
})

describe('PLM review card', () => {
  const card = prefillReviewCard({
    title: 'anything',
    series: 'PLM',
    product_line: '',
    frequency: '',
    summary: '',
    description: '',
  })

  it('publication type is ATHENA ELECTION OBSERVATORY', () => {
    assert.equal(card.publicationType, 'ATHENA ELECTION OBSERVATORY')
  })

  it('the description is the approved wording', () => {
    assert.equal(
      card.description,
      'A monthly monitoring publication from the Athena Election Observatory covering ' +
        'Nigeria’s democratic, electoral and political landscape. The Political Landscape ' +
        'Monitor is made available to APRI subscribers as part of their subscription.',
    )
  })

  it('frequency is Monthly', () => {
    assert.equal(card.frequency, 'Monthly')
  })

  it('audience is APRI subscribers and prospective readers', () => {
    assert.equal(card.audience, 'APRI subscribers and prospective readers')
  })

  it('the old wording is gone', () => {
    const src = read('src/lib/review-prefill.ts')
    assert.doesNotMatch(src, /Monthly Strategic Assessment/)
    assert.doesNotMatch(src, /broader monthly intelligence bouquet/)
  })

  it('the approved title is available for the owner to apply', () => {
    assert.equal(
      approvedTitleForSlot('PLM'),
      'Athena Political Landscape Monitor | Issue 01 | July 2026',
    )
  })

  it('MIN and AIU have no approved title, so nothing is forced on them', () => {
    assert.equal(approvedTitleForSlot('MIN'), null)
    assert.equal(approvedTitleForSlot('AIU'), null)
  })

  it('both surfaces render the same card fields, so one correction fixes both', () => {
    for (const f of ['src/app/page.tsx', 'src/app/publications/page.tsx']) {
      const src = read(f)
      assert.match(src, /card\.publicationType/, f)
      assert.match(src, /card\.pubTitle/, f)
      assert.match(src, /card\.description/, f)
    }
  })
})

describe('publication title editor', () => {
  const src = read(ACTIONS)
  const fn = fnBody(src, 'updateSlotPublicationTitle')

  it('is owner-only', () => {
    assert.match(fn, /requireOwner\(\)/)
  })

  it('updates documents.title only', () => {
    assert.match(fn, /update documents set title = \$\{clean\}/)
  })

  it('does not create a second publication', () => {
    assert.doesNotMatch(fn, /insert into documents/i)
  })

  it('does not change the slug, status or visibility', () => {
    assert.doesNotMatch(fn, /slug\s*=\s*\$/)
    assert.doesNotMatch(fn, /status\s*=\s*\$/)
    assert.doesNotMatch(fn, /visibility\s*=\s*\$/)
    assert.doesNotMatch(fn, /is_published\s*=/)
  })

  it('does not remap the Papermark document or touch the link', () => {
    assert.doesNotMatch(fn, /papermark_document_id\s*=/)
    assert.doesNotMatch(fn, /secure_link_id\s*=/)
    assert.doesNotMatch(fn, /secure_link_url\s*=/)
    assert.doesNotMatch(fn, /createReviewDocumentLink/)
  })

  it('validates the title length', () => {
    assert.match(fn, /clean\.length < 3/)
    assert.match(fn, /clean\.length > 300/)
  })

  it('the UI states what is left unchanged', () => {
    const form = read(RECIP_FORM)
    assert.match(form, /The slug stays/)
    assert.match(form, /Papermark document and secure link are untouched/)
  })

  it('the UI offers the approved title without applying it silently', () => {
    const form = read(RECIP_FORM)
    assert.match(form, /Use the approved title/)
    assert.match(form, /onClick=\{\(\) => setValue\(approvedTitle\)\}/)
  })
})

// ===========================================================================
// PART C — approved recipients
// ===========================================================================

describe('parseRecipients', () => {
  it('accepts newline-separated addresses', () => {
    const r = parseRecipients('a@x.com\nb@y.com')
    assert.deepEqual(r.emails, ['a@x.com', 'b@y.com'])
  })

  it('accepts comma-separated addresses', () => {
    assert.deepEqual(parseRecipients('a@x.com, b@y.com').emails, ['a@x.com', 'b@y.com'])
  })

  it('accepts semicolons and tabs, which mail clients produce', () => {
    assert.deepEqual(parseRecipients('a@x.com; b@y.com\tc@z.com').emails, ['a@x.com', 'b@y.com', 'c@z.com'])
  })

  it('trims and lower-cases', () => {
    assert.deepEqual(parseRecipients('  A@X.COM  ').emails, ['a@x.com'])
  })

  it('removes duplicates and counts them', () => {
    const r = parseRecipients('a@x.com\nA@X.com\na@x.com')
    assert.deepEqual(r.emails, ['a@x.com'])
    assert.equal(r.duplicates, 2)
  })

  it('preserves first-seen order', () => {
    assert.deepEqual(parseRecipients('z@x.com\na@x.com').emails, ['z@x.com', 'a@x.com'])
  })

  it('reports invalid entries rather than storing them', () => {
    const r = parseRecipients('good@x.com\nnot-an-email\nalso bad@')
    assert.deepEqual(r.emails, ['good@x.com'])
    assert.equal(r.invalid.length, 2)
  })

  it('extracts the address from a "Name <addr>" paste', () => {
    assert.deepEqual(parseRecipients('Jane Doe <jane@x.com>').emails, ['jane@x.com'])
  })

  it('rejects an over-long address', () => {
    assert.equal(parseRecipients(`${'a'.repeat(250)}@x.com`).emails.length, 0)
  })

  it('returns nothing for empty input', () => {
    const r = parseRecipients('')
    assert.deepEqual(r.emails, [])
    assert.deepEqual(r.invalid, [])
  })

  it('ignores blank lines', () => {
    assert.deepEqual(parseRecipients('a@x.com\n\n\n,,\nb@x.com').emails, ['a@x.com', 'b@x.com'])
  })
})

describe('recipient validation and storage', () => {
  it('isValidRecipient accepts a normal address', () => {
    assert.equal(isValidRecipient('reader@example.org'), true)
  })

  it('isValidRecipient rejects malformed addresses', () => {
    for (const bad of ['', 'no-at-sign', 'a@', '@b.com', 'a@b', 'a b@c.com', 'a@@b.com']) {
      assert.equal(isValidRecipient(bad), false, bad)
    }
  })

  it('serialise then deserialise round-trips', () => {
    const emails = ['a@x.com', 'b@y.com']
    assert.deepEqual(deserialiseRecipients(serialiseRecipients(emails)), emails)
  })

  it('deserialise re-validates, so a hand-edited row cannot inject rubbish', () => {
    assert.deepEqual(deserialiseRecipients('a@x.com\nrubbish\nb@y.com'), ['a@x.com', 'b@y.com'])
  })

  it('deserialise handles null and empty', () => {
    assert.deepEqual(deserialiseRecipients(null), [])
    assert.deepEqual(deserialiseRecipients(''), [])
  })

  it('canProvisionLinks fails closed on an empty list', () => {
    assert.equal(canProvisionLinks([]), false)
    assert.equal(canProvisionLinks(['a@x.com']), true)
  })

  it('there is a cap on the list size', () => {
    assert.ok(MAX_RECIPIENTS > 0 && MAX_RECIPIENTS <= 1000)
  })
})

describe('no new table was added', () => {
  it('the list lives in app_settings', () => {
    assert.match(read(MIGRATION), /insert into app_settings[\s\S]{0,80}'review_approved_recipients'/)
  })

  it('no recipients table is created', () => {
    assert.doesNotMatch(read(MIGRATION), /create table if not exists .*recipient/i)
  })

  it('the action reads and writes app_settings', () => {
    const src = read(ACTIONS)
    assert.match(src, /RECIPIENTS_KEY = 'review_approved_recipients'/)
    assert.match(fnBody(src, 'readApprovedRecipients'), /from app_settings where key/)
  })
})

describe('the list is never exposed publicly', () => {
  it('no public page reads it', () => {
    for (const f of [
      'src/app/publications/page.tsx',
      'src/app/page.tsx',
      'src/lib/publications.ts',
    ]) {
      assert.doesNotMatch(read(f), /review_approved_recipients/, f)
      assert.doesNotMatch(read(f), /ApprovedRecipients/, f)
    }
  })

  it('the click endpoint does not read it', () => {
    assert.doesNotMatch(read('src/app/api/engagement/click/route.ts'), /review_approved_recipients/)
  })

  it('the read action is owner-gated', () => {
    assert.match(fnBody(read(ACTIONS), 'getApprovedRecipients'), /requireOwner\(\)/)
  })

  it('the client form receives the list as a prop, not by fetching it', () => {
    const form = read(RECIP_FORM)
    assert.doesNotMatch(form, /getApprovedRecipients/)
    assert.match(form, /emails: string\[\]/)
  })

  it('the page reads it server-side', () => {
    const page = read('src/app/admin/review-library/page.tsx')
    assert.match(page, /review_approved_recipients/)
    assert.match(page, /never fetched by client JavaScript/)
  })
})

describe('saveApprovedRecipients', () => {
  const fn = fnBody(read(ACTIONS), 'saveApprovedRecipients')

  it('is owner-only', () => {
    assert.match(fn, /requireOwner\(\)/)
  })

  it('parses, validates and de-duplicates', () => {
    assert.match(fn, /parseRecipients\(raw\)/)
    assert.match(fn, /parsed\.invalid\.length/)
    assert.match(fn, /parsed\.duplicates/)
  })

  it('enforces the cap', () => {
    assert.match(fn, /MAX_RECIPIENTS/)
  })

  it('does NOT touch Papermark', () => {
    assert.doesNotMatch(fn, /setReviewLinkAllowList/)
    assert.doesNotMatch(fn, /papermark-datarooms/)
  })

  it('says the links are unchanged until Apply', () => {
    assert.match(fn, /unchanged until you press Apply/)
  })
})

describe('email restrictions: preview then apply', () => {
  const src = read(ACTIONS)

  it('both are owner-only', () => {
    assert.match(fnBody(src, 'previewEmailRestrictions'), /requireOwner\(\)/)
    assert.match(fnBody(src, 'applyEmailRestrictions'), /requireOwner\(\)/)
  })

  it('preview writes nothing', () => {
    const fn = fnBody(src, 'previewEmailRestrictions')
    assert.doesNotMatch(fn, /setReviewLinkAllowList/)
    assert.doesNotMatch(fn, /update complimentary_review_items/)
  })

  it('preview reads the live allow list from Papermark', () => {
    assert.match(fnBody(src, 'previewEmailRestrictions'), /getReviewLinkSettings/)
  })

  it('both fail closed on an empty approved list', () => {
    for (const name of ['previewEmailRestrictions', 'applyEmailRestrictions']) {
      const fn = fnBody(src, name)
      assert.match(fn, /canProvisionLinks\(approved\)/, name)
    }
    assert.match(fnBody(src, 'applyEmailRestrictions'), /Refused: no approved recipients/)
  })

  it('apply refuses BEFORE touching any link', () => {
    const fn = fnBody(src, 'applyEmailRestrictions')
    const guard = fn.indexOf('canProvisionLinks(approved)')
    const call = fn.indexOf('setReviewLinkAllowList')
    assert.ok(guard < call, 'the guard must precede the first link write')
  })

  it('apply updates the three existing links, not new ones', () => {
    const fn = fnBody(src, 'applyEmailRestrictions')
    assert.match(fn, /slot_key in \('MIN', 'AIU', 'PLM'\)/)
    assert.match(fn, /setReviewLinkAllowList/)
    assert.doesNotMatch(fn, /createReviewDocumentLink/)
  })

  it('apply reports individual failures without aborting', () => {
    const fn = fnBody(src, 'applyEmailRestrictions')
    assert.match(fn, /failures\.push\(/)
    assert.match(fn, /continue/)
    assert.match(fn, /\$\{failures\.length\} failed/)
  })

  it('apply does not rewrite the URL, link id or document id', () => {
    const fn = fnBody(src, 'applyEmailRestrictions')
    const update = fn.slice(fn.indexOf('update complimentary_review_items'), fn.indexOf('where slot_key'))
    assert.doesNotMatch(update, /secure_link_url\s*=/)
    assert.doesNotMatch(update, /secure_link_id\s*=/)
    assert.doesNotMatch(update, /secure_link_document_id\s*=/)
    assert.doesNotMatch(update, /papermark_document_id\s*=/)
  })
})

describe('setReviewLinkAllowList preserves everything else', () => {
  const src = read(SERVICE)
  const fn = fnBody(src, 'setReviewLinkAllowList')

  it('sends only allow_list in the PATCH body', () => {
    assert.match(fn, /body: \{ allow_list: \[\.\.\.args\.allowList\] \}/)
  })

  it('does not send watermark, download or verification settings', () => {
    const body = fn.slice(fn.indexOf('body: {'), fn.indexOf('},'))
    assert.doesNotMatch(body, /watermark/)
    assert.doesNotMatch(body, /allow_download/)
    assert.doesNotMatch(body, /email_protected/)
    assert.doesNotMatch(body, /email_authenticated/)
  })

  it('does not recreate the link', () => {
    assert.doesNotMatch(fn, /method: 'POST'/)
    assert.match(fn, /method: 'PATCH'/)
  })

  it('re-checks the document target before accepting the response', () => {
    assert.match(fn, /isDocumentTargetedLink\(link, args\.documentId\)/)
  })

  it('refuses an empty allow list', () => {
    assert.match(fn, /args\.allowList\.length === 0/)
    assert.match(fn, /Papermark would treat it as unrestricted/)
  })
})

describe('all provisioning paths use the approved list', () => {
  const src = read(ACTIONS)

  for (const name of ['createSlotSecureLink', 'verifySlotSecureLink', 'preparePendingSecureLink']) {
    it(`${name} reads the approved list`, () => {
      assert.match(fnBody(src, name), /readApprovedRecipients\(sql\)/, name)
    })

    it(`${name} refuses when nobody is approved`, () => {
      assert.match(fnBody(src, name), /canProvisionLinks\(approved\)/, name)
    })
  }

  it('createReviewDocumentLink requires a non-empty allow list at the type level', () => {
    const service = read(SERVICE)
    assert.match(service, /allowList: readonly string\[\]/)
    assert.match(fnBody(service, 'createReviewDocumentLink'), /args\.allowList\.length === 0/)
  })

  it('reviewLinkSettings carries the allow list into the request body', () => {
    const s = reviewLinkSettings({
      documentId: 'd1',
      slotKey: 'MIN',
      allowList: ['a@x.com', 'b@y.com'],
    })
    assert.deepEqual(s.allow_list, ['a@x.com', 'b@y.com'])
  })

  it('an omitted allow list yields an empty array, which the caller refuses', () => {
    const s = reviewLinkSettings({ documentId: 'd1', slotKey: 'MIN' })
    assert.deepEqual(s.allow_list, [])
  })

  it('the contract explains why an empty list is refused rather than sent', () => {
    assert.match(read(CONTRACT), /Papermark treats an empty allow list as "any verified/)
  })
})

describe('restrictions leave protected settings alone', () => {
  it('verified-email access is still required', () => {
    const s = reviewLinkSettings({ documentId: 'd', slotKey: 'MIN', allowList: ['a@x.com'] })
    assert.equal(s.email_protected, true)
    assert.equal(s.email_authenticated, true)
  })

  it('the watermark is unchanged', () => {
    const s = reviewLinkSettings({ documentId: 'd', slotKey: 'MIN', allowList: ['a@x.com'] })
    assert.equal(s.watermark_config.text, prospectWatermarkConfig().text)
    assert.equal(s.watermark_config.opacity, 0.15)
    assert.equal(s.watermark_config.font_size, 18)
    assert.match(s.watermark_config.text, /APRI Complimentary Review Copy/)
  })

  it('the download setting is unchanged', () => {
    const s = reviewLinkSettings({ documentId: 'd', slotKey: 'MIN', allowList: ['a@x.com'] })
    assert.equal(s.allow_download, true)
  })

  it('the document target is unchanged and no dataroom_id appears', () => {
    const s = reviewLinkSettings({ documentId: 'doc_1', slotKey: 'MIN', allowList: ['a@x.com'] })
    assert.equal(s.document_id, 'doc_1')
    assert.equal('dataroom_id' in s, false)
  })

  it('paid subscriber links are not touched', () => {
    const src = read(ACTIONS)
    assert.doesNotMatch(src, /papermark_subscriber_document_links/)
    assert.doesNotMatch(src, /papermark_dataroom_links/)
    assert.doesNotMatch(src, /mintSubscriberLink/)
    assert.doesNotMatch(src, /ensureDocumentLink/)
  })

  it('subscriber authentication is not touched', () => {
    const src = read(ACTIONS)
    assert.doesNotMatch(src, /auth_tokens/)
    assert.doesNotMatch(src, /createSubscriberSession/)
    assert.doesNotMatch(src, /issue\w*Token/)
  })
})

test('no credential reaches the recipients form', () => {
  const form = read(RECIP_FORM)
  assert.doesNotMatch(form, /PAPERMARK_API_TOKEN|PAPERMARK_WEBHOOK_SECRET|CRON_SECRET|DATABASE_URL/)
  assert.doesNotMatch(form, /from ['"]@\/lib\/db['"]/)
  assert.doesNotMatch(form, /from ['"]@\/lib\/papermark-datarooms['"]/)
})
