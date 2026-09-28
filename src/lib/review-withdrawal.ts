/**
 * Withdrawing a Complimentary Review edition -- the decisions and the sequence,
 * with no database or network in the way.
 *
 * Every Complimentary Review edition is its own Papermark document link, and
 * its URL is shown on the public pages and may already have been passed on. So
 * hiding an edition's card is not a withdrawal: its link has to stop working,
 * and Papermark has to confirm that it has. A withdrawal therefore runs in three
 * steps, each recorded before the next begins:
 *
 *   1. APRI hides the edition everywhere and records which link it is revoking
 *      (and, for the edition a series offers, which edition replaces it, if
 *      any). Nothing in Papermark has changed yet.
 *   2. Papermark revokes exactly that link, and APRI reads it back. Only
 *      Papermark reporting it gone counts.
 *   3. APRI records the withdrawal as complete and clears the edition's link,
 *      so it can never be offered again with the same URL.
 *
 * A failure at any step leaves a state the same action can finish: step 1's
 * record says which link to revoke, so a retry goes straight to revoking and
 * confirming it -- it never creates or restores any access.
 *
 * Dependency-free so every rule is tested directly: the server action supplies
 * the database and Papermark calls as `WithdrawalDeps`.
 */

export const REVIEW_SERIES = ["MIN", "AIU", "PLM"] as const
export type ReviewSeriesKey = (typeof REVIEW_SERIES)[number]

// ---------------------------------------------------------------------------
// Which edition each series offers
// ---------------------------------------------------------------------------

/**
 * The homepage cards: at most one per series, in MIN, AIU, PLM order.
 *
 * Each series stands alone. A series with no offered edition, or whose offered
 * edition is not ready, simply has no card -- it neither hides the other series
 * nor is quietly replaced by an older edition.
 */
export function selectOfferedCards<T extends { slotKey: string; accessConfigured: boolean }>(
  rows: readonly T[],
): T[] {
  const bySeries = new Map<string, T>()
  for (const row of rows) {
    // The first row per series is the one the query chose for it; a later row
    // for the same series is never a substitute.
    if (!bySeries.has(row.slotKey)) bySeries.set(row.slotKey, row)
  }
  const cards: T[] = []
  for (const series of REVIEW_SERIES) {
    const row = bySeries.get(series)
    if (row && row.accessConfigured === true) cards.push(row)
  }
  return cards
}

// ---------------------------------------------------------------------------
// The edition being withdrawn
// ---------------------------------------------------------------------------

export type WithdrawalState = "revoking" | "revoked"

export type WithdrawableEdition = {
  id: string
  series: string | null
  /** How the owner knows it, e.g. "MIN · September 2026". */
  label: string
  publicationState: string
  isLatest: boolean
  /** The edition its series offers on the homepage. */
  featured: boolean
  papermarkDocumentId: string
  secureLinkId: string | null
  recipientMode: "shared_legacy" | "edition"
  withdrawalState: WithdrawalState | null
  withdrawalLinkId: string | null
}

export type LinkState =
  | { state: "gone" }
  | { state: "active"; targetType: string | null; documentId: string | null; dataroomId: string | null }
  | { state: "unknown"; message: string }

/**
 * Binds a confirmation to what the owner was shown: the edition, the link that
 * will be revoked, and whether it was the offered edition. If any has changed
 * since the preview, the withdrawal is refused rather than acting on something
 * nobody reviewed.
 */
export function withdrawalPreviewKey(
  edition: Pick<WithdrawableEdition, "id" | "secureLinkId" | "featured">,
): string {
  return `${edition.id}:${edition.secureLinkId ?? ""}:${edition.featured ? "offered" : "not-offered"}`
}

export type ReplacementChoice =
  | { kind: "unset" }
  | { kind: "none" }
  | { kind: "edition"; id: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Reads the owner's replacement choice. Anything unreadable is "unset". */
export function parseReplacementChoice(value: unknown): ReplacementChoice {
  if (value === "none") return { kind: "none" }
  if (typeof value === "string" && UUID.test(value)) return { kind: "edition", id: value.toLowerCase() }
  return { kind: "unset" }
}

export type ReplacementCandidate = { id: string; label: string }

export type WithdrawalDecision =
  | { ok: true; resume: false; linkId: string; replacementId: string | null }
  | { ok: true; resume: true; linkId: string }
  | { ok: true; alreadyWithdrawn: true }
  | { ok: false; message: string }

/**
 * Whether this edition can be withdrawn now, as previewed.
 *
 * Latest or historical, any series, shared list or its own list: adoption is
 * never required to withdraw. What is required: a published edition with its
 * APRI link on record, a confirmation of exactly what was previewed, and -- for
 * the edition a series offers -- an explicit choice of another verified
 * published edition to offer instead, or of no replacement.
 */
export function decideWithdrawal(args: {
  edition: WithdrawableEdition
  previewKey: string
  choice: ReplacementChoice
  candidates: readonly ReplacementCandidate[]
}): WithdrawalDecision {
  const { edition } = args

  if (edition.publicationState === "withdrawn") {
    if (edition.withdrawalState === "revoked") return { ok: true, alreadyWithdrawn: true }
    if (edition.withdrawalState === "revoking" && edition.withdrawalLinkId) {
      // An unfinished withdrawal: finish it. No preview or replacement applies,
      // and nothing else about the edition or its series changes.
      return { ok: true, resume: true, linkId: edition.withdrawalLinkId }
    }
    return { ok: false, message: "This edition's withdrawal record is incomplete. Manual review is required; nothing was changed." }
  }
  if (edition.publicationState !== "published") {
    return { ok: false, message: "Only a published edition can be withdrawn. Nothing was changed." }
  }
  if (!edition.secureLinkId) {
    return {
      ok: false,
      message:
        "This edition has no APRI-managed Papermark link on record, so there is nothing APRI can revoke and confirm. " +
        "Find its links in Papermark and revoke them there. Nothing was changed.",
    }
  }
  if (args.previewKey !== withdrawalPreviewKey(edition)) {
    return { ok: false, message: "This edition changed since it was previewed. Preview the withdrawal again. Nothing was changed." }
  }

  if (!edition.featured) {
    if (args.choice.kind === "edition") {
      return {
        ok: false,
        message: "This edition is not the one its series offers, so there is nothing to replace. Nothing was changed.",
      }
    }
    return { ok: true, resume: false, linkId: edition.secureLinkId, replacementId: null }
  }

  if (args.choice.kind === "unset") {
    return {
      ok: false,
      message:
        `${edition.label} is the edition its series offers. Choose another verified published edition to offer instead, ` +
        "or choose no replacement. Nothing was changed.",
    }
  }
  if (args.choice.kind === "none") {
    return { ok: true, resume: false, linkId: edition.secureLinkId, replacementId: null }
  }
  const replacementId = args.choice.id
  if (replacementId === edition.id || !args.candidates.some((c) => c.id === replacementId)) {
    return {
      ok: false,
      message: "The chosen replacement is not a verified published edition of the same series. Nothing was changed.",
    }
  }
  return { ok: true, resume: false, linkId: edition.secureLinkId, replacementId }
}

/**
 * Why a link must not be revoked for this edition, or null if it may.
 *
 * The link has to be a document link to this edition's own PDF. Anything else
 * -- a Data Room link, or a link to another document -- could be someone's paid
 * access or another edition, and is refused rather than revoked.
 */
export function revocationTargetProblem(
  edition: Pick<WithdrawableEdition, "papermarkDocumentId">,
  live: LinkState,
): string | null {
  if (live.state !== "active") return null
  if (live.targetType && live.targetType !== "document") {
    return "The link on record is not a document link. APRI will not revoke it."
  }
  if (!live.documentId || live.documentId !== edition.papermarkDocumentId) {
    return "The link on record does not target this edition's own Papermark document. APRI will not revoke it."
  }
  return null
}

// ---------------------------------------------------------------------------
// Other ways to open the same PDF
// ---------------------------------------------------------------------------

export type ApriLinkKind = "complimentary" | "paid_subscriber" | "briefing"

export type FoundLink = {
  id: string
  name: string | null
  url: string | null
  targetType: "document" | "dataroom"
  roomId: string | null
  roomName: string | null
  emailProtected: boolean | null
}

export type AccessPathKind =
  | "other_complimentary"
  | "paid_subscriber"
  | "briefing"
  | "unmanaged"

export type AccessPath = {
  linkId: string
  name: string | null
  via: "document" | "data_room"
  roomName: string | null
  kind: AccessPathKind
  emailProtected: boolean | null
}

export type AccessPathReport = {
  /** False when Papermark could not be read fully; then more may remain. */
  complete: boolean
  notes: string[]
  paths: AccessPath[]
}

/**
 * Sorts every other Papermark link that can open the PDF by who manages it.
 *
 * The edition's own complimentary link is left out: whether it still works is
 * reported on its own, from reading it directly. Paid subscriber and briefing
 * links are APRI's own paid access: they are reported so the owner knows they
 * remain, and are never touched by a withdrawal. Anything APRI does not
 * recognise is "unmanaged" -- a link made by hand in Papermark, or a Data Room
 * link -- and is reported as still open rather than assumed closed.
 */
export function buildAccessPathReport(args: {
  links: readonly FoundLink[]
  /** The edition's own complimentary link, reported separately. */
  withdrawnLinkId: string | null
  /** APRI's own records, by link id. */
  knownIds: ReadonlyMap<string, ApriLinkKind>
  /** APRI's own records that hold only a URL, by URL. */
  knownUrls: ReadonlyMap<string, ApriLinkKind>
  complete: boolean
  notes: readonly string[]
}): AccessPathReport {
  const seen = new Set<string>()
  const paths: AccessPath[] = []
  for (const link of args.links) {
    if (!link.id || seen.has(link.id)) continue
    seen.add(link.id)
    if (args.withdrawnLinkId && link.id === args.withdrawnLinkId) continue
    const known = args.knownIds.get(link.id) ?? (link.url ? args.knownUrls.get(link.url) : undefined)
    const kind: AccessPathKind =
      known === "complimentary"
        ? "other_complimentary"
        : known === "paid_subscriber"
          ? "paid_subscriber"
          : known === "briefing"
            ? "briefing"
            : "unmanaged"
    paths.push({
      linkId: link.id,
      name: link.name,
      via: link.targetType === "dataroom" ? "data_room" : "document",
      roomName: link.roomName,
      kind,
      emailProtected: link.emailProtected,
    })
  }
  return { complete: args.complete, notes: [...args.notes], paths }
}

function describeLink(path: AccessPath): string {
  const name = path.name ? `"${path.name}"` : "an unnamed link"
  const where = path.via === "data_room" ? `Data Room link${path.roomName ? ` for room "${path.roomName}"` : ""}` : "document link"
  return `${name} (${where}, id ${path.linkId})`
}

/**
 * Owner-facing lines. Paid and briefing access is counted, never listed by
 * name; links APRI does not manage are listed so they can be found in
 * Papermark. Nothing here claims a path was closed that APRI did not close.
 */
export function describeAccessPaths(report: AccessPathReport): string[] {
  const lines: string[] = []
  const of = (kind: AccessPathKind) => report.paths.filter((p) => p.kind === kind)
  const unmanaged = of("unmanaged")
  const other = of("other_complimentary")
  const paid = of("paid_subscriber")
  const briefing = of("briefing")

  if (unmanaged.length) {
    lines.push(
      `Still open and not managed by APRI -- review in Papermark: ${unmanaged.map(describeLink).join("; ")}.`,
    )
  }
  if (other.length) {
    lines.push(`Other APRI Complimentary Review records also point at this PDF: ${other.map((p) => `link ${p.linkId}`).join(", ")}.`)
  }
  if (paid.length) {
    lines.push(
      `Paid subscriber access to this PDF, left unchanged: ${paid.length} link${paid.length === 1 ? "" : "s"}.`,
    )
  }
  if (briefing.length) {
    lines.push(`Briefing client access to this PDF, left unchanged: ${briefing.length} link${briefing.length === 1 ? "" : "s"}.`)
  }
  if (!report.complete) {
    lines.push(
      `The check for other access could not finish${report.notes.length ? ` (${report.notes.join("; ")})` : ""}, ` +
        "so other ways to open this PDF may remain. Check the document and its Data Rooms in Papermark.",
    )
  } else if (!unmanaged.length && !other.length) {
    lines.push("No other Papermark link outside APRI's paid access opens this PDF.")
  }
  return lines
}

/** What Admin says when the withdrawal migration has not run yet. */
export const WITHDRAWAL_MIGRATION_PENDING_MESSAGE =
  "Withdrawing an edition needs its database migration " +
  "(db/migrations/20260929_review_edition_withdrawal.sql, after 20260928). " +
  "Until it has run, nothing here can be changed. Nothing was changed."

// ---------------------------------------------------------------------------
// The sequence
// ---------------------------------------------------------------------------

export type WithdrawalDeps = {
  loadEdition(editionId: string): Promise<WithdrawableEdition | null>
  /** Verified published editions of the same series with access configured. */
  loadReplacementCandidates(edition: WithdrawableEdition): Promise<ReplacementCandidate[]>
  /** Re-checks a replacement against Papermark before it is offered. */
  verifyReplacement(candidateId: string): Promise<{ ok: true } | { ok: false; message: string }>
  /** Whether APRI records this link as anyone's paid access. */
  paidAccessCheck(linkId: string): Promise<"paid" | "not_paid" | "unknown">
  readLink(linkId: string): Promise<LinkState>
  revokeLink(linkId: string): Promise<{ ok: true } | { ok: false; message: string }>
  /** Step 1, in one transaction. Throws with a message if refused. */
  beginWithdrawal(args: { editionId: string; linkId: string; replacementId: string | null }): Promise<string>
  /** Step 3, in one transaction. Throws if refused. */
  completeWithdrawal(args: { editionId: string; linkId: string }): Promise<string>
  /** Best effort: records that Papermark did not confirm the revocation. */
  recordUnconfirmed(args: { editionId: string; reason: string }): Promise<void>
  /** Revalidates every page that can show a Complimentary Review edition. */
  refresh(): void
  scanAccessPaths(args: { documentId: string; withdrawnLinkId: string }): Promise<AccessPathReport | null>
}

export type WithdrawalStatus =
  | "withdrawn"
  | "already_withdrawn"
  | "refused"
  | "link_still_open"
  | "unconfirmed"
  | "record_failed"

export type WithdrawalOutcome = {
  ok: boolean
  status: WithdrawalStatus
  message: string
  accessPaths: string[]
}

function outcome(ok: boolean, status: WithdrawalStatus, message: string, accessPaths: string[] = []): WithdrawalOutcome {
  return { ok, status, message, accessPaths }
}

/**
 * Withdraws one edition, or finishes a withdrawal that stopped part-way.
 *
 * Reports success only once Papermark reads the edition's link as gone and
 * APRI has recorded that. Every other ending says what is true: whether the
 * edition is hidden, whether its link may still open, and what to do next.
 */
export async function runWithdrawal(
  deps: WithdrawalDeps,
  input: { editionId: string; previewKey: string; choice: ReplacementChoice },
): Promise<WithdrawalOutcome> {
  const edition = await deps.loadEdition(input.editionId)
  if (!edition) return outcome(false, "refused", "Unknown edition. Nothing was changed.")

  const candidates =
    edition.publicationState === "published" && edition.featured
      ? await deps.loadReplacementCandidates(edition)
      : []
  const decision = decideWithdrawal({ edition, previewKey: input.previewKey, choice: input.choice, candidates })
  if (!decision.ok) return outcome(false, "refused", decision.message)
  if ("alreadyWithdrawn" in decision) {
    return outcome(true, "already_withdrawn", `${edition.label} is already withdrawn, and Papermark confirmed its link no longer opens.`)
  }

  const linkId = decision.linkId

  // Before anything changes: the link must be this edition's own document
  // link, and must not be anyone's paid access.
  const before = await deps.readLink(linkId)
  if (before.state === "unknown") {
    return outcome(false, "refused", `Papermark could not be read (${before.message}). Nothing was changed; try again.`)
  }
  const targetProblem = revocationTargetProblem(edition, before)
  if (targetProblem) return outcome(false, "refused", `${targetProblem} Manual review is required; nothing was changed.`)
  const paid = await deps.paidAccessCheck(linkId)
  if (paid === "paid") {
    return outcome(
      false,
      "refused",
      "APRI also records this link as paid subscriber access, so it will not revoke it. Manual review is required; nothing was changed.",
    )
  }
  if (paid === "unknown") {
    return outcome(
      false,
      "refused",
      "APRI could not confirm this link is not someone's paid access, so it will not revoke it. Nothing was changed; try again.",
    )
  }

  if (!decision.resume) {
    if (decision.replacementId) {
      const check = await deps.verifyReplacement(decision.replacementId)
      if (!check.ok) return outcome(false, "refused", `${check.message} Nothing was changed.`)
    }
    // Step 1: hidden everywhere in APRI, and the link to revoke is on record.
    try {
      await deps.beginWithdrawal({ editionId: edition.id, linkId, replacementId: decision.replacementId })
    } catch (error) {
      const reason = error instanceof Error && error.message.startsWith("withdrawal:") ? ` (${error.message.slice(12).trim()})` : ""
      return outcome(false, "refused", `APRI could not start the withdrawal${reason}. Nothing was changed.`)
    }
    deps.refresh()
  }

  // Step 2: revoke exactly that link, then read it back from Papermark.
  const revoked = await deps.revokeLink(linkId)
  const after = await deps.readLink(linkId)
  if (after.state !== "gone") {
    const reason = !revoked.ok
      ? `Papermark did not revoke it (${revoked.message})`
      : after.state === "active"
        ? "Papermark still lists it as a working link"
        : `Papermark could not be read to confirm it (${after.message})`
    await deps.recordUnconfirmed({ editionId: edition.id, reason }).catch(() => undefined)
    deps.refresh()
    return outcome(
      false,
      after.state === "active" ? "link_still_open" : "unconfirmed",
      `${edition.label} is hidden from every public page, but its complimentary link (${linkId}) may still open the document: ${reason}. ` +
        "The withdrawal is not complete. Use Complete withdrawal to try again, or revoke that link in Papermark and then use Complete withdrawal.",
    )
  }

  // Step 3: recorded as complete, and the edition's link cleared.
  try {
    await deps.completeWithdrawal({ editionId: edition.id, linkId })
  } catch {
    deps.refresh()
    return outcome(
      false,
      "record_failed",
      `Papermark confirms ${edition.label}'s complimentary link no longer opens, but APRI could not record the withdrawal as complete. ` +
        "The edition is already hidden from every public page. Use Complete withdrawal to finish; it does not create or restore any access.",
    )
  }
  deps.refresh()

  let report: AccessPathReport | null = null
  try {
    report = await deps.scanAccessPaths({ documentId: edition.papermarkDocumentId, withdrawnLinkId: linkId })
  } catch {
    report = null
  }
  const paths = report
    ? describeAccessPaths(report)
    : ["The check for other ways to open this PDF could not run. Check the document and its Data Rooms in Papermark."]
  return outcome(
    true,
    "withdrawn",
    `${edition.label} is withdrawn: Papermark confirmed its complimentary link no longer opens, and it has been removed from ` +
      "the homepage, /publications, the prospect library and future grants.",
    paths,
  )
}

// ---------------------------------------------------------------------------
// What Admin shows
// ---------------------------------------------------------------------------

export type WithdrawalDisplay =
  | { kind: "not_withdrawn" }
  | { kind: "incomplete"; linkId: string | null }
  | { kind: "withdrawn"; linkId: string | null }

export function withdrawalDisplay(
  edition: Pick<WithdrawableEdition, "publicationState" | "withdrawalState" | "withdrawalLinkId">,
): WithdrawalDisplay {
  if (edition.publicationState !== "withdrawn") return { kind: "not_withdrawn" }
  if (edition.withdrawalState === "revoked") return { kind: "withdrawn", linkId: edition.withdrawalLinkId }
  return { kind: "incomplete", linkId: edition.withdrawalLinkId }
}
