/**
 * Per-edition Complimentary Review recipients.
 *
 * Every Complimentary Review edition is its own Papermark link, and its URL is
 * deliberately public, so the link's allow list is the only thing deciding who
 * can open it. These tests prove the rules that keep each edition's list
 * independent and fail-closed:
 *
 *  - the decisions themselves, run directly (src/lib/edition-recipients.ts);
 *  - the properties only the source can show: who is allowed to write, what
 *    each action touches, and what never reaches a public response.
 *
 * Written on the assumption that an attacker can read this repository: nothing
 * here relies on a route or value being hidden.
 */

import { describe, it, test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

import {
  decideAdoption,
  decideApply,
  decideLinkPreparation,
  decideProspectGrant,
  decideRecipientSave,
  decideAddressBookChange,
  listNames,
  MIGRATION_PENDING_MESSAGE,
  planEditionGrant,
  diffRecipients,
  evaluateReadBack,
  expectedRecipientsFor,
  normaliseRecipientList,
  prospectCanSeeEdition,
  recipientListHash,
  recipientStatus,
  sameRecipientSet,
  isValidRecipient as editionIsValid,
  MAX_RECIPIENTS as EDITION_MAX,
} from "../src/lib/edition-recipients.ts"
import {
  MAX_RECIPIENTS,
  isValidRecipient as bookIsValid,
} from "../src/lib/review-recipients.ts"

const ROOT = resolve(import.meta.dirname, "..")
const read = (p) => readFileSync(join(ROOT, p), "utf8")

const MIGRATION = "db/migrations/20260928_review_edition_recipients.sql"
const ACCESS = "src/app/actions/review-edition-access.ts"
const LIBRARY = "src/app/actions/review-library.ts"
const FUNNEL = "src/app/actions/review-funnel.ts"
const DAL = "src/lib/edition-recipients-dal.ts"
const PUBLICATIONS = "src/lib/publications.ts"

/**
 * From `export async function NAME(` to the lone closing brace of its body.
 *
 * A lone `}` line, not merely a line starting with `}`: a multi-line signature
 * such as `fn(args: {\n...\n}): Promise<...>` closes its type literal at column
 * 0 too, and must not be mistaken for the end of the function.
 */
function body(src, name) {
  const start = src.search(new RegExp(`(export )?async function ${name}\\(`))
  assert.notEqual(start, -1, `${name} must exist`)
  const rest = src.slice(start)
  const end = rest.search(/\n\}[ \t]*(\r?\n|$)/)
  assert.notEqual(end, -1, `${name} must have a closing brace`)
  return rest.slice(0, end + 2)
}

/** Every file under a directory, recursively. */
function walk(dir) {
  const out = []
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel))
    else out.push(rel)
  }
  return out
}

const LIVE_OK = (allowList, extra = {}) => ({
  ok: true,
  documentId: "doc_sept_min",
  allowList,
  policyProblem: null,
  ...extra,
})

// ===========================================================================
// 1. The migration
// ===========================================================================

describe("migration", () => {
  const mig = read(MIGRATION)
  const code = mig
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n")

  it("runs as one transaction", () => {
    assert.match(code, /^begin;$/m)
    assert.match(code, /^commit;$/m)
  })

  it("is additive: creates, adds and indexes only when absent", () => {
    assert.match(code, /create table if not exists review_edition_recipients/)
    for (const col of [
      "recipient_mode",
      "recipients_verified_hash",
      "recipients_verified_at",
      "recipients_applied_at",
      "recipients_adopted_at",
      "recipients_adopted_by",
    ]) {
      assert.match(code, new RegExp(`add column if not exists ${col}\\b`), col)
    }
    const indexes = code.match(/create (unique )?index/g) ?? []
    const guarded = code.match(/create (unique )?index if not exists/g) ?? []
    assert.equal(indexes.length, guarded.length)
  })

  it("contains nothing destructive", () => {
    for (const bad of [/\bdrop\b/i, /\btruncate\b/i, /delete from/i, /alter column \w+ type/i]) {
      assert.doesNotMatch(code, bad)
    }
  })

  it("classifies existing rows exactly once, so a re-run cannot undo an adoption", () => {
    const update = code.slice(code.indexOf("update review_publication_editions"), code.indexOf("alter column recipient_mode set not null"))
    assert.match(update, /where recipient_mode is null/)
  })

  it("keeps every already-published, linked edition on its existing checks", () => {
    assert.match(code, /when publication_state = 'published'\s+and secure_link_id is not null\s+and secure_link_url <> ''\s+then 'shared_legacy'/)
    assert.match(code, /else 'edition'/)
  })

  it("makes every new or synced edition fail-closed by default", () => {
    const setDefault = code.indexOf("set default 'edition'")
    const classify = code.indexOf("update review_publication_editions")
    const notNull = code.indexOf("set not null")
    assert.ok(setDefault !== -1 && setDefault < classify, "the default must be set before classification")
    assert.ok(classify < notNull, "NOT NULL comes after every row is classified")
  })

  it("seeds no recipients and never reads the shared APRI list", () => {
    assert.doesNotMatch(code, /insert into review_edition_recipients/)
    assert.doesNotMatch(code, /review_approved_recipients|app_settings/)
  })

  it("allows one active grant per address per edition, keeping revoked history", () => {
    assert.match(code, /create unique index if not exists review_edition_recipients_active_key\s+on review_edition_recipients \(edition_id, email\)\s+where revoked_at is null/)
  })

  it("stores addresses only in normalised form", () => {
    assert.match(code, /check \(email = lower\(btrim\(email\)\)/)
  })

  it("restricts modes and sources to the known values", () => {
    assert.match(code, /check \(recipient_mode in \('shared_legacy', 'edition'\)\)/)
    assert.match(code, /check \(source in \('adopted', 'owner', 'prospect_grant'\)\)/)
  })

  it("protects the audit trail from edition deletion", () => {
    assert.match(code, /references review_publication_editions \(id\) on delete restrict/)
  })

  it("runs through psql unchanged: no DO blocks or dollar-quoted bodies", () => {
    assert.doesNotMatch(code, /\$\$/)
    assert.doesNotMatch(code, /\bdo\b\s*\$/i)
  })
})

// ===========================================================================
// 1b. The mirrored address validator cannot drift from the original
// ===========================================================================

describe("address validator mirror", () => {
  const pattern = (f) => {
    const m = /^const EMAIL_RE = (\/.+\/)$/m.exec(read(f))
    assert.ok(m, `${f} must define EMAIL_RE`)
    return m[1]
  }

  it("uses the identical pattern", () => {
    assert.equal(pattern("src/lib/edition-recipients.ts"), pattern("src/lib/review-recipients.ts"))
  })

  it("uses the identical limits", () => {
    assert.equal(EDITION_MAX, MAX_RECIPIENTS)
    const len = (f) => /^const MAX_EMAIL_LENGTH = (\d+)$/m.exec(read(f))?.[1]
    assert.equal(len("src/lib/edition-recipients.ts"), len("src/lib/review-recipients.ts"))
  })

  it("accepts and rejects exactly the same addresses", () => {
    const corpus = [
      "reader@example.org", "A.B+tag@example.co.uk", " padded@example.org ", "UPPER@EXAMPLE.ORG",
      "", " ", "no-at-sign", "@example.org", "a@", "a@b", "a b@example.org", "a@@example.org",
      "a@-example.org", "a@example-.org", "a..b@example.org", ".a@example.org", "a.@example.org",
      `${"a".repeat(250)}@example.org`, "a@example.o", "first.last@sub.example.org",
    ]
    for (const address of corpus) {
      assert.equal(editionIsValid(address), bookIsValid(address), JSON.stringify(address))
    }
  })
})

// ===========================================================================
// 2. Normalisation and fingerprints
// ===========================================================================

describe("normalisation and fingerprints", () => {
  it("lower-cases, trims, de-duplicates and sorts", () => {
    const r = normaliseRecipientList([" B@example.org ", "a@example.org", "b@example.org"])
    assert.deepEqual(r.emails, ["a@example.org", "b@example.org"])
    assert.deepEqual(r.invalid, [])
  })

  it("sets aside a domain rule rather than treating it as one person", () => {
    const r = normaliseRecipientList(["@example.org", "a@example.org"])
    assert.deepEqual(r.emails, ["a@example.org"])
    assert.deepEqual(r.invalid, ["@example.org"])
  })

  it("fingerprints are independent of order and case", () => {
    assert.equal(recipientListHash(["a@example.org", "B@example.org"]), recipientListHash(["b@example.org", "a@example.org"]))
  })

  it("different lists have different fingerprints", () => {
    assert.notEqual(recipientListHash(["a@example.org"]), recipientListHash(["a@example.org", "b@example.org"]))
    assert.notEqual(recipientListHash([]), recipientListHash(["a@example.org"]))
  })

  it("set comparison ignores order, case and duplicates", () => {
    assert.equal(sameRecipientSet(["a@example.org", "A@example.org"], ["a@example.org"]), true)
    assert.equal(sameRecipientSet(["a@example.org"], ["b@example.org"]), false)
  })
})

// ===========================================================================
// 3. Independent lists
// ===========================================================================

describe("each edition's list is independent", () => {
  const editionA = ["alice@example.org", "bob@example.org"]
  const editionB = ["carol@example.org"]

  it("a change to one edition is computed against that edition alone", () => {
    const change = decideRecipientSave({ mode: "edition", hasLink: true, current: editionA, proposed: [...editionA, "dan@example.org"] })
    assert.equal(change.ok, true)
    assert.deepEqual(change.toAdd, ["dan@example.org"])
    assert.deepEqual(change.toRevoke, [])
    // Edition B's list played no part and is not mentioned.
    assert.ok(!change.emails.includes("carol@example.org"))
  })

  it("the same address can be on one edition and not another", () => {
    const common = { sharedRecipients: [] }
    assert.equal(prospectCanSeeEdition({ ...common, mode: "edition", prospectEmail: "alice@example.org", editionRecipients: editionA }), true)
    assert.equal(prospectCanSeeEdition({ ...common, mode: "edition", prospectEmail: "alice@example.org", editionRecipients: editionB }), false)
  })

  it("an edition's checks use its own list, and a legacy edition's use the shared one", () => {
    assert.deepEqual(expectedRecipientsFor({ mode: "edition", editionRecipients: editionB, sharedRecipients: editionA }), ["carol@example.org"])
    assert.deepEqual(expectedRecipientsFor({ mode: "shared_legacy", editionRecipients: editionB, sharedRecipients: editionA }), ["alice@example.org", "bob@example.org"])
  })

  it("the diff names only this edition's additions and removals", () => {
    const d = diffRecipients(["a@example.org", "c@example.org"], ["a@example.org", "b@example.org"])
    assert.deepEqual(d.toAdd, ["c@example.org"])
    assert.deepEqual(d.toRemove, ["b@example.org"])
    assert.equal(d.unchanged, 1)
    assert.equal(d.matches, false)
  })
})

// ===========================================================================
// 4. Safe adoption
// ===========================================================================

describe("adoption of live Papermark access", () => {
  const base = {
    mode: "shared_legacy",
    publicationState: "published",
    secureLinkId: "lnk_sept",
    expectedDocumentId: "doc_sept_min",
  }

  it("records exactly the live list when everything verifies", () => {
    const d = decideAdoption({ ...base, live: LIVE_OK(["B@example.org", "a@example.org"]) })
    assert.equal(d.ok, true)
    assert.deepEqual(d.emails, ["a@example.org", "b@example.org"])
    assert.equal(d.hash, recipientListHash(["a@example.org", "b@example.org"]))
  })

  it("refuses an empty live list, which Papermark treats as unrestricted", () => {
    const d = decideAdoption({ ...base, live: LIVE_OK([]) })
    assert.equal(d.ok, false)
    assert.match(d.blocker, /empty.*unrestricted/i)
  })

  it("refuses when Papermark cannot be read", () => {
    const d = decideAdoption({ ...base, live: { ok: false, error: "timeout" } })
    assert.equal(d.ok, false)
    assert.match(d.blocker, /could not be read/)
  })

  it("refuses a link pointing at a different document", () => {
    const d = decideAdoption({ ...base, live: LIVE_OK(["a@example.org"], { documentId: "doc_other" }) })
    assert.equal(d.ok, false)
    assert.match(d.blocker, /exact document/)
  })

  it("refuses a list holding a domain rule", () => {
    const d = decideAdoption({ ...base, live: LIVE_OK(["a@example.org", "@example.org"]) })
    assert.equal(d.ok, false)
    assert.match(d.blocker, /domain rule/)
  })

  it("refuses a link that breaches the review policy", () => {
    const d = decideAdoption({ ...base, live: LIVE_OK(["a@example.org"], { policyProblem: "Downloads are not disabled." }) })
    assert.equal(d.ok, false)
    assert.match(d.blocker, /Downloads are not disabled/)
  })

  it("refuses an edition already managed per edition", () => {
    assert.equal(decideAdoption({ ...base, mode: "edition", live: LIVE_OK(["a@example.org"]) }).ok, false)
  })

  it("refuses an unpublished edition", () => {
    assert.equal(decideAdoption({ ...base, publicationState: "draft", live: LIVE_OK(["a@example.org"]) }).ok, false)
  })

  it("refuses an edition with no link", () => {
    assert.equal(decideAdoption({ ...base, secureLinkId: null, live: LIVE_OK(["a@example.org"]) }).ok, false)
  })

  it("refuses a list larger than the limit", () => {
    const many = Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) => `r${i}@example.org`)
    assert.equal(decideAdoption({ ...base, live: LIVE_OK(many) }).ok, false)
  })

  it("every refusal says nothing was recorded and Papermark was not changed", () => {
    const d = decideAdoption({ ...base, live: LIVE_OK([]) })
    assert.match(d.blocker, /nothing was recorded and Papermark was not changed/)
  })

  const src = read(ACCESS)
  const adopt = body(src, "adoptEditionAccess")

  it("the action only reads Papermark: no write function is reachable", () => {
    assert.match(adopt, /readLiveLink\(edition\.secureLinkId\)/)
    assert.doesNotMatch(adopt, /setReviewLinkAllowList|updateReviewDocumentLink|createReviewDocumentLink|revokeReviewDocumentLink|method: ['"](POST|PATCH|DELETE)/)
  })

  it("the action never seeds from the shared APRI list", () => {
    assert.doesNotMatch(adopt, /readSharedRecipients|review_approved_recipients/)
  })

  it("switches mode and records the list in one guarded statement", () => {
    assert.match(adopt, /with switched as \(/)
    assert.match(adopt, /recipient_mode = 'shared_legacy'/)
    assert.match(adopt, /secure_link_id = \$\{edition\.secureLinkId\}/)
    assert.match(adopt, /from switched s cross join unnest/)
    assert.match(adopt, /if \(switched === 0\)/)
  })

  it("a database failure leaves the edition on its existing checks", () => {
    assert.match(adopt, /still checked against the shared list/)
  })
})

// ===========================================================================
// 5. Link preparation fails closed
// ===========================================================================

describe("link preparation", () => {
  const base = { mode: "edition", hasExactLink: false, hasAnyLink: false }

  it("refuses an edition with no recipients", () => {
    const d = decideLinkPreparation({ ...base, recipients: [] })
    assert.equal(d.kind, "refuse")
    assert.match(d.message, /at least one recipient/)
  })

  it("creates with exactly the edition's own list", () => {
    const d = decideLinkPreparation({ ...base, recipients: ["B@example.org", "a@example.org"] })
    assert.deepEqual(d, { kind: "create", emails: ["a@example.org", "b@example.org"] })
  })

  it("refuses an edition not yet adopted", () => {
    assert.equal(decideLinkPreparation({ ...base, mode: "shared_legacy", recipients: ["a@example.org"] }).kind, "refuse")
  })

  it("refuses to add a second link over a non-matching one", () => {
    const d = decideLinkPreparation({ ...base, hasAnyLink: true, recipients: ["a@example.org"] })
    assert.equal(d.kind, "refuse")
    assert.match(d.message, /does not match its document/)
  })

  it("does nothing when the exact link already exists", () => {
    assert.equal(decideLinkPreparation({ ...base, hasExactLink: true, hasAnyLink: true, recipients: [] }).kind, "already_linked")
  })

  const fn = body(read(LIBRARY), "prepareEditionSecureLink")

  it("the action reads the edition's recipients, never the shared list", () => {
    assert.match(fn, /loadActiveRecipients\(sql, editionId\)/)
    assert.doesNotMatch(fn, /readApprovedRecipients|review_approved_recipients/)
  })

  it("the action stores the link only against an edition with no link yet", () => {
    assert.match(fn, /and secure_link_id is null/)
  })
})

// ===========================================================================
// 6. Saving, and the last recipient
// ===========================================================================

describe("saving an edition's list", () => {
  it("refuses to remove the last recipient of a linked edition", () => {
    const d = decideRecipientSave({ mode: "edition", hasLink: true, current: ["a@example.org"], proposed: [] })
    assert.equal(d.ok, false)
    assert.match(d.message, /at least one recipient/)
    assert.match(d.message, /withdrawal workflow/)
  })

  it("allows an unlinked draft to be emptied, since nothing is in Papermark", () => {
    assert.equal(decideRecipientSave({ mode: "edition", hasLink: false, current: ["a@example.org"], proposed: [] }).ok, true)
  })

  it("refuses invalid addresses without saving any", () => {
    const d = decideRecipientSave({ mode: "edition", hasLink: true, current: [], proposed: ["a@example.org", "nonsense"] })
    assert.equal(d.ok, false)
  })

  it("refuses edits to an edition not yet adopted", () => {
    assert.equal(decideRecipientSave({ mode: "shared_legacy", hasLink: true, current: [], proposed: ["a@example.org"] }).ok, false)
  })

  it("refuses more than the limit", () => {
    const many = Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) => `r${i}@example.org`)
    assert.equal(decideRecipientSave({ mode: "edition", hasLink: false, current: [], proposed: many }).ok, false)
  })

  const fn = body(read(ACCESS), "saveEditionRecipients")

  it("never calls Papermark", () => {
    assert.doesNotMatch(fn, /papermark-datarooms|readLiveLink/)
  })

  it("re-checks the last-recipient rule inside the write itself", () => {
    assert.match(fn, /cardinality\(\$\{decision\.emails\}::text\[\]\) > 0 or secure_link_id is null/)
  })

  it("revokes rather than deletes, keeping history", () => {
    assert.match(fn, /set revoked_at = now\(\), revoked_by/)
    assert.doesNotMatch(fn, /delete from review_edition_recipients/)
  })

  it("writes additions and removals together in one statement", () => {
    assert.match(fn, /with ed as \([\s\S]*revoked as \([\s\S]*added as \(/)
  })
})

// ===========================================================================
// 7. Apply one edition, then read it back
// ===========================================================================

describe("applying one edition", () => {
  const desired = ["a@example.org", "b@example.org"]
  const hash = recipientListHash(desired)
  const base = { mode: "edition", secureLinkId: "lnk_1", desired, previewedHash: hash }

  it("proceeds when the previewed list is still the saved list", () => {
    const d = decideApply(base)
    assert.equal(d.ok, true)
    assert.deepEqual(d.emails, desired)
  })

  it("refuses when the list changed after the preview", () => {
    assert.equal(decideApply({ ...base, previewedHash: recipientListHash(["a@example.org"]) }).ok, false)
  })

  it("never sends an empty list", () => {
    const d = decideApply({ ...base, desired: [], previewedHash: recipientListHash([]) })
    assert.equal(d.ok, false)
    assert.match(d.message, /never sent an empty list/)
  })

  it("refuses an edition not yet adopted, and one with no link", () => {
    assert.equal(decideApply({ ...base, mode: "shared_legacy" }).ok, false)
    assert.equal(decideApply({ ...base, secureLinkId: null }).ok, false)
  })

  it("read-back succeeds only on list, document and policy together", () => {
    const ok = evaluateReadBack({ desired, expectedDocumentId: "doc_sept_min", live: LIVE_OK(["b@example.org", "A@example.org"]) })
    assert.equal(ok.matches, true)
  })

  it("an extra live address is a mismatch, never success", () => {
    const rb = evaluateReadBack({ desired, expectedDocumentId: "doc_sept_min", live: LIVE_OK([...desired, "stranger@example.org"]) })
    assert.equal(rb.matches, false)
    assert.deepEqual(rb.diff.toRemove, ["stranger@example.org"])
  })

  it("a wrong document or a policy breach is a mismatch", () => {
    assert.equal(evaluateReadBack({ desired, expectedDocumentId: "doc_other", live: LIVE_OK(desired) }).matches, false)
    assert.equal(evaluateReadBack({ desired, expectedDocumentId: "doc_sept_min", live: LIVE_OK(desired, { policyProblem: "Screenshot protection is disabled." }) }).matches, false)
  })

  it("an unreadable link is reported as unverified", () => {
    assert.equal(evaluateReadBack({ desired, expectedDocumentId: "doc_sept_min", live: { ok: false, error: "503" } }).ok, false)
  })

  const fn = body(read(ACCESS), "applyEditionRecipients")

  it("uses the narrow allow-list-only PATCH, never recreates or re-writes policy", () => {
    assert.match(fn, /setReviewLinkAllowList\(\{/)
    assert.doesNotMatch(fn, /updateReviewDocumentLink|createReviewDocumentLink|revokeReviewDocumentLink/)
  })

  it("reads the link back before deciding anything", () => {
    const patch = fn.indexOf("setReviewLinkAllowList({")
    const readBack = fn.indexOf("readLiveLink(linkId)")
    const success = fn.indexOf("ok: true,")
    assert.ok(patch < readBack && readBack < success)
  })

  it("withdraws the stored confirmation when the read-back does not match", () => {
    const mismatch = fn.slice(fn.indexOf("if (!readBack.ok || !readBack.matches) {"), fn.indexOf("ok: true,"))
    assert.match(mismatch, /recipients_verified_hash = null/)
  })

  it("does not report success if APRI cannot record the verification", () => {
    assert.match(fn, /APRI could not record the verification/)
    const catchBlock = fn.slice(fn.lastIndexOf("} catch {"), fn.lastIndexOf("refreshReviewPages()"))
    assert.match(catchBlock, /ok: false/)
  })

  it("the setReviewLinkAllowList service refuses an empty list itself", () => {
    const service = read("src/lib/papermark-datarooms.ts")
    assert.match(body(service, "setReviewLinkAllowList"), /args\.allowList\.length === 0/)
  })
})

// ===========================================================================
// 8. Prospect-specific grants
// ===========================================================================

describe("prospect grants", () => {
  const editions = [
    { id: "e-sept", label: "MIN · September 2026", mode: "edition", publicationState: "published", hasLink: true },
    { id: "e-aug", label: "MIN · August 2026", mode: "edition", publicationState: "published", hasLink: true },
    { id: "e-legacy", label: "AIU · Issue 001", mode: "shared_legacy", publicationState: "published", hasLink: true },
    { id: "e-legacy2", label: "PLM · Issue 01", mode: "shared_legacy", publicationState: "published", hasLink: true },
    { id: "e-draft", label: "MIN · October 2026", mode: "edition", publicationState: "draft", hasLink: true },
    { id: "e-ignored", label: "Old", mode: "edition", publicationState: "ignored", hasLink: true },
    { id: "e-nolink", label: "AIU · Issue 002", mode: "edition", publicationState: "published", hasLink: false },
  ]
  const base = { prospectVerified: true, prospectEmail: "Prospect@example.org", editions }

  it("an empty choice is refused: approval never means every publication", () => {
    const d = decideProspectGrant({ ...base, requestedEditionIds: [] })
    assert.equal(d.ok, false)
    assert.match(d.message, /never grants every publication/)
  })

  it("grants exactly the chosen editions, normalising the address", () => {
    const d = decideProspectGrant({ ...base, requestedEditionIds: ["e-aug", "e-aug"] })
    assert.equal(d.ok, true)
    assert.deepEqual(d.editions.map((e) => e.id), ["e-aug"])
    assert.equal(d.email, "prospect@example.org")
  })

  it("a not-yet-adopted edition refuses the whole request and is named", () => {
    const d = decideProspectGrant({ ...base, requestedEditionIds: ["e-sept", "e-legacy"] })
    assert.equal(d.ok, false, "never a partial grant")
    assert.match(d.message, /AIU · Issue 001 is still checked against the shared list/)
    assert.match(d.message, /Adopt it in Review Library first/)
    assert.match(d.message, /Nothing was granted\./)
  })

  it("several not-yet-adopted editions are all named", () => {
    const d = decideProspectGrant({ ...base, requestedEditionIds: ["e-legacy", "e-legacy2"] })
    assert.equal(d.ok, false)
    assert.match(d.message, /AIU · Issue 001 and PLM · Issue 01 are still checked/)
  })

  it("refuses an unverified prospect, an unknown, draft or ignored edition, and says nothing was granted", () => {
    for (const d of [
      decideProspectGrant({ ...base, prospectVerified: false, requestedEditionIds: ["e-sept"] }),
      decideProspectGrant({ ...base, requestedEditionIds: ["e-missing"] }),
      decideProspectGrant({ ...base, requestedEditionIds: ["e-sept", "e-draft"] }),
      decideProspectGrant({ ...base, requestedEditionIds: ["e-ignored"] }),
    ]) {
      assert.equal(d.ok, false)
      assert.match(d.message, /Nothing was granted\./)
    }
  })

  it("an edition without a Papermark link is refused and named", () => {
    const d = decideProspectGrant({ ...base, requestedEditionIds: ["e-nolink"] })
    assert.equal(d.ok, false)
    assert.match(d.message, /AIU · Issue 002 has no Papermark link/)
  })

  it("a prospect's library lists only their grants", () => {
    const shared = ["someone@example.org"]
    assert.equal(prospectCanSeeEdition({ mode: "edition", prospectEmail: "p@example.org", editionRecipients: ["p@example.org"], sharedRecipients: shared }), true)
    assert.equal(prospectCanSeeEdition({ mode: "edition", prospectEmail: "p@example.org", editionRecipients: ["q@example.org"], sharedRecipients: ["p@example.org"] }), false)
  })

  it("names are listed the way the owner reads them", () => {
    assert.equal(listNames(["A"]), "A")
    assert.equal(listNames(["A", "B"]), "A and B")
    assert.equal(listNames(["A", "B", "C"]), "A, B and C")
  })
})

describe("planning one edition's grant against Papermark", () => {
  const live = (allowList, over = {}) => ({ ok: true, documentId: "doc-1", allowList, policyProblem: null, ...over })
  const plan = (editionRecipients, liveState) =>
    planEditionGrant({ email: "New@example.org", editionRecipients, expectedDocumentId: "doc-1", live: liveState })

  it("in step and not yet granted: adds exactly this address", () => {
    const p = plan(["a@example.org", "b@example.org"], live(["B@example.org", "a@example.org"]))
    assert.equal(p.kind, "add")
    assert.deepEqual(p.next, ["a@example.org", "b@example.org", "new@example.org"])
    assert.equal(p.nextHash, recipientListHash(p.next))
    // What both sides hold now, for restoring the confirmation after a refusal.
    assert.deepEqual(p.current, ["a@example.org", "b@example.org"])
    assert.equal(p.currentHash, recipientListHash(p.current))
  })

  it("already on both lists: nothing to do", () => {
    const p = plan(["new@example.org", "a@example.org"], live(["a@example.org", "new@example.org", "stale@example.org"]))
    assert.equal(p.kind, "already_live")
  })

  it("granted in APRI but not yet in Papermark: refused, sent to apply", () => {
    const p = plan(["a@example.org", "new@example.org"], live(["a@example.org"]))
    assert.equal(p.kind, "refuse")
    assert.match(p.reason, /Papermark has not been updated yet/)
  })

  it("in Papermark but not in APRI: refused, sent to reconcile", () => {
    const p = plan(["a@example.org"], live(["a@example.org", "new@example.org"]))
    assert.equal(p.kind, "refuse")
    assert.match(p.reason, /APRI's list for it does not/)
  })

  it("any other disagreement: refused, so no unpreviewed change is ever carried along", () => {
    const p = plan(["a@example.org"], live(["b@example.org"]))
    assert.equal(p.kind, "refuse")
    assert.match(p.reason, /does not match APRI's list/)
  })

  it("an unreadable link, wrong document, policy breach or domain rule is refused", () => {
    assert.equal(plan(["a@example.org"], { ok: false, error: "timeout" }).kind, "refuse")
    assert.equal(plan(["a@example.org"], live(["a@example.org"], { documentId: "doc-2" })).kind, "refuse")
    assert.equal(plan(["a@example.org"], live(["a@example.org"], { documentId: null })).kind, "refuse")
    assert.equal(plan(["a@example.org"], live(["a@example.org"], { policyProblem: "downloads are enabled" })).kind, "refuse")
    assert.equal(plan(["a@example.org"], live(["a@example.org", "@example.org"])).kind, "refuse")
  })

  it("never builds on an empty list, which Papermark treats as unrestricted", () => {
    const p = plan([], live([]))
    assert.equal(p.kind, "refuse")
    assert.match(p.reason, /unrestricted/)
  })

  it("respects the recipient limit", () => {
    const full = Array.from({ length: EDITION_MAX }, (_, i) => `r${i}@example.org`)
    assert.equal(plan(full, live(full)).kind, "refuse")
  })
})

describe("the grant action", () => {
  const src = read(ACCESS)
  const grant = body(src, "grantProspectEditions")

  it("authorises, validates every posted id and waits for the migration before reading anything", () => {
    const owner = grant.indexOf("await requireOwner()")
    const ids = grant.indexOf("posted.some((id) => !UUID.test(id))")
    const ready = grant.indexOf("editionRecipientsReady(sql, { fresh: true })")
    const firstQuery = grant.indexOf("await sql`")
    assert.ok(owner !== -1 && ids !== -1 && ready !== -1)
    assert.ok(owner < ids && ids < ready && ready < firstQuery)
  })

  it("refuses a malformed id instead of silently dropping it", () => {
    assert.match(grant, /One of the chosen editions is not valid\. Reload the page and choose again\. Nothing was granted\./)
    assert.doesNotMatch(grant, /\.filter\(\(id\) => UUID\.test\(id\)\)/)
  })

  it("checks every chosen edition before changing any of them", () => {
    const check = grant.indexOf("// 1. Check every chosen edition before changing any of them.")
    const firstWrite = grant.indexOf("setReviewLinkAllowList({")
    assert.ok(check !== -1 && firstWrite !== -1 && check < firstWrite)
    const loop = grant.slice(check, firstWrite)
    assert.match(loop, /planEditionGrant\(/)
    assert.match(loop, /if \(plan\.kind === "refuse"\) \{\s*return \{ message: `\$\{edition\.label\}: \$\{plan\.reason\}\. Nothing was granted\.` \}/)
  })

  it("writes Papermark, reads it back, and records only a matching read-back", () => {
    const write = grant.indexOf("setReviewLinkAllowList({")
    const readBack = grant.indexOf("evaluateReadBack({", write)
    const record = grant.indexOf("insert into review_edition_recipients", readBack)
    assert.ok(write !== -1 && readBack > write && record > readBack)
    assert.match(grant.slice(readBack, record), /if \(!readBack\.ok \|\| !readBack\.matches\) \{[\s\S]*?withdrawVerification\(sql, edition\.id\)[\s\S]*?return \{/)
    assert.match(grant, /allowList: plan\.next/)
  })

  it("records the grant, the verified fingerprint and the audit event in one statement", () => {
    const start = grant.indexOf("with ed as (")
    const statementText = grant.slice(start, grant.indexOf("`)", start))
    assert.match(statementText, /update review_publication_editions[\s\S]*recipients_verified_hash = \$\{plan\.nextHash\}/)
    assert.match(statementText, /where id = \$\{edition\.id\}::uuid\s+and recipient_mode = 'edition'\s+and secure_link_id = \$\{edition\.secureLinkId\}/)
    assert.match(statementText, /insert into review_edition_recipients[\s\S]*'prospect_grant'[\s\S]*from ed/)
    assert.match(statementText, /insert into review_prospect_events[\s\S]*from ed/)
  })

  it("an unrecorded Papermark change withdraws the edition's verification and says so", () => {
    const failure = grant.slice(grant.indexOf("if (!recorded) {"))
    assert.match(failure, /withdrawVerification\(sql, edition\.id\)/)
    assert.match(failure, /Papermark now admits this prospect, but APRI could not record the grant/)
  })

  it("a refused Papermark change leaves that edition untouched and stops", () => {
    const refused = grant.slice(grant.indexOf("if (!patched.ok) {"), grant.indexOf("const readBack"))
    assert.match(refused, /so nothing was changed for it/)
    assert.match(refused, /notAttempted: remaining\(\)/)
    assert.doesNotMatch(refused, /withdrawVerification/)
  })

  it("each edition is marked unverified before Papermark is touched, and not touched without that mark", () => {
    const loop = grant.slice(grant.indexOf("// 2. One edition at a time"))
    const mark = loop.indexOf("if (!(await withdrawVerification(sql, edition.id))) {")
    const write = loop.indexOf("setReviewLinkAllowList({")
    assert.ok(mark !== -1 && write !== -1 && mark < write, "the mark must come first")
    const refusal = loop.slice(mark, write)
    assert.match(refusal, /Papermark was not touched and nothing was changed for it/)
    assert.match(refusal, /return \{/)
    // The mark reports whether it was recorded.
    const w = src.slice(src.indexOf("async function withdrawVerification("), src.indexOf("async function restoreVerificationIfUnchanged("))
    assert.match(w, /Promise<boolean>/)
    assert.match(w, /returning id/)
    assert.match(w, /return rows\.length === 1/)
  })

  it("a refused change restores the confirmation only after a fresh read matches", () => {
    const refused = grant.slice(grant.indexOf("if (!patched.ok) {"), grant.indexOf("const readBack"))
    assert.match(refused, /restoreVerificationIfUnchanged\(sql, edition, plan\.current, plan\.currentHash\)/)
    const restore = src.slice(src.indexOf("async function restoreVerificationIfUnchanged("), src.indexOf("function grantOutcome("))
    const read = restore.indexOf("readLiveLink(edition.secureLinkId)")
    const guard = restore.indexOf("if (!readBack.ok || !readBack.matches) return")
    const write = restore.indexOf("update review_publication_editions")
    assert.ok(read !== -1 && read < guard && guard < write)
    assert.match(restore, /and recipients_verified_hash is null/)
  })

  it("withdrawing a verification targets one edition-mode edition", () => {
    const w = body(src, "withdrawVerification")
    assert.match(w, /set recipients_verified_hash = null, recipients_verified_at = null/)
    assert.match(w, /where id = \$\{editionId\}::uuid and recipient_mode = 'edition'/)
  })

  it("the grant never writes the shared APRI list", () => {
    assert.doesNotMatch(grant, /review_approved_recipients|app_settings/)
  })

  it("the audit event names the edition, never the address", () => {
    const start = grant.indexOf("insert into review_prospect_events")
    const event = grant.slice(start, grant.indexOf("returning id", start))
    assert.notEqual(start, -1)
    assert.match(event, /edition\.label/)
    assert.doesNotMatch(event, /\.email\b|prospectEmail/)
  })

  it("the outcome names what was done, what failed and what was not attempted", () => {
    const outcome = src.slice(src.indexOf("function grantOutcome("), src.indexOf("export async function grantProspectEditions"))
    assert.match(outcome, /Granted and live in Papermark:/)
    assert.match(outcome, /Already live for this prospect:/)
    assert.match(outcome, /Not attempted, and unchanged:/)
  })

  it("the old approve-everything action is gone", () => {
    assert.doesNotMatch(read(FUNNEL), /export async function approveProspectRecipient/)
    assert.doesNotMatch(read("src/app/admin/review-requests/[id]/page.tsx"), /approveProspectRecipient/)
  })

  it("the grant form pre-selects nothing and confirms before submitting", () => {
    const ui = read("src/app/admin/review-requests/[id]/prospect-access.tsx")
    // The only checked boxes are the disabled, already-granted rows.
    const checked = ui.match(/<input[^>]*\bchecked\b[^>]*>/g) ?? []
    for (const box of checked) assert.match(box, /disabled/)
    assert.match(ui, /<input type="checkbox" name="editionId" value=\{e\.id\} \/>/)
    assert.match(ui, /onSubmit=\{confirmGrant\}/)
    assert.match(ui, /if \(!ok\) event\.preventDefault\(\)/)
  })

  it("every edition the owner cannot grant says why", () => {
    const ui = read("src/app/admin/review-requests/[id]/prospect-access.tsx")
    assert.match(ui, /Adopt this edition in Review Library before it can be granted to one person\./)
    assert.match(ui, /Has access through the shared list\./)
    assert.match(ui, /No Papermark link yet, so it cannot be granted\./)
    assert.match(ui, /every published edition is still checked against the shared list/)
  })
})

// ===========================================================================
// 9. Sending review access
// ===========================================================================

describe("sending secure review access", () => {
  const send = body(read(FUNNEL), "sendSecureReviewAccess")

  it("uses only the editions granted to this prospect", () => {
    assert.match(send, /grantedEditionsForProspect\(sql, p\.email\)/)
    assert.match(send, /if \(granted\.length === 0\)/)
  })

  it("verifies every granted edition live against its own list before sending", () => {
    const loop = send.indexOf("for (const edition of granted)")
    const token = send.indexOf("newToken()")
    assert.ok(loop !== -1 && loop < token)
    assert.match(send, /expectedRecipientsForEdition\(sql, edition\)/)
    assert.match(send, /expectedAllowList: expected/)
  })

  it("validates the prospect id before querying", () => {
    assert.ok(send.indexOf("UUID.test(prospectId)") < send.indexOf("getSql()"))
  })

  it("no longer depends on three fixed legacy links", () => {
    assert.doesNotMatch(send, /complimentary_review_items|!== 3/)
  })

  it("the granted-editions query cannot fall back to 'everything published'", () => {
    const q = body(read(DAL), "grantedEditionsForProspect")
    assert.match(q, /r\.email = \$\{email\}/)
    assert.match(q, /e\.recipient_mode = 'shared_legacy' and \$\{onSharedList\}::boolean/)
  })
})

// ===========================================================================
// 10. The prospect's library
// ===========================================================================

describe("/review/library", () => {
  const page = read("src/app/review/library/page.tsx")
  const lib = read(PUBLICATIONS)
  const fn = lib.slice(lib.indexOf("export async function getProspectReviewLibrary"), lib.indexOf("export async function getAllPublications"))

  it("shows only the editions granted to the signed-in prospect", () => {
    assert.match(page, /getProspectReviewLibrary\(id\)/)
    assert.doesNotMatch(page, /getReviewLibrary\(\)/)
  })

  it("requires a valid session and an access-sent prospect", () => {
    assert.match(page, /readReviewSession\(\)/)
    assert.match(page, /UUID\.test\(id\)/)
    assert.match(page, /access_sent_at is not null/)
  })

  it("matches the prospect's own address and nothing broader", () => {
    assert.match(fn, /r\.email = \$\{email\}/)
    assert.match(fn, /PROSPECT_UUID\.test/)
  })

  it("selects no other reader's address", () => {
    assert.doesNotMatch(fn, /select[^;]*\br\.email\b[^;]*from review_edition_recipients/)
  })
})

// ===========================================================================
// 11. Nothing leaks, and nothing else changes
// ===========================================================================

describe("scope and exposure", () => {
  it("only review-edition-access.ts writes review_edition_recipients", () => {
    const writers = walk("src").filter((f) => /\.(ts|tsx)$/.test(f)).filter((f) =>
      /(insert into|update|delete from)\s+review_edition_recipients/.test(read(f)),
    )
    assert.deepEqual(writers, [ACCESS])
  })

  it("every action in the access module authorises first and validates its ids", () => {
    const src = read(ACCESS)
    const names = [...src.matchAll(/export async function (\w+)\(/g)].map((m) => m[1])
    assert.ok(names.length >= 6)
    for (const name of names) {
      const b = body(src, name)
      const guard = b.indexOf("await requireOwner()")
      assert.notEqual(guard, -1, `${name} must authorise`)
      const sql = b.indexOf("getSql()")
      assert.ok(sql === -1 || guard < sql, `${name} must authorise before any query`)
      assert.match(b, /UUID\.test\(/, `${name} must validate its id`)
    }
  })

  it("every write to an edition row targets one edition by id", () => {
    const src = read(ACCESS)
    const updates = src.match(/update review_publication_editions[\s\S]*?where id = \$\{(editionId|edition\.id)\}::uuid/g) ?? []
    const all = src.match(/update review_publication_editions/g) ?? []
    assert.equal(updates.length, all.length, "no edition update may lack a single-id where clause")
  })

  it("sync keeps its hands off recipient data", () => {
    const sync = body(read(LIBRARY), "syncReviewLibrary")
    const upsert = sync.slice(sync.indexOf("on conflict (papermark_document_id) do update set"))
    const clause = upsert.slice(0, upsert.indexOf("`"))
    assert.doesNotMatch(clause, /recipient/)
    assert.doesNotMatch(sync, /review_edition_recipients|recipient_mode/)
  })

  it("metadata edits, state changes and promotion never touch recipients", () => {
    const src = read(LIBRARY)
    for (const name of ["updateEditionDetails", "generateEditionDefaults", "setEditionReviewState", "publishEditionAsLatest"]) {
      assert.doesNotMatch(body(src, name), /recipient/, name)
    }
    const migration = read("db/migrations/20260922_versioned_review_publications.sql")
    const promote = migration.slice(migration.indexOf("create or replace function promote_review_publication_edition"))
    assert.doesNotMatch(promote, /recipient/)
  })

  it("the legacy link actions are retired and write nothing", () => {
    const src = read(LIBRARY)
    for (const name of ["createSlotSecureLink", "verifySlotSecureLink", "preparePendingSecureLink", "makeVersionCurrent", "recoverAugustMinEdition"]) {
      const b = body(src, name)
      assert.match(b, /return retiredLegacyLinkAction\(\)/, name)
      assert.doesNotMatch(b, /sql`|papermark-datarooms/, name)
    }
    assert.doesNotMatch(src, /export async function (applyEmailRestrictions|previewEmailRestrictions)/)
  })

  it("public queries test recipients for existence and never select an address", () => {
    const lib = read(PUBLICATIONS)
    for (const name of ["getReviewLibrary", "getReviewPublicationArchive"]) {
      const b = body(lib, name)
      assert.match(b, /exists \(\s*select 1 from review_edition_recipients r/, name)
      assert.doesNotMatch(b, /r\.email/, name)
    }
  })

  it("the homepage never substitutes an older edition for one that is not ready", () => {
    const b = body(read(PUBLICATIONS), "getReviewLibrary")
    assert.match(b, /end as access_configured/)
    assert.match(b, /items\.some\(\(item\) => item\.access_configured !== true\)/)
  })

  it("no new module logs anything", () => {
    for (const f of [ACCESS, DAL, "src/lib/edition-recipients.ts", "src/app/admin/review-library/edition-access-panel.tsx", "src/app/admin/review-requests/[id]/prospect-access.tsx"]) {
      assert.doesNotMatch(read(f), /console\./, f)
    }
  })

  it("client components import no server-only module", () => {
    for (const f of ["src/app/admin/review-library/edition-access-panel.tsx", "src/app/admin/review-requests/[id]/prospect-access.tsx", "src/app/admin/review-library/review-form.tsx"]) {
      const src = read(f)
      assert.match(src, /^"use client"/, f)
      assert.doesNotMatch(src, /from "@\/lib\/(db|dal|edition-recipients|edition-recipients-dal|papermark|papermark-datarooms)"/, f)
      assert.doesNotMatch(src, /node:crypto/, f)
    }
  })

  it("the server-only modules say so", () => {
    assert.match(read(DAL), /^import "server-only"/)
    assert.match(read(ACCESS), /^"use server"/)
  })

  it("no credential or recipient address is committed in the new code", () => {
    for (const f of [ACCESS, DAL, "src/lib/edition-recipients.ts", MIGRATION]) {
      const src = read(f)
      assert.doesNotMatch(src, /PAPERMARK_API_TOKEN|DATABASE_URL|SESSION_SECRET/, f)
      // Only placeholder domains may appear.
      for (const m of src.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? []) {
        assert.match(m, /@example\.(org|com)$/i, `${f} contains a real-looking address`)
      }
    }
  })
})

// ===========================================================================
// 12. Status shown in Admin
// ===========================================================================

test("status reflects mode, recipients, link and verification", () => {
  const h = recipientListHash(["a@example.org"])
  const base = { mode: "edition", recipientCount: 1, hasLink: true, currentHash: h, verifiedHash: h }
  assert.equal(recipientStatus({ ...base, mode: "shared_legacy" }), "legacy_shared")
  assert.equal(recipientStatus({ ...base, recipientCount: 0 }), "no_recipients")
  assert.equal(recipientStatus({ ...base, hasLink: false }), "awaiting_link")
  assert.equal(recipientStatus(base), "in_sync")
  assert.equal(recipientStatus({ ...base, verifiedHash: null }), "pending_apply")
  assert.equal(recipientStatus({ ...base, verifiedHash: recipientListHash(["b@example.org"]) }), "pending_apply")
})

// ===========================================================================
// 13. The shared address book is locked during the changeover
// ===========================================================================

describe("the address book during the changeover", () => {
  it("any change is refused while a published edition is still on the shared list", () => {
    const d = decideAddressBookChange({
      current: ["a@example.org"],
      proposed: ["a@example.org", "new@example.org"],
      legacyPublishedEditions: 3,
    })
    assert.equal(d.ok, false)
    assert.match(d.message, /3 published editions are still checked against this list/)
    assert.match(d.message, /out of step/)
  })

  it("removing someone is refused too, not only adding", () => {
    const d = decideAddressBookChange({ current: ["a@example.org", "b@example.org"], proposed: ["a@example.org"], legacyPublishedEditions: 1 })
    assert.equal(d.ok, false)
    assert.match(d.message, /1 published edition is still checked/)
  })

  it("re-saving the same list is not a change", () => {
    const d = decideAddressBookChange({ current: ["a@example.org"], proposed: ["A@example.org "], legacyPublishedEditions: 3 })
    assert.deepEqual(d, { ok: true, changed: false })
  })

  it("once every published edition is adopted, the list may change", () => {
    assert.deepEqual(
      decideAddressBookChange({ current: [], proposed: ["a@example.org"], legacyPublishedEditions: 0 }),
      { ok: true, changed: true },
    )
  })

  const save = body(read(LIBRARY), "saveApprovedRecipients")

  it("the save waits for the migration, then applies the rule", () => {
    const ready = save.indexOf("editionRecipientsReady(sql, { fresh: true })")
    const rule = save.indexOf("decideAddressBookChange({")
    const write = save.indexOf("insert into app_settings")
    assert.ok(save.indexOf("await requireOwner()") < ready)
    assert.ok(ready !== -1 && ready < rule && rule < write)
  })

  it("the lock is re-checked inside the write itself", () => {
    const write = save.slice(save.indexOf("insert into app_settings"))
    assert.match(write, /where not exists \(\s*select 1 from review_publication_editions\s*where recipient_mode = 'shared_legacy' and publication_state = 'published'\s*\)/)
    assert.match(write, /returning key/)
    assert.match(save, /if \(!written\[0\]\) \{/)
  })

  it("the form shows the lock instead of inviting an edit that will be refused", () => {
    const form = read("src/app/admin/review-library/recipients-form.tsx")
    assert.match(form, /readOnly=\{legacyEditionCount > 0\}/)
    assert.match(form, /disabled=\{pending \|\| legacyEditionCount > 0\}/)
    assert.match(form, /Locked:/)
  })
})

// ===========================================================================
// 14. Deployable before the migration has run
// ===========================================================================

describe("before the migration has run", () => {
  const SCHEMA = "src/lib/edition-recipients-schema.ts"
  const schema = read(SCHEMA)
  const NEW_SCHEMA = /recipient_mode|review_edition_recipients|recipients_verified|recipients_adopted|recipients_applied/

  it("the check is server-only and looks for the table and every added column", () => {
    assert.match(schema, /^import "server-only"/)
    assert.match(schema, /to_regclass\('review_edition_recipients'\) is not null/)
    for (const column of ["recipient_mode", "recipients_verified_hash", "recipients_verified_at", "recipients_applied_at", "recipients_adopted_at", "recipients_adopted_by"]) {
      assert.match(schema, new RegExp(`"${column}"`), column)
    }
    assert.match(schema, /rows\[0\]\?\.columns === EDITION_RECIPIENT_COLUMNS\.length/)
  })

  it("only ever moves from not-yet to applied, and a failed check counts as not yet", () => {
    const fn = body(schema, "editionRecipientsReady")
    assert.match(fn, /if \(applied\) return true/)
    assert.match(fn, /\} catch \{\s*applied = false\s*\}/)
    assert.ok(fn.indexOf("if (applied) return true") < fn.indexOf("try {"), "a seen migration is never re-checked")
  })

  it("every access action and page asks before touching the new schema", () => {
    const entryPoints = [
      [ACCESS, ["saveEditionRecipients", "previewEditionRecipients", "applyEditionRecipients", "adoptEditionAccess", "checkEditionAddress", "grantProspectEditions"]],
      [LIBRARY, ["prepareEditionSecureLink", "verifyEditionForPublishing", "saveApprovedRecipients"]],
      [FUNNEL, ["sendSecureReviewAccess"]],
    ]
    for (const [file, names] of entryPoints) {
      const src = read(file)
      for (const name of names) {
        const b = body(src, name)
        const gate = b.indexOf("editionRecipientsReady(")
        assert.notEqual(gate, -1, `${name} must check for the migration`)
        assert.match(b.slice(gate, gate + 200), /MIGRATION_PENDING_MESSAGE/, `${name} must refuse with the pending message`)
        for (const call of ["loadEditionForAccess(", "loadActiveRecipients(", "grantedEditionsForProspect(", "expectedRecipientsForEdition(", "countLegacyPublishedEditions("]) {
          const at = b.indexOf(call)
          assert.ok(at === -1 || gate < at, `${name}: ${call} must come after the migration check`)
        }
      }
    }
  })

  it("the Admin pages show a notice instead of querying the new schema", () => {
    const library = read("src/app/admin/review-library/page.tsx")
    assert.ok(library.indexOf("editionRecipientsReady(sql, { fresh: true })") < library.indexOf("e.recipient_mode"))
    assert.match(library, /Database migration required/)
    const prospect = read("src/app/admin/review-requests/[id]/page.tsx")
    const gate = prospect.indexOf("editionRecipientsReady(sql, { fresh: true })")
    assert.ok(gate !== -1 && gate < prospect.indexOf("e.recipient_mode"))
    assert.match(prospect, /if \(perEdition\) \{/)
    assert.match(prospect, /\{p\.verified_at && perEdition && \(/)
  })

  it("each public query has a pre-migration form that names no new column or table", () => {
    const lib = read(PUBLICATIONS)
    for (const name of ["getReviewLibrary", "getReviewPublicationArchive", "getProspectReviewLibrary"]) {
      const b = body(lib, name)
      assert.match(b, /const perEdition = await editionRecipientsReady\(sql\)/, name)
      const fallback = b.slice(b.indexOf(": await sql`"))
      const fallbackSql = fallback.slice(0, fallback.indexOf("`)"))
      assert.notEqual(fallbackSql.length, 0, name)
      assert.doesNotMatch(fallbackSql, NEW_SCHEMA, `${name}'s fallback must not need the migration`)
      // The fallback is exactly the migration's own classification: published
      // with a secure link, judged by the shared list.
      assert.match(fallbackSql, /e\.secure_link_id is not null and \$\{(sharedConfigured|onSharedList)\}::boolean/, name)
    }
  })

  it("the migration classifies with that same rule, so nothing changes when it lands", () => {
    const sql = read(MIGRATION)
    assert.match(sql, /when publication_state = 'published'\s+and secure_link_id is not null\s+and secure_link_url <> ''\s+then 'shared_legacy'/)
  })

  it("the pending message is plain and says nothing was changed", () => {
    assert.match(MIGRATION_PENDING_MESSAGE, /20260928_review_edition_recipients\.sql/)
    assert.match(MIGRATION_PENDING_MESSAGE, /Nothing was changed\.$/)
  })
})

// ===========================================================================
// 15. The migration can be run safely on a live database
// ===========================================================================

describe("running the migration on a live database", () => {
  const sql = read(MIGRATION)

  it("gives up quickly instead of queueing behind a lock", () => {
    const begin = sql.indexOf("\nbegin;")
    const timeout = sql.indexOf("set local lock_timeout = '5s';")
    const firstAlter = sql.indexOf("alter table")
    assert.ok(begin !== -1 && begin < timeout && timeout < firstAlter)
  })

  it("documents ON_ERROR_STOP, so a failure stops psql instead of running on", () => {
    assert.match(sql, /-v ON_ERROR_STOP=1 -f db\/migrations\/20260928_review_edition_recipients\.sql/)
  })

  it("the rollback refuses whenever it would erase grants or adoptions", () => {
    const rollback = read("db/rollback/20260928_review_edition_recipients.rollback.sql")
    assert.match(rollback, /NOT a migration/)
    assert.match(rollback, /exists \(select 1 from review_edition_recipients\)[\s\S]*raise exception 'Refusing to roll back/)
    assert.match(rollback, /recipients_adopted_at is not null[\s\S]*raise exception 'Refusing to roll back/)
    assert.match(rollback, /^begin;$/m)
    assert.match(rollback, /^commit;$/m)
    assert.doesNotMatch(rollback, /app_settings/, "the rollback never touches the shared list")
  })
})
