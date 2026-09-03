"use server"

import { revalidatePath } from "next/cache"
import { requireOwner } from "@/lib/dal"
import { getSql } from "@/lib/db"
import type { FormState } from "@/lib/definitions"
import { prefillReviewCard } from "@/lib/review-prefill"
import {
  classifyReviewDocument,
  generateReviewMetadata,
  isReviewSeries,
  type ReviewSeries,
} from "@/lib/review-classify"
import { documentVersionKey } from "@/lib/papermark-dataroom-contract"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const FIXED_SLOTS = ['MIN', 'AIU', 'PLM'] as const
const SLOT_ORDER: Record<string, number> = { MIN: 0, AIU: 1, PLM: 2 }

function refresh() {
  revalidatePath("/admin/review-library")
  revalidatePath("/")
  revalidatePath("/publications")
}

// ---------------------------------------------------------------------------
// Ensure the three fixed slots exist (idempotent)
// ---------------------------------------------------------------------------

export async function ensureFixedSlots(): Promise<FormState> {
  await requireOwner()
  const sql = getSql()

  for (const slotKey of FIXED_SLOTS) {
    const existing = (await sql`
      select id from complimentary_review_items where slot_key = ${slotKey} limit 1
    `) as { id: string }[]

    if (existing[0]) continue

    const existingBySeries = (await sql`
      select ri.id from complimentary_review_items ri
      join documents d on d.id = ri.publication_id
      where d.series = ${slotKey} limit 1
    `) as { id: string }[]

    if (existingBySeries[0]) {
      await sql`
        update complimentary_review_items
        set slot_key = ${slotKey}, display_order = ${SLOT_ORDER[slotKey]!}, updated_at = now()
        where id = ${existingBySeries[0].id}::uuid
      `
      continue
    }

    const pub = (await sql`
      select id, title, series, product_line, frequency, summary, description
      from documents where series = ${slotKey} limit 1
    `) as {
      id: string; title: string; series: string; product_line: string
      frequency: string; summary: string; description: string
    }[]

    if (!pub[0]) continue

    const card = prefillReviewCard(pub[0])
    await sql`
      insert into complimentary_review_items
        (publication_id, slot_key, display_order, publication_type, description, frequency, audience, is_active)
      values (
        ${pub[0].id}::uuid, ${slotKey}, ${SLOT_ORDER[slotKey]!},
        ${card.publicationType}, ${card.description}, ${card.frequency}, ${card.audience}, true
      )
      on conflict (slot_key) where slot_key <> '' do nothing
    `
  }

  refresh()
  return { ok: true, message: "Fixed slots ensured." }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function saveReviewLibrarySettings(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireOwner()
  const sql = getSql()

  const enabled = formData.get("enabled") === "on"

  if (enabled) {
    const slots = (await sql`
      select slot_key, secure_link_url, publication_id, papermark_document_id,
             secure_link_document_id, secure_link_verified_at
      from complimentary_review_items
      where slot_key in ('MIN', 'AIU', 'PLM') and is_active = true
    `) as {
      slot_key: string
      secure_link_url: string
      publication_id: string
      papermark_document_id: string | null
      secure_link_document_id: string | null
      secure_link_verified_at: string | null
    }[]

    if (slots.length !== 3) {
      return { message: "Cannot enable: all three fixed slots (MIN, AIU, PLM) must exist and be active." }
    }

    const missing: string[] = []
    for (const s of slots) {
      if (!s.publication_id) missing.push(`${s.slot_key}: no mapped document`)
      if (!s.secure_link_url) missing.push(`${s.slot_key}: no secure link URL`)
      else if (!s.secure_link_verified_at) {
        missing.push(`${s.slot_key}: secure link not verified against Papermark`)
      } else if (
        s.papermark_document_id &&
        s.secure_link_document_id !== s.papermark_document_id
      ) {
        missing.push(`${s.slot_key}: secure link points at a different document than the one mapped`)
      }
    }
    if (missing.length > 0) {
      return { message: `Cannot enable. ${missing.join('; ')}.` }
    }
  }

  await sql`
    insert into app_settings (key, value)
    values ('review_library_enabled', ${enabled ? 'true' : 'false'})
    on conflict (key) do update set value = excluded.value
  `

  refresh()
  return { ok: true, message: enabled ? "Library enabled." : "Library disabled." }
}

// ---------------------------------------------------------------------------
// Data Room selection (owner only)
// ---------------------------------------------------------------------------

export async function fetchAvailableReviewDataRooms(): Promise<
  { ok: true; rooms: { id: string; name: string; documentCount: number }[] } |
  { ok: false; message: string }
> {
  await requireOwner()
  const { listDataRooms } = await import("@/lib/papermark-datarooms")
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

export async function saveReviewDataRoom(dataroomId: string): Promise<FormState> {
  await requireOwner()
  if (!dataroomId) return { message: "Select a Data Room." }

  const { getDataRoom } = await import("@/lib/papermark-datarooms")
  const result = await getDataRoom(dataroomId)
  if (!result.ok) return { message: `Could not verify: ${result.message}` }

  const sql = getSql()
  await sql`
    insert into app_settings (key, value)
    values ('review_library_papermark_dataroom_id', ${dataroomId})
    on conflict (key) do update set value = excluded.value
  `

  refresh()
  return { ok: true, message: `Data Room "${result.value.name}" selected.` }
}

// ---------------------------------------------------------------------------
// Update a slot's secure Papermark document link
// ---------------------------------------------------------------------------

export async function updateSlotSecureLink(
  slotKey: string,
  secureUrl: string,
): Promise<FormState> {
  await requireOwner()
  if (!FIXED_SLOTS.includes(slotKey as typeof FIXED_SLOTS[number])) {
    return { message: "Invalid slot." }
  }

  const url = secureUrl.trim()
  if (url && !url.startsWith("https://")) {
    return { message: "Must be an https:// URL." }
  }

  const sql = getSql()

  // Clearing the field is always allowed: it takes the slot out of the public
  // library, which is the safe direction.
  if (!url) {
    const cleared = (await sql`
      update complimentary_review_items
      set secure_link_url = '', secure_link_id = null,
          secure_link_document_id = null, secure_link_verified_at = null,
          updated_at = now()
      where slot_key = ${slotKey}
      returning id
    `) as { id: string }[]
    if (!cleared[0]) return { message: `Slot ${slotKey} not found. Ensure fixed slots first.` }
    refresh()
    return { ok: true, message: "Secure link cleared. This slot is no longer public." }
  }

  const slot = (await sql`
    select id, papermark_document_id
    from complimentary_review_items
    where slot_key = ${slotKey}
    limit 1
  `) as { id: string; papermark_document_id: string | null }[]

  if (!slot[0]) return { message: `Slot ${slotKey} not found. Ensure fixed slots first.` }

  const docId = (slot[0].papermark_document_id ?? '').trim()
  if (!docId) {
    return { message: `${slotKey} has no mapped Papermark document. Map one before saving a link.` }
  }

  // A pasted address is not trusted. The link id is read out of the URL and
  // checked against Papermark, because a URL that happens to be https and
  // happens to be on the right host can still point at the wrong document --
  // or at the whole Data Room, which is the leak this design exists to stop.
  const linkId = reviewLinkIdFromUrl(url)
  if (!linkId) {
    return {
      message:
        "Could not read a Papermark link id out of that URL. Use Create secure review link instead, or paste the full Papermark share URL.",
    }
  }

  const { verifyReviewDocumentLink } = await import("@/lib/papermark-datarooms")
  const verified = await verifyReviewDocumentLink({ linkId, expectedDocumentId: docId })
  if (!verified.ok) {
    return { message: `Not saved. ${verified.message}` }
  }

  await sql`
    update complimentary_review_items
    set secure_link_url = ${verified.value.url},
        secure_link_id = ${linkId},
        secure_link_document_id = ${docId},
        secure_link_verified_at = now(),
        updated_at = now()
    where id = ${slot[0].id}::uuid
  `

  refresh()
  return { ok: true, message: "Secure link verified against Papermark and saved." }
}

/**
 * Reads a Papermark link id out of a share URL.
 *
 * Papermark share URLs end in the link id, on either the api host or a verified
 * custom domain. Anything else returns null so the caller refuses the paste
 * rather than storing an address it cannot verify.
 */
function reviewLinkIdFromUrl(url: string): string | null {
  try {
    const u = new URL(url)
    const segments = u.pathname.split('/').filter(Boolean)
    const last = segments[segments.length - 1] ?? ''
    return /^[A-Za-z0-9_-]{6,}$/.test(last) ? last : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Provision the secure review link through the Papermark API (owner only)
// ---------------------------------------------------------------------------

type SlotLinkRow = {
  id: string
  papermark_document_id: string | null
  secure_link_url: string
  secure_link_id: string | null
  secure_link_document_id: string | null
  pending_papermark_document_id: string | null
  pending_clean_title: string | null
  pending_secure_link_id: string | null
  pending_secure_link_url: string | null
  pending_secure_link_document_id: string | null
  pub_title: string | null
}

async function loadSlotForLinking(
  sql: ReturnType<typeof getSql>,
  slotKey: string,
): Promise<SlotLinkRow | null> {
  const rows = (await sql`
    select ri.id, ri.papermark_document_id, ri.secure_link_url,
           ri.secure_link_id, ri.secure_link_document_id,
           ri.pending_papermark_document_id, ri.pending_clean_title,
           ri.pending_secure_link_id, ri.pending_secure_link_url,
           ri.pending_secure_link_document_id,
           d.title as pub_title
    from complimentary_review_items ri
    left join documents d on d.id = ri.publication_id
    where ri.slot_key = ${slotKey}
    limit 1
  `) as SlotLinkRow[]
  return rows[0] ?? null
}

/**
 * Confirms exactly one unambiguous current document is mapped to a slot.
 *
 * Refusing here rather than guessing is deliberate: creating a link against the
 * wrong document would publish the wrong PDF, and the sync deliberately leaves
 * a newly detected edition pending rather than replacing the mapping.
 */
async function resolveCurrentDocument(
  sql: ReturnType<typeof getSql>,
  slotKey: string,
  slot: SlotLinkRow,
): Promise<{ ok: true; documentId: string; title: string } | { ok: false; message: string }> {
  const docId = (slot.papermark_document_id ?? '').trim()
  if (!docId) {
    return {
      ok: false,
      message: `${slotKey} has no mapped Papermark document. Sync the Data Room and map a document to this slot first.`,
    }
  }

  // More than one candidate approved for the same series means the mapping is
  // ambiguous and a human has to resolve it before a public link is minted.
  const approved = (await sql`
    select papermark_document_id from review_sync_candidates
    where detected_series = ${slotKey} and sync_status = 'approved' and is_present = true
  `) as { papermark_document_id: string }[]

  const distinct = [...new Set(approved.map((r) => r.papermark_document_id))]
  if (distinct.length > 1) {
    return {
      ok: false,
      message: `${slotKey} has ${distinct.length} approved documents in the Data Room. Resolve the duplicate before creating a link.`,
    }
  }

  return { ok: true, documentId: docId, title: slot.pub_title ?? slotKey }
}

/**
 * Creates the slot's public review link through the Papermark API.
 *
 * Idempotent: a slot that already has a verified link for the same document is
 * left alone rather than accumulating duplicate public links for one PDF.
 */
export async function createSlotSecureLink(slotKey: string): Promise<FormState> {
  await requireOwner()
  if (!FIXED_SLOTS.includes(slotKey as typeof FIXED_SLOTS[number])) {
    return { message: "Invalid slot." }
  }

  const sql = getSql()
  const slot = await loadSlotForLinking(sql, slotKey)
  if (!slot) return { message: `Slot ${slotKey} not found. Ensure fixed slots first.` }

  const current = await resolveCurrentDocument(sql, slotKey, slot)
  if (!current.ok) return { message: current.message }

  // Already provisioned for this exact document: do not mint a second link.
  if (
    slot.secure_link_id &&
    slot.secure_link_document_id === current.documentId &&
    slot.secure_link_url
  ) {
    return {
      ok: true,
      message: `${slotKey} already has a link for this document. Use Verify to re-check it.`,
    }
  }

  const { createReviewDocumentLink, revokeReviewDocumentLink } = await import(
    "@/lib/papermark-datarooms"
  )

  const created = await createReviewDocumentLink({
    documentId: current.documentId,
    slotKey,
    documentTitle: current.title,
  })

  // The slot is left exactly as it was, so a failed call cannot take a working
  // card off the public page.
  if (!created.ok) return { message: `Link not created. ${created.message}` }

  const previousLinkId = slot.secure_link_id

  try {
    await sql`
      update complimentary_review_items
      set secure_link_url = ${created.value.url},
          secure_link_id = ${created.value.linkId},
          secure_link_document_id = ${current.documentId},
          secure_link_verified_at = now(),
          updated_at = now()
      where id = ${slot.id}::uuid
    `
  } catch (error) {
    // The link exists in Papermark but is recorded nowhere. Best-effort revoke
    // so it does not sit there as an unreferenced public address.
    const revoked = await revokeReviewDocumentLink(created.value.linkId)
    const tail = revoked.ok
      ? "The new link was revoked, so nothing was left exposed."
      : `The new link ${created.value.linkId} could NOT be revoked and must be removed manually in Papermark.`
    return {
      message: `Papermark created the link but saving it failed. ${tail} ${
        error instanceof Error ? error.message : "Unknown storage error."
      }`,
    }
  }

  // A superseded link for the same slot is retired on a best-effort basis; the
  // new link is already live either way.
  let tail = ""
  if (previousLinkId && previousLinkId !== created.value.linkId) {
    const revoked = await revokeReviewDocumentLink(previousLinkId)
    tail = revoked.ok
      ? " The previous link was revoked."
      : ` The previous link ${previousLinkId} could not be revoked and still needs manual revocation in Papermark.`
  }

  refresh()
  return { ok: true, message: `${slotKey} secure review link created.${tail}` }
}

/**
 * Re-checks the slot's saved link against Papermark, repairing its settings.
 *
 * Touches only the link id already stored for this slot -- never lists, never
 * walks the Data Room, and never goes near a subscriber link.
 */
export async function verifySlotSecureLink(slotKey: string): Promise<FormState> {
  await requireOwner()
  if (!FIXED_SLOTS.includes(slotKey as typeof FIXED_SLOTS[number])) {
    return { message: "Invalid slot." }
  }

  const sql = getSql()
  const slot = await loadSlotForLinking(sql, slotKey)
  if (!slot) return { message: `Slot ${slotKey} not found. Ensure fixed slots first.` }

  const current = await resolveCurrentDocument(sql, slotKey, slot)
  if (!current.ok) return { message: current.message }

  const linkId = (slot.secure_link_id ?? '').trim()
  if (!linkId) {
    return {
      message: `${slotKey} has no API-created link to verify. Use Create secure review link.`,
    }
  }

  const { verifyReviewDocumentLink, updateReviewDocumentLink } = await import(
    "@/lib/papermark-datarooms"
  )

  const verified = await verifyReviewDocumentLink({
    linkId,
    expectedDocumentId: current.documentId,
  })
  if (!verified.ok) return { message: `Verification failed. ${verified.message}` }

  // Re-apply the review settings so a watermark or email gate changed inside
  // Papermark is put back without minting a new address.
  const repaired = await updateReviewDocumentLink({
    linkId,
    documentId: current.documentId,
    slotKey,
    documentTitle: current.title,
  })
  if (!repaired.ok) return { message: `Link verified but settings could not be re-applied. ${repaired.message}` }

  await sql`
    update complimentary_review_items
    set secure_link_url = ${repaired.value.url},
        secure_link_document_id = ${current.documentId},
        secure_link_verified_at = now(),
        updated_at = now()
    where id = ${slot.id}::uuid
  `

  refresh()
  return { ok: true, message: `${slotKey} link verified and settings re-applied.` }
}

/**
 * Creates a link for a pending new edition without touching the live card.
 *
 * Writes only the `pending_secure_link_*` columns, so the public page keeps
 * serving the current edition until the owner confirms Make current.
 */
export async function preparePendingSecureLink(slotKey: string): Promise<FormState> {
  await requireOwner()
  if (!FIXED_SLOTS.includes(slotKey as typeof FIXED_SLOTS[number])) {
    return { message: "Invalid slot." }
  }

  const sql = getSql()
  const slot = await loadSlotForLinking(sql, slotKey)
  if (!slot) return { message: `Slot ${slotKey} not found.` }

  const pendingDocId = (slot.pending_papermark_document_id ?? '').trim()
  if (!pendingDocId) return { message: `${slotKey} has no pending edition.` }

  if (
    slot.pending_secure_link_id &&
    slot.pending_secure_link_document_id === pendingDocId &&
    slot.pending_secure_link_url
  ) {
    return {
      ok: true,
      message: `${slotKey} pending edition already has a prepared link.`,
    }
  }

  const { createReviewDocumentLink, revokeReviewDocumentLink } = await import(
    "@/lib/papermark-datarooms"
  )

  const created = await createReviewDocumentLink({
    documentId: pendingDocId,
    slotKey,
    documentTitle: slot.pending_clean_title ?? slotKey,
  })
  if (!created.ok) return { message: `Link not created. ${created.message}` }

  try {
    await sql`
      update complimentary_review_items
      set pending_secure_link_url = ${created.value.url},
          pending_secure_link_id = ${created.value.linkId},
          pending_secure_link_document_id = ${pendingDocId},
          pending_secure_link_verified_at = now(),
          updated_at = now()
      where id = ${slot.id}::uuid
    `
  } catch (error) {
    const revoked = await revokeReviewDocumentLink(created.value.linkId)
    const tail = revoked.ok
      ? "The new link was revoked, so nothing was left exposed."
      : `The new link ${created.value.linkId} could NOT be revoked and must be removed manually in Papermark.`
    return {
      message: `Papermark created the pending link but saving it failed. ${tail} ${
        error instanceof Error ? error.message : "Unknown storage error."
      }`,
    }
  }

  // Deliberately only the admin page. The public pages must not change: the
  // pending edition is not live until the owner confirms it.
  revalidatePath("/admin/review-library")
  return {
    ok: true,
    message: `${slotKey} pending edition link prepared. The public card is unchanged until you choose Make current.`,
  }
}

// ---------------------------------------------------------------------------
// Sync documents from the Complimentary Review Data Room
// ---------------------------------------------------------------------------

export async function syncReviewLibrary(): Promise<FormState> {
  await requireOwner()
  const sql = getSql()

  const drRow = (await sql`
    select value from app_settings where key = 'review_library_papermark_dataroom_id' limit 1
  `) as { value: string }[]
  const dataroomId = drRow[0]?.value ?? ''

  if (!dataroomId) {
    return { message: "No Complimentary Review Data Room configured. Select one first." }
  }

  const { listDataRoomDocuments } = await import("@/lib/papermark-datarooms")
  const docsResult = await listDataRoomDocuments(dataroomId)
  if (!docsResult.ok) {
    await sql`
      insert into app_settings (key, value)
      values ('review_library_last_sync_result', ${docsResult.message})
      on conflict (key) do update set value = excluded.value
    `
    return { message: docsResult.message }
  }

  const docs = docsResult.value
  let added = 0
  let updated = 0
  let unchanged = 0

  for (const d of docs) {
    const classification = classifyReviewDocument(d.document_name, d.folder_path)
    const vKey = documentVersionKey({
      title: d.document_name,
      numPages: d.num_pages,
      updatedAt: d.created,
    })

    const existing = (await sql`
      select id, version_key, is_present
      from review_sync_candidates
      where papermark_document_id = ${d.document_id}
      limit 1
    `) as { id: string; version_key: string; is_present: boolean }[]

    if (!existing[0]) {
      await sql`
        insert into review_sync_candidates (
          papermark_document_id, papermark_dataroom_id, raw_filename,
          clean_title, num_pages, folder_path,
          papermark_created_at, papermark_updated_at,
          detected_series, detected_edition_date, version_key,
          sync_status, is_present
        ) values (
          ${d.document_id}, ${dataroomId}, ${d.document_name},
          ${classification.cleanTitle}, ${d.num_pages ?? null}, ${d.folder_path ?? null},
          ${d.created ? new Date(d.created) : null}, ${d.created ? new Date(d.created) : null},
          ${classification.series ?? ''}, ${classification.editionDate ?? null}, ${vKey},
          'pending', true
        )
        on conflict (papermark_document_id) do nothing
      `
      added++

      if (classification.series && isReviewSeries(classification.series)) {
        await detectPendingVersion(sql, classification.series, d.document_id, classification.cleanTitle, vKey)
      }
    } else if (existing[0].version_key !== vKey || !existing[0].is_present) {
      await sql`
        update review_sync_candidates set
          raw_filename = ${d.document_name},
          clean_title = ${classification.cleanTitle},
          num_pages = ${d.num_pages ?? null},
          folder_path = ${d.folder_path ?? null},
          papermark_updated_at = ${d.created ? new Date(d.created) : null},
          detected_series = ${classification.series ?? ''},
          detected_edition_date = ${classification.editionDate ?? null},
          version_key = ${vKey},
          last_seen_at = now(),
          is_present = true,
          updated_at = now()
        where papermark_document_id = ${d.document_id}
      `
      updated++

      if (classification.series && isReviewSeries(classification.series)) {
        await detectPendingVersion(sql, classification.series, d.document_id, classification.cleanTitle, vKey)
      }
    } else {
      await sql`
        update review_sync_candidates set last_seen_at = now()
        where papermark_document_id = ${d.document_id}
      `
      unchanged++
    }
  }

  const presentIds = docs.map((d) => d.document_id)
  if (presentIds.length > 0) {
    await sql`
      update review_sync_candidates set is_present = false, updated_at = now()
      where papermark_dataroom_id = ${dataroomId}
        and is_present = true
        and papermark_document_id != all(${presentIds})
    `
  }

  const now = new Date().toISOString()
  const summary = `${docs.length} documents (${added} new, ${updated} updated, ${unchanged} unchanged)`
  await sql`
    insert into app_settings (key, value)
    values ('review_library_last_sync_at', ${now})
    on conflict (key) do update set value = excluded.value
  `
  await sql`
    insert into app_settings (key, value)
    values ('review_library_last_sync_result', ${summary})
    on conflict (key) do update set value = excluded.value
  `

  refresh()
  return { ok: true, message: `Synced: ${summary}.` }
}

async function detectPendingVersion(
  sql: ReturnType<typeof getSql>,
  series: string,
  papermarkDocId: string,
  cleanTitle: string,
  versionKey: string,
) {
  const slot = (await sql`
    select ri.id, ri.papermark_document_id
    from complimentary_review_items ri
    where ri.slot_key = ${series}
    limit 1
  `) as { id: string; papermark_document_id: string | null }[]

  if (!slot[0]) return
  if (slot[0].papermark_document_id === papermarkDocId) return

  await sql`
    update complimentary_review_items set
      pending_papermark_document_id = ${papermarkDocId},
      pending_clean_title = ${cleanTitle},
      pending_version_key = ${versionKey},
      pending_detected_at = now(),
      updated_at = now()
    where id = ${slot[0].id}::uuid
  `
}

// ---------------------------------------------------------------------------
// Make a pending version current (owner confirmation required)
// ---------------------------------------------------------------------------

export async function makeVersionCurrent(slotKey: string): Promise<FormState> {
  await requireOwner()
  if (!FIXED_SLOTS.includes(slotKey as typeof FIXED_SLOTS[number])) {
    return { message: "Invalid slot." }
  }

  const sql = getSql()

  const slot = (await sql`
    select ri.id, ri.publication_id, ri.owner_edited_fields,
           ri.pending_papermark_document_id, ri.pending_clean_title,
           ri.publication_type, ri.description, ri.frequency, ri.audience,
           ri.secure_link_id,
           ri.pending_secure_link_id, ri.pending_secure_link_url,
           ri.pending_secure_link_document_id, ri.pending_secure_link_verified_at
    from complimentary_review_items ri
    where ri.slot_key = ${slotKey}
    limit 1
  `) as {
    id: string
    publication_id: string
    owner_edited_fields: string[]
    pending_papermark_document_id: string | null
    pending_clean_title: string | null
    publication_type: string
    description: string
    frequency: string
    audience: string
    secure_link_id: string | null
    pending_secure_link_id: string | null
    pending_secure_link_url: string | null
    pending_secure_link_document_id: string | null
    pending_secure_link_verified_at: string | null
  }[]

  if (!slot[0]) return { message: `Slot ${slotKey} not found.` }

  const pendingDocId = slot[0].pending_papermark_document_id
  if (!pendingDocId) return { message: "No pending version." }

  // The new edition must already have its own verified link. Promoting without
  // one would swap the card's document while leaving the old edition's URL on
  // it, so the public page would advertise the new title and serve the old PDF.
  const pendingLinkUrl = (slot[0].pending_secure_link_url ?? '').trim()
  if (
    !slot[0].pending_secure_link_id ||
    !pendingLinkUrl ||
    !slot[0].pending_secure_link_verified_at ||
    slot[0].pending_secure_link_document_id !== pendingDocId
  ) {
    return {
      message: `${slotKey} cannot go live yet: the pending edition has no verified secure link. Use Prepare secure link first.`,
    }
  }

  const series = slotKey as ReviewSeries
  const meta = generateReviewMetadata(series, slot[0].pending_clean_title ?? '')
  const edited = new Set(slot[0].owner_edited_fields ?? [])
  const previousLinkId = slot[0].secure_link_id

  // One statement, so the document and the URL that serves it can never be
  // observed out of step with each other.
  await sql`
    update complimentary_review_items set
      papermark_document_id = ${pendingDocId},
      secure_link_url = ${pendingLinkUrl},
      secure_link_id = ${slot[0].pending_secure_link_id},
      secure_link_document_id = ${pendingDocId},
      secure_link_verified_at = now(),
      publication_type = ${edited.has('publication_type') ? slot[0].publication_type : meta.publicationType},
      description = ${edited.has('description') ? slot[0].description : meta.description},
      frequency = ${edited.has('frequency') ? slot[0].frequency : meta.frequency},
      audience = ${edited.has('audience') ? slot[0].audience : meta.audience},
      pending_papermark_document_id = null,
      pending_clean_title = null,
      pending_version_key = null,
      pending_detected_at = null,
      pending_secure_link_id = null,
      pending_secure_link_url = null,
      pending_secure_link_document_id = null,
      pending_secure_link_verified_at = null,
      last_synced_at = now(),
      updated_at = now()
    where id = ${slot[0].id}::uuid
  `

  const oldApproved = (await sql`
    select id from review_sync_candidates
    where detected_series = ${slotKey} and sync_status = 'approved'
  `) as { id: string }[]

  for (const old of oldApproved) {
    await sql`
      update review_sync_candidates set sync_status = 'archived', updated_at = now()
      where id = ${old.id}::uuid
    `
  }

  await sql`
    update review_sync_candidates set sync_status = 'approved', updated_at = now()
    where papermark_document_id = ${pendingDocId}
  `

  // The new edition is already live. Retiring the superseded link is
  // best-effort, and a failure is reported rather than rolled back, because
  // rolling back would take the new edition off the page to fix a stale link.
  let tail = ""
  if (previousLinkId && previousLinkId !== slot[0].pending_secure_link_id) {
    const { revokeReviewDocumentLink } = await import("@/lib/papermark-datarooms")
    const revoked = await revokeReviewDocumentLink(previousLinkId)
    tail = revoked.ok
      ? " The previous edition's link was revoked."
      : ` WARNING: the previous edition's link ${previousLinkId} could not be revoked (${revoked.message}) and still needs manual revocation in Papermark.`
  }

  refresh()
  return { ok: true, message: `${slotKey} updated to new edition.${tail}` }
}

// ---------------------------------------------------------------------------
// Generate details for a single slot (fills blanks only)
// ---------------------------------------------------------------------------

export async function generateSlotDetails(slotKey: string): Promise<FormState> {
  await requireOwner()
  if (!FIXED_SLOTS.includes(slotKey as typeof FIXED_SLOTS[number])) {
    return { message: "Invalid slot." }
  }

  const sql = getSql()

  const rows = (await sql`
    select ri.id, ri.publication_type, ri.description, ri.frequency, ri.audience,
           ri.owner_edited_fields,
           d.title, d.series, d.product_line, d.frequency as pub_frequency,
           d.summary, d.description as pub_description
    from complimentary_review_items ri
    join documents d on d.id = ri.publication_id
    where ri.slot_key = ${slotKey}
    limit 1
  `) as {
    id: string; publication_type: string; description: string
    frequency: string; audience: string; owner_edited_fields: string[]
    title: string; series: string; product_line: string
    pub_frequency: string; summary: string; pub_description: string
  }[]

  if (!rows[0]) return { message: `Slot ${slotKey} not found or no publication linked.` }

  const item = rows[0]
  const card = prefillReviewCard(item)
  const edited = new Set(item.owner_edited_fields ?? [])
  const filled: string[] = []

  const pubType = (!item.publication_type && !edited.has('publication_type') && card.publicationType)
    ? card.publicationType : null
  const desc = (!item.description && !edited.has('description') && card.description)
    ? card.description : null
  const freq = (!item.frequency && !edited.has('frequency') && card.frequency)
    ? card.frequency : null
  const aud = (!item.audience && !edited.has('audience') && card.audience)
    ? card.audience : null

  if (pubType) filled.push('publication_type')
  if (desc) filled.push('description')
  if (freq) filled.push('frequency')
  if (aud) filled.push('audience')

  if (filled.length === 0) {
    return { ok: true, message: "All fields already filled." }
  }

  await sql`
    update complimentary_review_items set
      publication_type = case when publication_type = '' then ${pubType ?? ''} else publication_type end,
      description = case when description = '' then ${desc ?? ''} else description end,
      frequency = case when frequency = '' then ${freq ?? ''} else frequency end,
      audience = case when audience = '' then ${aud ?? ''} else audience end,
      updated_at = now()
    where id = ${item.id}::uuid
  `

  refresh()
  return { ok: true, message: `Generated: ${filled.join(', ')}.` }
}

// ---------------------------------------------------------------------------
// Save a single review item's card details (tracks owner edits)
// ---------------------------------------------------------------------------

export async function saveReviewItemDetails(
  itemId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireOwner()
  if (!UUID.test(itemId)) return { message: "Invalid item." }

  const sql = getSql()

  const publicationType = String(formData.get("publicationType") ?? "").trim().slice(0, 200)
  const description = String(formData.get("description") ?? "").trim().slice(0, 2000)
  const frequency = String(formData.get("frequency") ?? "").trim().slice(0, 120)
  const audience = String(formData.get("audience") ?? "").trim().slice(0, 600)

  const editedFields: string[] = []
  if (publicationType) editedFields.push('publication_type')
  if (description) editedFields.push('description')
  if (frequency) editedFields.push('frequency')
  if (audience) editedFields.push('audience')

  await sql`
    update complimentary_review_items set
      publication_type = ${publicationType},
      description = ${description},
      frequency = ${frequency},
      audience = ${audience},
      owner_edited_fields = ${editedFields},
      updated_at = now()
    where id = ${itemId}::uuid
  `

  refresh()
  return { ok: true, message: "Card details saved." }
}

// ---------------------------------------------------------------------------
// Map a sync candidate to a slot
// ---------------------------------------------------------------------------

export async function mapCandidateToCard(
  candidateId: string,
  slotKey: string,
): Promise<FormState> {
  await requireOwner()
  if (!UUID.test(candidateId)) return { message: "Invalid candidate." }
  if (!FIXED_SLOTS.includes(slotKey as typeof FIXED_SLOTS[number])) {
    return { message: "Invalid slot." }
  }

  const sql = getSql()

  const candidate = (await sql`
    select id, papermark_document_id, papermark_dataroom_id, detected_series
    from review_sync_candidates where id = ${candidateId}::uuid limit 1
  `) as { id: string; papermark_document_id: string; papermark_dataroom_id: string; detected_series: string }[]

  if (!candidate[0]) return { message: "Candidate not found." }

  await sql`
    update complimentary_review_items set
      papermark_document_id = ${candidate[0].papermark_document_id},
      papermark_dataroom_id = ${candidate[0].papermark_dataroom_id},
      last_synced_at = now(),
      updated_at = now()
    where slot_key = ${slotKey}
  `

  await sql`
    update review_sync_candidates set
      sync_status = 'approved', updated_at = now()
    where id = ${candidateId}::uuid
  `

  refresh()
  return { ok: true, message: "Mapped successfully." }
}

// ---------------------------------------------------------------------------
// Ignore a candidate
// ---------------------------------------------------------------------------

export async function ignoreCandidate(candidateId: string): Promise<FormState> {
  await requireOwner()
  if (!UUID.test(candidateId)) return { message: "Invalid candidate." }

  const sql = getSql()
  await sql`
    update review_sync_candidates set sync_status = 'ignored', updated_at = now()
    where id = ${candidateId}::uuid
  `

  refresh()
  return { ok: true, message: "Candidate ignored." }
}

// ---------------------------------------------------------------------------
// Background sync (called by cron — never approves, publishes, or emails)
// ---------------------------------------------------------------------------

export async function backgroundReviewSync(): Promise<{
  ok: boolean
  message: string
  added: number
  updated: number
}> {
  const sql = getSql()

  const drRow = (await sql`
    select value from app_settings where key = 'review_library_papermark_dataroom_id' limit 1
  `) as { value: string }[]
  const dataroomId = drRow[0]?.value ?? ''

  if (!dataroomId) return { ok: true, message: "No Data Room configured.", added: 0, updated: 0 }

  const { listDataRoomDocuments } = await import("@/lib/papermark-datarooms")
  const docsResult = await listDataRoomDocuments(dataroomId)
  if (!docsResult.ok) return { ok: false, message: docsResult.message, added: 0, updated: 0 }

  let added = 0
  let updated = 0

  for (const d of docsResult.value) {
    const classification = classifyReviewDocument(d.document_name, d.folder_path)
    const vKey = documentVersionKey({
      title: d.document_name,
      numPages: d.num_pages,
      updatedAt: d.created,
    })

    const existing = (await sql`
      select id, version_key from review_sync_candidates
      where papermark_document_id = ${d.document_id} limit 1
    `) as { id: string; version_key: string }[]

    if (!existing[0]) {
      await sql`
        insert into review_sync_candidates (
          papermark_document_id, papermark_dataroom_id, raw_filename,
          clean_title, num_pages, folder_path,
          papermark_created_at, papermark_updated_at,
          detected_series, detected_edition_date, version_key,
          sync_status, is_present
        ) values (
          ${d.document_id}, ${dataroomId}, ${d.document_name},
          ${classification.cleanTitle}, ${d.num_pages ?? null}, ${d.folder_path ?? null},
          ${d.created ? new Date(d.created) : null}, ${d.created ? new Date(d.created) : null},
          ${classification.series ?? ''}, ${classification.editionDate ?? null}, ${vKey},
          'pending', true
        )
        on conflict (papermark_document_id) do nothing
      `
      added++
    } else if (existing[0].version_key !== vKey) {
      await sql`
        update review_sync_candidates set
          raw_filename = ${d.document_name},
          clean_title = ${classification.cleanTitle},
          num_pages = ${d.num_pages ?? null},
          version_key = ${vKey},
          last_seen_at = now(),
          is_present = true,
          updated_at = now()
        where papermark_document_id = ${d.document_id}
      `
      updated++
    } else {
      await sql`
        update review_sync_candidates set last_seen_at = now()
        where papermark_document_id = ${d.document_id}
      `
    }
  }

  const now = new Date().toISOString()
  await sql`
    insert into app_settings (key, value)
    values ('review_library_last_sync_at', ${now})
    on conflict (key) do update set value = excluded.value
  `

  return { ok: true, message: `${added} new, ${updated} updated`, added, updated }
}
