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
    category: categoriseDataRoomDocument({ title: d.document_name, category: d.folder_path }),
    folderId: d.folder_id,
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
