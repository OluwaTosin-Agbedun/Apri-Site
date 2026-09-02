"use server"

import { revalidatePath } from "next/cache"
import { requireOwner } from "@/lib/dal"
import { getSql } from "@/lib/db"
import type { FormState } from "@/lib/definitions"
import { prefillReviewCard } from "@/lib/review-prefill"

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
// Save a single review item's card details
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

  await sql`
    update complimentary_review_items set
      publication_type = ${publicationType},
      description = ${description},
      frequency = ${frequency},
      audience = ${audience},
      is_active = ${isActive},
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
      updated_at = now()
    where id = ${itemId}::uuid
  `

  refresh()
  return { ok: true, message: "Card details regenerated." }
}

