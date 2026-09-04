/**
 * The privacy notice and terms of use must describe what the code does.
 *
 * These pages drifted once already. They forbade downloading after downloads
 * were enabled, said the watermark carried the reader's name after it was
 * changed to their email address, and described freely shareable "open
 * publications" after those were replaced by an approval-restricted
 * Complimentary Review. Nothing caught it, because nothing tied the prose to
 * the implementation.
 *
 * So these tests assert the notice against the source of the behaviour it
 * describes, not against a copy of itself. A test that only checked the page
 * said "downloads are permitted" would pass just as happily when the code
 * stopped permitting them.
 */

import { describe, it, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  subscriberWatermarkText,
  PROSPECT_WATERMARK_TEXT,
  reviewLinkSettings,
  documentLinkSettings,
} from '../src/lib/papermark-dataroom-contract.ts'

const ROOT = resolve(import.meta.dirname, '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

const PRIVACY = 'src/app/privacy/page.tsx'
const TERMS = 'src/app/terms/page.tsx'

const privacySrc = read(PRIVACY)
const termsSrc = read(TERMS)

/**
 * The rendered wording, near enough.
 *
 * Block comments are removed first: the file-level comment explains that the
 * page once wrongly described "open publications", and a test looking for that
 * phrase would otherwise match the very note recording that it was fixed.
 * Whitespace is then collapsed, because an assertion about what the page says
 * should not depend on where the JSX happens to wrap.
 */
const prose = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ')

const privacy = prose(privacySrc)
const terms = prose(termsSrc)

// ---------------------------------------------------------------------------
// 1. Downloads: enabled in code, so both notices must say so
// ---------------------------------------------------------------------------

describe('downloads', () => {
  it('are in fact enabled on subscriber links', () => {
    const s = documentLinkSettings({
      documentId: 'd',
      assignedName: 'A',
      assignedEmail: 'a@x.com',
      expiresAt: null,
    })
    assert.equal(s.allow_download, true)
  })

  it('are in fact enabled on review links', () => {
    const s = reviewLinkSettings({ documentId: 'd', slotKey: 'MIN', allowList: ['a@x.com'] })
    assert.equal(s.allow_download, true)
  })

  it('a download route exists', () => {
    assert.equal(existsSync(join(ROOT, 'src/app/portal/document/[id]/download/route.ts')), true)
  })

  it('downloads are recorded as their own events', () => {
    const mig = read('db/migrations/20260903_publication_engagement_accuracy.sql')
    assert.match(mig, /create table if not exists document_download_events/)
  })

  // Given all of the above, neither page may claim otherwise.
  it('the privacy notice does not claim documents cannot be downloaded', () => {
    assert.doesNotMatch(privacy, /provides no download/i)
    assert.doesNotMatch(privacy, /view-only/i)
  })

  it('the terms do not claim documents cannot be downloaded', () => {
    assert.doesNotMatch(terms, /provides no download/i)
    assert.doesNotMatch(terms, /view-only/i)
    assert.doesNotMatch(terms, /printed to file/i)
  })

  it('the privacy notice discloses that downloads are recorded', () => {
    assert.match(privacy, /download/i)
    assert.match(privacy, /Each download is recorded separately/)
    assert.match(privacy, /repeat downloads/i)
  })

  it('the terms permit downloading while prohibiting redistribution', () => {
    assert.match(terms, /downloaded for your own use/)
    assert.match(terms, /not permitted is passing a copy on/)
    assert.match(terms, /re-hosted/)
  })

  it('the terms say a downloaded file keeps its watermark', () => {
    assert.match(terms, /downloaded file keeps that watermark/)
  })
})

// ---------------------------------------------------------------------------
// 2. Watermark: email address, not name, and never an IP
// ---------------------------------------------------------------------------

describe('watermark disclosure', () => {
  const subscriber = subscriberWatermarkText('Reader@Example.Org')

  it('the subscriber watermark carries the email address', () => {
    assert.match(subscriber, /reader@example\.org/)
  })

  it('the subscriber watermark carries no name', () => {
    // Phase 4 removed the name deliberately; the notices must not re-promise it.
    assert.doesNotMatch(subscriber, /Reader Name/)
    assert.match(subscriber, /APRI Subscriber Edition/)
  })

  it('no watermark carries an IP address', () => {
    for (const t of [subscriber, PROSPECT_WATERMARK_TEXT]) {
      assert.doesNotMatch(t, /\{\{ip/i)
      assert.doesNotMatch(t, /ipAddress/i)
    }
  })

  it('the privacy notice says the watermark shows an email address', () => {
    assert.match(privacy, /carries the email address of the person it was issued to/)
    assert.match(privacy, /watermark shows an email address rather than a name/)
  })

  it('the terms say the watermark shows an email address', () => {
    assert.match(terms, /carries the email address it was issued to/)
  })

  it('neither page claims the watermark carries a name', () => {
    assert.doesNotMatch(privacy, /carries the name of the person/)
    assert.doesNotMatch(terms, /carries the name of the person/)
  })

  it('the privacy notice states the watermark shows no IP address', () => {
    assert.match(privacy, /never an IP address/)
  })
})

// ---------------------------------------------------------------------------
// 3. Complimentary Review, not "open publications"
// ---------------------------------------------------------------------------

describe('Complimentary Review disclosure', () => {
  it('review links are restricted to an approved allow list in code', () => {
    const s = reviewLinkSettings({ documentId: 'd', slotKey: 'MIN', allowList: ['a@x.com'] })
    assert.deepEqual(s.allow_list, ['a@x.com'])
    assert.equal(s.email_protected, true)
    assert.equal(s.email_authenticated, true)
  })

  it('neither page describes freely shareable open publications', () => {
    assert.doesNotMatch(privacy, /open publication/i)
    assert.doesNotMatch(terms, /open publication/i)
    assert.doesNotMatch(terms, /read and shared freely/)
  })

  it('neither page uses retired Open Edition terminology', () => {
    assert.doesNotMatch(privacy, /Open Edition/)
    assert.doesNotMatch(terms, /Open Edition/)
  })

  it('the privacy notice describes the approval restriction', () => {
    assert.match(privacy, /Complimentary Review/)
    assert.match(privacy, /approved in advance/)
    assert.match(privacy, /verifies the address before the document opens/)
  })

  it('the terms describe a review copy as confidential, not public', () => {
    assert.match(terms, /Complimentary Review copies/)
    assert.match(terms, /approved in advance/)
    assert.match(terms, /not for redistribution/)
    assert.match(terms, /not open or public material/)
  })

  it('the terms say a review copy does not make someone a subscriber', () => {
    assert.match(terms, /does not make you a subscriber/)
  })
})

// ---------------------------------------------------------------------------
// 4. The click cookie must be disclosed
// ---------------------------------------------------------------------------

describe('cookie disclosure', () => {
  const route = read('src/app/api/engagement/click/route.ts')

  it('the code sets a first-party visitor cookie', () => {
    assert.match(route, /const VISITOR_COOKIE = 'apri_vid'/)
    assert.match(route, /httpOnly: true/)
    assert.match(route, /sameSite: 'lax'/)
  })

  it('the privacy notice names that cookie', () => {
    assert.match(privacy, /apri_vid/)
  })

  it('it describes the cookie accurately', () => {
    assert.match(privacy, /random value/)
    assert.match(privacy, /not linked to your name or email address/)
    assert.match(privacy, /cannot be read by JavaScript/)
    assert.match(privacy, /lasts one year/)
  })

  it('the stated lifetime matches the code', () => {
    // One year, as VISITOR_MAX_AGE.
    assert.match(route, /VISITOR_MAX_AGE = 60 \* 60 \* 24 \* 365/)
    assert.match(privacy, /one year/)
  })

  it('there is a cookies section at all', () => {
    assert.match(privacySrc, /title="Cookies"/)
  })
})

// ---------------------------------------------------------------------------
// 5. Click tracking is not reading
// ---------------------------------------------------------------------------

describe('click tracking disclosure', () => {
  it('clicks are recorded in their own table', () => {
    const mig = read('db/migrations/20260903_publication_engagement_accuracy.sql')
    assert.match(mig, /create table if not exists publication_access_events/)
  })

  it('the privacy notice discloses click recording', () => {
    assert.match(privacy, /When you click a publication card/)
  })

  it('it states no email or link leaves the browser', () => {
    assert.match(privacy, /No email address, document link or account identifier is sent from your browser/)
  })

  it('it distinguishes a click from a reading', () => {
    assert.match(privacy, /A click is not a reading/)
    assert.match(privacy, /keep the two figures apart/)
  })
})

// ---------------------------------------------------------------------------
// 6. Vercel Analytics
// ---------------------------------------------------------------------------

describe('Vercel Analytics disclosure', () => {
  it('analytics is in fact mounted', () => {
    assert.match(read('src/app/layout.tsx'), /SiteAnalytics/)
  })

  it('the privacy notice names Vercel as a supplier', () => {
    assert.match(privacy, /Vercel/)
    assert.match(privacy, /four suppliers/)
  })

  it('it says the figures are anonymous estimates', () => {
    assert.match(privacy, /anonymous estimates/)
  })

  it('it lists what is excluded, matching the code', () => {
    const priv = read('src/lib/analytics-privacy.ts')
    for (const p of ['/admin', '/api', '/portal']) {
      assert.ok(priv.includes(`'${p}'`), `${p} must be excluded in code`)
    }
    assert.match(privacy, /excluded entirely from the admin area, the subscriber portal, sign-in pages and anything carrying a token/)
  })

  it('it states no identifier is sent to Vercel', () => {
    assert.match(privacy, /no email address, no subscriber identifier, no document identifier and no document link/)
  })

  it('it refuses to combine anonymous traffic with identified reading', () => {
    assert.match(privacy, /do not combine these numbers/)
  })
})

// ---------------------------------------------------------------------------
// 7. IP addresses: honest about the one place they are stored
// ---------------------------------------------------------------------------

describe('IP address disclosure', () => {
  it('the analytics tables hold no IP column', () => {
    const mig = read('db/migrations/20260903_publication_engagement_accuracy.sql')
    assert.doesNotMatch(mig, /ip_address/)
    assert.match(mig, /never\s*\n?\s*-- an IP address/)
  })

  it('the sign-in security log does store one', () => {
    // login_attempts.ip exists for rate limiting, so the notice must say so
    // rather than claiming a blanket "we never store IP addresses".
    assert.match(read('db/schema.sql'), /create table if not exists login_attempts[\s\S]*?ip\s+text/)
  })

  it('the privacy notice has an IP section', () => {
    assert.match(privacySrc, /title="IP addresses"/)
  })

  it('it says reading and click records hold none', () => {
    assert.match(privacy, /do not store IP addresses in any of the reading or click records/)
  })

  it('it discloses the sign-in exception rather than overclaiming', () => {
    assert.match(privacy, /There is one exception/)
    assert.match(privacy, /repeated failed attempts/)
  })

  it('it discloses that the document host keeps its own logs', () => {
    assert.match(privacy, /document host keeps its own access logs/)
  })
})

// ---------------------------------------------------------------------------
// 8. Email engagement
// ---------------------------------------------------------------------------

describe('email engagement disclosure', () => {
  it('opens and clicks are in fact recorded', () => {
    const src = read('src/lib/client-engagement.ts')
    assert.match(src, /"email_opened"/)
    assert.match(src, /"email_clicked"/)
    assert.match(src, /"email_delivered"/)
  })

  it('the privacy notice discloses it', () => {
    assert.match(privacy, /When we email you/)
    assert.match(privacy, /whether it was opened, and whether a link in it was clicked/)
  })

  it('it says why, rather than only what', () => {
    assert.match(privacy, /tell a message that failed from one that was ignored/)
  })
})

// ---------------------------------------------------------------------------
// 9. Housekeeping both pages need
// ---------------------------------------------------------------------------

describe('both notices', () => {
  it('carry a last-updated date', () => {
    for (const [name, src] of [['privacy', privacySrc], ['terms', termsSrc]]) {
      assert.match(src, /LAST_UPDATED = '/, name)
      assert.match(src, /Last updated \{LAST_UPDATED\}/, name)
    }
  })

  it('name the Nigeria Data Protection Act', () => {
    assert.match(privacy, /Nigeria Data Protection Act 2023/)
  })

  it('are governed by Nigerian law', () => {
    assert.match(terms, /laws of the Federal Republic of Nigeria/)
  })

  it('link to each other', () => {
    assert.match(privacySrc, /href="\/terms"/)
    assert.match(termsSrc, /href="\/privacy"/)
  })

  it('give a contact address from config, not a hard-coded one', () => {
    for (const [name, src] of [['privacy', privacySrc], ['terms', termsSrc]]) {
      assert.match(src, /CONTACT_EMAIL/, name)
      assert.doesNotMatch(src, /aibt\.edu\.ng/, name)
    }
  })

  it('promise to tell subscribers about material changes', () => {
    assert.match(privacy, /tell them by email/)
    assert.match(terms, /tell them by email/)
  })

  it('carry a note tying the page to the code', () => {
    // The comment is the mechanism that keeps the next change honest.
    // Read the raw source: this note lives in the stripped comment.
    assert.match(privacySrc, /Keep this page in step with the code/)
    assert.match(termsSrc, /Keep this page in step with the code/)
  })

  it('contain no placeholder text', () => {
    for (const [name, src] of [['privacy', privacySrc], ['terms', termsSrc]]) {
      assert.doesNotMatch(src, /lorem ipsum/i, name)
      assert.doesNotMatch(src, /TODO|TBD|FIXME|XXX/, name)
      assert.doesNotMatch(src, /\[insert/i, name)
    }
  })
})

test('the privacy notice states times are shown in Africa/Lagos', () => {
  assert.match(privacy, /Africa\/Lagos/)
  assert.match(privacy, /store every time in UTC/)
})

test('neither notice leaks a credential or an internal identifier', () => {
  for (const src of [privacySrc, termsSrc]) {
    assert.doesNotMatch(src, /PAPERMARK_API_TOKEN|PAPERMARK_WEBHOOK_SECRET|CRON_SECRET|DATABASE_URL/)
    assert.doesNotMatch(src, /secure_link_id|papermark_link_id/)
  }
})
