"use server"

import { revalidatePath } from "next/cache"
import { requireOwner } from "@/lib/dal"
import { getSql } from "@/lib/db"
import type { FormState } from "@/lib/definitions"
import { isValidRecipient, MAX_RECIPIENTS } from "@/lib/review-recipients"
import {
  decideAdoption,
  decideApply,
  decideProspectGrant,
  decideRecipientSave,
  evaluateReadBack,
  listNames,
  MIGRATION_PENDING_MESSAGE,
  normaliseEmail,
  planEditionGrant,
  recipientListHash,
  type EditionGrantPlan,
  type GrantableEdition,
  type LiveLinkState,
  type RecipientMode,
} from "@/lib/edition-recipients"
import {
  loadActiveRecipients,
  loadEditionForAccess,
  readSharedRecipients,
} from "@/lib/edition-recipients-dal"
import { editionRecipientsReady } from "@/lib/edition-recipients-schema"

/**
 * Owner-only management of each Complimentary Review edition's recipients.
 *
 * This file is the only writer of review_edition_recipients. Every action:
 *
 *  - calls requireOwner() before reading or writing anything;
 *  - validates every id and address it is given;
 *  - refuses, changing nothing, until the per-edition migration has run;
 *  - touches only the Papermark links of the editions it names, one at a time;
 *  - never sends Papermark an empty list, which it would treat as
 *    unrestricted;
 *  - reports success only when Papermark has been read back and matches.
 *
 * Addresses returned from here go only to the owner's Admin page. They are not
 * logged, and nothing here reaches analytics or a public response.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HASH = /^[0-9a-f]{64}$/

/** Bounds the size of anything a client can post to these actions. */
const MAX_POSTED_ADDRESSES = MAX_RECIPIENTS * 2
const MAX_POSTED_EDITIONS = 200

function refreshReviewPages() {
  revalidatePath("/admin/review-library")
  revalidatePath("/admin/review-requests")
  revalidatePath("/")
  revalidatePath("/publications")
}

/** Reads one live link. The only Papermark call adoption and preview make. */
async function readLiveLink(linkId: string): Promise<LiveLinkState> {
  const { getReviewLinkSettings } = await import("@/lib/papermark-datarooms")
  const result = await getReviewLinkSettings(linkId)
  if (!result.ok) return { ok: false, error: result.message }
  return {
    ok: true,
    documentId: result.value.documentId,
    allowList: result.value.allowList,
    policyProblem: result.value.policyProblem,
  }
}

function sanitisePostedAddresses(values: unknown): string[] | null {
  if (!Array.isArray(values) || values.length > MAX_POSTED_ADDRESSES) return null
  const out: string[] = []
  for (const value of values) {
    if (typeof value !== "string" || value.length > 320) return null
    out.push(value)
  }
  return out
}

// ---------------------------------------------------------------------------
// Save an edition's list (intent only; Papermark is untouched)
// ---------------------------------------------------------------------------

export type EditionAccessResult = { ok: boolean; message: string }

export async function saveEditionRecipients(
  editionId: string,
  emails: string[],
): Promise<EditionAccessResult> {
  const admin = await requireOwner()
  if (!UUID.test(editionId)) return { ok: false, message: "Unknown edition." }
  const posted = sanitisePostedAddresses(emails)
  if (!posted) return { ok: false, message: "That recipient list could not be read. Nothing was saved." }

  const sql = getSql()
  if (!(await editionRecipientsReady(sql, { fresh: true }))) {
    return { ok: false, message: MIGRATION_PENDING_MESSAGE }
  }
  const edition = await loadEditionForAccess(sql, editionId)
  if (!edition) return { ok: false, message: "Unknown edition." }

  const current = await loadActiveRecipients(sql, editionId)
  const decision = decideRecipientSave({
    mode: edition.recipientMode,
    hasLink: Boolean(edition.secureLinkId),
    published: edition.publicationState === "published",
    current,
    proposed: posted,
  })
  if (!decision.ok) return { ok: false, message: decision.message }
  if (decision.toAdd.length === 0 && decision.toRevoke.length === 0) {
    return { ok: true, message: "No change: this is already the edition's list." }
  }

  let found = 0
  let revoked = 0
  let added = 0
  try {
    // One statement, so the removals and additions land together or not at
    // all. The `ed` CTE re-checks at write time that the edition is still
    // managed per edition and -- if the new list is empty -- still has no
    // link, so a race cannot empty the list of a linked edition.
    const rows = (await sql`
      with ed as (
        select id from review_publication_editions
        where id = ${editionId}::uuid
          and recipient_mode = 'edition'
          and (cardinality(${decision.emails}::text[]) > 0 or secure_link_id is null)
        for update
      ),
      revoked as (
        update review_edition_recipients r
        set revoked_at = now(), revoked_by = ${admin.id}::uuid
        from ed
        where r.edition_id = ed.id
          and r.revoked_at is null
          and not (r.email = any(${decision.emails}::text[]))
        returning r.id
      ),
      added as (
        insert into review_edition_recipients (edition_id, email, source, granted_by)
        select ed.id, x.email, 'owner', ${admin.id}::uuid
        from ed cross join unnest(${decision.emails}::text[]) as x(email)
        on conflict (edition_id, email) where revoked_at is null do nothing
        returning id
      )
      select (select count(*) from ed)::int as found,
             (select count(*) from revoked)::int as revoked,
             (select count(*) from added)::int as added
    `) as { found: number; revoked: number; added: number }[]
    found = rows[0]?.found ?? 0
    revoked = rows[0]?.revoked ?? 0
    added = rows[0]?.added ?? 0
  } catch {
    return { ok: false, message: "The recipient list could not be saved. Nothing was changed." }
  }

  if (found === 0) {
    return {
      ok: false,
      message: "Not saved: this edition changed while you were editing it. Reload and try again.",
    }
  }

  refreshReviewPages()
  return {
    ok: true,
    message:
      `Saved: ${added} added, ${revoked} removed. Papermark is unchanged ` +
      "until you preview and apply this edition.",
  }
}

// ---------------------------------------------------------------------------
// Preview one edition's list against its live Papermark link
// ---------------------------------------------------------------------------

export type EditionPreview = {
  ok: boolean
  message: string
  /** Fingerprint of the list previewed; Apply must be given it back. */
  previewHash: string
  desiredCount: number
  liveCount: number
  /** Owner-only: the addresses Apply would add and remove. */
  toAdd: string[]
  toRemove: string[]
  unchanged: number
  listMatches: boolean
  documentMatches: boolean
  policyProblem: string | null
}

const EMPTY_PREVIEW: Omit<EditionPreview, "ok" | "message"> = {
  previewHash: "",
  desiredCount: 0,
  liveCount: 0,
  toAdd: [],
  toRemove: [],
  unchanged: 0,
  listMatches: false,
  documentMatches: false,
  policyProblem: null,
}

export async function previewEditionRecipients(editionId: string): Promise<EditionPreview> {
  await requireOwner()
  if (!UUID.test(editionId)) return { ...EMPTY_PREVIEW, ok: false, message: "Unknown edition." }

  const sql = getSql()
  if (!(await editionRecipientsReady(sql, { fresh: true }))) {
    return { ...EMPTY_PREVIEW, ok: false, message: MIGRATION_PENDING_MESSAGE }
  }
  const edition = await loadEditionForAccess(sql, editionId)
  if (!edition) return { ...EMPTY_PREVIEW, ok: false, message: "Unknown edition." }
  if (edition.recipientMode === "shared_legacy") {
    return {
      ...EMPTY_PREVIEW,
      ok: false,
      message: "Adopt this edition's current Papermark access before previewing a new list.",
    }
  }

  const desired = await loadActiveRecipients(sql, editionId)
  const previewHash = recipientListHash(desired)
  if (!edition.secureLinkId) {
    return {
      ...EMPTY_PREVIEW,
      ok: false,
      previewHash,
      desiredCount: desired.length,
      message: "This edition has no Papermark link yet. Prepare its link; it will be created with exactly this list.",
    }
  }

  const live = await readLiveLink(edition.secureLinkId)
  const readBack = evaluateReadBack({
    desired,
    expectedDocumentId: edition.papermarkDocumentId,
    live,
  })
  if (!readBack.ok) {
    return {
      ...EMPTY_PREVIEW,
      ok: false,
      previewHash,
      desiredCount: desired.length,
      message: `Papermark could not be read (${readBack.error}). Nothing was changed.`,
    }
  }

  const liveCount = live.ok ? live.allowList.length : 0
  return {
    ok: true,
    previewHash,
    desiredCount: desired.length,
    liveCount,
    toAdd: readBack.diff.toAdd,
    toRemove: readBack.diff.toRemove,
    unchanged: readBack.diff.unchanged,
    listMatches: readBack.listMatches,
    documentMatches: readBack.documentMatches,
    policyProblem: readBack.policyProblem,
    message: readBack.matches
      ? "Papermark already matches this edition's list. Nothing needs applying."
      : `${readBack.diff.toAdd.length} to add and ${readBack.diff.toRemove.length} to remove on this edition only. Nothing has been changed yet.`,
  }
}

// ---------------------------------------------------------------------------
// Apply one edition's list, then read it back
// ---------------------------------------------------------------------------

export type EditionApplyResult = { ok: boolean; matches: boolean; message: string }

export async function applyEditionRecipients(
  editionId: string,
  previewedHash: string,
): Promise<EditionApplyResult> {
  await requireOwner()
  if (!UUID.test(editionId)) return { ok: false, matches: false, message: "Unknown edition." }
  if (!HASH.test(previewedHash ?? "")) {
    return { ok: false, matches: false, message: "Preview this edition before applying." }
  }

  const sql = getSql()
  if (!(await editionRecipientsReady(sql, { fresh: true }))) {
    return { ok: false, matches: false, message: MIGRATION_PENDING_MESSAGE }
  }
  const edition = await loadEditionForAccess(sql, editionId)
  if (!edition) return { ok: false, matches: false, message: "Unknown edition." }

  const desired = await loadActiveRecipients(sql, editionId)
  const decision = decideApply({
    mode: edition.recipientMode,
    secureLinkId: edition.secureLinkId,
    desired,
    previewedHash,
  })
  if (!decision.ok) return { ok: false, matches: false, message: decision.message }

  const linkId = edition.secureLinkId as string
  const { setReviewLinkAllowList } = await import("@/lib/papermark-datarooms")

  // The narrow PATCH: allow_list only. The link keeps its URL, id, document,
  // watermark, view-only setting and email verification.
  const patched = await setReviewLinkAllowList({
    linkId,
    documentId: edition.papermarkDocumentId,
    allowList: decision.emails,
  })
  if (!patched.ok) {
    return {
      ok: false,
      matches: false,
      message: `Papermark did not accept the change (${patched.message}). Preview again to see what is live.`,
    }
  }

  const readBack = evaluateReadBack({
    desired: decision.emails,
    expectedDocumentId: edition.papermarkDocumentId,
    live: await readLiveLink(linkId),
  })

  if (!readBack.ok || !readBack.matches) {
    // Whatever APRI last confirmed no longer describes the live link, so the
    // confirmation is withdrawn rather than left looking current.
    try {
      await sql`
        update review_publication_editions
        set recipients_applied_at = now(),
            recipients_verified_hash = null,
            recipients_verified_at = null,
            updated_at = now()
        where id = ${editionId}::uuid and recipient_mode = 'edition'
      `
    } catch {
      // Reported below either way.
    }
    refreshReviewPages()
    if (!readBack.ok) {
      return {
        ok: false,
        matches: false,
        message: `Papermark accepted the change but could not be read back (${readBack.error}), so it is unverified. Preview again.`,
      }
    }
    const problems: string[] = []
    if (!readBack.documentMatches) problems.push("the link does not target this edition's document")
    if (!readBack.listMatches) {
      problems.push(`the live list differs (${readBack.diff.toAdd.length} missing, ${readBack.diff.toRemove.length} unexpected)`)
    }
    if (readBack.policyProblem) problems.push(readBack.policyProblem)
    return {
      ok: false,
      matches: false,
      message: `Applied, but the read-back does not match: ${problems.join("; ")}. Preview again before relying on this edition.`,
    }
  }

  try {
    await sql`
      update review_publication_editions
      set recipients_applied_at = now(),
          recipients_verified_at = now(),
          recipients_verified_hash = ${decision.hash},
          secure_link_verified_at = now(),
          updated_at = now()
      where id = ${editionId}::uuid and recipient_mode = 'edition'
    `
  } catch {
    return {
      ok: false,
      matches: true,
      message:
        "Papermark now matches, but APRI could not record the verification. " +
        "Preview again; applying the same list again is safe.",
    }
  }

  refreshReviewPages()
  return {
    ok: true,
    matches: true,
    message:
      `Applied and verified: Papermark now lists exactly this edition's ${decision.emails.length} ` +
      `recipient${decision.emails.length === 1 ? "" : "s"}. No other edition was touched.`,
  }
}

// ---------------------------------------------------------------------------
// Adopt a pre-changeover edition's live Papermark access
// ---------------------------------------------------------------------------

export type AdoptionResult = { ok: boolean; adopted: number; message: string }

export async function adoptEditionAccess(editionId: string): Promise<AdoptionResult> {
  const admin = await requireOwner()
  if (!UUID.test(editionId)) return { ok: false, adopted: 0, message: "Unknown edition." }

  const sql = getSql()
  if (!(await editionRecipientsReady(sql, { fresh: true }))) {
    return { ok: false, adopted: 0, message: MIGRATION_PENDING_MESSAGE }
  }
  const edition = await loadEditionForAccess(sql, editionId)
  if (!edition) return { ok: false, adopted: 0, message: "Unknown edition." }

  // Read only. Adoption never writes to Papermark and never looks at the
  // shared APRI list: it records exactly who can open the edition today.
  const live: LiveLinkState = edition.secureLinkId
    ? await readLiveLink(edition.secureLinkId)
    : { ok: false, error: "no link" }

  const decision = decideAdoption({
    mode: edition.recipientMode,
    publicationState: edition.publicationState,
    secureLinkId: edition.secureLinkId,
    expectedDocumentId: edition.papermarkDocumentId,
    live,
  })
  if (!decision.ok) return { ok: false, adopted: 0, message: decision.blocker }

  let switched = 0
  let inserted = 0
  try {
    // One statement: the edition leaves shared_legacy and gains exactly the
    // live list together. The guard on link and document means a link changed
    // since it was read is not adopted.
    const rows = (await sql`
      with switched as (
        update review_publication_editions
        set recipient_mode = 'edition',
            recipients_adopted_at = now(),
            recipients_adopted_by = ${admin.id}::uuid,
            recipients_verified_hash = ${decision.hash},
            recipients_verified_at = now(),
            updated_at = now()
        where id = ${editionId}::uuid
          and recipient_mode = 'shared_legacy'
          and secure_link_id = ${edition.secureLinkId}
          and papermark_document_id = ${edition.papermarkDocumentId}
        returning id
      ),
      inserted as (
        insert into review_edition_recipients (edition_id, email, source, granted_by)
        select s.id, x.email, 'adopted', ${admin.id}::uuid
        from switched s cross join unnest(${decision.emails}::text[]) as x(email)
        on conflict (edition_id, email) where revoked_at is null do nothing
        returning id
      )
      select (select count(*) from switched)::int as switched,
             (select count(*) from inserted)::int as inserted
    `) as { switched: number; inserted: number }[]
    switched = rows[0]?.switched ?? 0
    inserted = rows[0]?.inserted ?? 0
  } catch {
    return {
      ok: false,
      adopted: 0,
      message: "Adoption could not be recorded. Nothing was changed, and the edition is still checked against the shared list.",
    }
  }

  if (switched === 0) {
    return {
      ok: false,
      adopted: 0,
      message: "Not adopted: the edition changed while it was being checked. Reload and try again.",
    }
  }

  refreshReviewPages()
  return {
    ok: true,
    adopted: inserted,
    message:
      `Adopted: the ${decision.emails.length} address${decision.emails.length === 1 ? "" : "es"} on the live ` +
      "Papermark link are now this edition's own list. Papermark was not changed, and no reader gained or lost access.",
  }
}

// ---------------------------------------------------------------------------
// Read-only check of one address against one edition
// ---------------------------------------------------------------------------

export type AddressCheckResult = {
  ok: boolean
  message: string
  allowedLive: boolean | null
  inEditionList: boolean | null
}

/**
 * Whether one address is on one edition's live Papermark list.
 *
 * For the changeover procedure's allowed/disallowed check. It answers yes or
 * no for the address asked about and never returns the list itself.
 */
export async function checkEditionAddress(
  editionId: string,
  email: string,
): Promise<AddressCheckResult> {
  await requireOwner()
  const blank = { allowedLive: null, inEditionList: null }
  if (!UUID.test(editionId)) return { ...blank, ok: false, message: "Unknown edition." }
  const address = normaliseEmail(typeof email === "string" ? email : "")
  if (!isValidRecipient(address)) return { ...blank, ok: false, message: "Enter one valid email address." }

  const sql = getSql()
  if (!(await editionRecipientsReady(sql, { fresh: true }))) {
    return { ...blank, ok: false, message: MIGRATION_PENDING_MESSAGE }
  }
  const edition = await loadEditionForAccess(sql, editionId)
  if (!edition) return { ...blank, ok: false, message: "Unknown edition." }
  if (!edition.secureLinkId) {
    return { ...blank, ok: false, message: "This edition has no Papermark link yet." }
  }

  const live = await readLiveLink(edition.secureLinkId)
  if (!live.ok) return { ...blank, ok: false, message: `Papermark could not be read (${live.error}).` }

  const allowedLive = live.allowList.map(normaliseEmail).includes(address)
  const expected: string[] =
    edition.recipientMode === "shared_legacy"
      ? await readSharedRecipients(sql)
      : await loadActiveRecipients(sql, editionId)
  const inEditionList = expected.includes(address)

  const where = modeLabel(edition.recipientMode)
  return {
    ok: true,
    allowedLive,
    inEditionList,
    message:
      (allowedLive
        ? "Papermark will let this address open the edition."
        : "Papermark will refuse this address for this edition.") +
      ` It is ${inEditionList ? "" : "not "}on ${where}.`,
  }
}

function modeLabel(mode: RecipientMode): string {
  return mode === "shared_legacy" ? "the shared list this edition still uses" : "this edition's own list"
}

// ---------------------------------------------------------------------------
// Grant chosen editions to one verified review prospect
// ---------------------------------------------------------------------------
//
// Granting is written to Papermark as part of the grant, so the owner is never
// left with a grant APRI records but Papermark does not enforce:
//
//  1. Every chosen edition is checked first -- read-only -- and the whole
//     request is refused, changing nothing, if any one of them cannot be
//     granted cleanly (still on the shared list, no link, or not in step with
//     Papermark). The refusal names the edition.
//  2. Then one edition at a time: Papermark first, read back, and only a
//     matching read-back is recorded -- the grant row, the new verified
//     fingerprint and the audit event in one statement.
//  3. If Papermark refuses, nothing is changed for that edition. If it accepts
//     but does not read back as intended, or APRI cannot record it, the
//     edition's verified fingerprint is withdrawn so Admin shows it as needing
//     a preview rather than as in step. Processing stops there and the message
//     says exactly which editions are done, which failed and why, and which
//     were not attempted.

type ChosenEdition = GrantableEdition & {
  secureLinkId: string
  papermarkDocumentId: string
}

/**
 * Marks an edition's last Papermark confirmation as no longer current. Returns
 * whether that was recorded; callers that are about to change Papermark
 * refuse to go on without it.
 */
async function withdrawVerification(
  sql: ReturnType<typeof getSql>,
  editionId: string,
): Promise<boolean> {
  try {
    const rows = (await sql`
      update review_publication_editions
      set recipients_verified_hash = null, recipients_verified_at = null, updated_at = now()
      where id = ${editionId}::uuid and recipient_mode = 'edition'
      returning id
    `) as { id: string }[]
    return rows.length === 1
  } catch {
    return false
  }
}

/**
 * After Papermark refused a change: puts the edition's confirmation back, but
 * only if a fresh read shows Papermark still holds exactly the list APRI does.
 * Otherwise the edition stays marked as needing a preview.
 */
async function restoreVerificationIfUnchanged(
  sql: ReturnType<typeof getSql>,
  edition: { id: string; secureLinkId: string; papermarkDocumentId: string },
  current: readonly string[],
  currentHash: string,
): Promise<void> {
  const readBack = evaluateReadBack({
    desired: current,
    expectedDocumentId: edition.papermarkDocumentId,
    live: await readLiveLink(edition.secureLinkId),
  })
  if (!readBack.ok || !readBack.matches) return
  try {
    await sql`
      update review_publication_editions
      set recipients_verified_hash = ${currentHash}, recipients_verified_at = now(), updated_at = now()
      where id = ${edition.id}::uuid and recipient_mode = 'edition'
        and recipients_verified_hash is null
    `
  } catch {
    // Left marked as needing a preview, which is the safe side.
  }
}

function grantOutcome(parts: {
  done: string[]
  already: string[]
  failure?: string
  notAttempted?: string[]
}): string {
  const out: string[] = []
  if (parts.done.length) out.push(`Granted and live in Papermark: ${listNames(parts.done)}.`)
  if (parts.already.length) out.push(`Already live for this prospect: ${listNames(parts.already)}.`)
  if (parts.failure) out.push(parts.failure)
  if (parts.notAttempted?.length) {
    out.push(`Not attempted, and unchanged: ${listNames(parts.notAttempted)}.`)
  }
  if (!parts.failure) out.push("Send secure review access when you are ready.")
  return out.join(" ")
}

export async function grantProspectEditions(
  prospectId: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireOwner()
  if (!UUID.test(prospectId)) return { message: "Unknown review request." }

  const posted = formData.getAll("editionId").map(String)
  if (posted.length > MAX_POSTED_EDITIONS) {
    return { message: "Too many editions chosen. Nothing was granted." }
  }
  // A malformed id is refused, not dropped, so no chosen edition disappears
  // from the request without the owner being told.
  if (posted.some((id) => !UUID.test(id))) {
    return { message: "One of the chosen editions is not valid. Reload the page and choose again. Nothing was granted." }
  }
  const requested = [...new Set(posted)]

  const sql = getSql()
  if (!(await editionRecipientsReady(sql, { fresh: true }))) {
    return { message: MIGRATION_PENDING_MESSAGE }
  }

  const prospects = (await sql`
    select email, verified_at from review_prospects where id = ${prospectId}::uuid limit 1
  `) as { email: string; verified_at: string | null }[]
  const prospect = prospects[0]
  if (!prospect) return { message: "Unknown review request." }

  const rows = requested.length
    ? ((await sql`
        select id, series, title, edition_label, recipient_mode, publication_state,
               secure_link_id, papermark_document_id
        from review_publication_editions
        where id = any(${requested}::uuid[])
      `) as Array<{
        id: string
        series: string | null
        title: string
        edition_label: string
        recipient_mode: string
        publication_state: string
        secure_link_id: string | null
        papermark_document_id: string
      }>)
    : []
  const byId = new Map(
    rows.map((e) => [
      e.id,
      {
        id: e.id,
        label: [e.series, e.edition_label || e.title].filter(Boolean).join(" · ") || "Untitled edition",
        // An unrecognised mode is treated as the fail-closed one.
        mode: (e.recipient_mode === "shared_legacy" ? "shared_legacy" : "edition") as RecipientMode,
        publicationState: e.publication_state,
        hasLink: Boolean(e.secure_link_id),
        secureLinkId: e.secure_link_id ?? "",
        papermarkDocumentId: e.papermark_document_id,
      } satisfies ChosenEdition,
    ]),
  )

  const decision = decideProspectGrant({
    prospectVerified: Boolean(prospect.verified_at),
    prospectEmail: prospect.email,
    requestedEditionIds: requested,
    editions: [...byId.values()],
  })
  if (!decision.ok) return { message: decision.message }
  const chosen = decision.editions.map((e) => byId.get(e.id) as ChosenEdition)

  // 1. Check every chosen edition before changing any of them.
  const plans: Array<{ edition: ChosenEdition; plan: EditionGrantPlan }> = []
  for (const edition of chosen) {
    const plan = planEditionGrant({
      email: decision.email,
      editionRecipients: await loadActiveRecipients(sql, edition.id),
      expectedDocumentId: edition.papermarkDocumentId,
      live: await readLiveLink(edition.secureLinkId),
    })
    if (plan.kind === "refuse") {
      return { message: `${edition.label}: ${plan.reason}. Nothing was granted.` }
    }
    plans.push({ edition, plan })
  }

  // 2. One edition at a time: Papermark, read back, then record.
  const refresh = () => {
    refreshReviewPages()
    revalidatePath(`/admin/review-requests/${prospectId}`)
  }
  const { setReviewLinkAllowList } = await import("@/lib/papermark-datarooms")
  const done: string[] = []
  const already: string[] = []
  const remaining = () =>
    plans.slice(done.length + already.length + 1).map((p) => p.edition.label)

  for (const { edition, plan } of plans) {
    if (plan.kind === "already_live") {
      already.push(edition.label)
      continue
    }
    if (plan.kind !== "add") continue

    // Marked unverified before Papermark is touched, so if anything stops this
    // request part-way -- the server included -- Admin shows the edition as
    // needing a preview rather than as in step. No mark, no change.
    if (!(await withdrawVerification(sql, edition.id))) {
      refresh()
      return {
        message: grantOutcome({
          done,
          already,
          failure: `${edition.label}: APRI could not prepare the change, so Papermark was not touched and nothing was changed for it.`,
          notAttempted: remaining(),
        }),
      }
    }

    const patched = await setReviewLinkAllowList({
      linkId: edition.secureLinkId,
      documentId: edition.papermarkDocumentId,
      allowList: plan.next,
    })
    if (!patched.ok) {
      await restoreVerificationIfUnchanged(sql, edition, plan.current, plan.currentHash)
      refresh()
      return {
        message: grantOutcome({
          done,
          already,
          failure: `${edition.label}: Papermark did not accept the change (${patched.message}), so nothing was changed for it.`,
          notAttempted: remaining(),
        }),
      }
    }

    const readBack = evaluateReadBack({
      desired: plan.next,
      expectedDocumentId: edition.papermarkDocumentId,
      live: await readLiveLink(edition.secureLinkId),
    })
    if (!readBack.ok || !readBack.matches) {
      await withdrawVerification(sql, edition.id)
      refresh()
      return {
        message: grantOutcome({
          done,
          already,
          failure:
            `${edition.label}: Papermark accepted the change but did not read back as intended, ` +
            `so the grant was not recorded. Preview ${edition.label} in Review Library to see what is live.`,
          notAttempted: remaining(),
        }),
      }
    }

    let recorded = false
    try {
      // One statement: the verified fingerprint, the grant and its audit event
      // land together or not at all. The guard means an edition whose link or
      // mode changed meanwhile records nothing.
      const result = (await sql`
        with ed as (
          update review_publication_editions
          set recipients_verified_hash = ${plan.nextHash},
              recipients_verified_at = now(),
              recipients_applied_at = now(),
              secure_link_verified_at = now(),
              updated_at = now()
          where id = ${edition.id}::uuid
            and recipient_mode = 'edition'
            and secure_link_id = ${edition.secureLinkId}
          returning id
        ),
        granted as (
          insert into review_edition_recipients (edition_id, email, source, granted_by)
          select ed.id, ${decision.email}, 'prospect_grant', ${admin.id}::uuid
          from ed
          on conflict (edition_id, email) where revoked_at is null do nothing
          returning edition_id
        ),
        logged as (
          -- Append-only audit trail: the edition, never the address.
          insert into review_prospect_events (prospect_id, event_type, detail, actor_admin_id)
          select ${prospectId}::uuid, 'review_edition_granted',
                 ${`Granted ${edition.label}; verified live in Papermark`}, ${admin.id}::uuid
          from ed
          returning id
        )
        select (select count(*) from ed)::int as found
      `) as { found: number }[]
      recorded = result[0]?.found === 1
    } catch {
      recorded = false
    }
    if (!recorded) {
      await withdrawVerification(sql, edition.id)
      refresh()
      return {
        message: grantOutcome({
          done,
          already,
          failure:
            `${edition.label}: Papermark now admits this prospect, but APRI could not record the grant. ` +
            `Preview ${edition.label} in Review Library: it will show this address as unexpected, ` +
            "so you can add it to the edition's list or remove it.",
          notAttempted: remaining(),
        }),
      }
    }
    done.push(edition.label)
  }

  refresh()
  return { ok: true, message: grantOutcome({ done, already }) }
}
