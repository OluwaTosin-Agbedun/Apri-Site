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

function refresh() {
  revalidatePath("/admin/review-library")
  revalidatePath("/")
  revalidatePath("/publications")
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
  const url = String(formData.get("papermarkUrl") ?? "").trim()

  if (url && !url.startsWith("https://")) {
    return { errors: { papermarkUrl: ["Must be an https:// URL."] } }
  }

  if (enabled) {
    if (!url || !url.startsWith("https://")) {
      return { message: "Cannot enable: a valid HTTPS Papermark URL is required." }
    }
    const activeCount = (await sql`
      select count(*)::int as n from complimentary_review_items where is_active = true
    `) as { n: number }[]
    if ((activeCount[0]?.n ?? 0) !== 3) {
      return { message: "Cannot enable: exactly three active review items are required." }
    }
  }

  await sql`
    insert into app_settings (key, value)
    values ('review_library_enabled', ${enabled ? 'true' : 'false'})
    on conflict (key) do update set value = excluded.value
  `
  await sql`
    insert into app_settings (key, value)
    values ('review_library_papermark_url', ${url})
    on conflict (key) do update set value = excluded.value
  `

  refresh()
  return { ok: true, message: "Settings saved." }
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

// ---------------------------------------------------------------------------
// Map a sync candidate to an existing review card
// ---------------------------------------------------------------------------

export async function mapCandidateToCard(
  candidateId: string,
  itemId: string,
): Promise<FormState> {
  await requireOwner()
  if (!UUID.test(candidateId) && candidateId.length < 1) return { message: "Invalid candidate." }
  if (!UUID.test(itemId)) return { message: "Invalid review item." }

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
    where id = ${itemId}::uuid
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
// Approve a candidate as replacement for its series
// ---------------------------------------------------------------------------

export async function approveCandidateReplacement(
  candidateId: string,
): Promise<FormState> {
  await requireOwner()
  if (!UUID.test(candidateId)) return { message: "Invalid candidate." }

  const sql = getSql()

  const candidate = (await sql`
    select id, papermark_document_id, papermark_dataroom_id, detected_series,
           raw_filename, clean_title
    from review_sync_candidates where id = ${candidateId}::uuid limit 1
  `) as {
    id: string
    papermark_document_id: string
    papermark_dataroom_id: string
    detected_series: string
    raw_filename: string
    clean_title: string
  }[]

  if (!candidate[0]) return { message: "Candidate not found." }
  if (!isReviewSeries(candidate[0].detected_series)) {
    return { message: "Only MIN, AIU or PLM candidates can replace a live card." }
  }

  const series = candidate[0].detected_series as ReviewSeries

  const currentItem = (await sql`
    select ri.id, ri.publication_id, ri.owner_edited_fields,
           ri.publication_type, ri.description, ri.frequency, ri.audience
    from complimentary_review_items ri
    join documents d on d.id = ri.publication_id
    where d.series = ${series} and ri.is_active = true
    limit 1
  `) as {
    id: string
    publication_id: string
    owner_edited_fields: string[]
    publication_type: string
    description: string
    frequency: string
    audience: string
  }[]

  if (!currentItem[0]) {
    return { message: `No active ${series} review card to replace.` }
  }

  const item = currentItem[0]
  const meta = generateReviewMetadata(series, candidate[0].raw_filename)
  const edited = new Set(item.owner_edited_fields ?? [])

  await sql`
    update complimentary_review_items set
      papermark_document_id = ${candidate[0].papermark_document_id},
      papermark_dataroom_id = ${candidate[0].papermark_dataroom_id},
      publication_type = ${edited.has('publication_type') ? item.publication_type : meta.publicationType},
      description = ${edited.has('description') ? item.description : meta.description},
      frequency = ${edited.has('frequency') ? item.frequency : meta.frequency},
      audience = ${edited.has('audience') ? item.audience : meta.audience},
      last_synced_at = now(),
      updated_at = now()
    where id = ${item.id}::uuid
  `

  const oldApproved = (await sql`
    select id from review_sync_candidates
    where detected_series = ${series} and sync_status = 'approved'
      and id != ${candidateId}::uuid
  `) as { id: string }[]

  for (const old of oldApproved) {
    await sql`
      update review_sync_candidates set sync_status = 'archived', updated_at = now()
      where id = ${old.id}::uuid
    `
  }

  await sql`
    update review_sync_candidates set sync_status = 'approved', updated_at = now()
    where id = ${candidateId}::uuid
  `

  refresh()
  return { ok: true, message: `${series} card updated to new edition.` }
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
// Add a review item
// ---------------------------------------------------------------------------

export async function addReviewItem(
  publicationId: string,
): Promise<FormState> {
  await requireOwner()
  if (!UUID.test(publicationId)) return { message: "Invalid publication." }

  const sql = getSql()

  const pub = (await sql`
    select id, title, series, product_line, frequency, summary, description
    from documents where id = ${publicationId}::uuid limit 1
  `) as {
    id: string
    title: string
    series: string
    product_line: string
    frequency: string
    summary: string
    description: string
  }[]

  if (!pub[0]) return { message: "Publication not found." }

  const existing = (await sql`
    select id from complimentary_review_items
    where publication_id = ${publicationId}::uuid limit 1
  `) as { id: string }[]

  if (existing[0]) return { message: "This publication is already in the review library." }

  const { publicationType, description, frequency, audience } =
    prefillReviewCard(pub[0])

  const maxOrder = (await sql`
    select coalesce(max(display_order), -1) as m from complimentary_review_items
  `) as { m: number }[]

  await sql`
    insert into complimentary_review_items
      (publication_id, display_order, publication_type, description, frequency, audience)
    values (
      ${publicationId}::uuid, ${(maxOrder[0]?.m ?? -1) + 1},
      ${publicationType}, ${description}, ${frequency}, ${audience}
    )
  `

  refresh()
  return { ok: true, message: "Added to review library." }
}

// ---------------------------------------------------------------------------
// Remove a review item
// ---------------------------------------------------------------------------

export async function removeReviewItem(
  itemId: string,
): Promise<FormState> {
  await requireOwner()
  if (!UUID.test(itemId)) return { message: "Invalid item." }

  const sql = getSql()
  await sql`delete from complimentary_review_items where id = ${itemId}::uuid`

  refresh()
  return { ok: true, message: "Removed from review library." }
}

// ---------------------------------------------------------------------------
// Reorder review items
// ---------------------------------------------------------------------------

export async function reorderReviewItems(
  orderedIds: string[],
): Promise<FormState> {
  await requireOwner()
  if (!orderedIds.every((id) => UUID.test(id))) return { message: "Invalid item list." }

  const sql = getSql()
  for (let i = 0; i < orderedIds.length; i++) {
    await sql`
      update complimentary_review_items
      set display_order = ${i}, updated_at = now()
      where id = ${orderedIds[i]!}::uuid
    `
  }

  refresh()
  return { ok: true, message: "Order saved." }
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
  const isActive = formData.get("isActive") === "on"

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
      is_active = ${isActive},
      owner_edited_fields = ${editedFields},
      updated_at = now()
    where id = ${itemId}::uuid
  `

  refresh()
  return { ok: true, message: "Card details saved." }
}

// ---------------------------------------------------------------------------
// Regenerate card details (explicit, requires confirmation)
// ---------------------------------------------------------------------------

export async function regenerateReviewItemDetails(
  itemId: string,
): Promise<FormState> {
  await requireOwner()
  if (!UUID.test(itemId)) return { message: "Invalid item." }

  const sql = getSql()

  const rows = (await sql`
    select ri.id, d.title, d.series, d.product_line, d.frequency, d.summary, d.description
    from complimentary_review_items ri
    join documents d on d.id = ri.publication_id
    where ri.id = ${itemId}::uuid
    limit 1
  `) as {
    id: string
    title: string
    series: string
    product_line: string
    frequency: string
    summary: string
    description: string
  }[]

  if (!rows[0]) return { message: "Item not found." }

  const prefilled = prefillReviewCard(rows[0])

  await sql`
    update complimentary_review_items set
      publication_type = ${prefilled.publicationType},
      description = ${prefilled.description},
      frequency = ${prefilled.frequency},
      audience = ${prefilled.audience},
      owner_edited_fields = '{}',
      updated_at = now()
    where id = ${itemId}::uuid
  `

  refresh()
  return { ok: true, message: "Card details regenerated." }
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
