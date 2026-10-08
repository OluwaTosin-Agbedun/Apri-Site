"use server"

import { revalidatePath } from "next/cache"
import { requireOwner } from "@/lib/dal"
import { getSql } from "@/lib/db"
import { editionWithdrawalReady } from "@/lib/edition-recipients-schema"
import { expectedRecipientsForEdition, loadEditionForAccess } from "@/lib/edition-recipients-dal"
import {
  buildAccessPathReport,
  describeAccessPaths,
  parseReplacementChoice,
  runWithdrawal,
  WITHDRAWAL_MIGRATION_PENDING_MESSAGE,
  withdrawalPreviewKey,
  type AccessPathReport,
  type FoundLink,
  type WithdrawalOutcome,
} from "@/lib/review-withdrawal"
import {
  beginWithdrawal,
  classifyPapermarkLinks,
  completeWithdrawal,
  featureEdition,
  loadEditionForWithdrawal,
  loadReplacementCandidates,
  paidAccessCheck,
  recordWithdrawalUnconfirmed,
  reofferEdition,
} from "@/lib/review-withdrawal-dal"
import { scheduleRoomReconcile } from "@/lib/review-reader-rooms"

/**
 * Owner-only actions for withdrawing a Complimentary Review edition, choosing
 * which edition a series offers, and offering a withdrawn edition again.
 *
 * A withdrawal only ever revokes the one Papermark link recorded for that
 * edition, after reading it back as a document link to that edition's own
 * PDF and confirming APRI does not also record it as paid access. It never
 * writes a recipient, subscriber, Data Room or paid-access record, and never
 * deletes or moves a PDF.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** How many Data Rooms the access check reads, at most. */
const MAX_ROOMS_CHECKED = 25

/** Every page that can show, list or grant a Complimentary Review edition. */
function refreshReviewPages() {
  revalidatePath("/")
  revalidatePath("/publications")
  revalidatePath("/review/library")
  revalidatePath("/admin/review-library")
  revalidatePath("/admin/review-requests", "layout")
}

async function papermark() {
  return import("@/lib/papermark-datarooms")
}

/**
 * Every other Papermark link that can open one PDF: the document's own links,
 * and the links of every Data Room holding it. Read-only.
 */
async function scanAccessPaths(
  sql: ReturnType<typeof getSql>,
  documentId: string,
  withdrawnLinkId: string | null,
): Promise<AccessPathReport> {
  const pm = await papermark()
  const notes: string[] = []
  let complete = true
  const links: FoundLink[] = []

  const documentLinks = await pm.listDocumentLinks(documentId)
  if (documentLinks.ok) {
    for (const l of documentLinks.value) {
      links.push({
        id: l.id,
        name: l.name ?? null,
        url: l.url ?? null,
        targetType: "document",
        roomId: null,
        roomName: null,
        emailProtected: typeof l.email_protected === "boolean" ? l.email_protected : null,
      })
    }
  } else {
    complete = false
    notes.push("the document's own links could not be read")
  }

  const rooms = await pm.listDataRooms()
  if (!rooms.ok) {
    complete = false
    notes.push("the Data Rooms could not be listed")
  } else {
    const checked = rooms.value.slice(0, MAX_ROOMS_CHECKED)
    if (rooms.value.length > checked.length) {
      complete = false
      notes.push(`only the first ${checked.length} of ${rooms.value.length} Data Rooms were checked`)
    }
    for (let i = 0; i < checked.length; i += 4) {
      await Promise.all(
        checked.slice(i, i + 4).map(async (room) => {
          const documents = await pm.listDataRoomDocuments(room.id)
          if (!documents.ok) {
            complete = false
            notes.push(`Data Room "${room.name}" could not be read`)
            return
          }
          if (!documents.value.some((d) => d.document_id === documentId)) return
          const roomLinks = await pm.listDataRoomLinks(room.id)
          if (!roomLinks.ok) {
            complete = false
            notes.push(`the links of Data Room "${room.name}" could not be read`)
            return
          }
          for (const l of roomLinks.value) {
            links.push({
              id: l.id,
              name: l.name ?? null,
              url: l.url ?? null,
              targetType: "dataroom",
              roomId: room.id,
              roomName: room.name,
              emailProtected: typeof l.email_protected === "boolean" ? l.email_protected : null,
            })
          }
        }),
      )
    }
  }

  const known = await classifyPapermarkLinks(
    sql,
    links.map((l) => l.id),
    links.map((l) => l.url ?? "").filter(Boolean),
  )
  if (!known.complete) {
    complete = false
    notes.push("some of APRI's own link records could not be read")
  }
  return buildAccessPathReport({
    links,
    withdrawnLinkId,
    knownIds: known.knownIds,
    knownUrls: known.knownUrls,
    complete,
    notes,
  })
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export type WithdrawalPreview = {
  ok: boolean
  message: string
  editionId: string
  label: string
  status: "published" | "incomplete" | "withdrawn" | "other"
  /** "Latest" or "Published historical" for a published edition. */
  stateLabel: string
  offered: boolean
  documentId: string
  filename: string
  linkId: string | null
  linkUrl: string
  /** What Papermark says about that link right now. */
  linkLive: string
  recipientMode: "shared_legacy" | "edition"
  recipientCount: number
  replacementRequired: boolean
  candidates: { id: string; label: string }[]
  accessPaths: string[]
  previewKey: string
}

const EMPTY_PREVIEW = {
  editionId: "",
  label: "",
  status: "other" as const,
  stateLabel: "",
  offered: false,
  documentId: "",
  filename: "",
  linkId: null,
  linkUrl: "",
  linkLive: "",
  recipientMode: "edition" as const,
  recipientCount: 0,
  replacementRequired: false,
  candidates: [],
  accessPaths: [],
  previewKey: "",
}

/**
 * What withdrawing one edition would do, read-only: the exact edition, its
 * Papermark document and its APRI-managed complimentary link, what Papermark
 * says about that link, what else can open the same PDF, and -- for the
 * edition its series offers -- which editions could be offered instead.
 */
export async function previewReviewEditionWithdrawal(editionId: string): Promise<WithdrawalPreview> {
  await requireOwner()
  if (!UUID.test(editionId ?? "")) return { ...EMPTY_PREVIEW, ok: false, message: "Unknown edition." }
  const sql = getSql()
  if (!(await editionWithdrawalReady(sql, { fresh: true }))) {
    return { ...EMPTY_PREVIEW, ok: false, message: WITHDRAWAL_MIGRATION_PENDING_MESSAGE }
  }

  const edition = await loadEditionForWithdrawal(sql, editionId)
  if (!edition) return { ...EMPTY_PREVIEW, ok: false, message: "Unknown edition." }

  const base = {
    ...EMPTY_PREVIEW,
    editionId: edition.id,
    label: edition.label,
    offered: edition.featured,
    documentId: edition.papermarkDocumentId,
    filename: edition.papermarkFilename,
    recipientMode: edition.recipientMode,
    recipientCount: edition.recipientCount,
  }

  if (edition.publicationState === "withdrawn") {
    return {
      ...base,
      ok: true,
      status: edition.withdrawalState === "revoked" ? "withdrawn" : "incomplete",
      linkId: edition.withdrawalLinkId,
      message:
        edition.withdrawalState === "revoked"
          ? `${edition.label} is withdrawn. Papermark confirmed its complimentary link no longer opens.`
          : `${edition.label}'s withdrawal is not complete: it is hidden from every public page, but Papermark has not confirmed its link no longer opens. Use Complete withdrawal.`,
    }
  }
  if (edition.publicationState !== "published") {
    return { ...base, ok: false, message: "Only a published edition can be withdrawn." }
  }

  const pm = await papermark()
  const live = edition.secureLinkId
    ? await pm.readReviewLinkState(edition.secureLinkId)
    : ({ state: "unknown", message: "no link on record" } as const)
  const linkLive =
    live.state === "gone"
      ? "Papermark reports this link already revoked; withdrawing records that and hides the edition."
      : live.state === "active"
        ? live.targetType === "document" && live.documentId === edition.papermarkDocumentId
          ? "Active in Papermark, and it opens exactly this edition's document."
          : "Active in Papermark, but it does NOT target this edition's document. APRI will refuse to revoke it; manual review is required."
        : `Papermark could not be read (${live.message}).`

  const candidates = edition.featured ? await loadReplacementCandidates(sql, edition) : []
  const report = await scanAccessPaths(sql, edition.papermarkDocumentId, edition.secureLinkId)

  return {
    ...base,
    ok: true,
    status: "published",
    stateLabel: edition.isLatest ? "Latest edition" : "Published historical edition",
    linkId: edition.secureLinkId,
    linkUrl: edition.secureLinkUrl,
    linkLive,
    replacementRequired: edition.featured,
    candidates,
    accessPaths: describeAccessPaths(report),
    previewKey: withdrawalPreviewKey(edition),
    message: edition.featured
      ? `${edition.label} is the edition its series offers. Choose another edition to offer instead, or no replacement, then confirm.`
      : `${edition.label} is not the edition its series offers; withdrawing it does not change what the homepage offers.`,
  }
}

// ---------------------------------------------------------------------------
// Withdraw, or complete an unfinished withdrawal
// ---------------------------------------------------------------------------

export async function withdrawReviewEdition(
  editionId: string,
  previewKey: string,
  replacement: string,
): Promise<WithdrawalOutcome> {
  const admin = await requireOwner()
  const refused = (message: string): WithdrawalOutcome => ({ ok: false, status: "refused", message, accessPaths: [] })
  if (!UUID.test(editionId ?? "")) return refused("Unknown edition. Nothing was changed.")
  // Readers with a personal room are brought into line after the response.
  await scheduleRoomReconcile({ editionId })
  if (typeof previewKey !== "string" || previewKey.length > 300) return refused("Preview the withdrawal again. Nothing was changed.")
  const sql = getSql()
  if (!(await editionWithdrawalReady(sql, { fresh: true }))) return refused(WITHDRAWAL_MIGRATION_PENDING_MESSAGE)

  const pm = await papermark()
  return runWithdrawal(
    {
      loadEdition: (id) => loadEditionForWithdrawal(sql, id),
      loadReplacementCandidates: (edition) => loadReplacementCandidates(sql, edition),
      verifyReplacement: async (candidateId) => {
        // Offered only if its own link still verifies against its own list.
        const candidate = await loadEditionForAccess(sql, candidateId)
        if (!candidate?.secureLinkId) return { ok: false, message: "The chosen replacement has no link on record." }
        const expected = await expectedRecipientsForEdition(sql, candidate)
        if (expected.length === 0) return { ok: false, message: "No one could open the chosen replacement." }
        const check = await pm.verifyReviewDocumentLink({
          linkId: candidate.secureLinkId,
          expectedDocumentId: candidate.papermarkDocumentId,
          expectedAllowList: expected,
        })
        return check.ok ? { ok: true } : { ok: false, message: `The chosen replacement did not verify: ${check.message}` }
      },
      paidAccessCheck: (linkId) => paidAccessCheck(sql, linkId),
      readLink: (linkId) => pm.readReviewLinkState(linkId),
      revokeLink: async (linkId) => {
        const result = await pm.revokeWithdrawnReviewLink(linkId)
        return result.ok ? { ok: true } : { ok: false, message: result.message }
      },
      beginWithdrawal: (args) => beginWithdrawal(sql, { ...args, adminId: admin.id }),
      completeWithdrawal: (args) => completeWithdrawal(sql, { ...args, adminId: admin.id }),
      recordUnconfirmed: (args) => recordWithdrawalUnconfirmed(sql, { ...args, adminId: admin.id }),
      refresh: refreshReviewPages,
      scanAccessPaths: (args) => scanAccessPaths(sql, args.documentId, args.withdrawnLinkId),
    },
    { editionId, previewKey, choice: parseReplacementChoice(replacement) },
  )
}

// ---------------------------------------------------------------------------
// Offer an edition
// ---------------------------------------------------------------------------

export type OfferResult = { ok: boolean; message: string }

/**
 * Offers one verified published edition as its series' Complimentary Review
 * edition, in place of whichever was offered before. Its link is re-verified
 * against its own list first.
 */
export async function offerReviewEdition(editionId: string): Promise<OfferResult> {
  const admin = await requireOwner()
  if (!UUID.test(editionId ?? "")) return { ok: false, message: "Unknown edition." }
  const sql = getSql()
  if (!(await editionWithdrawalReady(sql, { fresh: true }))) {
    return { ok: false, message: WITHDRAWAL_MIGRATION_PENDING_MESSAGE }
  }

  const edition = await loadEditionForWithdrawal(sql, editionId)
  if (!edition) return { ok: false, message: "Unknown edition." }
  if (edition.featured) return { ok: true, message: `${edition.label} is already the edition its series offers.` }
  if (edition.publicationState !== "published" || !edition.secureLinkId) {
    return { ok: false, message: "Only a published edition with a verified link can be offered. Nothing was changed." }
  }

  const access = await loadEditionForAccess(sql, editionId)
  const expected = access ? await expectedRecipientsForEdition(sql, access) : []
  if (expected.length === 0) {
    return { ok: false, message: "No one could open this edition yet. Choose and apply its recipients first. Nothing was changed." }
  }
  const pm = await papermark()
  const check = await pm.verifyReviewDocumentLink({
    linkId: edition.secureLinkId,
    expectedDocumentId: edition.papermarkDocumentId,
    expectedAllowList: expected,
  })
  if (!check.ok) return { ok: false, message: `Not offered: ${check.message} Nothing was changed.` }

  try {
    await featureEdition(sql, { editionId, adminId: admin.id })
  } catch {
    return { ok: false, message: "APRI could not record the change. Nothing was changed." }
  }
  refreshReviewPages()
  return { ok: true, message: `${edition.label} is now the edition its series offers on the homepage.` }
}

// ---------------------------------------------------------------------------
// Offer a withdrawn edition again
// ---------------------------------------------------------------------------

/**
 * Returns a completed withdrawal to draft. It is not offered again until the
 * owner chooses its recipients, prepares and verifies a new link to its exact
 * document -- the revoked link is never reused -- and publishes it.
 */
export async function reofferWithdrawnEdition(editionId: string): Promise<OfferResult> {
  const admin = await requireOwner()
  if (!UUID.test(editionId ?? "")) return { ok: false, message: "Unknown edition." }
  // Readers with a personal room are brought into line after the response.
  await scheduleRoomReconcile({ editionId })
  const sql = getSql()
  if (!(await editionWithdrawalReady(sql, { fresh: true }))) {
    return { ok: false, message: WITHDRAWAL_MIGRATION_PENDING_MESSAGE }
  }

  const edition = await loadEditionForWithdrawal(sql, editionId)
  if (!edition) return { ok: false, message: "Unknown edition." }
  if (edition.publicationState !== "withdrawn" || edition.withdrawalState !== "revoked") {
    return {
      ok: false,
      message: "Only a completed withdrawal can be offered again. Complete the withdrawal first. Nothing was changed.",
    }
  }

  let changed = false
  try {
    changed = await reofferEdition(sql, { editionId, adminId: admin.id })
  } catch {
    changed = false
  }
  if (!changed) return { ok: false, message: "APRI could not record the change. Nothing was changed." }
  refreshReviewPages()
  return {
    ok: true,
    message:
      `${edition.label} is back in draft. Choose who may open it, then use Prepare & verify secure link: ` +
      "that creates and verifies a new link to its exact document (the revoked link is never reused). Then publish it.",
  }
}
