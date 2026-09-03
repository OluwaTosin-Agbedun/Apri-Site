/**
 * Phase 5.1 — API-provisioned Complimentary Review links.
 *
 * The three review PDFs live inside the Papermark Complimentary Review Data
 * Room, so the owner cannot easily obtain per-document share links by hand.
 * These tests pin the behaviour of the owner-only buttons that create and
 * verify those links through the Papermark API, and the safety rules that stop
 * a bad link reaching the public page.
 */

import { describe, it, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  PROSPECT_WATERMARK_TEXT,
  prospectWatermarkConfig,
  prospectWatermarkText,
  reviewLinkSettings,
  isDocumentTargetedLink,
  subscriberWatermarkConfig,
} from '../src/lib/papermark-dataroom-contract.ts'

const ROOT = resolve(import.meta.dirname, '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

const ACTIONS = 'src/app/actions/review-library.ts'
const SERVICE = 'src/lib/papermark-datarooms.ts'
const CONTRACT = 'src/lib/papermark-dataroom-contract.ts'
const FORM = 'src/app/admin/review-library/review-form.tsx'
const MIGRATION = 'db/migrations/20260903_review_secure_link_provisioning.sql'

/** The body of one named function, up to the next top-level `export`. */
const fnBody = (src, name) => {
  const start = src.indexOf(`function ${name}`)
  assert.notEqual(start, -1, `${name} must exist`)
  const rest = src.slice(start + 1)
  const next = rest.indexOf('\nexport ')
  return next === -1 ? rest : rest.slice(0, next)
}

// ---------------------------------------------------------------------------
// 1. Owner-only access
// ---------------------------------------------------------------------------

describe('owner-only access', () => {
  const src = read(ACTIONS)

  for (const name of [
    'createSlotSecureLink',
    'verifySlotSecureLink',
    'preparePendingSecureLink',
    'updateSlotSecureLink',
    'makeVersionCurrent',
  ]) {
    it(`${name} calls requireOwner`, () => {
      assert.match(fnBody(src, name), /requireOwner\(\)/)
    })
  }

  it('every new action validates the slot key against FIXED_SLOTS', () => {
    for (const name of [
      'createSlotSecureLink',
      'verifySlotSecureLink',
      'preparePendingSecureLink',
    ]) {
      assert.match(fnBody(src, name), /FIXED_SLOTS\.includes/, `${name} must validate the slot`)
    }
  })
})

// ---------------------------------------------------------------------------
// 2. document_id is used; dataroom_id never is
// ---------------------------------------------------------------------------

describe('document targeting', () => {
  it('reviewLinkSettings sends document_id', () => {
    const s = reviewLinkSettings({ documentId: 'doc_abc', slotKey: 'MIN' })
    assert.equal(s.document_id, 'doc_abc')
  })

  it('reviewLinkSettings never sends dataroom_id', () => {
    const s = reviewLinkSettings({ documentId: 'doc_abc', slotKey: 'MIN' })
    assert.equal('dataroom_id' in s, false)
    assert.equal(s.dataroom_id, undefined)
  })

  it('the review link settings builder has no dataroom_id anywhere', () => {
    const src = read(CONTRACT)
    const fn = src.slice(
      src.indexOf('export function reviewLinkSettings'),
      src.indexOf('export function isDocumentTargetedLink'),
    )
    assert.doesNotMatch(fn, /dataroom_id/)
  })

  it('createReviewDocumentLink posts to /v1/links with the review settings', () => {
    const src = read(SERVICE)
    const fn = src.slice(src.indexOf('export async function createReviewDocumentLink'))
    assert.match(fn, /'\/v1\/links'/)
    assert.match(fn, /method: 'POST'/)
    assert.match(fn, /reviewLinkSettings/)
  })

  it('createReviewDocumentLink never references dataroom_id', () => {
    const src = read(SERVICE)
    const fn = src.slice(
      src.indexOf('export async function createReviewDocumentLink'),
      src.indexOf('export async function verifyReviewDocumentLink'),
    )
    assert.doesNotMatch(fn, /dataroom_id:/)
  })
})

// ---------------------------------------------------------------------------
// 3. Exact verified-email and watermark settings
// ---------------------------------------------------------------------------

describe('link security settings', () => {
  const s = reviewLinkSettings({ documentId: 'doc_abc', slotKey: 'MIN' })

  it('email_protected is true', () => {
    assert.equal(s.email_protected, true)
  })

  it('email_authenticated is true', () => {
    assert.equal(s.email_authenticated, true)
  })

  it('enable_watermark is true', () => {
    assert.equal(s.enable_watermark, true)
  })

  it('allow_list stays empty so any verified address may read', () => {
    assert.deepEqual(s.allow_list, [])
  })

  it('screenshot protection is on', () => {
    assert.equal(s.enable_screenshot_protection, true)
  })

  it('download policy matches the existing Complimentary Review policy', () => {
    assert.equal(s.allow_download, true)
  })

  it('watermark text is exactly the approved wording', () => {
    assert.equal(
      s.watermark_config.text,
      'APRI Complimentary Review Copy · {{email}} · {{date}} {{time}} · Confidential · Not for redistribution',
    )
  })

  it('watermark opacity is 0.15', () => {
    assert.equal(s.watermark_config.opacity, 0.15)
  })

  it('watermark font size is 18', () => {
    assert.equal(s.watermark_config.font_size, 18)
  })

  it('watermark leaves {{email}} as a Papermark token, not a baked address', () => {
    assert.match(s.watermark_config.text, /\{\{email\}\}/)
  })

  it('exported constant and helper agree', () => {
    assert.equal(prospectWatermarkText(), PROSPECT_WATERMARK_TEXT)
    assert.equal(prospectWatermarkConfig().text, PROSPECT_WATERMARK_TEXT)
  })
})

// ---------------------------------------------------------------------------
// 4. No IP token
// ---------------------------------------------------------------------------

describe('no IP address in review watermarks', () => {
  it('watermark text carries no IP token', () => {
    for (const t of [PROSPECT_WATERMARK_TEXT, prospectWatermarkConfig().text]) {
      assert.doesNotMatch(t, /\{\{ip/i)
      assert.doesNotMatch(t, /ipAddress/i)
      assert.doesNotMatch(t, /ip[\s_-]?address/i)
    }
  })

  it('the review link settings carry no IP token in any field', () => {
    const s = reviewLinkSettings({ documentId: 'doc_abc', slotKey: 'MIN' })
    assert.doesNotMatch(JSON.stringify(s), /\{\{ip/i)
    assert.doesNotMatch(JSON.stringify(s), /ipAddress/i)
  })

  it('the prospect watermark block in the contract has no IP token', () => {
    const src = read(CONTRACT)
    const block = src.slice(
      src.indexOf('PROSPECT_WATERMARK_TEXT'),
      src.indexOf('export type DataRoomLinkSettings'),
    )
    assert.doesNotMatch(block, /\{\{ip/i)
  })
})

// ---------------------------------------------------------------------------
// 5. Direct document target validation
// ---------------------------------------------------------------------------

describe('isDocumentTargetedLink', () => {
  it('accepts a matching document link', () => {
    const r = isDocumentTargetedLink({ document_id: 'doc_1', target_type: 'document' }, 'doc_1')
    assert.equal(r.ok, true)
  })

  it('tolerates an absent target_type when the document matches', () => {
    assert.equal(isDocumentTargetedLink({ document_id: 'doc_1' }, 'doc_1').ok, true)
  })

  it('rejects a target_type that is not document', () => {
    const r = isDocumentTargetedLink(
      { document_id: 'doc_1', target_type: 'dataroom' },
      'doc_1',
    )
    assert.equal(r.ok, false)
    assert.match(r.reason, /target_type/)
  })

  it('rejects a Data Room link', () => {
    const r = isDocumentTargetedLink({ dataroom_id: 'dr_1' }, 'doc_1')
    assert.equal(r.ok, false)
    assert.match(r.reason, /Data Room/)
  })

  it('rejects a link with no document id', () => {
    assert.equal(isDocumentTargetedLink({}, 'doc_1').ok, false)
  })

  it('rejects a link pointing at a different document', () => {
    const r = isDocumentTargetedLink({ document_id: 'doc_OTHER' }, 'doc_1')
    assert.equal(r.ok, false)
    assert.match(r.reason, /doc_OTHER/)
    assert.match(r.reason, /doc_1/)
  })

  it('create and verify both run the check before returning', () => {
    const src = read(SERVICE)
    for (const name of [
      'createReviewDocumentLink',
      'verifyReviewDocumentLink',
      'updateReviewDocumentLink',
    ]) {
      const fn = src.slice(src.indexOf(`export async function ${name}`))
      assert.match(fn.slice(0, 2500), /isDocumentTargetedLink/, `${name} must validate the target`)
    }
  })
})

// ---------------------------------------------------------------------------
// 6. Duplicate link creation is prevented
// ---------------------------------------------------------------------------

describe('idempotency', () => {
  const src = read(ACTIONS)

  it('createSlotSecureLink returns early when a link for the same document exists', () => {
    const fn = fnBody(src, 'createSlotSecureLink')
    assert.match(fn, /slot\.secure_link_document_id === current\.documentId/)
    assert.match(fn, /already has a link for this document/)
  })

  it('preparePendingSecureLink returns early for an already prepared edition', () => {
    const fn = fnBody(src, 'preparePendingSecureLink')
    assert.match(fn, /slot\.pending_secure_link_document_id === pendingDocId/)
    assert.match(fn, /already has a prepared link/)
  })

  it('verify targets only the stored link id, never a list', () => {
    const fn = fnBody(src, 'verifySlotSecureLink')
    assert.match(fn, /slot\.secure_link_id/)
    assert.doesNotMatch(fn, /listLinks|listDataRoomLinks/)
  })

  it('verifyReviewDocumentLink reads exactly one link by id', () => {
    const src2 = read(SERVICE)
    const fn = src2.slice(
      src2.indexOf('export async function verifyReviewDocumentLink'),
      src2.indexOf('export async function updateReviewDocumentLink'),
    )
    assert.match(fn, /\/v1\/links\/\$\{encodeURIComponent\(linkId\)\}/)
    assert.doesNotMatch(fn, /\/v1\/links\?/)
  })
})

// ---------------------------------------------------------------------------
// 7. Subscriber links are untouched
// ---------------------------------------------------------------------------

describe('subscriber isolation', () => {
  const src = read(ACTIONS)

  it('review actions never touch subscriber link tables', () => {
    assert.doesNotMatch(src, /papermark_dataroom_links/)
    assert.doesNotMatch(src, /papermark_subscriber_document_links/)
    assert.doesNotMatch(src, /subscriber_documents/)
  })

  it('review actions never write to the subscribers table', () => {
    assert.doesNotMatch(src, /insert into subscribers/i)
    assert.doesNotMatch(src, /update subscribers/i)
  })

  it('review actions never mint or revoke subscriber links', () => {
    assert.doesNotMatch(src, /mintSubscriberLink/)
    assert.doesNotMatch(src, /ensureDocumentLink/)
    assert.doesNotMatch(src, /ensureAllDocumentLinks/)
    assert.doesNotMatch(src, /revokeAllDocumentLinks/)
    assert.doesNotMatch(src, /createDataRoomLink/)
  })

  it('review revocation only ever uses the review-specific helper', () => {
    const matches = src.match(/revoke\w*/g) ?? []
    for (const m of matches) {
      assert.match(
        m,
        /^revoked?$|^revokeReviewDocumentLink$/,
        `unexpected revoke helper referenced: ${m}`,
      )
    }
  })

  it('the review watermark is distinct from the subscriber watermark', () => {
    const sub = subscriberWatermarkConfig('someone@example.org').text
    assert.notEqual(sub, PROSPECT_WATERMARK_TEXT)
    assert.match(sub, /APRI Subscriber Edition/)
    assert.match(PROSPECT_WATERMARK_TEXT, /APRI Complimentary Review Copy/)
    assert.doesNotMatch(sub, /Complimentary/)
  })
})

// ---------------------------------------------------------------------------
// 8. Public revalidation occurs
// ---------------------------------------------------------------------------

describe('revalidation', () => {
  const src = read(ACTIONS)

  it('refresh revalidates / and /publications', () => {
    const fn = src.slice(src.indexOf('function refresh'), src.indexOf('// -----'))
    assert.match(fn, /revalidatePath\("\/"\)/)
    assert.match(fn, /revalidatePath\("\/publications"\)/)
  })

  it('createSlotSecureLink refreshes the public pages on success', () => {
    const fn = fnBody(src, 'createSlotSecureLink')
    assert.match(fn, /refresh\(\)/)
  })

  it('verifySlotSecureLink refreshes the public pages on success', () => {
    assert.match(fnBody(src, 'verifySlotSecureLink'), /refresh\(\)/)
  })

  it('makeVersionCurrent refreshes the public pages', () => {
    assert.match(fnBody(src, 'makeVersionCurrent'), /refresh\(\)/)
  })
})

// ---------------------------------------------------------------------------
// 9. API or database failures leave the slot unchanged
// ---------------------------------------------------------------------------

describe('failure handling', () => {
  const src = read(ACTIONS)

  it('a failed creation returns before any database write', () => {
    const fn = fnBody(src, 'createSlotSecureLink')
    const guard = fn.indexOf('if (!created.ok) return')
    const write = fn.indexOf('update complimentary_review_items')
    assert.notEqual(guard, -1, 'must guard on a failed create')
    assert.ok(guard < write, 'the guard must come before the write')
    assert.match(fn, /Link not created\./)
  })

  it('a failed verification returns without writing', () => {
    const fn = fnBody(src, 'verifySlotSecureLink')
    const guard = fn.indexOf('if (!verified.ok) return')
    const write = fn.indexOf('update complimentary_review_items')
    assert.notEqual(guard, -1)
    assert.ok(guard < write)
  })

  it('a storage failure after creation revokes the orphan link', () => {
    const fn = fnBody(src, 'createSlotSecureLink')
    assert.match(fn, /catch \(error\)/)
    assert.match(fn, /revokeReviewDocumentLink\(created\.value\.linkId\)/)
    assert.match(fn, /could NOT be revoked and must be removed manually/)
  })

  it('a storage failure on a pending link revokes that orphan too', () => {
    const fn = fnBody(src, 'preparePendingSecureLink')
    assert.match(fn, /catch \(error\)/)
    assert.match(fn, /revokeReviewDocumentLink\(created\.value\.linkId\)/)
  })

  it('the exact provider message is surfaced, not a generic one', () => {
    assert.match(src, /\$\{created\.message\}/)
    assert.match(src, /\$\{verified\.message\}/)
  })

  it('a slot with no unambiguous mapped document is refused', () => {
    const fn = fnBody(src, 'resolveCurrentDocument')
    assert.match(fn, /no mapped Papermark document/)
    assert.match(fn, /approved documents in the Data Room/)
    assert.match(fn, /Resolve the duplicate/)
  })
})

// ---------------------------------------------------------------------------
// 10. Pending links do not become public before Make current
// ---------------------------------------------------------------------------

describe('pending editions stay private', () => {
  const src = read(ACTIONS)

  it('preparePendingSecureLink writes only pending_ columns', () => {
    const fn = fnBody(src, 'preparePendingSecureLink')
    const update = fn.slice(fn.indexOf('update complimentary_review_items'), fn.indexOf('where id'))
    assert.match(update, /pending_secure_link_url/)
    assert.match(update, /pending_secure_link_id/)
    // The live columns must not appear in the pending write.
    assert.doesNotMatch(update, /[^g_]secure_link_url = /)
    assert.doesNotMatch(update, /papermark_document_id = /)
  })

  it('preparePendingSecureLink does not revalidate the public pages', () => {
    const fn = fnBody(src, 'preparePendingSecureLink')
    assert.doesNotMatch(fn, /refresh\(\)/)
    assert.match(fn, /revalidatePath\("\/admin\/review-library"\)/)
    assert.doesNotMatch(fn, /revalidatePath\("\/publications"\)/)
    assert.doesNotMatch(fn, /revalidatePath\("\/"\)/)
  })

  it('preparing a link says the public card is unchanged', () => {
    assert.match(fnBody(src, 'preparePendingSecureLink'), /public card is unchanged/)
  })

  it('makeVersionCurrent refuses a pending edition with no verified link', () => {
    const fn = fnBody(src, 'makeVersionCurrent')
    assert.match(fn, /pending_secure_link_verified_at/)
    assert.match(fn, /no verified secure link/)
    assert.match(fn, /Prepare secure link first/)
  })

  it('makeVersionCurrent switches document and URL in one statement', () => {
    const fn = fnBody(src, 'makeVersionCurrent')
    const update = fn.slice(
      fn.indexOf('update complimentary_review_items set'),
      fn.indexOf('where id ='),
    )
    assert.match(update, /papermark_document_id = \$\{pendingDocId\}/)
    assert.match(update, /secure_link_url = \$\{pendingLinkUrl\}/)
    assert.match(update, /secure_link_id = \$\{slot\[0\]\.pending_secure_link_id\}/)
    // and clears the pending fields in the same statement
    assert.match(update, /pending_secure_link_id = null/)
    assert.match(update, /pending_papermark_document_id = null/)
  })

  it('the old link is revoked best-effort after the switch', () => {
    const fn = fnBody(src, 'makeVersionCurrent')
    assert.match(fn, /revokeReviewDocumentLink\(previousLinkId\)/)
    assert.match(fn, /still needs manual revocation/)
  })

  it('a failed revocation keeps the new edition live', () => {
    const fn = fnBody(src, 'makeVersionCurrent')
    const revoke = fn.indexOf('revokeReviewDocumentLink(previousLinkId)')
    const ret = fn.indexOf('return { ok: true')
    assert.ok(revoke < ret, 'revocation is attempted before the success return')
    assert.match(fn, /WARNING/)
  })

  it('the admin UI only enables Make current for a verified pending link', () => {
    const form = read(FORM)
    assert.match(form, /pendingLinkReady/)
    assert.match(form, /disabled=\{makeBusy \|\| !pendingLinkReady\}/)
  })
})

// ---------------------------------------------------------------------------
// 11. Public cards use verified direct-document URLs only
// ---------------------------------------------------------------------------

describe('public library gating', () => {
  const pubs = read('src/lib/publications.ts')
  const page = read('src/app/publications/page.tsx')

  it('getReviewLibrary requires a verified link', () => {
    const fn = pubs.slice(pubs.indexOf('async function getReviewLibrary'))
    assert.match(fn, /secure_link_verified_at is not null/)
  })

  it('getReviewLibrary requires the link to match the mapped document', () => {
    const fn = pubs.slice(pubs.indexOf('async function getReviewLibrary'))
    assert.match(fn, /secure_link_document_id = ri\.papermark_document_id/)
  })

  it('getReviewLibrary still requires exactly three slots', () => {
    const fn = pubs.slice(pubs.indexOf('async function getReviewLibrary'))
    assert.match(fn, /items\.length !== 3/)
  })

  it('the public page renders one direct link per card', () => {
    assert.match(page, /card\.secureUrl/)
    assert.match(page, /Access review copy/)
  })

  it('the enable gate refuses an unverified or mismatched link', () => {
    const fn = fnBody(read(ACTIONS), 'saveReviewLibrarySettings')
    assert.match(fn, /secure link not verified against Papermark/)
    assert.match(fn, /points at a different document/)
  })
})

// ---------------------------------------------------------------------------
// 12. No Data Room homepage URL is ever used
// ---------------------------------------------------------------------------

describe('no Data Room homepage fallback', () => {
  it('the public page has no Data Room URL or papermarkUrl', () => {
    const page = read('src/app/publications/page.tsx')
    assert.doesNotMatch(page, /library\.papermarkUrl/)
    assert.doesNotMatch(page, /papermark_dataroom_id/)
    assert.doesNotMatch(page, /review_library_papermark_url/)
  })

  it('getReviewLibrary reads no Data Room URL setting', () => {
    const fn = read('src/lib/publications.ts').slice(
      read('src/lib/publications.ts').indexOf('async function getReviewLibrary'),
    )
    assert.doesNotMatch(fn, /review_library_papermark_url/)
    assert.doesNotMatch(fn, /papermark_dataroom_id/)
  })

  it('the link actions never fall back to a Data Room address', () => {
    const src = read(ACTIONS)
    for (const name of ['createSlotSecureLink', 'verifySlotSecureLink', 'preparePendingSecureLink']) {
      const fn = fnBody(src, name)
      assert.doesNotMatch(fn, /review_library_papermark_dataroom_id/, `${name} must not read the room id`)
      assert.doesNotMatch(fn, /papermark_dataroom_id/, `${name} must not use a room id`)
    }
  })

  it('a manually pasted URL must still be verified as a document link', () => {
    const fn = fnBody(read(ACTIONS), 'updateSlotSecureLink')
    assert.match(fn, /verifyReviewDocumentLink/)
    assert.match(fn, /expectedDocumentId: docId/)
    assert.match(fn, /Not saved\./)
  })

  it('a pasted URL with no readable link id is refused', () => {
    const fn = fnBody(read(ACTIONS), 'updateSlotSecureLink')
    assert.match(fn, /Could not read a Papermark link id/)
  })
})

// ---------------------------------------------------------------------------
// 13. Never sends emails
// ---------------------------------------------------------------------------

test('the review link actions never send email', () => {
  const src = read(ACTIONS)
  assert.doesNotMatch(src, /sendEmail|sendMail|Resend|resend\(|nodemailer/)
  assert.doesNotMatch(src, /sendWelcome|sendReviewInvite/)
})

test('the review link service never sends email', () => {
  const src = read(SERVICE)
  assert.doesNotMatch(src, /sendEmail|sendMail|Resend|nodemailer/)
})

// ---------------------------------------------------------------------------
// 14. Custom domain handling
// ---------------------------------------------------------------------------

describe('custom domain', () => {
  it('omits the domain field when none is configured', () => {
    const s = reviewLinkSettings({ documentId: 'd', slotKey: 'MIN', customDomain: null })
    assert.equal('domain' in s, false)
  })

  it('omits the domain field for an empty string', () => {
    const s = reviewLinkSettings({ documentId: 'd', slotKey: 'MIN', customDomain: '   ' })
    assert.equal('domain' in s, false)
  })

  it('sends the domain when one is configured', () => {
    const s = reviewLinkSettings({
      documentId: 'd',
      slotKey: 'MIN',
      customDomain: 'docs.athenacentre.org',
    })
    assert.equal(s.domain, 'docs.athenacentre.org')
  })

  it('the service reads the domain from PAPERMARK_CUSTOM_DOMAIN', () => {
    const src = read(SERVICE)
    assert.match(src, /PAPERMARK_CUSTOM_DOMAIN/)
    const fn = src.slice(src.indexOf('function reviewLinkDomain'))
    assert.match(fn.slice(0, 300), /return domain \|\| null/)
  })

  it('no hostname is hard-coded as a fallback in the settings builder', () => {
    const src = read(CONTRACT)
    const fn = src.slice(
      src.indexOf('export function reviewLinkSettings'),
      src.indexOf('export function isDocumentTargetedLink'),
    )
    assert.doesNotMatch(fn, /athenacentre\.org/)
    assert.doesNotMatch(fn, /papermark\.com/)
  })
})

// ---------------------------------------------------------------------------
// 15. Migration is additive and idempotent
// ---------------------------------------------------------------------------

describe('migration', () => {
  it('exists', () => {
    assert.equal(existsSync(join(ROOT, MIGRATION)), true)
  })

  const mig = read(MIGRATION)

  for (const col of [
    'secure_link_id',
    'secure_link_document_id',
    'secure_link_verified_at',
    'pending_secure_link_id',
    'pending_secure_link_url',
    'pending_secure_link_document_id',
    'pending_secure_link_verified_at',
  ]) {
    it(`adds ${col}`, () => {
      assert.match(mig, new RegExp(`add column if not exists ${col}\\b`))
    })
  }

  it('every column add is guarded with IF NOT EXISTS', () => {
    const adds = mig.match(/add column/g) ?? []
    const guarded = mig.match(/add column if not exists/g) ?? []
    assert.equal(adds.length, guarded.length)
    assert.ok(adds.length >= 7)
  })

  it('every index is guarded with IF NOT EXISTS', () => {
    const idx = mig.match(/create (unique )?index/g) ?? []
    const guarded = mig.match(/create (unique )?index if not exists/g) ?? []
    assert.equal(idx.length, guarded.length)
  })

  it('all new columns are nullable — no NOT NULL and no DEFAULT', () => {
    // Only the column definitions matter. A partial index may legitimately say
    // "where secure_link_id is not null", which is a predicate, not a
    // constraint on a new column.
    for (const line of mig.split('\n')) {
      if (!/add column if not exists/.test(line)) continue
      assert.doesNotMatch(line, /\bnot null\b/i, `column add must stay nullable: ${line.trim()}`)
      assert.doesNotMatch(line, /\bdefault\b/i, `column add must have no default: ${line.trim()}`)
    }
  })

  it('contains no destructive statement', () => {
    assert.doesNotMatch(mig, /\bdrop\b/i)
    assert.doesNotMatch(mig, /\bdelete\b/i)
    assert.doesNotMatch(mig, /\btruncate\b/i)
    assert.doesNotMatch(mig, /\balter column\b/i)
    assert.doesNotMatch(mig, /\bupdate .* set\b/i)
  })
})

// ---------------------------------------------------------------------------
// 16. Admin UI surfaces the required controls and status
// ---------------------------------------------------------------------------

describe('admin UI', () => {
  const form = read(FORM)

  it('offers Create secure review link when none exists', () => {
    assert.match(form, /Create secure review link/)
  })

  it('offers Verify\/update secure review link when one exists', () => {
    assert.match(form, /Verify\/update secure review link/)
  })

  it('offers Prepare secure link for a pending edition', () => {
    assert.match(form, /Prepare secure link/)
  })

  it('shows a Ready status', () => {
    assert.match(form, /linkReady/)
    assert.match(form, />\s*Ready\s*</)
  })

  it('shows an Error status when the link points elsewhere', () => {
    assert.match(form, /linkStale/)
    assert.match(form, /Error: link points elsewhere/)
  })

  it('shows the mapped Papermark filename and document ID', () => {
    assert.match(form, /Papermark PDF: <span className="font-medium">\{slot\.pubTitle\}<\/span>/)
    assert.match(form, /Document ID: \{slot\.papermarkDocumentId\}/)
  })

  it('shows the link ID and when it was verified', () => {
    assert.match(form, /Link ID: \{slot\.secureLinkId\}/)
    assert.match(form, /slot\.secureLinkVerifiedAt/)
  })

  it('keeps the manual URL field as a labelled emergency fallback', () => {
    assert.match(form, /Emergency fallback/)
    assert.match(form, /manualMode/)
  })

  it('the create button is disabled without a mapped document', () => {
    assert.match(form, /disabled=\{linkBusy \|\| !hasDoc\}/)
  })

  it('holds no Papermark API token', () => {
    assert.doesNotMatch(form, /PAPERMARK_API_TOKEN|PAPERMARK_API_KEY/)
  })
})

// ---------------------------------------------------------------------------
// 17. The service module stays server-only
// ---------------------------------------------------------------------------

test('the review link service is server-only', () => {
  assert.match(read(SERVICE), /^import 'server-only'/m)
})

test('the actions module is a server module', () => {
  assert.match(read(ACTIONS), /^"use server"/m)
})

test('the contract stays importable by tests — no server-only import', () => {
  // The phrase appears in a doc comment explaining why the contract is split
  // out; what must not appear is an actual server-only import statement.
  assert.doesNotMatch(read(CONTRACT), /^\s*import\s+'server-only'/m)
})
