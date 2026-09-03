/**
 * Phase 6 — attribution, webhook, polling, click tracking and safeguards.
 *
 * Source-level tests, because the pipeline needs a database to run. Where a
 * rule can be checked as behaviour it is; where it can only be checked as
 * structure, the assertion names the specific fault it guards against so a
 * later edit that reintroduces it fails here.
 */

import { describe, it, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { isExcludedAnalyticsPath, sanitizeBeacon } from '../src/lib/analytics-privacy.ts'

const ROOT = resolve(import.meta.dirname, '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

const ATTRIB = 'src/lib/view-attribution.ts'
const COLLECTOR = 'src/lib/papermark-collector.ts'
const WEBHOOK = 'src/app/api/papermark/webhook/route.ts'
const CRON = 'src/app/api/cron/papermark-views/route.ts'
const CLICK = 'src/app/api/engagement/click/route.ts'
const TRACKED = 'src/components/TrackedAccessLink.tsx'
const ANALYTICS_LAYER = 'src/lib/engagement-analytics.ts'
const MIGRATION = 'db/migrations/20260903_publication_engagement_accuracy.sql'
const LAYOUT = 'src/app/layout.tsx'

/**
 * Source with comments removed.
 *
 * Needed because these files document the faults they fixed, so a naive
 * "must not contain" assertion matches the comment explaining the removal
 * rather than any live code.
 */
const codeOnly = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|\s)\/\/.*$/, '$1').replace(/^\s*--.*$/, ''))
    .join('\n')

const fnBody = (src, name) => {
  const start = src.indexOf(`function ${name}`)
  assert.notEqual(start, -1, `${name} must exist`)
  const rest = src.slice(start + 1)
  const next = rest.indexOf('\nexport ')
  return next === -1 ? rest : rest.slice(0, next)
}

// ---------------------------------------------------------------------------
// 1. The canonical resolver, and its order
// ---------------------------------------------------------------------------

describe('canonical attribution resolver', () => {
  const src = read(ATTRIB)

  it('webhook and poll both use it — there is only one resolver', () => {
    assert.match(read(WEBHOOK), /from '@\/lib\/view-attribution'/)
    assert.match(read(COLLECTOR), /from '\.\/view-attribution'/)
    // Neither collector carries its own resolution logic.
    assert.doesNotMatch(read(COLLECTOR), /select subscriber_id[\s\S]{0,80}from publication_access/)
  })

  it('resolves in the specified order', () => {
    const fn = fnBody(src, 'attribute')
    const order = [
      'papermark_subscriber_document_links',
      'papermark_dataroom_links',
      'complimentary_review_items',
      'publication_access',
    ]
    let last = -1
    for (const table of order) {
      const at = fn.indexOf(table)
      assert.notEqual(at, -1, `${table} must be consulted`)
      assert.ok(at > last, `${table} must come after the previous source`)
      last = at
    }
    // The email fallback comes after every link source.
    assert.ok(fn.indexOf('lower(s.email)') > last, 'email must be the last resort')
  })

  it('a Complimentary Review link maps through secure_link_id to its slot', () => {
    const fn = fnBody(src, 'attribute')
    assert.match(fn, /ri\.secure_link_id = \$\{linkId\}/)
    assert.match(fn, /slot_key/)
  })

  it('a review reader is classified complimentary_review, never subscriber', () => {
    const fn = fnBody(src, 'attribute')
    const block = fn.slice(fn.indexOf('secure_link_id'), fn.indexOf('Legacy per-publication'))
    assert.match(block, /readerType: 'complimentary_review'/)
    assert.match(block, /subscriberId: null/)
  })

  it('a review reader keeps their verified email as their only identity', () => {
    const fn = fnBody(src, 'attribute')
    const block = fn.slice(fn.indexOf('secure_link_id'), fn.indexOf('Legacy per-publication'))
    assert.match(block, /viewerEmail: email/)
  })

  it('no subscriber is created or implied for a review reader', () => {
    assert.doesNotMatch(src, /insert into subscribers/i)
    assert.doesNotMatch(src, /update subscribers set (?!last_viewed_at)/i)
  })

  it('a Data Room link can resolve a briefing client', () => {
    const fn = fnBody(src, 'attribute')
    assert.match(fn, /briefing_request_id/)
    assert.match(fn, /readerType: row\.subscriber_id \? 'subscriber' : 'briefing'/)
  })

  it('publication lookup checks all three mapping tables', () => {
    const fn = fnBody(src, 'publicationFromDocument')
    assert.match(fn, /from documents where papermark_document_id/)
    assert.match(fn, /papermark_dataroom_documents/)
    assert.match(fn, /complimentary_review_items/)
  })

  it('an unmatched event is retained, not discarded', () => {
    // The UNMATCHED shape is declared above the function it is returned from.
    assert.match(src, /matchedBy: 'none'/)
    assert.match(fnBody(src, 'attribute'), /\.\.\.UNMATCHED/)
    // recordView still writes the row.
    assert.match(fnBody(src, 'recordView'), /insert into document_views/)
  })

  it('never guesses: the email rule is narrowed to shared or open documents', () => {
    const fn = fnBody(src, 'attribute')
    assert.match(fn, /is_shared_copy = true or d\.visibility = 'OPEN'/)
  })

  it('a resolved attribution is never overwritten by a weaker one', () => {
    const fn = fnBody(src, 'recordView')
    assert.match(fn, /subscriber_id\s*=\s*coalesce\(document_views\.subscriber_id/)
    assert.match(fn, /publication_id\s*=\s*coalesce\(document_views\.publication_id/)
  })

  it('greatest() over a null duration does not become zero', () => {
    // The old formula was greatest(coalesce(x,0), coalesce(y,0)), which turned
    // "no reading" into "zero seconds".
    const fn = fnBody(src, 'recordView')
    assert.doesNotMatch(fn, /greatest\(coalesce\(document_views\.duration_seconds, 0\)/)
    assert.match(fn, /when document_views\.duration_seconds is null then excluded\.duration_seconds/)
  })

  it('source only moves poll -> webhook, never back', () => {
    const fn = fnBody(src, 'recordView')
    assert.match(fn, /when excluded\.source = 'webhook' then 'webhook'/)
  })
})

// ---------------------------------------------------------------------------
// 2. No Open Edition terminology in the new analytics
// ---------------------------------------------------------------------------

describe('no Open Edition terminology', () => {
  it('the resolver no longer writes open_edition_leads', () => {
    const src = read(ATTRIB)
    assert.doesNotMatch(src, /insert into open_edition_leads/)
    assert.doesNotMatch(src, /recordOpenEditionLead/)
  })

  it('the resolver explains that the table is history only', () => {
    assert.match(read(ATTRIB), /retained as history/i)
  })

  for (const [label, file] of [
    ['metrics', 'src/lib/engagement-metrics.ts'],
    ['analytics layer', ANALYTICS_LAYER],
    ['collector', COLLECTOR],
    ['click route', CLICK],
    ['dashboard', 'src/app/admin/engagement/page.tsx'],
  ]) {
    it(`${label} contains no Open Edition label`, () => {
      assert.doesNotMatch(read(file), /Open Edition/i)
      assert.doesNotMatch(read(file), /open_edition_leads/)
    })
  }
})

// ---------------------------------------------------------------------------
// 3. Webhook reliability
// ---------------------------------------------------------------------------

describe('webhook', () => {
  const src = read(WEBHOOK)

  it('rejects a bad signature with 401', () => {
    assert.match(src, /if \(!verifySignature\(raw, signature, secret\)\)/)
    assert.match(src, /Invalid signature.*401/s)
  })

  it('verifies with a constant-time comparison', () => {
    const fn = fnBody(src, 'verifySignature')
    assert.match(fn, /timingSafeEqual/)
    assert.match(fn, /createHmac\('sha256', secret\)/)
    // A length mismatch must be refused before the comparison.
    assert.match(fn, /if \(a\.length !== b\.length\) return false/)
  })

  it('refuses every delivery when no secret is configured', () => {
    assert.match(src, /if \(!secret\)[\s\S]{0,120}503/)
  })

  it('dispatches link.downloaded BEFORE the generic view matcher', () => {
    const fn = fnBody(src, 'dispatch')
    const dl = fn.indexOf('/download/i')
    const view = fn.indexOf('/view/i')
    assert.notEqual(dl, -1)
    assert.notEqual(view, -1)
    assert.ok(dl < view, 'the download test must precede the loose view matcher')
  })

  it('marks an event processed only AFTER its work succeeded', () => {
    // The specific fault: the old route caught every error and then called
    // markProcessed regardless, permanently recording a failure as done.
    assert.match(src, /const result = await dispatch\(payload, eventType\)\s*\n\s*\n?\s*if \(eventId\) await markProcessed/)
  })

  it('records a failure and returns a retriable 500', () => {
    assert.match(src, /await markFailed\(eventId, eventType, reason\)/)
    assert.match(src, /status: 500/)
  })

  it('does not swallow processing failures', () => {
    // The handlers must not wrap their database work in an empty catch.
    const viewFn = fnBody(src, 'handleViewEvents')
    assert.doesNotMatch(viewFn, /catch \{\s*\}\s*\n\s*\n?\s*if \(eventId\)/)
    assert.match(src, /Not wrapped in a swallowing catch/)
  })

  it('does not respond before doing the work', () => {
    // `after()` let the old route answer 200 and fail invisibly afterwards.
    // Checked against code only: the header comment still mentions it to
    // explain why it is gone.
    assert.doesNotMatch(codeOnly(src), /\bafter\(/)
    assert.doesNotMatch(src, /import \{[^}]*\bafter\b[^}]*\} from 'next\/server'/)
    assert.match(src, /const result = await dispatch/)
  })

  it('treats only outcome=processed as already done', () => {
    const fn = fnBody(src, 'alreadyProcessed')
    assert.match(fn, /outcome = 'processed'/)
  })

  it('a previous failure does not suppress the retry', () => {
    // Only outcome='processed' short-circuits, so a 'failed' row still retries.
    assert.match(src, /not suppress the retry/)
    assert.match(fnBody(src, 'alreadyProcessed'), /and outcome = 'processed'/)
  })

  it('creates one download row per unique webhook event', () => {
    const fn = fnBody(src, 'handleDownloadEvent')
    assert.match(fn, /recordDownload/)
    assert.match(fn, /sourceEventId/)
  })

  it('accepts the event id as the dedup key when no view id is supplied', () => {
    const fn = fnBody(src, 'handleDownloadEvent')
    assert.match(fn, /viewId \? `view:\$\{viewId\}` : eventId \? `event:\$\{eventId\}` : null/)
  })

  it('updates the view downloaded flag when a view id is supplied', () => {
    assert.match(fnBody(read(ATTRIB), 'recordDownload'), /update document_views set downloaded = true/)
  })

  it('validates required identifiers', () => {
    const fn = fnBody(src, 'handleDownloadEvent')
    assert.match(fn, /missingIdentifiers: true/)
  })

  it('sanitizes failure diagnostics — no token, no raw header', () => {
    const fn = fnBody(src, 'sanitizeError')
    assert.match(fn, /Bearer/)
    assert.match(fn, /redacted/)
    assert.match(fn, /slice\(0, 300\)/)
  })

  it('never stores raw request headers', () => {
    assert.doesNotMatch(src, /insert into[\s\S]{0,200}headers/i)
    assert.doesNotMatch(src, /JSON\.stringify\(.*headers/i)
  })

  it('never logs or returns the signing secret', () => {
    assert.doesNotMatch(src, /console\.\w+\([^)]*secret/i)
    assert.doesNotMatch(src, /json\([^)]*secret/i)
  })
})

// ---------------------------------------------------------------------------
// 4. Polling safety net
// ---------------------------------------------------------------------------

describe('polling', () => {
  const src = read(COLLECTOR)

  it('knownLinkIds includes all five sources', () => {
    const fn = fnBody(src, 'knownLinkIds')
    for (const table of [
      'papermark_subscriber_document_links',
      'papermark_dataroom_links',
      'complimentary_review_items',
      'publication_access',
      'subscribers',
    ]) {
      assert.match(fn, new RegExp(table), `${table} must contribute link ids`)
    }
  })

  it('reads the review slot link id specifically', () => {
    assert.match(fnBody(src, 'knownLinkIds'), /secure_link_id as id/)
  })

  it('polls ZERO links when nothing is on file', () => {
    // The old code was `known.size === 0 || known.has(id)`, which polled every
    // link in the Papermark account — including documents belonging to other
    // work — and attributed them to nobody.
    const fn = fnBody(src, 'collectPapermarkAnalytics')
    assert.match(fn, /if \(known\.size === 0\)/)
    assert.match(fn, /skipped: 'no-known-links'/)
    assert.doesNotMatch(codeOnly(src), /known\.size === 0 \|\| known\.has/)
  })

  it('filters candidates strictly by the known set', () => {
    assert.match(src, /allIds\.filter\(\(id\) => known\.has\(id\)\)/)
  })

  it('counts link ids Papermark returned that APRI does not know', () => {
    assert.match(src, /unknownLinkIds = allIds\.length - candidates\.length/)
  })

  it('upserts views by papermark_view_id', () => {
    assert.match(src, /recordView\(/)
    assert.match(fnBody(read(ATTRIB), 'recordView'), /on conflict \(papermark_view_id\)/)
  })

  it('backfills a missed download from downloaded_at', () => {
    const fn = fnBody(src, 'collectPapermarkAnalytics')
    assert.match(fn, /if \(view\.downloaded_at\)/)
    assert.match(fn, /recordDownload/)
  })

  it('keys a backfilled download the same way the webhook does, so it cannot duplicate', () => {
    assert.match(src, /sourceEventId: `view:\$\{view\.id\}`/)
    assert.match(read(WEBHOOK), /`view:\$\{viewId\}`/)
  })

  it('enriches in bounded batches', () => {
    assert.match(src, /const ENRICH_LIMIT = \d+/)
    assert.match(fnBody(src, 'enrichPendingViews'), /limit \$\{limit\}/)
  })

  it('resumes unfinished enrichment on a later run', () => {
    const fn = fnBody(src, 'enrichPendingViews')
    assert.match(fn, /where last_enriched_at is null/)
    assert.match(fn, /last_enriched_at = now\(\)/)
  })

  it('reports enrichment coverage', () => {
    assert.match(src, /enrichmentCoveragePct/)
    assert.match(src, /getEnrichmentCoverage/)
  })

  it('computes completion only from sufficient page data', () => {
    const fn = fnBody(src, 'enrichPendingViews')
    assert.match(fn, /completionFromPages/)
    // Missing information must remain null, never zero.
    assert.match(fn, /coalesce\(\$\{completion\}, completion_pct\)/)
    assert.doesNotMatch(fn, /completion_pct = 0/)
  })

  it('preserves the 60-second budget with headroom', () => {
    assert.match(src, /MAX_DURATION_SECONDS = 60/)
    assert.match(src, /TIME_BUDGET_MS = \(MAX_DURATION_SECONDS - 12\) \* 1000/)
    assert.match(src, /if \(Date\.now\(\) - startedAt > TIME_BUDGET_MS\) break/)
  })

  it('echoes no Papermark error detail that could carry the token', () => {
    const fn = fnBody(src, 'collectPapermarkAnalytics')
    assert.match(fn, /Could not list links from Papermark\./)
    assert.match(src, /carries the bearer token/)
  })

  it('is server-only', () => {
    assert.match(src, /^import 'server-only'/m)
  })
})

describe('cron and manual sync share the collector', () => {
  it('the cron route calls collectPapermarkAnalytics', () => {
    assert.match(read(CRON), /collectPapermarkAnalytics\(\)/)
  })

  it('the owner action calls the same function', () => {
    assert.match(read('src/app/actions/engagement-analytics.ts'), /collectPapermarkAnalytics\(\)/)
  })

  it('the cron route no longer carries its own knownLinkIds', () => {
    // Two copies is how the missing tables went unnoticed.
    assert.doesNotMatch(read(CRON), /function knownLinkIds/)
  })

  it('the cron route no longer lists links itself', () => {
    assert.doesNotMatch(read(CRON), /listLinks\(\)/)
  })

  it('the manual sync reports the required figures', () => {
    const src = read('src/app/actions/engagement-analytics.ts')
    const fn = fnBody(src, 'syncPapermarkAnalyticsNow')
    for (const field of ['linksChecked', 'viewsFound', 'newViews', 'downloadsRecorded', 'unmatched', 'failures']) {
      assert.match(fn, new RegExp(field), `${field} must be reported`)
    }
  })

  it('the manual sync is owner-only', () => {
    assert.match(fnBody(read('src/app/actions/engagement-analytics.ts'), 'syncPapermarkAnalyticsNow'), /requireOwner\(\)/)
  })
})

// ---------------------------------------------------------------------------
// 5. Click tracking
// ---------------------------------------------------------------------------

describe('click tracking endpoint', () => {
  const src = read(CLICK)

  it('enforces same-origin', () => {
    assert.match(src, /if \(!isSameOrigin\(request\)\)/)
    assert.match(src, /status: 403/)
    const fn = fnBody(src, 'isSameOrigin')
    assert.match(fn, /sec-fetch-site/)
    assert.match(fn, /new URL\(origin\)\.host === host/)
  })

  it('validates the body with Zod', () => {
    assert.match(src, /from 'zod'/)
    assert.match(src, /Body\.safeParse/)
    assert.match(src, /z\.enum\(ACCESS_EVENT_TYPES\)/)
  })

  it('requires an idempotency event id', () => {
    assert.match(src, /eventId: z\.string\(\)\.min\(8\)/)
  })

  it('is idempotent on event id', () => {
    assert.match(src, /on conflict \(event_id\) do nothing/)
  })

  it('accepts only recognised publications and slot keys', () => {
    assert.match(src, /slotKey: z\.enum\(\['MIN', 'AIU', 'PLM'\]\)/)
    assert.match(src, /Unknown publication/)
    assert.match(fnBody(src, 'resolveTarget'), /where slot_key = \$\{slotKey\} and is_active = true/)
  })

  it('resolves Papermark ids server-side, not from the browser', () => {
    const fn = fnBody(src, 'resolveTarget')
    assert.match(fn, /secure_link_id/)
    assert.match(fn, /papermark_document_id/)
  })

  it('never accepts an email, a URL or a token from the browser', () => {
    // The schema is the allowlist: these fields do not exist in it.
    const schema = src.slice(src.indexOf('const Body = z.object'), src.indexOf('export async function POST'))
    assert.doesNotMatch(schema, /email/i)
    assert.doesNotMatch(schema, /secureUrl|secure_link_url/)
    assert.doesNotMatch(schema, /token/i)
    assert.doesNotMatch(schema, /ip\b|ipAddress/i)
  })

  it('never stores the secure Papermark URL in the event', () => {
    // Code only: a comment names the column to record that it is not selected.
    assert.doesNotMatch(codeOnly(src), /secure_link_url/)
    assert.match(src, /not the credential that opens/)
  })

  it('stores no IP address', () => {
    assert.doesNotMatch(src, /x-forwarded-for/i)
    assert.doesNotMatch(src, /request\.ip/)
    assert.doesNotMatch(src, /ip_address/)
  })

  it('the visitor cookie is random, httpOnly, secure and SameSite=Lax', () => {
    assert.match(src, /randomUUID\(\)/)
    const fn = fnBody(src, 'setVisitorCookie')
    assert.match(fn, /httpOnly: true/)
    assert.match(fn, /sameSite: 'lax'/)
    assert.match(fn, /secure: process\.env\.NODE_ENV === 'production'/)
  })

  it('the visitor id is not derived from anything about the person', () => {
    assert.match(src, /not their IP, not a fingerprint/)
  })

  it('does not fabricate a historical tracking start', () => {
    const fn = fnBody(src, 'stampFirstReliableTimestamp')
    assert.match(fn, /then excluded\.value/)
    assert.match(fn, /else app_settings\.value/)
  })

  it('refuses a client clock claiming the future', () => {
    const fn = fnBody(src, 'safeTimestamp')
    assert.match(fn, /t > now \+ 5 \* 60_000/)
  })

  it('strips the query string from the origin path', () => {
    const fn = fnBody(src, 'sanitizePath')
    assert.match(fn, /split\('\?'\)/)
  })
})

describe('tracked link component', () => {
  const src = read(TRACKED)

  it('does not prevent or delay navigation', () => {
    const code = codeOnly(src)
    assert.doesNotMatch(code, /preventDefault/)
    assert.doesNotMatch(code, /await recordAccessClick/)
    assert.doesNotMatch(code, /async function onClick|onClick = async/)
    // The handler is synchronous and returns nothing.
    assert.match(code, /const onClick = \(\) => \{/)
  })

  it('uses keepalive so the beacon survives the navigation', () => {
    assert.match(src, /keepalive: true/)
  })

  it('swallows every failure so a reader is never blocked', () => {
    assert.match(src, /\.catch\(\(\) => \{\}\)/)
    assert.match(src, /try \{/)
  })

  it('generates the event id client-side', () => {
    assert.match(src, /crypto\.randomUUID/)
    assert.match(fnBody(src, 'newEventId'), /Math\.random/)
  })

  it('sends no email, URL or token', () => {
    const body = src.slice(src.indexOf('const body = JSON.stringify'), src.indexOf('// Deliberately not awaited'))
    assert.doesNotMatch(body, /email/i)
    assert.doesNotMatch(body, /token/i)
    assert.doesNotMatch(body, /secureUrl/)
  })

  it('posts same-origin credentials only', () => {
    assert.match(src, /credentials: 'same-origin'/)
  })
})

describe('instrumented surfaces', () => {
  it('Complimentary Review Access review copy is tracked', () => {
    const src = read('src/app/publications/page.tsx')
    assert.match(src, /eventType="review_access_clicked"/)
    assert.match(src, /Access review copy/)
  })

  it('the review link still points at the same secure URL', () => {
    // The public URL must not change.
    assert.match(read('src/app/publications/page.tsx'), /href=\{card\.secureUrl\}/)
  })

  it('subscriber View details is tracked', () => {
    assert.match(read('src/app/publications/page.tsx'), /eventType="publication_details_clicked"/)
  })

  it('portal View and Download are tracked', () => {
    const src = read('src/app/portal/page.tsx')
    assert.match(src, /eventType="subscriber_document_view_clicked"/)
    assert.match(src, /eventType="subscriber_document_download_clicked"/)
  })

  it('portal hrefs are unchanged', () => {
    const src = read('src/app/portal/page.tsx')
    assert.match(src, /\/portal\/document\/\$\{encodeURIComponent\(document\.id\)\}\/download/)
    assert.match(src, /\/portal\/document\/\$\{encodeURIComponent\(document\.id\)\}`/)
  })
})

// ---------------------------------------------------------------------------
// 6. Vercel Analytics
// ---------------------------------------------------------------------------

describe('Vercel Web Analytics', () => {
  it('is installed', () => {
    const pkg = JSON.parse(read('package.json'))
    assert.ok(pkg.dependencies['@vercel/analytics'], '@vercel/analytics must be a dependency')
  })

  it('is mounted in the root layout', () => {
    assert.match(read(LAYOUT), /<SiteAnalytics \/>/)
  })

  it('uses beforeSend', () => {
    assert.match(read('src/components/SiteAnalytics.tsx'), /beforeSend=\{sanitizeBeacon\}/)
  })

  it('excludes /admin', () => {
    assert.equal(isExcludedAnalyticsPath('/admin'), true)
    assert.equal(isExcludedAnalyticsPath('/admin/engagement'), true)
  })

  it('excludes /api', () => {
    assert.equal(isExcludedAnalyticsPath('/api'), true)
    assert.equal(isExcludedAnalyticsPath('/api/engagement/click'), true)
  })

  it('excludes private portal routes', () => {
    assert.equal(isExcludedAnalyticsPath('/portal'), true)
    assert.equal(isExcludedAnalyticsPath('/portal/document/abc'), true)
  })

  it('excludes authentication and magic-token routes', () => {
    for (const p of ['/auth/callback', '/verify', '/signin', '/sign-in', '/login', '/magic/abc']) {
      assert.equal(isExcludedAnalyticsPath(p), true, `${p} must be excluded`)
    }
  })

  it('allows public marketing pages', () => {
    for (const p of ['/', '/publications', '/services', '/access']) {
      assert.equal(isExcludedAnalyticsPath(p), false, `${p} should be reported`)
    }
  })

  it('does not exclude a page merely containing an excluded word', () => {
    assert.equal(isExcludedAnalyticsPath('/administration-guide'), false)
  })

  it('drops an excluded path entirely', () => {
    assert.equal(sanitizeBeacon({ url: 'https://apri.example/portal/document/1' }), null)
    assert.equal(sanitizeBeacon({ url: 'https://apri.example/admin' }), null)
  })

  it('DROPS a url carrying a token or an email, rather than cleaning it', () => {
    // Strengthened in the final review: a credentialed visit is not reported at
    // all, because stripping the parameter would still tell Vercel the visit
    // happened.
    assert.equal(sanitizeBeacon({ url: 'https://apri.example/publications?token=abc123' }), null)
    assert.equal(sanitizeBeacon({ url: 'https://apri.example/publications?email=a@b.com' }), null)
  })

  it('strips an innocuous query string from what it does send', () => {
    const out = sanitizeBeacon({ url: 'https://apri.example/publications?page=2' })
    assert.equal(out.url, 'https://apri.example/publications')
  })

  it('strips the hash', () => {
    const out = sanitizeBeacon({ url: 'https://apri.example/publications#complimentary-review' })
    assert.equal(out.url, 'https://apri.example/publications')
  })

  it('drops an unparseable url rather than sending it unexamined', () => {
    assert.equal(sanitizeBeacon({ url: 'not a url' }), null)
  })

  it('sends no custom events', () => {
    const src = read('src/components/SiteAnalytics.tsx')
    assert.doesNotMatch(src, /\btrack\(/)
    assert.doesNotMatch(src, /from '@vercel\/analytics'\s*$/m)
  })

  it('requires no VERCEL_TOKEN', () => {
    assert.doesNotMatch(read('src/components/SiteAnalytics.tsx'), /VERCEL_TOKEN/)
    assert.doesNotMatch(read(ANALYTICS_LAYER), /VERCEL_TOKEN/)
  })

  it('the dashboard explains the two must not be combined', () => {
    const src = read('src/app/admin/engagement/page.tsx')
    assert.match(src, /Vercel &rarr; Analytics/)
    assert.match(src, /anonymous, sampled estimates/)
    assert.match(src, /never be combined/)
  })
})

// ---------------------------------------------------------------------------
// 7. Dashboard date filtering and unavailability
// ---------------------------------------------------------------------------

describe('dashboard queries', () => {
  const src = read(ANALYTICS_LAYER)

  it('every overview subquery is bounded by the window', () => {
    const fn = fnBody(src, 'getOverviewMetrics')
    const lower = (fn.match(/>= \$\{fromIso\}::timestamptz/g) ?? []).length
    const upper = (fn.match(/< +\$\{toIso\}::timestamptz/g) ?? []).length
    assert.ok(lower >= 8, `expected many windowed subqueries, found ${lower}`)
    assert.equal(lower, upper, 'every lower bound must have an upper bound')
  })

  it('publication and reader queries scope their sources first', () => {
    for (const name of ['getPublicationRows', 'getReaderRows']) {
      const fn = fnBody(src, name)
      assert.match(fn, /scoped_views as \(/, `${name} must scope views`)
      assert.match(fn, /fromIso/, `${name} must use the window`)
      assert.match(fn, /toIso/, `${name} must use the window`)
    }
  })

  it('counts distinct ids, never rows', () => {
    const fn = fnBody(src, 'getOverviewMetrics')
    assert.match(fn, /count\(distinct dv\.papermark_view_id\)/)
    assert.match(fn, /count\(distinct de\.source_event_id\)/)
    assert.match(fn, /count\(distinct pae\.event_id\)/)
  })

  it('does not count portal_opened as a view', () => {
    assert.doesNotMatch(src, /portal_opened/)
  })

  it('averages exclude nulls rather than coalescing them to zero', () => {
    const fn = fnBody(src, 'getPublicationRows')
    assert.match(fn, /avg\(v\.duration_seconds\)[\s\S]{0,80}duration_seconds is not null/)
    assert.doesNotMatch(fn, /avg\(coalesce\(v\.duration_seconds, 0\)\)/)
  })

  it('preserves null averages through to the UI', () => {
    const fn = fnBody(src, 'numOrNull')
    assert.match(fn, /return null/)
    assert.match(src, /averageEngagedTime: numOrNull/)
  })

  it('eligible subscribers is null for a review slot, not zero', () => {
    const fn = fnBody(src, 'getPublicationRows')
    assert.match(fn, /when rs\.slot_key is not null then null/)
  })

  it('the epoch sentinel becomes null rather than 1970', () => {
    const fn = fnBody(src, 'epochToNull')
    assert.match(fn, /t <= 86_400_000/)
  })

  it('active subscribers is labelled as a state, not a windowed figure', () => {
    assert.match(fnBody(src, 'getOverviewMetrics'), /Not date-filtered on purpose/)
    assert.match(read('src/app/admin/engagement/page.tsx'), /Current state, not a figure for this period/)
  })

  it('never reveals the webhook secret, only whether it is set', () => {
    const fn = fnBody(src, 'getDiagnostics')
    assert.match(fn, /webhookConfigured: Boolean\(process\.env\.PAPERMARK_WEBHOOK_SECRET\)/)
    assert.doesNotMatch(fn, /value: process\.env\.PAPERMARK_WEBHOOK_SECRET/)
  })

  it('is server-only', () => {
    assert.match(src, /^import 'server-only'/m)
  })
})

describe('dashboard rendering', () => {
  const src = read('src/app/admin/engagement/page.tsx')

  it('has the four required sections', () => {
    for (const tab of ['Overview', 'Publications', 'Readers', 'Diagnostics']) {
      assert.match(src, new RegExp(`label: "${tab}"`), `${tab} tab must exist`)
    }
  })

  it('offers 7, 30, 90 day and custom periods', () => {
    assert.match(src, /WINDOW_PRESETS/)
    assert.match(src, /name="window" value="custom"/)
  })

  it('passes one window object to every query', () => {
    assert.match(src, /const window = resolveWindow\(/)
    assert.match(src, /getOverviewMetrics\(window\)/)
    assert.match(src, /getPublicationRows\(window\)/)
    assert.match(src, /getReaderRows\(window\)/)
  })

  it('renders missing metrics as Unavailable', () => {
    assert.match(src, /formatMetric\(r\.averageEngagedTime/)
    assert.match(src, /formatMetric\(r\.completionPct/)
    assert.match(src, /UNAVAILABLE_LABEL/)
  })

  it('renders Not applicable for a prospect publication eligibility', () => {
    assert.match(src, /r\.eligibleSubscribers === null \? \(/)
    assert.match(src, /NOT_APPLICABLE_LABEL/)
  })

  it('separates clicks from Papermark confirmations under distinct headings', () => {
    assert.match(src, /Confirmed by Papermark/)
    assert.match(src, /Recorded by APRI/)
    assert.match(src, /must not be added to them/)
  })

  it('shows Data since', () => {
    assert.match(src, /Data since:/)
    assert.match(src, /never backfilled/)
  })

  it('states that times are Africa\/Lagos', () => {
    assert.match(src, /All times shown in \{DISPLAY_TIME_ZONE\}/)
    assert.match(src, /stored in UTC/)
  })

  it('separates and filters reader types', () => {
    const client = read('src/app/admin/engagement/engagement-client.tsx')
    assert.match(client, /function ReaderTypeFilter/)
    assert.match(client, /complimentary_review/)
    assert.match(client, /Subscribers/)
  })

  it('invents no name for a reader with no subscriber record', () => {
    assert.match(src, /No subscriber record/)
  })
})

// ---------------------------------------------------------------------------
// 8. Historical repair safety
// ---------------------------------------------------------------------------

describe('historical repair', () => {
  const src = read('src/app/actions/engagement-analytics.ts')

  it('preview and apply are both owner-only', () => {
    assert.match(fnBody(src, 'previewAttributionRepair'), /requireOwner\(\)/)
    assert.match(fnBody(src, 'applyAttributionRepair'), /requireOwner\(\)/)
  })

  it('preview writes nothing', () => {
    const fn = fnBody(src, 'previewAttributionRepair')
    assert.doesNotMatch(fn, /update document_views/)
    assert.doesNotMatch(fn, /insert into/)
  })

  it('reuses the canonical resolver', () => {
    assert.match(src, /from "@\/lib\/view-attribution"/)
    assert.match(fnBody(src, 'previewAttributionRepair'), /await attribute\(/)
    assert.match(fnBody(src, 'applyAttributionRepair'), /await attribute\(/)
  })

  it('only considers rows with a genuinely missing field', () => {
    const fn = fnBody(src, 'previewAttributionRepair')
    assert.match(fn, /subscriber_id is null\s*\n?\s*or publication_id is null\s*\n?\s*or reader_type is null/)
  })

  it('only proposes a field that is empty AND resolvable', () => {
    const fn = fnBody(src, 'previewAttributionRepair')
    assert.match(fn, /if \(!row\.subscriber_id && attribution\.subscriberId\)/)
    assert.match(fn, /if \(!row\.publication_id && attribution\.publicationId\)/)
  })

  it('never overwrites an existing attribution — enforced in SQL', () => {
    const fn = fnBody(src, 'applyAttributionRepair')
    assert.match(fn, /subscriber_id\s*=\s*coalesce\(subscriber_id,/)
    assert.match(fn, /publication_id\s*=\s*coalesce\(publication_id,/)
    assert.match(fn, /reader_type\s*=\s*coalesce\(reader_type,/)
  })

  it('guards against a stale preview with a where clause', () => {
    const fn = fnBody(src, 'applyAttributionRepair')
    assert.match(fn, /and \(subscriber_id is null or publication_id is null or reader_type is null\)/)
  })

  it('never touches the source column, so collector provenance is preserved', () => {
    const fn = fnBody(src, 'applyAttributionRepair')
    assert.doesNotMatch(fn, /\bsource\s*=/)
  })

  it('does not fabricate clicks', () => {
    assert.doesNotMatch(src, /insert into publication_access_events/)
  })

  it('reports that existing attributions were left alone', () => {
    assert.match(fnBody(src, 'applyAttributionRepair'), /Existing attributions were not modified/)
  })
})

// ---------------------------------------------------------------------------
// 9. Migration
// ---------------------------------------------------------------------------

describe('migration', () => {
  it('exists', () => {
    assert.equal(existsSync(join(ROOT, MIGRATION)), true)
  })

  const mig = read(MIGRATION)

  it('creates publication_access_events with a unique event id', () => {
    assert.match(mig, /create table if not exists publication_access_events/)
    assert.match(mig, /publication_access_events_event_id_key/)
  })

  it('constrains the four allowed event types', () => {
    for (const t of ACCESS_TYPES) {
      assert.match(mig, new RegExp(`'${t}'`), `${t} must be allowed`)
    }
  })

  it('creates document_download_events with a unique source event id', () => {
    assert.match(mig, /create table if not exists document_download_events/)
    assert.match(mig, /document_download_events_source_event_key/)
  })

  it('records the collection source', () => {
    assert.match(mig, /collection_source/)
    assert.match(mig, /check \(collection_source in \('webhook', 'poll'\)\)/)
  })

  it('extends document_views with the five required columns', () => {
    for (const col of [
      'papermark_document_id',
      'briefing_request_id',
      'reader_type',
      'attribution_method',
      'last_enriched_at',
    ]) {
      assert.match(mig, new RegExp(`add column if not exists ${col}\\b`), `${col} must be added`)
    }
  })

  it('constrains reader_type to the four values', () => {
    assert.match(mig, /'subscriber', 'briefing', 'complimentary_review', 'unknown'/)
  })

  it('adds the required indexes', () => {
    for (const idx of [
      'publication_access_events_pub_date_idx',
      'document_download_events_pub_date_idx',
      'document_download_events_email_date_idx',
      'document_download_events_subscriber_date_idx',
      'publication_access_events_slot_date_idx',
      'document_views_pub_date_idx',
      'document_views_email_date_idx',
      'document_views_reader_type_date_idx',
      'document_views_enrichment_idx',
    ]) {
      assert.match(mig, new RegExp(idx), `${idx} must be created`)
    }
  })

  it('guards every table, column and index with IF NOT EXISTS', () => {
    const tables = (mig.match(/create table/g) ?? []).length
    const tablesGuarded = (mig.match(/create table if not exists/g) ?? []).length
    assert.equal(tables, tablesGuarded)

    const cols = (mig.match(/add column/g) ?? []).length
    const colsGuarded = (mig.match(/add column if not exists/g) ?? []).length
    assert.equal(cols, colsGuarded)

    const idx = (mig.match(/create (unique )?index/g) ?? []).length
    const idxGuarded = (mig.match(/create (unique )?index if not exists/g) ?? []).length
    assert.equal(idx, idxGuarded)
  })

  it('preserves existing data — no destructive statement', () => {
    assert.doesNotMatch(mig, /drop table/i)
    assert.doesNotMatch(mig, /drop column/i)
    assert.doesNotMatch(mig, /\btruncate\b/i)
    assert.doesNotMatch(mig, /delete from/i)
    assert.doesNotMatch(mig, /alter column/i)
  })

  it('drops no constraint at all', () => {
    // Strengthened in the final review: nothing is dropped, so there is no
    // window in which a populated table lacks its constraint.
    assert.doesNotMatch(mig, /drop constraint/i)
  })

  it('does not store a raw IP address anywhere', () => {
    assert.doesNotMatch(mig, /ip_address/)
    assert.doesNotMatch(mig, /\bremote_addr\b/)
    assert.match(mig, /raw IPs are not stored anywhere/)
  })

  it('does not store the secure Papermark URL on a click event', () => {
    const block = mig.slice(mig.indexOf('publication_access_events ('), mig.indexOf('create unique index'))
    assert.doesNotMatch(block, /secure_link_url/)
  })

  it('uses timestamptz throughout, so storage stays UTC', () => {
    assert.doesNotMatch(mig, /\btimestamp\s+(?!with)/)
    assert.match(mig, /timestamptz/)
    assert.match(mig, /stored in UTC/)
  })

  it('seeds diagnostics keys without overwriting them', () => {
    assert.match(mig, /on conflict \(key\) do nothing/)
  })
})

const ACCESS_TYPES = [
  'review_access_clicked',
  'publication_details_clicked',
  'subscriber_document_view_clicked',
  'subscriber_document_download_clicked',
]

// ---------------------------------------------------------------------------
// 10. The old inaccurate metrics are gone
// ---------------------------------------------------------------------------

describe('the previous inaccuracies are fixed', () => {
  const src = read('src/lib/client-engagement.ts')

  it('portal_opened is no longer counted as a view click', () => {
    assert.doesNotMatch(src, /event_type in \('portal_opened','private_link_opened'\)/)
    assert.doesNotMatch(src, /as view_clicks/)
  })

  it('document_views rows are no longer counted as views', () => {
    assert.doesNotMatch(src, /count\(\*\)::int from document_views\) as papermark_views/)
  })

  it('the mixed lifetime/30-day summary shape is gone', () => {
    assert.doesNotMatch(src, /export type EngagementSummary/)
    assert.doesNotMatch(src, /export async function getEngagementSummary/)
    assert.doesNotMatch(src, /export async function getClientEngagementDashboard/)
  })

  it('the replacement requires an explicit window', () => {
    assert.match(src, /windowDays: number/)
    assert.match(fnBody(src, 'getSubscriberActivity'), /interval/)
  })

  it('the replacement counts distinct ids', () => {
    const fn = fnBody(src, 'getSubscriberActivity')
    assert.match(fn, /count\(distinct dv\.papermark_view_id\)/)
    assert.match(fn, /count\(distinct dv\.publication_id\)/)
    assert.match(fn, /count\(distinct de\.source_event_id\)/)
  })

  it('the four faults are documented so they are not reintroduced', () => {
    assert.match(src, /wrong in four specific ways/)
  })

  it('recordClientEvent is untouched, so email and portal flows still work', () => {
    assert.match(src, /export async function recordClientEvent/)
    assert.match(src, /export async function principalForResendEmail/)
  })
})

// ---------------------------------------------------------------------------
// 11. Safeguards — nothing protected was changed
// ---------------------------------------------------------------------------

describe('safeguards', () => {
  it('the three Complimentary Review links are untouched', () => {
    const src = read('src/app/actions/review-library.ts')
    assert.match(src, /export async function createSlotSecureLink/)
    assert.match(src, /export async function verifySlotSecureLink/)
    assert.match(src, /export async function updateSlotSecureLink/)
  })

  it('watermark settings are unchanged', () => {
    const src = read('src/lib/papermark-dataroom-contract.ts')
    assert.match(src, /APRI Complimentary Review Copy · \{\{email\}\}/)
    assert.match(src, /APRI Subscriber Edition/)
    assert.match(src, /opacity: 0\.15/)
    assert.match(src, /font_size: 18/)
  })

  it('verified-email access is unchanged', () => {
    const src = read('src/lib/papermark-dataroom-contract.ts')
    const fn = src.slice(src.indexOf('export function reviewLinkSettings'))
    assert.match(fn, /email_protected: true/)
    assert.match(fn, /email_authenticated: true/)
  })

  it('download permissions are unchanged', () => {
    const src = read('src/lib/papermark-dataroom-contract.ts')
    const fn = src.slice(src.indexOf('export function reviewLinkSettings'), src.indexOf('export function isDocumentTargetedLink'))
    assert.match(fn, /allow_download: true/)
  })

  it('PAPERMARK_CUSTOM_DOMAIN handling is unchanged', () => {
    assert.match(read('src/lib/papermark-datarooms.ts'), /PAPERMARK_CUSTOM_DOMAIN/)
    assert.match(read('src/lib/papermark-datarooms.ts'), /return domain \|\| null/)
  })

  it('no new complimentary-review route was introduced', () => {
    assert.equal(existsSync(join(ROOT, 'src/app/complimentary-review')), false)
  })

  it('the public review URL is still the per-card secure link', () => {
    assert.match(read('src/lib/publications.ts'), /secureUrl: r\.secure_link_url/)
  })

  it('Resend email flows are untouched', () => {
    const digest = read('src/app/api/cron/engagement-digest/route.ts')
    // Still uses the engagement module's own summary, not the analytics layer.
    assert.match(digest, /from '@\/lib\/engagement'/)
    assert.doesNotMatch(digest, /engagement-analytics/)
  })

  it('subscriber entitlement logic is not touched by the analytics layer', () => {
    for (const f of [ANALYTICS_LAYER, COLLECTOR, CLICK, 'src/app/actions/engagement-analytics.ts']) {
      const src = read(f)
      assert.doesNotMatch(src, /insert into subscribers/i, `${f} must not create subscribers`)
      assert.doesNotMatch(src, /public_tier\s*=/, `${f} must not change entitlements`)
      assert.doesNotMatch(src, /status\s*=\s*'active'/, `${f} must not activate anyone`)
    }
  })

  it('the review library slot mappings are not written by analytics', () => {
    for (const f of [ANALYTICS_LAYER, COLLECTOR, CLICK]) {
      assert.doesNotMatch(read(f), /update complimentary_review_items/, `${f} must not alter slots`)
    }
  })

  it('no credential reaches client code', () => {
    for (const f of [
      'src/components/TrackedAccessLink.tsx',
      'src/components/SiteAnalytics.tsx',
      'src/app/admin/engagement/engagement-client.tsx',
    ]) {
      const src = read(f)
      assert.doesNotMatch(src, /PAPERMARK_API_TOKEN|PAPERMARK_API_KEY|PAPERMARK_WEBHOOK_SECRET/, f)
      assert.doesNotMatch(src, /CRON_SECRET|DATABASE_URL|RESEND_API_KEY|VERCEL_TOKEN/, f)
    }
  })

  it('client components never import a server-only module', () => {
    for (const f of [
      'src/components/TrackedAccessLink.tsx',
      'src/components/SiteAnalytics.tsx',
      'src/app/admin/engagement/engagement-client.tsx',
    ]) {
      const src = read(f)
      assert.doesNotMatch(src, /from ['"]@\/lib\/db['"]/, f)
      // Importing a server ACTION module is how a client component calls one,
      // and is correct. What must never be imported is the server-only lib.
      assert.doesNotMatch(src, /from ['"]@\/lib\/papermark-collector['"]/, f)
      assert.doesNotMatch(src, /from ['"]@\/lib\/engagement-analytics['"]/, f)
      assert.doesNotMatch(src, /from ['"]@\/lib\/view-attribution['"]/, f)
    }
  })
})
