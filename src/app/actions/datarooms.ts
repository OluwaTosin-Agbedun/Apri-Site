"use server"

import { revalidatePath } from "next/cache"
import { requireAdmin, requireOwner } from "@/lib/dal"
import { getSql } from "@/lib/db"
import { PUBLIC_TIER_NAMES } from "@/lib/entitlements"
import type { FormState } from "@/lib/definitions"
import {
  getLevelRoomMappings,
  setLevelRoomMapping,
  removeLevelRoomMapping,
  resolveDataRoom,
  getDataRoomLink,
  saveDataRoomLink,
  markLinkRevoked,
  updateLinkAnalytics,
  syncDataRoomDocuments,
  updateDataRoomSyncState,
  updateLevelRoomSyncState,
  recordAssignment,
  assignDataRoomToSubscriber,
  addSeat,
  removeSeat,
} from "@/lib/dataroom-dal"
import {
  listDataRooms,
  listDataRoomDocuments,
  createDataRoomLink,
  revokeDataRoomLink,
  getLinkAnalytics,
  getDataRoom,
} from "@/lib/papermark-datarooms"
import {
  categoriseDataRoomDocument,
  documentVersionKey,
  watermarkText,
} from "@/lib/papermark-dataroom-contract"
import {
  reconcileDownloadsFromViews,
  revokeAllDataRoomLinks,
} from "@/lib/dataroom-lifecycle"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function refresh() {
  revalidatePath("/admin")
  revalidatePath("/admin/datarooms")
  revalidatePath("/admin/subscribers")
  revalidatePath("/portal")
}

// ---------------------------------------------------------------------------
// Level-to-room mapping (owner only)
// ---------------------------------------------------------------------------

export async function saveLevelRoomMapping(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireOwner()
  const publicTier = String(formData.get("publicTier") ?? "").trim()
  const dataroomId = String(formData.get("dataroomId") ?? "").trim()

  if (!publicTier || !(PUBLIC_TIER_NAMES as readonly string[]).includes(publicTier)) {
    return { message: "Select a valid subscription level." }
  }
  if (!dataroomId) {
    return { message: "Select a Papermark Data Room." }
  }

  const room = await getDataRoom(dataroomId)
  if (!room.ok) {
    return { message: `Could not verify the Data Room: ${room.message}` }
  }

  await setLevelRoomMapping({
    publicTier,
    dataroomId,
    dataroomName: room.value.name,
    adminId: admin.id,
    adminName: admin.name,
  })

  refresh()
  return {
    ok: true,
    message: `${publicTier} is now mapped to "${room.value.name}".`,
  }
}

export async function deleteLevelRoomMapping(publicTier: string): Promise<FormState> {
  await requireOwner()
  if (!publicTier) return { message: "Missing level." }

  const removed = await removeLevelRoomMapping(publicTier)
  refresh()
  return removed
    ? { ok: true, message: `Mapping for ${publicTier} removed.` }
    : { message: "That mapping does not exist." }
}

// ---------------------------------------------------------------------------
// Sync a Data Room's documents
// ---------------------------------------------------------------------------

export async function syncDataRoomForLevel(publicTier: string): Promise<FormState> {
  await requireAdmin()
  if (!publicTier) return { message: "Missing level." }

  const mappings = await getLevelRoomMappings()
  const mapping = mappings.find((m) => m.publicTier === publicTier)
  if (!mapping) return { message: "No Data Room mapped for this level." }

  const docsResult = await listDataRoomDocuments(mapping.dataroomId)
  if (!docsResult.ok) {
    await updateLevelRoomSyncState(publicTier, docsResult.message)
    return { message: docsResult.message }
  }

  const documents = docsResult.value.map((d) => ({
    documentId: d.document_id,
    dataroomDocumentId: d.id,
    title: d.document_name,
    category: categoriseDataRoomDocument({
      title: d.document_name,
      category: d.folder_path,
      folderPath: d.folder_path,
    }),
    folderId: d.folder_id,
    folderPath: d.folder_path ?? null,
    numPages: d.num_pages,
    contentType: d.content_type,
    createdAt: d.created,
    updatedAt: d.created,
    versionKey: documentVersionKey({
      title: d.document_name,
      numPages: d.num_pages,
      updatedAt: d.created,
    }),
  }))

  const counts = await syncDataRoomDocuments(mapping.dataroomId, documents)
  await updateDataRoomSyncState(mapping.dataroomId, mapping.dataroomName, documents.length, null)
  await updateLevelRoomSyncState(publicTier, null)

  refresh()
  return {
    ok: true,
    message: `Synced: ${documents.length} documents (${counts.added} new, ${counts.updated} updated, ${counts.removed} removed).`,
  }
}

// ---------------------------------------------------------------------------
// Create a Data Room link for a subscriber
// ---------------------------------------------------------------------------

export async function createSubscriberDataRoomLink(subscriberId: string): Promise<FormState> {
  const admin = await requireAdmin()
  if (!UUID.test(subscriberId)) return { message: "Unknown subscriber." }

  const sql = getSql()
  const rows = (await sql`
    select id, full_name, email, public_tier, term_end, status,
           papermark_dataroom_id, papermark_dataroom_override
    from subscribers where id = ${subscriberId} and client_type = 'subscriber' limit 1
  `) as {
    id: string
    full_name: string
    email: string
    public_tier: string
    term_end: string | null
    status: string
    papermark_dataroom_id: string | null
    papermark_dataroom_override: string | null
  }[]

  const sub = rows[0]
  if (!sub) return { message: "Subscriber not found." }
  if (!sub.public_tier) return { message: "Set a subscription level before creating a Data Room link." }
  if (!sub.term_end) return { message: "Set a term end date before creating a Data Room link." }

  const room = await resolveDataRoom({
    subscriberId: sub.id,
    publicTier: sub.public_tier,
  })
  if (!room) return { message: "No Data Room mapped for this subscription level. Configure one under Data Rooms first." }

  const existingLink = await getDataRoomLink({
    subscriberId: sub.id,
    dataroomId: room.dataroomId,
  })
  if (existingLink) {
    return { message: "This subscriber already has a live Data Room link." }
  }

  const result = await createDataRoomLink({
    dataroomId: room.dataroomId,
    assignedName: sub.full_name,
    assignedEmail: sub.email,
    expiresAt: sub.term_end,
  })

  if (!result.ok) return { message: result.message }

  await saveDataRoomLink({
    subscriberId: sub.id,
    dataroomId: room.dataroomId,
    papermarkLinkId: result.value.linkId,
    linkUrl: result.value.url,
    assignedName: sub.full_name,
    assignedEmail: sub.email,
    watermarkEnabled: true,
    watermarkText: watermarkText(sub.full_name, sub.email),
    allowDownload: result.value.settings.allow_download,
    screenshotProtection: result.value.settings.enable_screenshot_protection,
    expiresAt: result.value.settings.expires_at,
  })

  await assignDataRoomToSubscriber(sub.id, room.dataroomId)

  await recordAssignment({
    subscriberId: sub.id,
    newDataroomId: room.dataroomId,
    newLinkId: result.value.linkId,
    reason: "Data Room link created",
    changedById: admin.id,
    changedByName: admin.name,
  })

  refresh()
  return { ok: true, message: "Data Room link created and assigned." }
}

// ---------------------------------------------------------------------------
// Revoke a Data Room link
// ---------------------------------------------------------------------------

export async function revokeSubscriberDataRoomLink(
  linkRecordId: string,
): Promise<FormState> {
  const admin = await requireAdmin()
  if (!UUID.test(linkRecordId)) return { message: "Unknown link." }

  const sql = getSql()
  const rows = (await sql`
    select id, papermark_link_id, subscriber_id, papermark_dataroom_id
    from papermark_dataroom_links where id = ${linkRecordId}::uuid limit 1
  `) as {
    id: string
    papermark_link_id: string
    subscriber_id: string | null
    papermark_dataroom_id: string
  }[]

  const link = rows[0]
  if (!link) return { message: "Link record not found." }

  const revokeResult = await revokeDataRoomLink(link.papermark_link_id)
  if (!revokeResult.ok) return { message: revokeResult.message }

  await markLinkRevoked(link.id)

  await recordAssignment({
    subscriberId: link.subscriber_id,
    previousDataroomId: link.papermark_dataroom_id,
    previousLinkId: link.papermark_link_id,
    reason: "Data Room link revoked",
    changedById: admin.id,
    changedByName: admin.name,
  })

  refresh()
  return { ok: true, message: "Link revoked." }
}

// ---------------------------------------------------------------------------
// Refresh analytics for a link
// ---------------------------------------------------------------------------

export async function refreshDataRoomLinkAnalytics(
  linkRecordId: string,
): Promise<FormState> {
  await requireAdmin()
  if (!UUID.test(linkRecordId)) return { message: "Unknown link." }

  const sql = getSql()
  const rows = (await sql`
    select id, papermark_link_id, subscriber_id, briefing_request_id
    from papermark_dataroom_links
    where id = ${linkRecordId}::uuid limit 1
  `) as { id: string; papermark_link_id: string; subscriber_id: string | null; briefing_request_id: string | null }[]

  const link = rows[0]
  if (!link) return { message: "Link not found." }

  const result = await getLinkAnalytics(link.papermark_link_id)
  if (!result.ok) return { message: result.message }

  await updateLinkAnalytics({
    linkId: link.id,
    totalViews: result.value.total_views,
    uniqueViewers: result.value.unique_viewers,
    totalDurationSeconds: result.value.total_duration_seconds,
  })

  let downloadNote = ""
  try {
    const downloads = await reconcileDownloadsFromViews({
      linkRecordId: link.id,
      subscriberId: link.subscriber_id,
      briefingRequestId: link.briefing_request_id,
    })
    if (downloads > 0) downloadNote = ` ${downloads} download${downloads === 1 ? "" : "s"} recorded.`
  } catch {}

  refresh()
  return {
    ok: true,
    message: `${result.value.total_views} views, ${result.value.unique_viewers} unique viewers.${downloadNote}`,
  }
}

// ---------------------------------------------------------------------------
// Fetch available Data Rooms from Papermark (for the admin dropdown)
// ---------------------------------------------------------------------------

export async function fetchAvailableDataRooms(): Promise<
  { ok: true; rooms: { id: string; name: string; documentCount: number }[] } |
  { ok: false; message: string }
> {
  await requireAdmin()
  const result = await listDataRooms()
  if (!result.ok) return { ok: false, message: result.message }
  return {
    ok: true,
    rooms: result.value.map((r) => ({
      id: r.id,
      name: r.name,
      documentCount: r.document_count ?? 0,
    })),
  }
}

// ---------------------------------------------------------------------------
// Seat management
// ---------------------------------------------------------------------------

export async function addSubscriberSeat(
  subscriberId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireAdmin()
  if (!UUID.test(subscriberId)) return { message: "Unknown subscriber." }

  const fullName = String(formData.get("seatName") ?? "").trim()
  const email = String(formData.get("seatEmail") ?? "").trim().toLowerCase()
  if (!fullName) return { errors: { seatName: ["A name is required."] } }
  if (!email || !email.includes("@")) return { errors: { seatEmail: ["A valid email is required."] } }

  try {
    await addSeat({ subscriberId, fullName, email })
  } catch (error) {
    const isUnique = Boolean(
      error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "23505"
    )
    return isUnique
      ? { message: "A seat with that email already exists for this subscriber." }
      : { message: "The seat could not be added." }
  }

  refresh()
  return { ok: true, message: `Seat added for ${fullName}.` }
}

export async function removeSubscriberSeat(seatId: string): Promise<FormState> {
  await requireAdmin()
  if (!UUID.test(seatId)) return { message: "Unknown seat." }
  const removed = await removeSeat(seatId)
  refresh()
  return removed
    ? { ok: true, message: "Seat removed." }
    : { message: "That seat does not exist." }
}

// ---------------------------------------------------------------------------
// Prepare document links (owner-only backfill)
// ---------------------------------------------------------------------------

export async function prepareDocumentLinks(subscriberId: string): Promise<FormState> {
  await requireOwner()
  if (!UUID.test(subscriberId)) return { message: "Unknown subscriber." }

  const { ensureAllDocumentLinks } = await import("@/lib/document-links")
  const result = await ensureAllDocumentLinks(subscriberId)

  refresh()
  if (result.errors > 0 && result.created === 0) {
    return { message: `Could not create document links. ${result.errors} error${result.errors === 1 ? "" : "s"}.` }
  }
  return {
    ok: true,
    message: [
      result.created > 0 ? `${result.created} document link${result.created === 1 ? "" : "s"} created.` : null,
      result.skipped > 0 ? `${result.skipped} already existed.` : null,
      result.errors > 0 ? `${result.errors} failed.` : null,
      result.created === 0 && result.skipped === 0 && result.errors === 0 ? "No documents need links." : null,
    ].filter(Boolean).join(" "),
  }
}

export async function prepareDocumentLinksForLevel(publicTier: string): Promise<FormState> {
  await requireOwner()
  if (!(PUBLIC_TIER_NAMES as readonly string[]).includes(publicTier)) return { message: "Unknown subscription level." }

  const room = await resolveDataRoom({ publicTier })
  if (!room) return { message: `No Data Room mapped for ${publicTier}.` }

  const { getActiveSubscriberIdsForRoom } = await import("@/lib/dataroom-dal")
  const subscriberIds = await getActiveSubscriberIdsForRoom(room.dataroomId)
  if (subscriberIds.length === 0) return { ok: true, message: "No active subscribers with a live link for this level." }

  const { ensureAllDocumentLinks } = await import("@/lib/document-links")

  let totalCreated = 0
  let totalSkipped = 0
  let totalFailed = 0
  let processed = 0

  for (const subId of subscriberIds) {
    try {
      const result = await ensureAllDocumentLinks(subId)
      totalCreated += result.created
      totalSkipped += result.skipped
      totalFailed += result.errors
      processed++
    } catch {
      totalFailed++
    }
  }

  refresh()

  if (totalFailed > 0 && totalCreated === 0) {
    return {
      message: `Could not create document links for ${subscriberIds.length} subscriber${subscriberIds.length === 1 ? "" : "s"}. ${totalFailed} error${totalFailed === 1 ? "" : "s"}.`,
    }
  }

  return {
    ok: true,
    message: [
      `${processed} subscriber${processed === 1 ? "" : "s"} processed.`,
      totalCreated > 0 ? `${totalCreated} link${totalCreated === 1 ? "" : "s"} created.` : null,
      totalSkipped > 0 ? `${totalSkipped} already existed.` : null,
      totalFailed > 0 ? `${totalFailed} failed.` : null,
      totalCreated === 0 && totalSkipped === 0 && totalFailed === 0 ? "All documents already have links." : null,
    ].filter(Boolean).join(" "),
  }
}

// ---------------------------------------------------------------------------
// Update watermarks on all live links (owner-only)
// ---------------------------------------------------------------------------

export async function updateAllWatermarks(): Promise<FormState> {
  await requireOwner()

  const { getAllLiveLinksForWatermark, updateLocalWatermarkText } = await import("@/lib/dataroom-dal")
  const { updateLinkWatermark } = await import("@/lib/papermark-datarooms")

  const links = await getAllLiveLinksForWatermark()
  if (links.length === 0) return { ok: true, message: "No live links to update." }

  let updated = 0
  let failed = 0

  for (const link of links) {
    const newText = watermarkText(link.assignedName, link.assignedEmail)
    const result = await updateLinkWatermark({
      linkId: link.papermarkLinkId,
      assignedName: link.assignedName,
      assignedEmail: link.assignedEmail,
    })
    if (result.ok) {
      await updateLocalWatermarkText(link.table, link.id, newText)
      updated++
    } else {
      failed++
    }
  }

  refresh()
  return {
    ok: failed === 0,
    message: [
      `${updated} link${updated === 1 ? "" : "s"} updated.`,
      failed > 0 ? `${failed} failed — Papermark may not support partial watermark updates on those links.` : null,
    ].filter(Boolean).join(" "),
  }
}

// ---------------------------------------------------------------------------
// Link/unlink editorial publication to a synced Data Room document
// ---------------------------------------------------------------------------

export async function linkPublicationToSyncedDocument(
  documentRowId: string,
  publicationId: string,
): Promise<FormState> {
  await requireOwner()
  if (!UUID.test(documentRowId)) return { message: "Unknown document." }
  if (!UUID.test(publicationId)) return { message: "Unknown publication." }

  const { linkPublicationToDocument } = await import("@/lib/dataroom-dal")
  const linked = await linkPublicationToDocument(documentRowId, publicationId)
  refresh()
  return linked
    ? { ok: true, message: "Publication linked." }
    : { message: "Document not found." }
}

export async function unlinkPublicationFromSyncedDocument(
  documentRowId: string,
): Promise<FormState> {
  await requireOwner()
  if (!UUID.test(documentRowId)) return { message: "Unknown document." }

  const { unlinkPublicationFromDocument } = await import("@/lib/dataroom-dal")
  const unlinked = await unlinkPublicationFromDocument(documentRowId)
  refresh()
  return unlinked
    ? { ok: true, message: "Publication unlinked." }
    : { message: "Document not found." }
}

export async function createPublicationForDocument(
  documentRowId: string,
  publicTier?: string,
): Promise<FormState & { publicationId?: string }> {
  await requireOwner()
  if (!UUID.test(documentRowId)) return { message: "Unknown document." }

  try {
    const { createPublicationForSyncedDocument } = await import("@/lib/dataroom-dal")
    const result = await createPublicationForSyncedDocument({
      documentRowId,
      publicTier: publicTier || null,
    })
    refresh()
    return {
      ok: true,
      publicationId: result.publicationId,
      message: result.created
        ? "Publication record created."
        : "Linked to existing publication record.",
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Could not create publication."
    return { message: msg }
  }
}

export async function autoLinkPublicationsByPapermarkId(
  publicTier: string,
): Promise<FormState> {
  await requireOwner()
  if (!(PUBLIC_TIER_NAMES as readonly string[]).includes(publicTier)) return { message: "Unknown level." }

  const room = await resolveDataRoom({ publicTier })
  if (!room) return { message: `No Data Room mapped for ${publicTier}.` }

  const { autoLinkByPapermarkId } = await import("@/lib/dataroom-dal")
  const counts = await autoLinkByPapermarkId(room.dataroomId)
  refresh()
  const parts = [
    counts.linked > 0 ? `${counts.linked} linked` : null,
    counts.alreadyLinked > 0 ? `${counts.alreadyLinked} already linked` : null,
    counts.noMatch > 0 ? `${counts.noMatch} no matching publication` : null,
  ].filter(Boolean)
  return {
    ok: true,
    message: parts.length > 0 ? parts.join(', ') + '.' : 'No documents in this room.',
  }
}

// ---------------------------------------------------------------------------
// Record a portal download click (no Papermark URL stored)
// ---------------------------------------------------------------------------

export async function recordPortalDownloadClick(
  documentId: string,
): Promise<FormState> {
  const sql = getSql()
  const { readSubscriberSession } = await import("@/lib/subscriber-session")

  const session = await readSubscriberSession()
  if (!session) return { message: "Not authenticated." }

  if (!documentId || documentId.length > 200) return { message: "Invalid document." }

  await sql`
    insert into client_engagement_events
      (subscriber_id, event_type, occurred_at)
    values (${session.principalId}::uuid, 'document_downloaded', now())
  `

  return { ok: true, message: "Download recorded." }
}

// ---------------------------------------------------------------------------
// Refresh Data Room and notify subscribers of new documents (owner only)
// ---------------------------------------------------------------------------

export async function syncAndNotify(publicTier: string): Promise<FormState> {
  const admin = await requireOwner()
  if (!publicTier) return { message: "Missing level." }

  const syncResult = await syncDataRoomForLevel(publicTier)
  if (!syncResult?.ok) return syncResult

  const mappings = await getLevelRoomMappings()
  const mapping = mappings.find((m) => m.publicTier === publicTier)
  if (!mapping) return syncResult

  const sql = getSql()

  const newDocs = (await sql`
    select dd.id as doc_id, dd.title, dd.version_key
    from papermark_dataroom_documents dd
    where dd.papermark_dataroom_id = ${mapping.dataroomId}
      and dd.is_present = true
      and dd.first_seen_at > now() - interval '7 days'
  `) as { doc_id: string; title: string; version_key: string }[]

  if (newDocs.length === 0) {
    return { ok: true, message: `${syncResult.message} No new documents to notify about.` }
  }

  const subscribers = (await sql`
    select s.id, s.full_name, s.email
    from subscribers s
    where s.client_type = 'subscriber'
      and lower(s.status) = 'active'
      and s.public_tier = ${publicTier}
  `) as { id: string; full_name: string; email: string }[]

  let notified = 0
  for (const sub of subscribers) {
    for (const doc of newDocs) {
      try {
        await sql`
          insert into papermark_document_notifications
            (subscriber_id, dataroom_document_id, version_key)
          values (${sub.id}::uuid, ${doc.doc_id}::uuid, ${doc.version_key})
        `
        notified++
      } catch {
        // Unique constraint: already notified for this version.
      }
    }
  }

  refresh()
  return {
    ok: true,
    message: `${syncResult.message} ${notified} notification${notified === 1 ? "" : "s"} queued for ${subscribers.length} subscriber${subscribers.length === 1 ? "" : "s"}.`,
  }
}

// ---------------------------------------------------------------------------
// Migrate one subscriber to Data Rooms (owner only, per-subscriber)
// ---------------------------------------------------------------------------

export async function migrateSubscriberToDataRoom(
  subscriberId: string,
): Promise<FormState> {
  const admin = await requireOwner()
  if (!UUID.test(subscriberId)) return { message: "Unknown subscriber." }

  const sql = getSql()
  const rows = (await sql`
    select id, full_name, email, public_tier, term_end, status,
           papermark_dataroom_id, papermark_dataroom_override, library_link_url
    from subscribers where id = ${subscriberId} and client_type = 'subscriber' limit 1
  `) as {
    id: string
    full_name: string
    email: string
    public_tier: string
    term_end: string | null
    status: string
    papermark_dataroom_id: string | null
    papermark_dataroom_override: string | null
    library_link_url: string | null
  }[]

  const sub = rows[0]
  if (!sub) return { message: "Subscriber not found." }
  if (sub.status.toLowerCase() !== "active") return { message: "Only active subscribers can be migrated." }
  if (!sub.public_tier) return { message: "Subscriber has no subscription level." }
  if (!sub.term_end) return { message: "Subscriber has no term end date." }

  const existingLink = sub.papermark_dataroom_id
    ? await getDataRoomLink({ subscriberId: sub.id, dataroomId: sub.papermark_dataroom_id })
    : null
  if (existingLink) return { message: "Subscriber already has a live Data Room link." }

  const room = await resolveDataRoom({
    subscriberId: sub.id,
    publicTier: sub.public_tier,
  })
  if (!room) return { message: "No Data Room is mapped for this subscription level." }

  const result = await createDataRoomLink({
    dataroomId: room.dataroomId,
    assignedName: sub.full_name,
    assignedEmail: sub.email,
    expiresAt: sub.term_end,
  })

  if (!result.ok) return { message: result.message }

  await saveDataRoomLink({
    subscriberId: sub.id,
    dataroomId: room.dataroomId,
    papermarkLinkId: result.value.linkId,
    linkUrl: result.value.url,
    assignedName: sub.full_name,
    assignedEmail: sub.email,
    watermarkEnabled: true,
    watermarkText: watermarkText(sub.full_name, sub.email),
    allowDownload: result.value.settings.allow_download,
    screenshotProtection: result.value.settings.enable_screenshot_protection,
    expiresAt: result.value.settings.expires_at,
  })

  await assignDataRoomToSubscriber(sub.id, room.dataroomId)

  await recordAssignment({
    subscriberId: sub.id,
    newDataroomId: room.dataroomId,
    newLinkId: result.value.linkId,
    reason: "Migrated to Data Room from legacy library link",
    changedById: admin.id,
    changedByName: admin.name,
  })

  refresh()
  return {
    ok: true,
    message: `Migrated to Data Room. Legacy library link preserved as fallback.`,
  }
}

// ---------------------------------------------------------------------------
// Briefing Data Room actions
// ---------------------------------------------------------------------------

export async function createBriefingDataRoomLink(
  briefingRequestId: string,
): Promise<FormState> {
  const admin = await requireAdmin()
  if (!UUID.test(briefingRequestId)) return { message: "Unknown briefing." }

  const sql = getSql()
  const rows = (await sql`
    select id, name, email, papermark_dataroom_id, status
    from briefing_requests where id = ${briefingRequestId} limit 1
  `) as {
    id: string
    name: string
    email: string
    papermark_dataroom_id: string | null
    status: string
  }[]

  const briefing = rows[0]
  if (!briefing) return { message: "Briefing not found." }
  if (!briefing.papermark_dataroom_id) {
    return { message: "Assign a Data Room to this briefing first." }
  }

  const existingLink = await getDataRoomLink({
    briefingRequestId: briefing.id,
    dataroomId: briefing.papermark_dataroom_id,
  })
  if (existingLink) return { message: "This briefing already has a live Data Room link." }

  const result = await createDataRoomLink({
    dataroomId: briefing.papermark_dataroom_id,
    assignedName: briefing.name,
    assignedEmail: briefing.email,
    expiresAt: null,
  })

  if (!result.ok) return { message: result.message }

  await saveDataRoomLink({
    briefingRequestId: briefing.id,
    dataroomId: briefing.papermark_dataroom_id,
    papermarkLinkId: result.value.linkId,
    linkUrl: result.value.url,
    assignedName: briefing.name,
    assignedEmail: briefing.email,
    watermarkEnabled: true,
    watermarkText: watermarkText(briefing.name, briefing.email),
    allowDownload: result.value.settings.allow_download,
    screenshotProtection: result.value.settings.enable_screenshot_protection,
    expiresAt: result.value.settings.expires_at,
  })

  await sql`
    update briefing_requests
    set papermark_dataroom_id = ${briefing.papermark_dataroom_id},
        updated_at = now()
    where id = ${briefing.id}
  `

  await recordAssignment({
    briefingRequestId: briefing.id,
    newDataroomId: briefing.papermark_dataroom_id,
    newLinkId: result.value.linkId,
    reason: "Briefing Data Room link created",
    changedById: admin.id,
    changedByName: admin.name,
  })

  refresh()
  return { ok: true, message: "Briefing Data Room link created." }
}

export async function assignDataRoomToBriefing(
  briefingRequestId: string,
  dataroomId: string,
): Promise<FormState> {
  await requireOwner()
  if (!UUID.test(briefingRequestId)) return { message: "Unknown briefing." }
  if (!dataroomId) return { message: "Select a Data Room." }

  const room = await getDataRoom(dataroomId)
  if (!room.ok) return { message: `Could not verify the Data Room: ${room.message}` }

  const sql = getSql()
  await sql`
    update briefing_requests
    set papermark_dataroom_id = ${dataroomId}, updated_at = now()
    where id = ${briefingRequestId}
  `

  refresh()
  return { ok: true, message: `Briefing assigned to "${room.value.name}".` }
}

export async function revokeBriefingDataRoomLink(
  linkRecordId: string,
): Promise<FormState> {
  const admin = await requireAdmin()
  if (!UUID.test(linkRecordId)) return { message: "Unknown link." }

  const sql = getSql()
  const rows = (await sql`
    select id, papermark_link_id, briefing_request_id, papermark_dataroom_id
    from papermark_dataroom_links where id = ${linkRecordId}::uuid limit 1
  `) as {
    id: string
    papermark_link_id: string
    briefing_request_id: string | null
    papermark_dataroom_id: string
  }[]

  const link = rows[0]
  if (!link) return { message: "Link record not found." }

  const revokeResult = await revokeDataRoomLink(link.papermark_link_id)
  if (!revokeResult.ok) return { message: revokeResult.message }

  await markLinkRevoked(link.id)

  await recordAssignment({
    briefingRequestId: link.briefing_request_id,
    previousDataroomId: link.papermark_dataroom_id,
    previousLinkId: link.papermark_link_id,
    reason: "Briefing Data Room link revoked",
    changedById: admin.id,
    changedByName: admin.name,
  })

  refresh()
  return { ok: true, message: "Briefing link revoked." }
}
