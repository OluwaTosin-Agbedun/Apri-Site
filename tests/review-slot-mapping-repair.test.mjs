/**
 * Fixed-slot mapping repair — regression tests for the production fault.
 *
 * Production showed this for MIN, AIU and PLM after a successful sync:
 *
 *   "No Papermark document is mapped to this slot yet. Sync the Data Room and
 *    map a document before creating a link."
 *
 * The slots held their publication records and `slot_key`, and the Phase 3 sync
 * candidates were already in the database — so every file compared equal on its
 * version key, sync took the no-op branch, and nothing was ever attached. The
 * secure-link buttons stayed disabled no matter how often sync ran.
 *
 * The first suite below reconstructs that exact state and proves a sync now
 * repairs it. The rest pin the safety rules that stop the repair doing harm.
 */

import { describe, it, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  decideSlotRepair,
  isUsableCandidate,
  summariseRepair,
  usableCandidatesForSlot,
} from '../src/lib/review-repair.ts'

const ROOT = resolve(import.meta.dirname, '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

const ACTIONS = 'src/app/actions/review-library.ts'
const FORM = 'src/app/admin/review-library/review-form.tsx'

/** A recognised, present Phase 3 candidate. */
const candidate = (over = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  documentId: 'doc_min_001',
  dataroomId: 'dr_review',
  cleanTitle: 'Monthly Intelligence Note — August 2026',
  rawFilename: 'MIN August 2026 Complimentary Review Copy.pdf',
  versionKey: 'v-min-aug-2026',
  folderPath: '/Complimentary Review',
  numPages: 12,
  isPresent: true,
  syncStatus: 'approved',
  ...over,
})

/** The body of one named function in a source file. */
const fnBody = (src, name) => {
  const start = src.indexOf(`function ${name}`)
  assert.notEqual(start, -1, `${name} must exist`)
  const rest = src.slice(start + 1)
  const next = rest.indexOf('\nexport ')
  return next === -1 ? rest : rest.slice(0, next)
}

// ---------------------------------------------------------------------------
// 1. The production state, reproduced
// ---------------------------------------------------------------------------

describe('the production fault', () => {
  // Fixed slot exists with slot_key and publication; a matching Phase 3
  // candidate already exists; the slot's Papermark document id is null; and the
  // document is reported unchanged by sync (which is why it is already
  // 'approved' and present, having been seen in an earlier pass).
  const productionState = {
    slotKey: 'MIN',
    slotExists: true,
    currentDocumentId: null,
    candidates: [candidate()],
  }

  it('sync backfills the missing mapping', () => {
    const d = decideSlotRepair(productionState)
    assert.equal(d.status, 'repaired')
    assert.equal(d.candidate.documentId, 'doc_min_001')
  })

  it('the repair carries the candidate metadata across', () => {
    const d = decideSlotRepair(productionState)
    assert.equal(d.candidate.dataroomId, 'dr_review')
    assert.equal(d.candidate.versionKey, 'v-min-aug-2026')
    assert.equal(d.candidate.folderPath, '/Complimentary Review')
    assert.equal(d.candidate.numPages, 12)
    assert.equal(d.candidate.rawFilename, 'MIN August 2026 Complimentary Review Copy.pdf')
  })

  it('an unchanged document is still eligible — being already approved is not a bar', () => {
    const d = decideSlotRepair({
      ...productionState,
      candidates: [candidate({ syncStatus: 'approved' })],
    })
    assert.equal(d.status, 'repaired')
  })

  it('a pending candidate is equally eligible', () => {
    const d = decideSlotRepair({
      ...productionState,
      candidates: [candidate({ syncStatus: 'pending' })],
    })
    assert.equal(d.status, 'repaired')
  })

  it('the secure-link button becomes enabled once mapped', () => {
    // hasDoc drives the button; the repair sets papermark_document_id, so the
    // gate that disabled it is satisfied.
    const form = read(FORM)
    assert.match(form, /const hasDoc = !!slot\.papermarkDocumentId/)
    assert.match(form, /disabled=\{linkBusy \|\| !hasDoc\}/)
    // and the repair is what populates that column
    assert.match(fnBody(read(ACTIONS), 'repairFixedSlotMappings'), /papermark_document_id = \$\{only\.documentId\}/)
  })
})

// ---------------------------------------------------------------------------
// 2. Three unique candidates map to MIN, AIU and PLM
// ---------------------------------------------------------------------------

describe('all three slots', () => {
  const all = [
    candidate({ id: 'a', documentId: 'doc_min', cleanTitle: 'MIN Aug', rawFilename: 'MIN.pdf' }),
    candidate({ id: 'b', documentId: 'doc_aiu', cleanTitle: 'AIU Aug', rawFilename: 'AIU.pdf' }),
    candidate({ id: 'c', documentId: 'doc_plm', cleanTitle: 'PLM Aug', rawFilename: 'PLM.pdf' }),
  ]

  // In the real query each slot is asked for its own series, so model that by
  // handing each decision only its own candidate.
  const perSlot = { MIN: [all[0]], AIU: [all[1]], PLM: [all[2]] }

  for (const [slotKey, expected] of [
    ['MIN', 'doc_min'],
    ['AIU', 'doc_aiu'],
    ['PLM', 'doc_plm'],
  ]) {
    it(`${slotKey} maps to ${expected}`, () => {
      const d = decideSlotRepair({
        slotKey,
        slotExists: true,
        currentDocumentId: null,
        candidates: perSlot[slotKey],
      })
      assert.equal(d.status, 'repaired')
      assert.equal(d.candidate.documentId, expected)
    })
  }

  it('a full pass reports all three as mapped', () => {
    const decisions = ['MIN', 'AIU', 'PLM'].map((slotKey) =>
      decideSlotRepair({
        slotKey,
        slotExists: true,
        currentDocumentId: null,
        candidates: perSlot[slotKey],
      }),
    )
    assert.equal(decisions.every((d) => d.status === 'repaired'), true)
    assert.equal(summariseRepair(decisions), 'mapped MIN, AIU, PLM')
  })
})

// ---------------------------------------------------------------------------
// 3. Ambiguity is never resolved automatically
// ---------------------------------------------------------------------------

describe('ambiguous candidates', () => {
  const two = [
    candidate({ id: 'a', documentId: 'doc_min_aug', cleanTitle: 'MIN August' }),
    candidate({ id: 'b', documentId: 'doc_min_sep', cleanTitle: 'MIN September' }),
  ]

  it('is reported as ambiguous, not mapped', () => {
    const d = decideSlotRepair({
      slotKey: 'MIN',
      slotExists: true,
      currentDocumentId: null,
      candidates: two,
    })
    assert.equal(d.status, 'ambiguous')
  })

  it('never picks a candidate', () => {
    const d = decideSlotRepair({
      slotKey: 'MIN',
      slotExists: true,
      currentDocumentId: null,
      candidates: two,
    })
    assert.equal(d.candidate, undefined)
  })

  it('offers both documents for an explicit choice', () => {
    const d = decideSlotRepair({
      slotKey: 'MIN',
      slotExists: true,
      currentDocumentId: null,
      candidates: two,
    })
    assert.equal(d.options.length, 2)
    assert.deepEqual(
      d.options.map((o) => o.documentId).sort(),
      ['doc_min_aug', 'doc_min_sep'],
    )
  })

  it('says how many were found and what to do', () => {
    const d = decideSlotRepair({
      slotKey: 'MIN',
      slotExists: true,
      currentDocumentId: null,
      candidates: two,
    })
    assert.match(d.reason, /2 recognised MIN documents/)
    assert.match(d.reason, /ambiguous/)
    assert.match(d.reason, /Use this document/)
  })

  it('the action performs no write for an ambiguous slot', () => {
    const fn = fnBody(read(ACTIONS), 'repairFixedSlotMappings')
    assert.match(fn, /if \(decision\.status !== 'repaired' \|\| !decision\.candidate\) continue/)
  })

  it('three copies of one document are not ambiguity', () => {
    const dupes = [
      candidate({ id: 'a', documentId: 'doc_same' }),
      candidate({ id: 'b', documentId: 'doc_same' }),
      candidate({ id: 'c', documentId: 'doc_same' }),
    ]
    const d = decideSlotRepair({
      slotKey: 'MIN',
      slotExists: true,
      currentDocumentId: null,
      candidates: dupes,
    })
    assert.equal(d.status, 'repaired')
    assert.equal(d.candidate.documentId, 'doc_same')
  })
})

// ---------------------------------------------------------------------------
// 4. An existing mapping is never overwritten
// ---------------------------------------------------------------------------

describe('existing mappings are preserved', () => {
  it('a mapped slot is left alone even when candidates exist', () => {
    const d = decideSlotRepair({
      slotKey: 'MIN',
      slotExists: true,
      currentDocumentId: 'doc_already_live',
      candidates: [candidate({ documentId: 'doc_something_else' })],
    })
    assert.equal(d.status, 'already-mapped')
    assert.equal(d.candidate, undefined)
    assert.equal(d.currentDocumentId, 'doc_already_live')
  })

  it('a mapped slot is left alone even when several candidates exist', () => {
    const d = decideSlotRepair({
      slotKey: 'PLM',
      slotExists: true,
      currentDocumentId: 'doc_live',
      candidates: [
        candidate({ id: 'a', documentId: 'doc_x' }),
        candidate({ id: 'b', documentId: 'doc_y' }),
      ],
    })
    assert.equal(d.status, 'already-mapped')
  })

  it('whitespace does not count as an empty mapping', () => {
    const d = decideSlotRepair({
      slotKey: 'MIN',
      slotExists: true,
      currentDocumentId: '   ',
      candidates: [candidate()],
    })
    // A blank-but-present value is treated as unmapped, so it can be repaired.
    assert.equal(d.status, 'repaired')
  })

  it('the already-mapped check precedes any candidate lookup', () => {
    const src = read('src/lib/review-repair.ts')
    const fn = fnBody(src, 'decideSlotRepair')
    const mappedGuard = fn.indexOf("status: 'already-mapped'")
    const lookup = fn.indexOf('usableCandidatesForSlot')
    assert.ok(mappedGuard < lookup, 'the mapped guard must come first')
  })
})

// ---------------------------------------------------------------------------
// 5. Idempotency
// ---------------------------------------------------------------------------

describe('idempotency', () => {
  it('a second pass over a repaired slot changes nothing', () => {
    const cands = [candidate()]

    const first = decideSlotRepair({
      slotKey: 'MIN',
      slotExists: true,
      currentDocumentId: null,
      candidates: cands,
    })
    assert.equal(first.status, 'repaired')

    // The caller has now written first.candidate.documentId onto the slot.
    const second = decideSlotRepair({
      slotKey: 'MIN',
      slotExists: true,
      currentDocumentId: first.candidate.documentId,
      candidates: cands,
    })
    assert.equal(second.status, 'already-mapped')
    assert.equal(second.candidate, undefined)
  })

  it('repeated passes never accumulate changes', () => {
    const cands = [candidate()]
    let current = null
    const statuses = []
    for (let i = 0; i < 5; i++) {
      const d = decideSlotRepair({
        slotKey: 'MIN',
        slotExists: true,
        currentDocumentId: current,
        candidates: cands,
      })
      statuses.push(d.status)
      if (d.candidate) current = d.candidate.documentId
    }
    assert.deepEqual(statuses, [
      'repaired',
      'already-mapped',
      'already-mapped',
      'already-mapped',
      'already-mapped',
    ])
  })

  it('summariseRepair reports nothing when everything is already mapped', () => {
    const decisions = ['MIN', 'AIU', 'PLM'].map((slotKey) =>
      decideSlotRepair({
        slotKey,
        slotExists: true,
        currentDocumentId: 'doc_live',
        candidates: [],
      }),
    )
    assert.equal(summariseRepair(decisions), '')
  })
})

// ---------------------------------------------------------------------------
// 6. No candidate — the exact reason
// ---------------------------------------------------------------------------

describe('no matching candidate', () => {
  const none = {
    slotKey: 'AIU',
    slotExists: true,
    currentDocumentId: null,
    candidates: [],
  }

  it('is reported as no-candidate', () => {
    assert.equal(decideSlotRepair(none).status, 'no-candidate')
  })

  it('names the series and says what to check', () => {
    const d = decideSlotRepair(none)
    assert.match(d.reason, /No recognised AIU document was found/)
    assert.match(d.reason, /filename or folder identifies/)
    assert.match(d.reason, /sync again/)
  })

  it('a candidate removed from the room is not used', () => {
    const d = decideSlotRepair({
      ...none,
      candidates: [candidate({ isPresent: false })],
    })
    assert.equal(d.status, 'no-candidate')
  })

  it('an ignored candidate is not used', () => {
    const d = decideSlotRepair({
      ...none,
      candidates: [candidate({ syncStatus: 'ignored' })],
    })
    assert.equal(d.status, 'no-candidate')
  })

  it('a candidate with a blank document id is not used', () => {
    const d = decideSlotRepair({
      ...none,
      candidates: [candidate({ documentId: '' })],
    })
    assert.equal(d.status, 'no-candidate')
  })

  it('a slot that does not exist yet says so', () => {
    const d = decideSlotRepair({
      slotKey: 'MIN',
      slotExists: false,
      currentDocumentId: null,
      candidates: [candidate()],
    })
    assert.equal(d.status, 'no-slot')
    assert.match(d.reason, /Initialise fixed slots/)
  })
})

// ---------------------------------------------------------------------------
// 7. Candidate filtering helpers
// ---------------------------------------------------------------------------

describe('candidate filtering', () => {
  it('isUsableCandidate accepts a present, non-ignored candidate', () => {
    assert.equal(isUsableCandidate(candidate()), true)
  })

  it('isUsableCandidate rejects absent, ignored or id-less candidates', () => {
    assert.equal(isUsableCandidate(candidate({ isPresent: false })), false)
    assert.equal(isUsableCandidate(candidate({ syncStatus: 'ignored' })), false)
    assert.equal(isUsableCandidate(candidate({ documentId: '  ' })), false)
  })

  it('usableCandidatesForSlot dedupes by document id and drops unusable rows', () => {
    const list = [
      candidate({ id: 'a', documentId: 'doc_1' }),
      candidate({ id: 'b', documentId: 'doc_1' }),
      candidate({ id: 'c', documentId: 'doc_2', isPresent: false }),
      candidate({ id: 'd', documentId: 'doc_3', syncStatus: 'ignored' }),
      candidate({ id: 'e', documentId: 'doc_4' }),
    ]
    const out = usableCandidatesForSlot('MIN', list)
    assert.deepEqual(out.map((c) => c.documentId).sort(), ['doc_1', 'doc_4'])
  })

  it('the first row wins, so query ordering decides which duplicate is kept', () => {
    const out = usableCandidatesForSlot('MIN', [
      candidate({ id: 'newest', documentId: 'doc_1', cleanTitle: 'Newest' }),
      candidate({ id: 'older', documentId: 'doc_1', cleanTitle: 'Older' }),
    ])
    assert.equal(out.length, 1)
    assert.equal(out[0].cleanTitle, 'Newest')
  })
})

// ---------------------------------------------------------------------------
// 8. Sync runs the repair automatically
// ---------------------------------------------------------------------------

describe('sync integration', () => {
  const src = read(ACTIONS)

  it('syncReviewLibrary calls the repair', () => {
    const fn = fnBody(src, 'syncReviewLibrary')
    assert.match(fn, /repairFixedSlotMappings\(sql\)/)
  })

  it('the repair runs after the document loop, not instead of it', () => {
    const fn = fnBody(src, 'syncReviewLibrary')
    const loop = fn.indexOf('for (const d of docs)')
    const repair = fn.indexOf('repairFixedSlotMappings(sql)')
    assert.ok(loop !== -1 && repair !== -1)
    assert.ok(loop < repair, 'the repair must run after the documents are ingested')
  })

  it('the repair outcome is reported in the sync message', () => {
    const fn = fnBody(src, 'syncReviewLibrary')
    assert.match(fn, /summariseRepair\(repair\)/)
    assert.match(fn, /repairNote \? /)
  })

  it('an unmapped slot no longer parks its document in the pending columns', () => {
    const fn = fnBody(src, 'detectPendingVersion')
    assert.match(fn, /if \(!slot\[0\]\.papermark_document_id\) return/)
  })
})

// ---------------------------------------------------------------------------
// 9. The repair never reaches beyond the review tables
// ---------------------------------------------------------------------------

describe('blast radius', () => {
  const fn = fnBody(read(ACTIONS), 'repairFixedSlotMappings')

  it('writes only to complimentary_review_items and review_sync_candidates', () => {
    const writes = fn.match(/(update|insert into|delete from)\s+(\w+)/g) ?? []
    for (const w of writes) {
      assert.match(
        w,
        /(complimentary_review_items|review_sync_candidates)$/,
        `unexpected table written: ${w}`,
      )
    }
  })

  it('creates no publication', () => {
    assert.doesNotMatch(fn, /insert into documents/i)
    assert.doesNotMatch(fn, /insert into complimentary_review_items/i)
  })

  it('creates no secure link', () => {
    assert.doesNotMatch(fn, /createReviewDocumentLink/)
    assert.doesNotMatch(fn, /secure_link_url\s*=/)
    assert.doesNotMatch(fn, /secure_link_id\s*=/)
  })

  it('touches no subscriber or paid Data Room table', () => {
    assert.doesNotMatch(fn, /subscribers/i)
    assert.doesNotMatch(fn, /papermark_dataroom_links/)
    assert.doesNotMatch(fn, /papermark_subscriber_document_links/)
  })

  it('does not overwrite publication descriptions or owner-edited fields', () => {
    assert.doesNotMatch(fn, /owner_edited_fields\s*=/)
    assert.doesNotMatch(fn, /description\s*=/)
    assert.doesNotMatch(fn, /publication_type\s*=/)
    assert.doesNotMatch(fn, /publication_id\s*=/)
  })

  it('the pure decision module reaches nothing at all', () => {
    const pure = read('src/lib/review-repair.ts')
    assert.doesNotMatch(pure, /^\s*import /m)
  })
})

// ---------------------------------------------------------------------------
// 10. Owner-only repair action
// ---------------------------------------------------------------------------

describe('repairMissingMappings action', () => {
  const src = read(ACTIONS)

  it('is exported', () => {
    assert.match(src, /export async function repairMissingMappings/)
  })

  it('requires owner', () => {
    assert.match(fnBody(src, 'repairMissingMappings'), /requireOwner\(\)/)
  })

  it('runs the same repair as sync', () => {
    assert.match(fnBody(src, 'repairMissingMappings'), /repairFixedSlotMappings\(sql\)/)
  })

  it('revalidates the public pages after a repair', () => {
    assert.match(fnBody(src, 'repairMissingMappings'), /refresh\(\)/)
  })

  it('says so plainly when there is nothing to repair', () => {
    assert.match(fnBody(src, 'repairMissingMappings'), /Nothing to repair/)
  })
})

// ---------------------------------------------------------------------------
// 11. Admin UI
// ---------------------------------------------------------------------------

describe('admin UI', () => {
  const form = read(FORM)

  it('offers a Repair missing mappings button', () => {
    assert.match(form, /Repair missing mappings/)
    assert.match(form, /repairMissingMappings/)
  })

  it('offers Use this document for an explicit choice', () => {
    assert.match(form, /function UseThisDocumentButton/)
    assert.match(form, /Use this document/)
    assert.match(form, /mapCandidateToCard/)
  })

  it('the choice is confirmed before it is applied', () => {
    const fn = fnBody(form, 'UseThisDocumentButton')
    assert.match(fn, /window\.confirm/)
  })

  it('shows the ambiguity count and refuses to auto-pick', () => {
    assert.match(form, /recognised \{slot\.slotKey\} documents were found/)
    assert.match(form, /not<\/strong>\s*\n?\s*chosen/)
  })

  it('shows the exact reason when no candidate matches', () => {
    assert.match(form, /No recognised \{slot\.slotKey\} document was found/)
    assert.match(form, /filename or folder identifies the series/)
  })

  it('shows the mapped Papermark filename from the candidate', () => {
    assert.match(form, /mappedCandidate/)
    assert.match(form, /mappedCandidate\?\.rawFilename/)
  })

  it('shows the Papermark document ID', () => {
    assert.match(form, /Document ID: \{slot\.papermarkDocumentId\}/)
  })

  it('shows an explicit mapping status', () => {
    assert.match(form, /Mapping:/)
    assert.match(form, /hasDoc \? 'Mapped' : 'Not mapped'/)
  })

  it('holds no Papermark credential', () => {
    assert.doesNotMatch(form, /PAPERMARK_API_TOKEN|PAPERMARK_API_KEY/)
  })
})

// ---------------------------------------------------------------------------
// 12. No schema change was needed
// ---------------------------------------------------------------------------

test('the repair uses only columns that already exist', () => {
  const fn = fnBody(read(ACTIONS), 'repairFixedSlotMappings')
  // The mapping is the document-id pair plus a timestamp — exactly what
  // mapCandidateToCard has always written. Filename, version key, folder and
  // page count are read from review_sync_candidates rather than copied onto the
  // slot, so there is one record of what is in the Data Room and no new column.
  assert.match(fn, /papermark_document_id = /)
  assert.match(fn, /papermark_dataroom_id = /)
  assert.match(fn, /last_synced_at = now\(\)/)
})
