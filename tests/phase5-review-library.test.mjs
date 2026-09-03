import { describe, it, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

// ---------------------------------------------------------------------------
// 1. Fixed slots
// ---------------------------------------------------------------------------

describe('fixed review slots', () => {
  const prefill = read('src/lib/review-prefill.ts')

  it('APPROVED_CARDS defines exactly three entries: MIN, AIU, PLM', () => {
    assert.match(prefill, /MIN:\s*\{/)
    assert.match(prefill, /AIU:\s*\{/)
    assert.match(prefill, /PLM:\s*\{/)
    const keys = [...prefill.matchAll(/^\s+(\w{3}):\s*\{/gm)].map((m) => m[1])
    const approvedOnly = keys.filter((k) => ['MIN', 'AIU', 'PLM'].includes(k))
    assert.equal(approvedOnly.length, 3)
  })

  it('review-library actions define FIXED_SLOTS = MIN, AIU, PLM', () => {
    const src = read('src/app/actions/review-library.ts')
    assert.match(src, /FIXED_SLOTS\s*=\s*\['MIN',\s*'AIU',\s*'PLM'\]/)
  })

  it('SLOT_ORDER is MIN=0, AIU=1, PLM=2', () => {
    const src = read('src/app/actions/review-library.ts')
    assert.match(src, /MIN:\s*0/)
    assert.match(src, /AIU:\s*1/)
    assert.match(src, /PLM:\s*2/)
  })
})

// ---------------------------------------------------------------------------
// 2. Approved titles, types, descriptions
// ---------------------------------------------------------------------------

describe('approved display content', () => {
  const prefill = read('src/lib/review-prefill.ts')

  it('MIN has correct publication type', () => {
    assert.match(prefill, /MIN:[\s\S]*?publicationType:\s*'Monthly Intelligence Note'/)
  })

  it('AIU has correct publication type', () => {
    assert.match(prefill, /AIU:[\s\S]*?publicationType:\s*'Periodic Focused Briefing'/)
  })

  it('PLM has correct publication type', () => {
    // Corrected by the Chancellor: the PLM is presented under the Athena
    // Election Observatory rather than as a generic strategic assessment.
    assert.match(prefill, /PLM:[\s\S]*?publicationType:\s*'ATHENA ELECTION OBSERVATORY'/)
  })

  it('MIN description mentions political, regulatory and political-economy', () => {
    assert.match(prefill, /MIN:[\s\S]*?description:[\s\S]*?political, regulatory and political-economy/)
  })

  it('AIU description mentions focused intelligence update', () => {
    assert.match(prefill, /AIU:[\s\S]*?description:[\s\S]*?focused intelligence update/)
  })

  it('PLM description mentions democratic, electoral and political landscape', () => {
    assert.match(prefill, /PLM:[\s\S]*?description:[\s\S]*?democratic, electoral and political landscape/)
  })
})

// ---------------------------------------------------------------------------
// 3. Per-card secure links (not Data Room homepage)
// ---------------------------------------------------------------------------

describe('per-card secure document links', () => {
  const pubPage = read('src/app/publications/page.tsx')

  it('each card uses card.secureUrl for the link', () => {
    assert.match(pubPage, /card\.secureUrl/)
  })

  it('no "Enter Secure Review Library" button exists', () => {
    assert.doesNotMatch(pubPage, /Enter Secure Review Library/)
  })

  it('no generic Data Room homepage CTA', () => {
    assert.doesNotMatch(pubPage, /library\.papermarkUrl/)
  })

  it('publications page has per-card Access review copy button', () => {
    assert.match(pubPage, /Access review copy/)
  })

  it('getReviewLibrary returns secureUrl per card', () => {
    const src = read('src/lib/publications.ts')
    assert.match(src, /secureUrl:\s*r\.secure_link_url/)
  })

  it('getReviewLibrary requires all 3 slots have secure_link_url', () => {
    const src = read('src/lib/publications.ts')
    assert.match(src, /items\.length !== 3.*return null/s)
    assert.match(src, /secure_link_url <> ''/)
  })
})

// ---------------------------------------------------------------------------
// 4. No "Open Edition" in public pages
// ---------------------------------------------------------------------------

describe('no Open Edition wording', () => {
  it('publications page does not say Open Edition', () => {
    const src = read('src/app/publications/page.tsx')
    assert.doesNotMatch(src, /Open Edition/i)
  })

  it('home page does not say Open Edition', () => {
    const src = read('src/app/page.tsx')
    assert.doesNotMatch(src, /Open Edition/i)
  })
})

// ---------------------------------------------------------------------------
// 5. /complimentary-review remains absent
// ---------------------------------------------------------------------------

test('/complimentary-review route does not exist', () => {
  const dir = join(ROOT, 'src/app/complimentary-review')
  assert.equal(existsSync(dir), false)
  const altDir = join(ROOT, 'src/app/(public)/complimentary-review')
  assert.equal(existsSync(altDir), false)
})

// ---------------------------------------------------------------------------
// 6. Prospect watermark policy
// ---------------------------------------------------------------------------

describe('prospect watermark policy', () => {
  const contract = read('src/lib/papermark-dataroom-contract.ts')

  it('prospect watermark text is preserved in the contract comments', () => {
    assert.doesNotMatch(contract, /prospect.*watermark.*IP/i)
  })

  it('subscriber watermark uses Subscriber Edition format', () => {
    assert.match(contract, /APRI Subscriber Edition/)
  })

  it('subscriberWatermarkText does not include IP address', () => {
    assert.doesNotMatch(contract, /subscriberWatermarkText[\s\S]*?\{\{ipAddress\}\}/)
  })
})

// ---------------------------------------------------------------------------
// 7. Prospect links excluded from subscriber watermark updates
// ---------------------------------------------------------------------------

describe('watermark update exclusion', () => {
  const actions = read('src/app/actions/datarooms.ts')

  it('previewSubscriberWatermarkUpdate reads prospect Data Room ID', () => {
    assert.match(actions, /review_library_papermark_dataroom_id/)
  })

  it('prospect links are excluded from eligible links', () => {
    assert.match(actions, /Prospect|prospect/)
  })

  it('prospect document links are NOT in papermark_dataroom_links', () => {
    const reviewActions = read('src/app/actions/review-library.ts')
    assert.doesNotMatch(reviewActions, /papermark_dataroom_links/)
    assert.doesNotMatch(reviewActions, /papermark_subscriber_document_links/)
  })
})

// ---------------------------------------------------------------------------
// 8. Admin: generate details fills blanks only
// ---------------------------------------------------------------------------

describe('admin detail generation', () => {
  const actions = read('src/app/actions/review-library.ts')

  it('generateSlotDetails checks owner_edited_fields before filling', () => {
    assert.match(actions, /edited\.has/)
  })

  it('generateSlotDetails only fills empty fields', () => {
    assert.match(actions, /!item\.publication_type && !edited\.has/)
  })

  it('saveReviewItemDetails tracks owner-edited fields', () => {
    assert.match(actions, /editedFields/)
    assert.match(actions, /owner_edited_fields/)
  })
})

// ---------------------------------------------------------------------------
// 9. Missing editorial fields are named
// ---------------------------------------------------------------------------

describe('editorial completeness shows specific fields', () => {
  const page = read('src/app/admin/datarooms/page.tsx')

  it('shows "Missing:" with specific field names', () => {
    assert.match(page, /Missing:.*doc\.missingFields/)
  })

  it('DAL returns missingFields array', () => {
    const dal = read('src/lib/dataroom-dal.ts')
    assert.match(dal, /missingFields: missing/)
  })

  it('missing fields include Editorial title and One-line summary', () => {
    const dal = read('src/lib/dataroom-dal.ts')
    assert.match(dal, /Editorial title/)
    assert.match(dal, /One-line summary/)
    assert.match(dal, /Linked publication/)
  })
})

// ---------------------------------------------------------------------------
// 10. Per-document Generate missing details button
// ---------------------------------------------------------------------------

describe('per-document generate missing details', () => {
  const form = read('src/app/admin/datarooms/dataroom-form.tsx')

  it('GenerateDocumentDetailsButton component exists', () => {
    assert.match(form, /GenerateDocumentDetailsButton/)
  })

  it('calls generateMissingDetailsForDocument action', () => {
    assert.match(form, /generateMissingDetailsForDocument/)
  })

  it('page imports and uses GenerateDocumentDetailsButton', () => {
    const page = read('src/app/admin/datarooms/page.tsx')
    assert.match(page, /GenerateDocumentDetailsButton/)
  })
})

// ---------------------------------------------------------------------------
// 11. Duplicate publication detection
// ---------------------------------------------------------------------------

describe('duplicate publication handling', () => {
  const dal = read('src/lib/dataroom-dal.ts')

  it('findCanonicalMatch checks papermark_document_id first', () => {
    assert.match(dal, /papermark_document_id/)
  })

  it('insertWithSafeSlug generates -2, -3 suffixes', () => {
    assert.match(dal, /baseSlug.*-.*attempt/)
  })

  it('insertWithSafeSlug catches unique constraint violations', () => {
    assert.match(dal, /23505/)
  })
})

// ---------------------------------------------------------------------------
// 12. Sync never publishes or sends emails
// ---------------------------------------------------------------------------

describe('sync safety', () => {
  const actions = read('src/app/actions/review-library.ts')

  it('backgroundReviewSync never calls revalidatePath', () => {
    const bgSync = actions.slice(actions.indexOf('async function backgroundReviewSync'))
    assert.doesNotMatch(bgSync, /revalidatePath/)
  })

  it('syncReviewLibrary does not send emails', () => {
    assert.doesNotMatch(actions, /sendEmail|resend|Resend/)
  })

  it('sync does not auto-approve candidates', () => {
    const bgSync = actions.slice(actions.indexOf('async function backgroundReviewSync'))
    assert.doesNotMatch(bgSync, /sync_status = 'approved'/)
  })
})

// ---------------------------------------------------------------------------
// 13. Owner confirmation for Make current
// ---------------------------------------------------------------------------

describe('owner approval for version changes', () => {
  const form = read('src/app/admin/review-library/review-form.tsx')

  it('makeVersionCurrent is owner-gated', () => {
    const actions = read('src/app/actions/review-library.ts')
    const fn = actions.slice(actions.indexOf('async function makeVersionCurrent'))
    assert.match(fn, /requireOwner/)
  })

  it('admin UI has Make current button with confirmation', () => {
    assert.match(form, /Make current/)
    assert.match(form, /window\.confirm/)
  })
})

// ---------------------------------------------------------------------------
// 14. No updateAllWatermarks (Phase 4 removal preserved)
// ---------------------------------------------------------------------------

test('updateAllWatermarks is not exported', () => {
  const actions = read('src/app/actions/datarooms.ts')
  assert.doesNotMatch(actions, /export.*async.*function.*updateAllWatermarks/)
})

// ---------------------------------------------------------------------------
// 15. Secure link storage
// ---------------------------------------------------------------------------

describe('secure link storage', () => {
  it('complimentary_review_items has secure_link_url column', () => {
    const migration = read('db/migrations/20260902_review_library_fixed_slots.sql')
    assert.match(migration, /secure_link_url/)
  })

  it('complimentary_review_items has slot_key column', () => {
    const migration = read('db/migrations/20260902_review_library_fixed_slots.sql')
    assert.match(migration, /slot_key/)
  })

  it('slot_key has unique index', () => {
    const migration = read('db/migrations/20260902_review_library_fixed_slots.sql')
    assert.match(migration, /cri_slot_key_idx/)
  })
})

// ---------------------------------------------------------------------------
// 16. Pending version tracking
// ---------------------------------------------------------------------------

describe('pending version workflow', () => {
  const migration = read('db/migrations/20260902_review_library_fixed_slots.sql')

  it('migration adds pending_papermark_document_id', () => {
    assert.match(migration, /pending_papermark_document_id/)
  })

  it('migration adds pending_clean_title', () => {
    assert.match(migration, /pending_clean_title/)
  })

  it('admin shows pending version info', () => {
    const form = read('src/app/admin/review-library/review-form.tsx')
    assert.match(form, /Pending edition/)
    assert.match(form, /pendingCleanTitle/)
  })
})

// ---------------------------------------------------------------------------
// 17. Review library enable validation
// ---------------------------------------------------------------------------

describe('library enable validation', () => {
  const actions = read('src/app/actions/review-library.ts')

  it('saveReviewLibrarySettings checks all 3 slots have secure links', () => {
    assert.match(actions, /secure_link_url/)
    assert.match(actions, /Cannot enable/)
  })

  it('saveReviewLibrarySettings checks all 3 slots have mapped documents', () => {
    assert.match(actions, /publication_id/)
    assert.match(actions, /no mapped document/)
  })
})

// ---------------------------------------------------------------------------
// 18. Three-column responsive layout
// ---------------------------------------------------------------------------

test('publications page uses 3-column grid', () => {
  const src = read('src/app/publications/page.tsx')
  assert.match(src, /grid-cols-1 md:grid-cols-3/)
})

// ---------------------------------------------------------------------------
// 19. Admin review library: no Add/Reorder sections
// ---------------------------------------------------------------------------

describe('simplified admin', () => {
  const form = read('src/app/admin/review-library/review-form.tsx')

  it('no AddItemSection component', () => {
    assert.doesNotMatch(form, /function AddItemSection/)
  })

  it('no ReorderSection component', () => {
    assert.doesNotMatch(form, /function ReorderSection/)
  })

  it('no addReviewItem import', () => {
    assert.doesNotMatch(form, /addReviewItem/)
  })

  it('no removeReviewItem import', () => {
    assert.doesNotMatch(form, /removeReviewItem/)
  })

  it('no reorderReviewItems import', () => {
    assert.doesNotMatch(form, /reorderReviewItems/)
  })

  it('SlotCard component exists for each fixed slot', () => {
    assert.match(form, /function SlotCard/)
    assert.match(form, /SLOT_LABELS/)
  })
})

// ---------------------------------------------------------------------------
// 20. Legacy audit protects review slot publications
// ---------------------------------------------------------------------------

test('legacy audit checks complimentary_review_items by publication_id', () => {
  const actions = read('src/app/actions/datarooms.ts')
  const auditFn = actions.slice(actions.indexOf('async function auditLegacyOpenEditions'))
  assert.match(auditFn, /publication_id = \$\{doc\.id\}/)
  assert.match(auditFn, /complimentary_review_items/)
})

// ---------------------------------------------------------------------------
// 21. No API tokens in client code
// ---------------------------------------------------------------------------

test('PAPERMARK_API_TOKEN not in review-form.tsx', () => {
  const form = read('src/app/admin/review-library/review-form.tsx')
  assert.doesNotMatch(form, /PAPERMARK_API_TOKEN/)
})

test('PAPERMARK_API_TOKEN not in publications page', () => {
  const src = read('src/app/publications/page.tsx')
  assert.doesNotMatch(src, /PAPERMARK_API_TOKEN/)
})

// ---------------------------------------------------------------------------
// 22. Secure link update action
// ---------------------------------------------------------------------------

describe('updateSlotSecureLink action', () => {
  const actions = read('src/app/actions/review-library.ts')

  it('is exported', () => {
    assert.match(actions, /export async function updateSlotSecureLink/)
  })

  it('requires owner', () => {
    const fn = actions.slice(actions.indexOf('async function updateSlotSecureLink'))
    assert.match(fn, /requireOwner/)
  })

  it('validates HTTPS URL', () => {
    const fn = actions.slice(actions.indexOf('async function updateSlotSecureLink'))
    assert.match(fn, /https:\/\//)
  })

  it('validates slot key', () => {
    const fn = actions.slice(actions.indexOf('async function updateSlotSecureLink'))
    assert.match(fn, /FIXED_SLOTS\.includes/)
  })
})

// ---------------------------------------------------------------------------
// 23. No IP address in watermarks or public pages
// ---------------------------------------------------------------------------

describe('no IP in watermarks or public UI', () => {
  it('subscriberWatermarkText has no IP', () => {
    const contract = read('src/lib/papermark-dataroom-contract.ts')
    const fn = contract.slice(contract.indexOf('function subscriberWatermarkText'), contract.indexOf('function subscriberWatermarkText') + 500)
    assert.doesNotMatch(fn, /ipAddress/)
    assert.doesNotMatch(fn, /\{\{ip/)
  })

  it('publications page has no IP reference', () => {
    const src = read('src/app/publications/page.tsx')
    assert.doesNotMatch(src, /ipAddress/i)
    assert.doesNotMatch(src, /IP address/i)
  })
})

// ---------------------------------------------------------------------------
// 24. Review library type exports
// ---------------------------------------------------------------------------

test('ReviewCard type includes secureUrl', () => {
  const src = read('src/lib/publications.ts')
  assert.match(src, /secureUrl: string/)
})

test('ReviewLibrary type does not have papermarkUrl', () => {
  const src = read('src/lib/publications.ts')
  const typeBlock = src.slice(src.indexOf('export type ReviewLibrary'), src.indexOf('export type ReviewLibrary') + 200)
  assert.doesNotMatch(typeBlock, /papermarkUrl/)
})
