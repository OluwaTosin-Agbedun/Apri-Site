/**
 * Per-edition Complimentary Review recipients -- the decisions, with no
 * database or network in the way.
 *
 * Each Complimentary Review edition is its own Papermark document link, and
 * its URL is deliberately shown on the public pages, so the link's Papermark
 * allow list is the only thing deciding who can open that edition. This module
 * decides what each edition's list should be and whether a proposed change is
 * safe. The server actions read the database and Papermark, call these, and
 * carry out the result -- which is what lets every rule here be tested
 * directly rather than inferred from source text.
 *
 * Two modes exist during the changeover:
 *
 *  - `shared_legacy`: an edition that was already published before
 *    per-edition lists existed. Its live list was written from the shared APRI
 *    list, and every check for it keeps using that shared list, exactly as
 *    before. Nothing about it can be edited until the owner adopts it.
 *  - `edition`: governed only by its own recipient rows. New and synced
 *    editions start here with none, which is fail-closed.
 *
 * Imports only Node's crypto, so it must never be imported by a client
 * component.
 */

import { createHash } from "node:crypto"

// ---------------------------------------------------------------------------
// Address rules, mirrored exactly from review-recipients.ts
// ---------------------------------------------------------------------------
//
// Mirrored rather than imported because the test suite runs this module
// directly under Node's built-in TypeScript support, which cannot resolve an
// extensionless relative import -- the reason every directly-tested module in
// src/lib has none. tests/per-edition-review-recipients.test.mjs asserts that
// both copies share the same pattern and limits and accept and reject exactly
// the same addresses, so they cannot drift apart unnoticed.

const EMAIL_RE = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/

const MAX_EMAIL_LENGTH = 254

/** The most recipients one edition may have; the same limit as the address book. */
export const MAX_RECIPIENTS = 500

export function isValidRecipient(value: string): boolean {
  const e = (value ?? "").trim().toLowerCase()
  return e.length > 0 && e.length <= MAX_EMAIL_LENGTH && EMAIL_RE.test(e)
}

export const RECIPIENT_MODES = ["shared_legacy", "edition"] as const
export type RecipientMode = (typeof RECIPIENT_MODES)[number]

export function isRecipientMode(value: unknown): value is RecipientMode {
  return (
    typeof value === "string" &&
    (RECIPIENT_MODES as readonly string[]).includes(value)
  )
}

// ---------------------------------------------------------------------------
// Normalisation and comparison
// ---------------------------------------------------------------------------

export function normaliseEmail(value: string): string {
  return (value ?? "").trim().toLowerCase()
}

/**
 * Normalised, de-duplicated and sorted, with anything that is not an
 * individual email address set aside rather than silently dropped.
 *
 * Papermark allow lists can hold domain rules such as "@example.org". Those
 * grant a whole organisation, so they are reported as invalid here: an
 * adoption that met one must stop for a human rather than record it as if it
 * were one person.
 */
export function normaliseRecipientList(values: readonly string[]): {
  emails: string[]
  invalid: string[]
} {
  const seen = new Set<string>()
  const invalid: string[] = []
  for (const raw of values ?? []) {
    const email = normaliseEmail(raw)
    if (!email) continue
    if (!isValidRecipient(email)) {
      invalid.push(raw)
      continue
    }
    seen.add(email)
  }
  return { emails: [...seen].sort(), invalid }
}

/**
 * A fingerprint of a recipient list.
 *
 * Stored as "the list APRI last read back from Papermark and found to match",
 * so Admin can tell whether an edition is in sync by comparing hashes rather
 * than storing or re-reading addresses.
 */
export function recipientListHash(emails: readonly string[]): string {
  const canonical = [...new Set(emails.map(normaliseEmail).filter(Boolean))]
    .sort()
    .join("\n")
  return createHash("sha256").update(`edition-recipients:v1\n${canonical}`).digest("hex")
}

export function sameRecipientSet(
  a: readonly string[],
  b: readonly string[],
): boolean {
  const left = new Set(a.map(normaliseEmail).filter(Boolean))
  const right = new Set(b.map(normaliseEmail).filter(Boolean))
  if (left.size !== right.size) return false
  for (const email of left) if (!right.has(email)) return false
  return true
}

export type RecipientDiff = {
  /** In the edition's list but not yet on the live Papermark link. */
  toAdd: string[]
  /** On the live Papermark link but no longer in the edition's list. */
  toRemove: string[]
  unchanged: number
  matches: boolean
}

export function diffRecipients(
  desired: readonly string[],
  live: readonly string[],
): RecipientDiff {
  const want = new Set(desired.map(normaliseEmail).filter(Boolean))
  const have = new Set(live.map(normaliseEmail).filter(Boolean))
  const toAdd = [...want].filter((e) => !have.has(e)).sort()
  const toRemove = [...have].filter((e) => !want.has(e)).sort()
  const unchanged = [...want].filter((e) => have.has(e)).length
  return { toAdd, toRemove, unchanged, matches: toAdd.length === 0 && toRemove.length === 0 }
}

/**
 * The list an edition's checks must compare against.
 *
 * A shared_legacy edition is still judged by the shared list, because that is
 * what was last written to its link; switching it to its own (empty) list
 * before adoption would fail every one of its readers' checks.
 */
export function expectedRecipientsFor(args: {
  mode: RecipientMode
  editionRecipients: readonly string[]
  sharedRecipients: readonly string[]
}): string[] {
  const source =
    args.mode === "shared_legacy" ? args.sharedRecipients : args.editionRecipients
  return normaliseRecipientList(source).emails
}

// ---------------------------------------------------------------------------
// Adoption of a pre-changeover edition's live access
// ---------------------------------------------------------------------------

/** What a read of one live Papermark link returned. */
export type LiveLinkState =
  | { ok: false; error: string }
  | {
      ok: true
      documentId: string | null
      allowList: readonly string[]
      /**
       * Any breach of the Complimentary Review policy other than the list
       * itself: document target, verified email, view-only, watermark,
       * screenshot protection. Null when compliant.
       */
      policyProblem: string | null
    }

export type AdoptionDecision =
  | { ok: true; emails: string[]; hash: string }
  | { ok: false; blocker: string }

const MANUAL_REVIEW = "Manual review is required; nothing was recorded and Papermark was not changed."

/**
 * Whether an edition's live Papermark access can be adopted as its own list.
 *
 * Adoption records exactly who can open the edition today -- read from
 * Papermark, not assumed from the shared APRI list -- so the changeover
 * neither grants nor removes anyone. Every doubt stops it: a list that cannot
 * be read, is empty (Papermark treats that as unrestricted), holds a domain
 * rule, points at the wrong document, or breaches the review policy is a case
 * for a human, not something to record.
 */
export function decideAdoption(args: {
  mode: RecipientMode
  publicationState: string
  secureLinkId: string | null
  expectedDocumentId: string
  live: LiveLinkState
}): AdoptionDecision {
  if (args.mode !== "shared_legacy") {
    return { ok: false, blocker: "This edition is already managed with its own recipient list." }
  }
  if (args.publicationState !== "published") {
    return { ok: false, blocker: "Only an edition that was already published can be adopted." }
  }
  if (!(args.secureLinkId ?? "").trim()) {
    return { ok: false, blocker: `This edition has no Papermark link to adopt. ${MANUAL_REVIEW}` }
  }
  const live = args.live
  if (!live.ok) {
    return { ok: false, blocker: `The live Papermark link could not be read (${live.error}). ${MANUAL_REVIEW}` }
  }
  if (!live.documentId || live.documentId !== args.expectedDocumentId) {
    return {
      ok: false,
      blocker: `The live Papermark link does not target this edition's exact document. ${MANUAL_REVIEW}`,
    }
  }
  if ((live.allowList ?? []).filter((v) => normaliseEmail(v)).length === 0) {
    return {
      ok: false,
      blocker: `The live Papermark list is empty, which Papermark treats as unrestricted. ${MANUAL_REVIEW}`,
    }
  }
  const { emails, invalid } = normaliseRecipientList(live.allowList)
  if (invalid.length > 0) {
    return {
      ok: false,
      blocker:
        `The live Papermark list holds ${invalid.length} ${invalid.length === 1 ? "entry that is" : "entries that are"} ` +
        `not an individual email address (for example a domain rule). ${MANUAL_REVIEW}`,
    }
  }
  if (emails.length > MAX_RECIPIENTS) {
    return {
      ok: false,
      blocker: `The live Papermark list holds more than ${MAX_RECIPIENTS} addresses. ${MANUAL_REVIEW}`,
    }
  }
  if (live.policyProblem) {
    return {
      ok: false,
      blocker: `The live link breaches the Complimentary Review policy: ${live.policyProblem} ${MANUAL_REVIEW}`,
    }
  }
  return { ok: true, emails, hash: recipientListHash(emails) }
}

// ---------------------------------------------------------------------------
// Changing an edition's list
// ---------------------------------------------------------------------------

export type SaveDecision =
  | { ok: true; emails: string[]; hash: string; toAdd: string[]; toRevoke: string[] }
  | { ok: false; message: string }

/**
 * Whether a proposed list may be saved for one edition.
 *
 * Saving records the owner's intent only; Papermark is changed separately by
 * Apply, after a preview. The one hard rule is the last recipient: an edition
 * that already has a link must keep at least one, because the only other way
 * to empty its Papermark list would open it to anybody. Ending a published
 * edition's access is a withdrawal: Withdraw from Complimentary Review revokes
 * its link instead.
 */
export const WITHDRAW_TO_END_ACCESS =
  "To end access to a published edition, use Withdraw from Complimentary Review instead."

export function decideRecipientSave(args: {
  mode: RecipientMode
  hasLink: boolean
  /** Published editions are told how to end access instead. */
  published?: boolean
  current: readonly string[]
  proposed: readonly string[]
}): SaveDecision {
  if (args.mode === "shared_legacy") {
    return {
      ok: false,
      message: "Adopt this edition's current Papermark access before changing its recipients.",
    }
  }
  const { emails, invalid } = normaliseRecipientList(args.proposed)
  if (invalid.length > 0) {
    return {
      ok: false,
      message: `${invalid.length} ${invalid.length === 1 ? "entry is" : "entries are"} not a valid email address. Nothing was saved.`,
    }
  }
  if (emails.length > MAX_RECIPIENTS) {
    return { ok: false, message: `An edition may have at most ${MAX_RECIPIENTS} recipients. Nothing was saved.` }
  }
  if (args.hasLink && emails.length === 0) {
    return {
      ok: false,
      message:
        "This edition has a Papermark link, so it must keep at least one recipient: Papermark would treat an " +
        `empty list as open to anyone. ${args.published ? WITHDRAW_TO_END_ACCESS + " " : ""}Nothing was saved.`,
    }
  }
  const current = normaliseRecipientList(args.current).emails
  const diff = diffRecipients(emails, current)
  return { ok: true, emails, hash: recipientListHash(emails), toAdd: diff.toAdd, toRevoke: diff.toRemove }
}

// ---------------------------------------------------------------------------
// Preparing a link, applying a list, reading it back
// ---------------------------------------------------------------------------

export type LinkPreparationDecision =
  | { kind: "already_linked" }
  | { kind: "create"; emails: string[] }
  | { kind: "refuse"; message: string }

/**
 * Whether a new Papermark link may be created for an edition.
 *
 * A link is born with exactly its edition's recipients. With none chosen there
 * is no correct list to create it with, so none is created.
 */
export function decideLinkPreparation(args: {
  mode: RecipientMode
  hasExactLink: boolean
  /** Any link id at all, even one that no longer matches the document. */
  hasAnyLink: boolean
  recipients: readonly string[]
}): LinkPreparationDecision {
  if (args.hasExactLink) return { kind: "already_linked" }
  if (args.hasAnyLink) {
    // Creating a second link would overwrite the stored id and leave the first
    // one live in Papermark with nobody tracking it.
    return {
      kind: "refuse",
      message:
        "This edition already has a Papermark link that does not match its document. " +
        "Manual review is required; no new link was created.",
    }
  }
  if (args.mode === "shared_legacy") {
    return { kind: "refuse", message: "Adopt this edition's current Papermark access first. No link was created." }
  }
  const emails = normaliseRecipientList(args.recipients).emails
  if (emails.length === 0) {
    return {
      kind: "refuse",
      message: "Choose at least one recipient for this edition before preparing its link. No link was created.",
    }
  }
  return { kind: "create", emails }
}

export type ApplyDecision =
  | { ok: true; emails: string[]; hash: string }
  | { ok: false; message: string }

/**
 * Whether one edition's list may be written to its Papermark link now.
 *
 * `previewedHash` is the fingerprint of the list the owner was shown. If the
 * list has changed since, Apply refuses rather than writing something nobody
 * previewed.
 */
export function decideApply(args: {
  mode: RecipientMode
  secureLinkId: string | null
  desired: readonly string[]
  previewedHash: string
}): ApplyDecision {
  if (args.mode === "shared_legacy") {
    return { ok: false, message: "Adopt this edition's current Papermark access before applying a new list." }
  }
  if (!(args.secureLinkId ?? "").trim()) {
    return {
      ok: false,
      message: "This edition has no Papermark link yet. Prepare its link; it will be created with this list.",
    }
  }
  const emails = normaliseRecipientList(args.desired).emails
  if (emails.length === 0) {
    return {
      ok: false,
      message:
        "Refused: Papermark is never sent an empty list, which it would treat as unrestricted. " +
        WITHDRAW_TO_END_ACCESS,
    }
  }
  const hash = recipientListHash(emails)
  if (!args.previewedHash || args.previewedHash !== hash) {
    return {
      ok: false,
      message: "The recipient list has changed since it was previewed. Preview again before applying.",
    }
  }
  return { ok: true, emails, hash }
}

export type ReadBack =
  | { ok: false; error: string }
  | {
      ok: true
      matches: boolean
      listMatches: boolean
      documentMatches: boolean
      policyProblem: string | null
      diff: RecipientDiff
    }

/**
 * Compares what Papermark reports after a change with what was intended.
 *
 * Success means all three at once: the exact document, exactly the intended
 * list, and a compliant policy. Anything less is reported as a mismatch, never
 * as success.
 */
export function evaluateReadBack(args: {
  desired: readonly string[]
  expectedDocumentId: string
  live: LiveLinkState
}): ReadBack {
  if (!args.live.ok) return { ok: false, error: args.live.error }
  const diff = diffRecipients(args.desired, args.live.allowList)
  const documentMatches = args.live.documentId === args.expectedDocumentId
  const policyProblem = args.live.policyProblem
  return {
    ok: true,
    matches: diff.matches && documentMatches && !policyProblem,
    listMatches: diff.matches,
    documentMatches,
    policyProblem,
    diff,
  }
}

// ---------------------------------------------------------------------------
// Status shown in Admin
// ---------------------------------------------------------------------------

export type RecipientStatus =
  | "legacy_shared"
  | "no_recipients"
  | "awaiting_link"
  | "in_sync"
  | "pending_apply"

export function recipientStatus(args: {
  mode: RecipientMode
  recipientCount: number
  hasLink: boolean
  currentHash: string
  verifiedHash: string | null
}): RecipientStatus {
  if (args.mode === "shared_legacy") return "legacy_shared"
  if (args.recipientCount === 0) return "no_recipients"
  if (!args.hasLink) return "awaiting_link"
  if (args.verifiedHash && args.verifiedHash === args.currentHash) return "in_sync"
  return "pending_apply"
}

// ---------------------------------------------------------------------------
// Review requests
// ---------------------------------------------------------------------------

/** "A", "A and B", "A, B and C" -- edition names in owner-facing messages. */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ""
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

export type GrantableEdition = {
  id: string
  /** How the owner knows it, e.g. "MIN · September 2026". Never an address. */
  label: string
  mode: RecipientMode
  publicationState: string
  hasLink: boolean
}

export type GrantDecision =
  | { ok: true; email: string; editions: GrantableEdition[] }
  | { ok: false; message: string }

/**
 * Whether a verified review prospect may be granted the chosen editions.
 *
 * All or nothing, and never implicit:
 *
 *  - an empty choice is refused, so approving someone can never mean
 *    "everything";
 *  - if any chosen edition cannot be granted -- not a published edition, still
 *    on the shared list, or without a Papermark link -- the whole request is
 *    refused and that edition is named. Nothing is granted partially, and no
 *    chosen edition is skipped without the owner being told which and why.
 *
 * An edition still on the shared list cannot be granted to one person at all:
 * its Papermark list was written from the shared list, and the only way to
 * give one reader access there would be to change the list that every one of
 * those editions is judged by. It has to be adopted first.
 */
export function decideProspectGrant(args: {
  prospectVerified: boolean
  prospectEmail: string
  requestedEditionIds: readonly string[]
  editions: readonly GrantableEdition[]
}): GrantDecision {
  if (!args.prospectVerified) {
    return {
      ok: false,
      message: "Only a prospect who has verified their email can be granted access. Nothing was granted.",
    }
  }
  const email = normaliseEmail(args.prospectEmail)
  if (!isValidRecipient(email)) {
    return { ok: false, message: "This prospect's email address is not valid. Nothing was granted." }
  }
  const requested = [...new Set(args.requestedEditionIds)]
  if (requested.length === 0) {
    return { ok: false, message: "Choose at least one edition. Approval never grants every publication." }
  }
  const byId = new Map(args.editions.map((e) => [e.id, e]))
  let unavailable = 0
  const needsAdoption: string[] = []
  const unlinked: string[] = []
  const chosen: GrantableEdition[] = []
  for (const id of requested) {
    const edition = byId.get(id)
    if (!edition || edition.publicationState !== "published") unavailable++
    else if (edition.mode === "shared_legacy") needsAdoption.push(edition.label)
    else if (!edition.hasLink) unlinked.push(edition.label)
    else chosen.push(edition)
  }
  if (unavailable > 0) {
    return {
      ok: false,
      message:
        `${unavailable === 1 ? "One of the chosen editions is" : `${unavailable} of the chosen editions are`} ` +
        "no longer a published edition. Reload the page and choose again. Nothing was granted.",
    }
  }
  if (needsAdoption.length > 0) {
    const one = needsAdoption.length === 1
    return {
      ok: false,
      message:
        `${listNames(needsAdoption)} ${one ? "is" : "are"} still checked against the shared list. ` +
        `Adopt ${one ? "it" : "them"} in Review Library first; until then nobody can be added to ` +
        `${one ? "it" : "them"} individually. Nothing was granted.`,
    }
  }
  if (unlinked.length > 0) {
    const one = unlinked.length === 1
    return {
      ok: false,
      message:
        `${listNames(unlinked)} ${one ? "has" : "have"} no Papermark link, so nobody can be granted ` +
        `${one ? "it" : "them"} yet. Nothing was granted.`,
    }
  }
  return { ok: true, email, editions: chosen }
}

export type EditionGrantPlan =
  /** Already on both APRI's list and the live Papermark list: nothing to do. */
  | { kind: "already_live" }
  /**
   * In step and not yet granted: write `next` to Papermark, then record it.
   * `current` is the list both sides hold now, for restoring the edition's
   * confirmation if Papermark refuses the change.
   */
  | { kind: "add"; current: string[]; currentHash: string; next: string[]; nextHash: string }
  | { kind: "refuse"; reason: string }

/**
 * What granting one edition to one address requires, from what APRI and
 * Papermark each hold now.
 *
 * A grant is written to Papermark straight away, so it is allowed only when the
 * edition is in step to begin with: its live link targets its document, passes
 * the review policy, and lists exactly the edition's recipients. Otherwise the
 * write would also carry changes nobody previewed, or stack a grant on a list
 * that already disagrees -- so the owner is sent to preview the edition first,
 * and nothing is changed.
 */
export function planEditionGrant(args: {
  email: string
  editionRecipients: readonly string[]
  expectedDocumentId: string
  live: LiveLinkState
}): EditionGrantPlan {
  const email = normaliseEmail(args.email)
  const live = args.live
  if (!live.ok) return { kind: "refuse", reason: `Papermark could not be read (${live.error})` }
  if (!live.documentId || live.documentId !== args.expectedDocumentId) {
    return { kind: "refuse", reason: "its Papermark link does not target this edition's document" }
  }
  if (live.policyProblem) {
    return { kind: "refuse", reason: `its Papermark link breaches the review policy (${live.policyProblem})` }
  }
  const liveList = normaliseRecipientList(live.allowList)
  if (liveList.invalid.length > 0) {
    return { kind: "refuse", reason: "its Papermark list holds entries that are not individual addresses" }
  }
  const current = normaliseRecipientList(args.editionRecipients).emails
  const onList = current.includes(email)
  const onLive = liveList.emails.includes(email)
  if (onList && onLive) return { kind: "already_live" }
  if (onList) {
    return {
      kind: "refuse",
      reason: "this prospect is on its list already, but Papermark has not been updated yet. Preview and apply it in Review Library",
    }
  }
  if (onLive) {
    return {
      kind: "refuse",
      reason: "Papermark already admits this address, but APRI's list for it does not. Preview it in Review Library to reconcile",
    }
  }
  if (!sameRecipientSet(current, liveList.emails)) {
    return {
      kind: "refuse",
      reason: "its Papermark list does not match APRI's list for it. Preview and apply it in Review Library first",
    }
  }
  if (current.length === 0) {
    // In step with an empty list would mean an unrestricted link; never build on that.
    return { kind: "refuse", reason: "it has no recipients on record, which Papermark would treat as unrestricted" }
  }
  const next = normaliseRecipientList([...current, email]).emails
  if (next.length > MAX_RECIPIENTS) {
    return { kind: "refuse", reason: `it already has the maximum of ${MAX_RECIPIENTS} recipients` }
  }
  return {
    kind: "add",
    current,
    currentHash: recipientListHash(current),
    next,
    nextHash: recipientListHash(next),
  }
}

// ---------------------------------------------------------------------------
// The shared address book during the changeover
// ---------------------------------------------------------------------------

export type AddressBookDecision =
  | { ok: true; changed: boolean }
  | { ok: false; message: string }

/**
 * Whether the shared address book may be changed.
 *
 * While any published edition is still on the shared list, that list is what
 * APRI checks those editions against -- and nothing writes it to Papermark any
 * more. Changing it then would put APRI and Papermark out of step for every one
 * of those editions at once, with no way to reconcile except adoption. So it is
 * locked until every published edition has been adopted, after which it is an
 * address book only and grants nothing.
 */
export function decideAddressBookChange(args: {
  current: readonly string[]
  proposed: readonly string[]
  legacyPublishedEditions: number
}): AddressBookDecision {
  if (sameRecipientSet(args.current, args.proposed)) return { ok: true, changed: false }
  if (args.legacyPublishedEditions > 0) {
    const n = args.legacyPublishedEditions
    return {
      ok: false,
      message:
        `Not saved: ${n} published edition${n === 1 ? " is" : "s are"} still checked against this list, ` +
        "and changing it would put APRI and Papermark out of step for " +
        `${n === 1 ? "it" : "all of them"}. Adopt every published edition in Review Library first; ` +
        "after that this list is an address book only.",
    }
  }
  return { ok: true, changed: true }
}

// ---------------------------------------------------------------------------
// Before the migration has run
// ---------------------------------------------------------------------------

/**
 * What every Admin action and page that needs per-edition recipients says when
 * db/migrations/20260928_review_edition_recipients.sql has not been applied.
 */
export const MIGRATION_PENDING_MESSAGE =
  "Per-edition access is waiting for its database migration " +
  "(db/migrations/20260928_review_edition_recipients.sql). Until it has run, the site " +
  "keeps its current behaviour and nothing here can be changed. Nothing was changed."

/**
 * Whether one verified prospect's library should list an edition.
 *
 * Mirrors the SQL in the prospect library query, and is kept here so the rule
 * can be tested without a database.
 */
export function prospectCanSeeEdition(args: {
  mode: RecipientMode
  prospectEmail: string
  editionRecipients: readonly string[]
  sharedRecipients: readonly string[]
}): boolean {
  const email = normaliseEmail(args.prospectEmail)
  if (!email) return false
  return expectedRecipientsFor(args).includes(email)
}
