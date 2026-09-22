"use server"

// ---------------------------------------------------------------------------
// Ensure the three fixed slots exist (idempotent)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Data Room selection (owner only)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Update a slot's secure Papermark document link
// ---------------------------------------------------------------------------

// Clearing the field is always allowed: it takes the slot out of the public
// library, which is the safe direction.

// A pasted address is not trusted. The link id is read out of the URL and
// checked against Papermark, because a URL that happens to be https and
// happens to be on the right host can still point at the wrong document --
// or at the whole Data Room, which is the leak this design exists to stop.

/**
 * Reads a Papermark link id out of a share URL.
 *
 * Papermark share URLs end in the link id, on either the api host or a verified
 * custom domain. Anything else returns null so the caller refuses the paste
 * rather than storing an address it cannot verify.
 */

// ---------------------------------------------------------------------------
// Approved Complimentary Review recipients
// ---------------------------------------------------------------------------
//
// Stored as one app_settings row rather than a table: it is a single
// owner-managed value, read server-side only, and never rendered on a public
// page or sent to client JavaScript.

/** The approved list, re-validated on read. */

/** Owner-only read, for the admin form. */

/**
 * Saves the approved list.
 *
 * Saving does NOT touch Papermark. The allow lists currently applied to the
 * three links stay exactly as they are until the owner explicitly presses
 * Apply, so an edit here cannot cut off a reader mid-review by accident.
 */

/**
 * Shows what applying the restrictions would change, without changing it.
 *
 * Reads each link's live allow list from Papermark rather than assuming what
 * APRI last set, so the owner compares against what is genuinely in force.
 */

/**
 * Applies the approved list to the three existing links.
 *
 * Repairs the complete Complimentary Review policy on each existing link in
 * place. No document, link id or URL is recreated.
 * Failures are reported per slot rather than aborting the run, so one bad link
 * does not prevent the other two being restricted.
 */

// Fail closed, before touching anything.
// Only the verification timestamp moves. The URL, link id and document id
// are deliberately not rewritten here -- the PATCH did not change them.

// ---------------------------------------------------------------------------
// Edit the linked publication's title (owner only)
// ---------------------------------------------------------------------------

/**
 * Renames the publication a review slot points at.
 *
 * Updates `documents.title` and nothing else. Deliberately absent: no second
 * publication is created, the slug is untouched (so no public URL moves),
 * status and visibility are untouched, the Papermark document mapping is
 * untouched, and no link is recreated. A rename is a rename.
 */

/** The Chancellor-approved title for a slot, offered in the admin. */

// ---------------------------------------------------------------------------
// Provision the secure review link through the Papermark API (owner only)
// ---------------------------------------------------------------------------

/**
 * Confirms exactly one unambiguous current document is mapped to a slot.
 *
 * Refusing here rather than guessing is deliberate: creating a link against the
 * wrong document would publish the wrong PDF, and the sync deliberately leaves
 * a newly detected edition pending rather than replacing the mapping.
 */

// More than one candidate approved for the same series means the mapping is
// ambiguous and a human has to resolve it before a public link is minted.

/**
 * Creates the slot's public review link through the Papermark API.
 *
 * Idempotent: a slot that already has a verified link for the same document is
 * left alone rather than accumulating duplicate public links for one PDF.
 */

// Already provisioned for this exact document: do not mint a second link.

// Fails closed: with nobody approved there is no such thing as a correctly
// restricted link, so none is created.

// The slot is left exactly as it was, so a failed call cannot take a working
// card off the public page.
// The link exists in Papermark but is recorded nowhere. Best-effort revoke
// so it does not sit there as an unreferenced public address.

/**
 * Re-checks the slot's saved link against Papermark, repairing its settings.
 *
 * Touches only the link id already stored for this slot -- never lists, never
 * walks the Data Room, and never goes near a subscriber link.
 */

// Re-apply the review settings so a watermark or email gate changed inside
// Papermark is put back without minting a new address.

/**
 * Creates a link for a pending new edition without touching the live card.
 *
 * Writes only the `pending_secure_link_*` columns, so the public page keeps
 * serving the current edition until the owner confirms Make current.
 */

// Deliberately only the admin page. The public pages must not change: the
// pending edition is not live until the owner confirms it.

// ---------------------------------------------------------------------------
// Sync documents from the Complimentary Review Data Room
// ---------------------------------------------------------------------------

// Every real Data Room document has exactly one private edition record.
// Conflict updates refresh Papermark facts only: review state and all owner
// edits survive later syncs, including an explicit Ignored decision.

// Self-repair. A slot can hold its publication and slot_key while its
// papermark_document_id is null -- the candidates were already present, so
// every file above took the "unchanged" branch and attached nothing. Without
// this the slot stays unmapped through any number of syncs.

// ---------------------------------------------------------------------------
// Fixed-slot mapping repair
// ---------------------------------------------------------------------------

/**
 * What a repair pass concluded about one fixed slot.
 *
 * `ambiguous` carries the competing documents so the admin can offer an
 * explicit choice rather than the sync guessing.
 */
/**
 * Attaches recognised sync candidates to fixed slots that have none.
 *
 * The rule itself lives in `@/lib/review-repair` so it can be tested without a
 * database; this function only reads the slot and its candidates, applies what
 * was decided, and reports back.
 *
 * Deliberately conservative:
 *
 *  - A slot that already has a current document is never touched, so a repair
 *    pass can never silently swap a live edition.
 *  - Only an unambiguous single match is applied. Several candidates for one
 *    series is a question for the owner, not something to guess at.
 *  - It maps only. No publication is created, no secure link is minted, and
 *    nothing outside `complimentary_review_items` and the chosen candidate's
 *    own status is written -- subscriber links and paid Data Rooms are
 *    untouched.
 *
 * Idempotent: once a slot is mapped it takes the `already-mapped` branch, so
 * running sync repeatedly changes nothing and creates no duplicates.
 */

// The candidate now backs a live slot, so it is no longer merely pending.

// If this document was also sitting in the pending columns, it is now the
// current edition and must not be offered as a new one as well.

/**
 * Owner-only explicit repair, as a fallback when sync has already run.
 *
 * Sync performs the same safe unique-match repair automatically; this button
 * exists so the owner can retry after fixing a filename or removing a
 * duplicate, without waiting for another full sync.
 */

// A slot with no current document has nothing to supersede. Parking the
// document in the pending columns would leave the slot permanently
// unmapped and its buttons disabled, which is the production fault this
// guard exists to prevent -- repairFixedSlotMappings makes it current
// instead.

// ---------------------------------------------------------------------------
// Make a pending version current (owner confirmation required)
// ---------------------------------------------------------------------------

// The new edition must already have its own verified link. Promoting without
// one would swap the card's document while leaving the old edition's URL on
// it, so the public page would advertise the new title and serve the old PDF.

// ---------------------------------------------------------------------------
// Generate details for a single slot (fills blanks only)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Save a single review item's card details (tracks owner edits)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Map a sync candidate to a slot
// ---------------------------------------------------------------------------

/** Prepare a policy-compliant exact-document link for one draft edition. */

// Do not trust only the POST response. Read the link back from Papermark and
// verify both its exact document target and the complete recipient policy
// before persisting or publishing it.

/**
 * Recover the known August 2026 MIN from its synced Papermark record.
 *
 * This deliberately identifies the existing PDF through sync metadata instead
 * of embedding a document or link id. It touches only that edition. A fresh
 * exact-document link is created under the current approved-recipient policy,
 * read back from Papermark, and only then stored as a published non-latest MIN.
 */

// Reuse a stored link only when Papermark proves it is still live, targets
// August, and has the complete current policy. The known revoked former link
// fails this GET and falls through to creation; it is never reused by URL.

/** Publish an edition without deleting, archiving, or revoking its predecessor. */

/** Publish a historical edition without changing the series' latest edition. */

// ---------------------------------------------------------------------------
// Ignore a candidate
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Background sync (called by cron — never approves, publishes, or emails)
// ---------------------------------------------------------------------------

import { revalidatePath } from "next/cache"
import { requireOwner } from "@/lib/dal"
import { getSql } from "@/lib/db"
import type { FormState } from "@/lib/definitions"
import { prefillReviewCard } from "@/lib/review-prefill"
import {
  classifyReviewDocument,
  generateReviewMetadata,
  inferReviewEditionLabel,
  isReviewSeries,
  type ReviewSeries,
} from "@/lib/review-classify"
import { documentVersionKey } from "@/lib/papermark-dataroom-contract"
import {
  decideSlotRepair,
  summariseRepair,
  type RepairCandidate,
  type RepairDecision,
} from "@/lib/review-repair"
import {
  parseRecipients,
  serialiseRecipients,
  deserialiseRecipients,
  canProvisionLinks,
  MAX_RECIPIENTS,
} from "@/lib/review-recipients"
import { approvedTitleForSlot } from "@/lib/review-prefill"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const FIXED_SLOTS = ["MIN", "AIU", "PLM"] as const
const SLOT_ORDER: Record<string, number> = { MIN: 0, AIU: 1, PLM: 2 }

function editionSortKey(label: string, detectedDate: string | null): string {
  if (detectedDate) return detectedDate.slice(0, 7)
  const issue = label.match(/Issue\s+0*(\d+).*?(20\d{2})?/i)
  return issue
    ? `${
        issue[2] ??
        "0000"
      }-${issue[1]!.padStart(6, "0")}`
    : label
}

function refresh() {
  revalidatePath("/admin/review-library")
  revalidatePath("/")
  revalidatePath("/publications")
}

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
      id: string
      title: string
      series: string
      product_line: string
      frequency: string
      summary: string
      description: string
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

export async function saveReviewLibrarySettings(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireOwner()
  const sql = getSql()

  const enabled =
    formData.get("enabled") ===
    "on"

  if (enabled) {
    const current = (await sql`
      select series from review_publication_editions
      where publication_state = 'published' and is_latest = true
        and secure_link_url <> '' and secure_link_verified_at is not null
        and secure_link_document_id = papermark_document_id
    `) as { series: string }[]
    const present = new Set(current.map((row) => row.series))
    const missing = FIXED_SLOTS.filter((series) => !present.has(series))
    if (missing.length)
      return {
        message: `Cannot enable: verified latest editions are missing for ${missing.join(", ")}.`,
    }
  }

  await sql`
    insert into app_settings (key, value)
    values ('review_library_enabled', ${enabled ? "true" : "false"})
    on conflict (key) do update set value = excluded.value
  `

  refresh()
  return {
    ok: true,
    message: enabled ? "Library enabled." : "Library disabled.",
  }
}

export async function fetchAvailableReviewDataRooms(): Promise<{
  ok: true
  rooms: { id: string; name: string; documentCount: number }[]
} | { ok: false; message: string }> {
  await requireOwner()
  const { listDataRooms } = await import("@/lib/papermark-datarooms")
  const result = await listDataRooms()
  if (!result.ok) return { ok: false, message: result.message }
  return {
    ok: true,
    rooms: result.value.map((r) => ({
      id: r.id,
      name: r.name,
      documentCount:
        r.document_count ??
        0,
    })),
  }
}

export async function saveReviewDataRoom(
  dataroomId: string,
): Promise<FormState> {
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
  if (!url) {
    const cleared = (await sql`
      update complimentary_review_items
      set secure_link_url = '', secure_link_id = null,
          secure_link_document_id = null, secure_link_verified_at = null,
          updated_at = now()
      where slot_key = ${slotKey}
      returning id
    `) as { id: string }[]
    if (!cleared[0])
      return { message: `Slot ${slotKey} not found. Ensure fixed slots first.` }
    refresh()
    return {
      ok: true,
      message: "Secure link cleared. This slot is no longer public.",
    }
  }

  const slot = (await sql`
    select id, papermark_document_id
    from complimentary_review_items
    where slot_key = ${slotKey}
    limit 1
  `) as { id: string; papermark_document_id: string | null }[]

  if (!slot[0])
    return { message: `Slot ${slotKey} not found. Ensure fixed slots first.` }

  const docId = (
    slot[0].papermark_document_id ??
    ""
  ).trim()
  if (!docId) {
    return {
      message: `${slotKey} has no mapped Papermark document. Map one before saving a link.`,
    }
  }
  const linkId = reviewLinkIdFromUrl(url)
  if (!linkId) {
    return {
      message:
        "Could not read a Papermark link id out of that URL. Use Create secure review link instead, or paste the full Papermark share URL.",
    }
  }

  const { verifyReviewDocumentLink } = await import("@/lib/papermark-datarooms")
  const verified = await verifyReviewDocumentLink({
    linkId,
    expectedDocumentId: docId,
  })
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
  return {
    ok: true,
    message: "Secure link verified against Papermark and saved.",
  }
}
function reviewLinkIdFromUrl(url: string): string | null {
  try {
    const u = new URL(url)
    const segments = u.pathname.split("/").filter(Boolean)
    const last =
      segments[
        segments.length -
          1
      ] ??
      ""
    return /^[A-Za-z0-9_-]{6,}$/.test(last) ? last : null
  } catch {
    return null
  }
}

const RECIPIENTS_KEY = "review_approved_recipients"
async function readApprovedRecipients(
  sql: ReturnType<typeof getSql>,
): Promise<string[]> {
  const rows = (await sql`
    select value from app_settings where key = ${RECIPIENTS_KEY} limit 1
  `) as { value: string }[]
  return deserialiseRecipients(
    rows[0]?.value ??
      "",
  )
}
export async function getApprovedRecipients(): Promise<{
  emails: string[]
  count: number
}> {
  await requireOwner()
  const emails = await readApprovedRecipients(getSql())
  return { emails, count: emails.length }
}
export async function saveApprovedRecipients(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireOwner()

  const raw = String(
    formData.get("recipients") ??
      "",
  )
  if (
    raw.length >
    100_000
  ) {
    return {
      message: "That list is too large. Paste at most a few hundred addresses.",
    }
  }

  const parsed = parseRecipients(raw)

  if (
    parsed.emails.length >
    MAX_RECIPIENTS
  ) {
    return {
      message: `${parsed.emails.length} addresses is more than the ${MAX_RECIPIENTS} limit. Trim the list.`,
    }
  }

  const sql = getSql()
  await sql`
    insert into app_settings (key, value)
    values (${RECIPIENTS_KEY}, ${serialiseRecipients(parsed.emails)})
    on conflict (key) do update set value = excluded.value
  `

  revalidatePath("/admin/review-library")

  const notes: string[] = [
    `${parsed.emails.length} approved recipient${
      parsed.emails.length ===
      1
        ? ""
        : "s"
    } saved.`,
  ]
  if (
    parsed.duplicates >
    0
  )
    notes.push(
      `${parsed.duplicates} duplicate${
        parsed.duplicates ===
        1
          ? ""
          : "s"
      } removed.`,
    )
  if (
    parsed.invalid.length >
    0
  ) {
    notes.push(
      `${parsed.invalid.length} entr${
        parsed.invalid.length ===
        1
          ? "y was"
          : "ies were"
      } not valid and ${
        parsed.invalid.length ===
        1
          ? "was"
          : "were"
      } skipped: ${parsed.invalid.slice(0, 5).join(", ")}${
        parsed.invalid.length >
        5
          ? "…"
          : ""
      }`,
    )
  }
  notes.push(
    "The links themselves are unchanged until you press Apply email restrictions.",
  )

  return { ok: true, message: notes.join(" ") }
}

export type RestrictionRow = {
  slotKey: string
  linkId: string | null
  documentId: string | null
  currentAllowList: string[]
  willChange: boolean
  problem: string | null
}

export type RestrictionPreview = {
  ok: boolean
  message: string
  approvedCount: number
  rows: RestrictionRow[]
}
export async function previewEmailRestrictions(): Promise<RestrictionPreview> {
  await requireOwner()
  const sql = getSql()

  const approved = await readApprovedRecipients(sql)

  const slots = (await sql`
    select series as slot_key, secure_link_id, papermark_document_id
    from review_publication_editions
    where publication_state = 'published' and secure_link_url <> ''
    order by series, edition_date desc nulls last, edition_order desc, created_at desc
  `) as {
    slot_key: string
    secure_link_id: string | null
    papermark_document_id: string | null
  }[]

  if (!canProvisionLinks(approved)) {
    return {
      ok: false,
      approvedCount: 0,
      rows: [],
      message:
        "No approved recipients are configured. Applying an empty list would open every " +
        "review link to any verified address, so nothing will be applied.",
    }
  }

  const { getReviewLinkSettings } = await import("@/lib/papermark-datarooms")
  const rows: RestrictionRow[] = []

  for (const slot of slots) {
    const linkId = (
      slot.secure_link_id ??
      ""
    ).trim()
    if (!linkId) {
      rows.push({
        slotKey: slot.slot_key,
        linkId: null,
        documentId: slot.papermark_document_id,
        currentAllowList: [],
        willChange: false,
        problem: "No API-created link. Create the secure review link first.",
      })
      continue
    }

    const current = await getReviewLinkSettings(linkId)
    if (!current.ok) {
      rows.push({
        slotKey: slot.slot_key,
        linkId,
        documentId: slot.papermark_document_id,
        currentAllowList: [],
        willChange: false,
        problem: current.message,
      })
      continue
    }

    const existing = [...current.value.allowList]
      .map((e) => e.toLowerCase())
      .sort()
    const target = [...approved].sort()
    rows.push({
      slotKey: slot.slot_key,
      linkId,
      documentId: slot.papermark_document_id,
      currentAllowList: current.value.allowList,
      willChange:
        existing.join("|") !==
          target.join("|") ||
        !current.value.policyCompliant,
      problem: current.value.policyProblem,
    })
  }

  const changing = rows.filter((r) => r.willChange).length
  return {
    ok: true,
    approvedCount: approved.length,
    rows,
    message:
      `${approved.length} approved recipient${
        approved.length ===
        1
          ? ""
          : "s"
      }. ` +
      `${changing} of ${rows.length} links would change. Nothing has been applied yet.`,
  }
}
export async function applyEmailRestrictions(): Promise<{
  ok: boolean
  message: string
  updated: number
  failures: { slotKey: string; reason: string }[]
}> {
  await requireOwner()
  const sql = getSql()

  const approved = await readApprovedRecipients(sql)
  if (!canProvisionLinks(approved)) {
    return {
      ok: false,
      updated: 0,
      failures: [],
      message:
        "Refused: no approved recipients are configured. An empty allow list would let " +
        "anyone who can verify an address open the review documents.",
    }
  }

  const slots = (await sql`
    select series as slot_key, secure_link_id, papermark_document_id,
           title as document_title, id
    from review_publication_editions
    where publication_state = 'published' and secure_link_url <> ''
    order by series, edition_date desc nulls last, edition_order desc, created_at desc
  `) as {
    slot_key: string
    secure_link_id: string | null
    papermark_document_id: string | null
    document_title: string
    id: string
  }[]

  const { updateReviewDocumentLink } = await import("@/lib/papermark-datarooms")

  let updated = 0
  const failures: { slotKey: string; reason: string }[] = []

  for (const slot of slots) {
    const linkId = (
      slot.secure_link_id ??
      ""
    ).trim()
    const docId = (
      slot.papermark_document_id ??
      ""
    ).trim()

    if (!linkId || !docId) {
      failures.push({
        slotKey: slot.slot_key,
        reason: !linkId
          ? "No API-created link to restrict."
          : "No mapped document.",
      })
      continue
    }

    const result = await updateReviewDocumentLink({
      linkId,
      documentId: docId,
      slotKey: slot.slot_key,
      documentTitle: slot.document_title,
      allowList: approved,
    })

    if (result.ok) {
      updated++
      await sql`
        update review_publication_editions
        set secure_link_verified_at = now(), updated_at = now()
        where id = ${slot.id}::uuid
      `
    } else {
      failures.push({ slotKey: slot.slot_key, reason: result.message })
    }
  }

  refresh()

  return {
    ok:
      failures.length ===
      0,
    updated,
    failures,
    message:
      `Applied to ${updated} of ${slots.length} links.` +
      (failures.length >
      0
        ? ` ${failures.length} failed: ${failures.map((f) => `${f.slotKey} (${f.reason})`).join("; ")}`
        : " Every existing link was repaired in place; no document, link id or URL was recreated."),
  }
}
export async function updateSlotPublicationTitle(
  slotKey: string,
  title: string,
): Promise<FormState> {
  await requireOwner()
  if (!FIXED_SLOTS.includes(slotKey as typeof FIXED_SLOTS[number])) {
    return { message: "Invalid slot." }
  }

  const clean = title.trim().replace(/\s+/g, " ")
  if (
    clean.length <
    3
  )
    return { message: "A title needs at least three characters." }
  if (
    clean.length >
    300
  )
    return { message: "That title is too long (300 characters maximum)." }

  const sql = getSql()

  const slot = (await sql`
    select publication_id from complimentary_review_items
    where slot_key = ${slotKey} limit 1
  `) as { publication_id: string | null }[]

  const publicationId = slot[0]?.publication_id
  if (!publicationId) {
    return { message: `${slotKey} has no linked publication to rename.` }
  }

  const updated = (await sql`
    update documents set title = ${clean}, updated_at = now()
    where id = ${publicationId}::uuid
    returning id, slug
  `) as { id: string; slug: string }[]

  if (!updated[0]) return { message: "That publication no longer exists." }

  refresh()
  return {
    ok: true,
    message: `Title updated. The slug (${updated[0].slug}) and the Papermark mapping are unchanged.`,
  }
}
export async function getApprovedSlotTitle(
  slotKey: string,
): Promise<string | null> {
  await requireOwner()
  return approvedTitleForSlot(slotKey)
}

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
  if (!slot)
    return { message: `Slot ${slotKey} not found. Ensure fixed slots first.` }

  const current = await resolveCurrentDocument(sql, slotKey, slot)
  if (!current.ok) return { message: current.message }
  if (
    slot.secure_link_id &&
    slot.secure_link_document_id ===
      current.documentId &&
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
  const approved = await readApprovedRecipients(sql)
  if (!canProvisionLinks(approved)) {
    return {
      message:
        "No approved review recipients are configured. Add at least one address under " +
        "Approved Review Recipients before creating a link.",
    }
  }

  const created = await createReviewDocumentLink({
    documentId: current.documentId,
    slotKey,
    documentTitle: current.title,
    allowList: approved,
  })
  if (!created.ok) return { message: `Link not created. ${created.message}` }

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

  refresh()
  return { ok: true, message: `${slotKey} secure review link created. Existing edition links were not changed.` }
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
  if (!slot)
    return { message: `Slot ${slotKey} not found. Ensure fixed slots first.` }

  const current = await resolveCurrentDocument(sql, slotKey, slot)
  if (!current.ok) return { message: current.message }

  const linkId = (
    slot.secure_link_id ??
    ""
  ).trim()
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
  if (!verified.ok)
    return { message: `Verification failed. ${verified.message}` }
  const approved = await readApprovedRecipients(sql)
  if (!canProvisionLinks(approved)) {
    return {
      message:
        "Link verified, but settings were not re-applied: no approved recipients are " +
        "configured and re-applying would send an empty allow list.",
    }
  }

  const repaired = await updateReviewDocumentLink({
    linkId,
    documentId: current.documentId,
    slotKey,
    documentTitle: current.title,
    allowList: approved,
  })
  if (!repaired.ok)
    return {
      message: `Link verified but settings could not be re-applied. ${repaired.message}`,
    }

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

  const pendingDocId = (
    slot.pending_papermark_document_id ??
    ""
  ).trim()
  if (!pendingDocId) return { message: `${slotKey} has no pending edition.` }

  if (
    slot.pending_secure_link_id &&
    slot.pending_secure_link_document_id ===
      pendingDocId &&
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

  const approved = await readApprovedRecipients(sql)
  if (!canProvisionLinks(approved)) {
    return {
      message:
        "No approved review recipients are configured. Add at least one address before " +
        "preparing a link for the pending edition.",
    }
  }

  const created = await createReviewDocumentLink({
    documentId: pendingDocId,
    slotKey,
    documentTitle:
      slot.pending_clean_title ??
      slotKey,
    allowList: approved,
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
        error instanceof
        Error
          ? error.message
          : "Unknown storage error."
      }`,
    }
  }
  revalidatePath("/admin/review-library")
  return {
    ok: true,
    message: `${slotKey} pending edition link prepared. The public card is unchanged until you choose Make current.`,
  }
}

export async function syncReviewLibrary(): Promise<FormState> {
  await requireOwner()
  const sql = getSql()

  const drRow = (await sql`
    select value from app_settings where key = 'review_library_papermark_dataroom_id' limit 1
  `) as { value: string }[]
  const dataroomId =
    drRow[0]?.value ??
    ""

  if (!dataroomId) {
    return {
      message:
        "No Complimentary Review Data Room configured. Select one first.",
    }
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
    const classification = classifyReviewDocument(
      d.document_name,
      d.folder_path,
    )
    const vKey = documentVersionKey({
      title: d.document_name,
      numPages: d.num_pages,
      updatedAt: d.created,
    })
    const editionLabel = inferReviewEditionLabel(d.document_name)

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
          ${classification.cleanTitle}, ${
            d.num_pages ??
            null
          }, ${
            d.folder_path ??
            null
          },
          ${d.created ? new Date(d.created) : null}, ${
            d.created ? new Date(d.created) : null
          },
          ${
            classification.series ??
            ""
          }, ${
            classification.editionDate ??
            null
          }, ${vKey},
          'pending', true
        )
        on conflict (papermark_document_id) do nothing
      `
      added++

      if (classification.series && isReviewSeries(classification.series)) {
        await detectPendingVersion(
          sql,
          classification.series,
          d.document_id,
          classification.cleanTitle,
          vKey,
        )
      }
    } else if (
      existing[0].version_key !==
        vKey ||
      !existing[0].is_present
    ) {
      await sql`
        update review_sync_candidates set
          raw_filename = ${d.document_name},
          clean_title = ${classification.cleanTitle},
          num_pages = ${
            d.num_pages ??
            null
          },
          folder_path = ${
            d.folder_path ??
            null
          },
          papermark_updated_at = ${d.created ? new Date(d.created) : null},
          detected_series = ${
            classification.series ??
            ""
          },
          detected_edition_date = ${
            classification.editionDate ??
            null
          },
          version_key = ${vKey},
          last_seen_at = now(),
          is_present = true,
          updated_at = now()
        where papermark_document_id = ${d.document_id}
      `
      updated++

      if (classification.series && isReviewSeries(classification.series)) {
        await detectPendingVersion(
          sql,
          classification.series,
          d.document_id,
          classification.cleanTitle,
          vKey,
        )
      }
    } else {
      await sql`
        update review_sync_candidates set last_seen_at = now()
        where papermark_document_id = ${d.document_id}
      `
      unchanged++
    }
    const defaults =
      classification.series &&
      isReviewSeries(classification.series)
        ? generateReviewMetadata(classification.series, d.document_name)
        : null
    await sql`
      insert into review_publication_editions (
        series, title, edition_label, edition_sort_key, edition_order,
        papermark_document_id, papermark_dataroom_id, papermark_filename,
        num_pages, publication_type, description, frequency, audience,
        sync_version_key, first_seen_at, last_synced_at, publication_state, is_latest
      ) values (
        ${classification.series}, ${classification.cleanTitle}, ${editionLabel},
        ${editionSortKey(editionLabel, classification.editionDate)},
        ${editionSortKey(editionLabel, classification.editionDate)}, ${d.document_id},
        ${dataroomId}, ${d.document_name}, ${
          d.num_pages ??
          null
        },
        ${
          defaults?.publicationType ??
          ""
        }, ${
          defaults?.description ??
          ""
        },
        ${
          defaults?.frequency ??
          ""
        }, ${
          defaults?.audience ??
          ""
        }, ${vKey},
        now(), now(), 'draft', false
      )
      on conflict (papermark_document_id) do update set
        papermark_dataroom_id = excluded.papermark_dataroom_id,
        papermark_filename = excluded.papermark_filename,
        num_pages = excluded.num_pages,
        sync_version_key = excluded.sync_version_key,
        last_synced_at = now(), updated_at = now()
    `
  }

  const presentIds = docs.map((d) => d.document_id)
  if (
    presentIds.length >
    0
  ) {
    await sql`
      update review_sync_candidates set is_present = false, updated_at = now()
      where papermark_dataroom_id = ${dataroomId}
        and is_present = true
        and papermark_document_id != all(${presentIds})
    `
  }
  const now = new Date().toISOString()
  const base = `${docs.length} documents (${added} new, ${updated} updated, ${unchanged} unchanged)`
  const summary = base
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
export async function repairFixedSlotMappings(
  sql: ReturnType<typeof getSql>,
): Promise<RepairDecision[]> {
  const decisions: RepairDecision[] = []

  for (const slotKey of FIXED_SLOTS) {
    const slot = (await sql`
      select id, papermark_document_id
      from complimentary_review_items
      where slot_key = ${slotKey}
      limit 1
    `) as { id: string; papermark_document_id: string | null }[]

    const rows = (await sql`
      select id, papermark_document_id, papermark_dataroom_id,
             clean_title, raw_filename, version_key, folder_path,
             num_pages, is_present, sync_status
      from review_sync_candidates
      where detected_series = ${slotKey}
      order by papermark_updated_at desc nulls last, first_seen_at desc
    `) as {
      id: string
      papermark_document_id: string
      papermark_dataroom_id: string
      clean_title: string
      raw_filename: string
      version_key: string
      folder_path: string | null
      num_pages: number | null
      is_present: boolean
      sync_status: string
    }[]

    const candidates: RepairCandidate[] = rows.map((r) => ({
      id: r.id,
      documentId: r.papermark_document_id,
      dataroomId: r.papermark_dataroom_id,
      cleanTitle: r.clean_title,
      rawFilename: r.raw_filename,
      versionKey: r.version_key,
      folderPath: r.folder_path,
      numPages: r.num_pages,
      isPresent: r.is_present,
      syncStatus: r.sync_status,
    }))

    const decision = decideSlotRepair({
      slotKey,
      slotExists: !!slot[0],
      currentDocumentId:
        slot[0]?.papermark_document_id ??
        null,
      candidates,
    })

    decisions.push(decision)

    if (
      decision.status !==
        "repaired" ||
      !decision.candidate
    )
      continue

    const only = decision.candidate

    await sql`
      update complimentary_review_items set
        papermark_document_id = ${only.documentId},
        papermark_dataroom_id = ${only.dataroomId},
        last_synced_at = now(),
        updated_at = now()
      where id = ${slot[0]!.id}::uuid
    `
    await sql`
      update review_sync_candidates set sync_status = 'approved', updated_at = now()
      where id = ${only.id}::uuid
    `
    await sql`
      update complimentary_review_items set
        pending_papermark_document_id = null,
        pending_clean_title = null,
        pending_version_key = null,
        pending_detected_at = null,
        updated_at = now()
      where id = ${slot[0]!.id}::uuid
        and pending_papermark_document_id = ${only.documentId}
    `
  }

  return decisions
}
export async function repairMissingMappings(): Promise<FormState> {
  await requireOwner()
  const sql = getSql()

  const outcomes = await repairFixedSlotMappings(sql)
  const summary = summariseRepair(outcomes)

  refresh()

  if (!summary) {
    return {
      ok: true,
      message:
        "All three slots already have a mapped document. Nothing to repair.",
  }
  }
  const repairedAny = outcomes.some(
    (o) =>
      o.status ===
      "repaired",
  )
  return { ok: repairedAny, message: `Repair: ${summary}.` }
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
  if (
    slot[0].papermark_document_id ===
    papermarkDocId
  )
    return
  if (!slot[0].papermark_document_id) return

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
  const pendingLinkUrl = (
    slot[0].pending_secure_link_url ??
    ""
  ).trim()
  if (
    !slot[0].pending_secure_link_id ||
    !pendingLinkUrl ||
    !slot[0].pending_secure_link_verified_at ||
    slot[0].pending_secure_link_document_id !==
      pendingDocId
  ) {
    return {
      message: `${slotKey} cannot go live yet: the pending edition has no verified secure link. Use Prepare secure link first.`,
    }
  }

  const meta = generateReviewMetadata(
    slotKey as ReviewSeries,
    slot[0].pending_clean_title ??
      "",
  )
  const editions = (await sql`
    insert into review_publication_editions (
      series, title, edition_order, papermark_document_id, secure_link_id,
      secure_link_url, secure_link_document_id, secure_link_verified_at,
      publication_type, description, frequency, audience
    ) values (
      ${slotKey}, ${
        slot[0].pending_clean_title ??
        slotKey
      }, '', ${pendingDocId},
      ${slot[0].pending_secure_link_id}, ${pendingLinkUrl}, ${pendingDocId}, now(),
      ${meta.publicationType}, ${meta.description}, ${meta.frequency}, ${meta.audience}
    )
    on conflict (papermark_document_id) do update set
      secure_link_id = excluded.secure_link_id,
      secure_link_url = excluded.secure_link_url,
      secure_link_document_id = excluded.secure_link_document_id,
      secure_link_verified_at = excluded.secure_link_verified_at,
      updated_at = now()
    returning id
  `) as { id: string }[]
  if (!editions[0]) return { message: "Edition could not be prepared." }
  const result = await publishEditionAsLatest(editions[0].id)
  if (!result?.ok)
    return (
      result ?? { message: "Edition could not be published." }
    )
  await sql`
    update complimentary_review_items set pending_papermark_document_id = null,
      pending_clean_title = null, pending_version_key = null,
      pending_detected_at = null, pending_secure_link_id = null,
      pending_secure_link_url = null, pending_secure_link_document_id = null,
      pending_secure_link_verified_at = null, updated_at = now()
    where id = ${slot[0].id}::uuid
  `
  return result
}

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
    id: string
    publication_type: string
    description: string
    frequency: string
    audience: string
    owner_edited_fields: string[]
    title: string
    series: string
    product_line: string
    pub_frequency: string
    summary: string
    pub_description: string
  }[]

  if (!rows[0])
    return { message: `Slot ${slotKey} not found or no publication linked.` }

  const item = rows[0]
  const card = prefillReviewCard(item)
  const edited = new Set(
    item.owner_edited_fields ??
      [],
  )
  const filled: string[] = []

  const pubType =
    !item.publication_type &&
    !edited.has("publication_type") &&
    card.publicationType
      ? card.publicationType
      : null
  const desc =
    !item.description && !edited.has("description") && card.description
      ? card.description
      : null
  const freq =
    !item.frequency && !edited.has("frequency") && card.frequency
      ? card.frequency
      : null
  const aud =
    !item.audience && !edited.has("audience") && card.audience
      ? card.audience
      : null

  if (pubType) filled.push("publication_type")
  if (desc) filled.push("description")
  if (freq) filled.push("frequency")
  if (aud) filled.push("audience")

  if (
    filled.length ===
    0
  ) {
    return { ok: true, message: "All fields already filled." }
  }

  await sql`
    update complimentary_review_items set
      publication_type = case when publication_type = '' then ${
        pubType ??
        ""
      } else publication_type end,
      description = case when description = '' then ${
        desc ??
        ""
      } else description end,
      frequency = case when frequency = '' then ${
        freq ??
        ""
      } else frequency end,
      audience = case when audience = '' then ${
        aud ??
        ""
      } else audience end,
      updated_at = now()
    where id = ${item.id}::uuid
  `

  refresh()
  return { ok: true, message: `Generated: ${filled.join(", ")}.` }
}

export async function saveReviewItemDetails(
  itemId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireOwner()
  if (!UUID.test(itemId)) return { message: "Invalid item." }

  const sql = getSql()

  const publicationType = String(
    formData.get("publicationType") ??
      "",
  )
    .trim()
    .slice(0, 200)
  const description = String(
    formData.get("description") ??
      "",
  )
    .trim()
    .slice(0, 2000)
  const frequency = String(
    formData.get("frequency") ??
      "",
  )
    .trim()
    .slice(0, 120)
  const audience = String(
    formData.get("audience") ??
      "",
  )
    .trim()
    .slice(0, 600)

  const editedFields: string[] = []
  if (publicationType) editedFields.push("publication_type")
  if (description) editedFields.push("description")
  if (frequency) editedFields.push("frequency")
  if (audience) editedFields.push("audience")

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
    select id, papermark_document_id, papermark_dataroom_id, detected_series,
           detected_edition_date, clean_title, raw_filename, version_key,
           first_seen_at, last_seen_at
    from review_sync_candidates where id = ${candidateId}::uuid limit 1
  `) as {
    id: string
    papermark_document_id: string
    papermark_dataroom_id: string
    detected_series: string
    detected_edition_date: string | null
    clean_title: string
    raw_filename: string
    version_key: string
    first_seen_at: string
    last_seen_at: string
  }[]

  if (!candidate[0]) return { message: "Candidate not found." }

  const meta = generateReviewMetadata(
    slotKey as ReviewSeries,
    candidate[0].clean_title,
  )
  await sql`
    insert into review_publication_editions (
      series, title, edition_order, papermark_document_id, papermark_dataroom_id,
      publication_type, description, frequency, audience, sync_candidate_id,
      sync_version_key, first_seen_at, last_synced_at
    ) values (
      ${slotKey}, ${
        candidate[0].clean_title ||
        candidate[0].raw_filename
      },
      ${
        candidate[0].detected_edition_date ??
        candidate[0].version_key
      },
      ${candidate[0].papermark_document_id}, ${candidate[0].papermark_dataroom_id},
      ${meta.publicationType}, ${meta.description}, ${meta.frequency}, ${meta.audience},
      ${candidate[0].id}::uuid, ${candidate[0].version_key},
      ${candidate[0].first_seen_at}, ${candidate[0].last_seen_at}
    )
    on conflict (papermark_document_id) do update set
      series = excluded.series, title = excluded.title,
      edition_order = excluded.edition_order,
      papermark_dataroom_id = excluded.papermark_dataroom_id,
      sync_candidate_id = excluded.sync_candidate_id,
      sync_version_key = excluded.sync_version_key,
      last_synced_at = excluded.last_synced_at, updated_at = now()
  `

  await sql`
    update review_sync_candidates set
      sync_status = 'approved', updated_at = now()
    where id = ${candidateId}::uuid
  `

  refresh()
  return { ok: true, message: "Edition assigned as a draft. Existing published editions are unchanged." }
}

/** Prepare a policy-compliant exact-document link for one draft edition. */
export async function prepareEditionSecureLink(editionId: string): Promise<FormState> {
  await requireOwner()
  if (!UUID.test(editionId)) return { message: "Invalid edition." }
  const sql = getSql()
  const rows = (await sql`
    select id, series, title, papermark_document_id, secure_link_id,
           secure_link_url, secure_link_document_id
    from review_publication_editions where id = ${editionId}::uuid limit 1
  `) as Array<{
    id: string
    series: string
    title: string
    papermark_document_id: string
    secure_link_id: string | null
    secure_link_url: string
    secure_link_document_id: string | null
  }>
  const edition = rows[0]
  if (!edition) return { message: "Edition not found." }
  if (
    edition.secure_link_id &&
    edition.secure_link_url &&
    edition.secure_link_document_id ===
      edition.papermark_document_id
  ) {
    return {
      ok: true,
      message:
        "This edition already has an exact-document link. Verify it before publishing.",
    }
  }
  const approved = await readApprovedRecipients(sql)
  if (!canProvisionLinks(approved))
    return {
      message: "No approved recipients are configured; no link was created.",
    }
  const {
    createReviewDocumentLink,
    verifyReviewDocumentLink,
    revokeReviewDocumentLink,
  } = await import("@/lib/papermark-datarooms")
  const created = await createReviewDocumentLink({
    documentId: edition.papermark_document_id,
    slotKey: edition.series,
    documentTitle: edition.title,
    allowList: approved,
  })
  if (!created.ok) return { message: created.message }
  const verified = await verifyReviewDocumentLink({
    linkId: created.value.linkId,
    expectedDocumentId: edition.papermark_document_id,
    expectedAllowList: approved,
  })
  if (!verified.ok) {
    const cleanup = await revokeReviewDocumentLink(created.value.linkId)
    return {
      message:
        `Link verification failed; the edition remains unpublished. ${verified.message}` +
        (cleanup.ok
          ? " The unverified new link was revoked."
          : " The unverified new link requires manual cleanup."),
    }
  }
  try {
    await sql`
      update review_publication_editions set secure_link_id = ${created.value.linkId},
        secure_link_url = ${verified.value.url},
        secure_link_document_id = ${edition.papermark_document_id},
        secure_link_verified_at = now(), updated_at = now()
      where id = ${edition.id}::uuid
    `
  } catch (error) {
    const cleanup = await revokeReviewDocumentLink(created.value.linkId)
    return {
      message: `Link storage failed; ${
        cleanup.ok
          ? "the orphan was revoked"
          : "manual orphan cleanup is required"
      }. ${
        error instanceof
        Error
          ? error.message
          : ""
      }`,
    }
  }
  refresh()
  return {
    ok: true,
    message: "Exact-document secure link prepared and verified.",
  }
}
export async function recoverAugustMinEdition(): Promise<FormState> {
  await requireOwner()
  const sql = getSql()
  const approved = await readApprovedRecipients(sql)
  if (!canProvisionLinks(approved)) {
    return {
      message: "August recovery refused: the approved-recipient list is empty.",
    }
  }

  const configuredRoom = (await sql`
    select value from app_settings
    where key = 'review_library_papermark_dataroom_id' limit 1
  `) as { value: string }[]
  const roomId =
    configuredRoom[0]?.value?.trim() ??
    ""
  if (!roomId)
    return {
      message: "August recovery refused: no Review Data Room is configured.",
    }

  const matches = (await sql`
    select e.id, e.title, e.papermark_document_id,
           e.is_latest, e.secure_link_id
    from review_publication_editions e
    join review_sync_candidates c
      on c.papermark_document_id = e.papermark_document_id
    where e.series = 'MIN'
      and c.detected_series = 'MIN'
      and c.detected_edition_date = '2026-08-01'
      and c.papermark_dataroom_id = ${roomId}
      and c.is_present = true
    order by c.first_seen_at, e.id
  `) as Array<{
    id: string
    title: string
    papermark_document_id: string
    is_latest: boolean
    secure_link_id: string | null
  }>

  if (
    matches.length !==
    1
  ) {
    return {
      message:
        matches.length ===
        0
          ? "August recovery stopped: no synced August 2026 MIN exists in the configured Data Room. Run Sync first."
          : "August recovery stopped: more than one synced August 2026 MIN matched. Resolve the duplicate manually.",
    }
  }
  const august = matches[0]!
  if (august.is_latest) {
    return {
      message:
        "August recovery stopped: August is unexpectedly marked latest; September was not changed.",
    }
  }
  const {
    createReviewDocumentLink,
    verifyReviewDocumentLink,
    revokeReviewDocumentLink,
  } = await import("@/lib/papermark-datarooms")
  let linkId =
    august.secure_link_id?.trim() ??
    ""
  let linkUrl = ""
  let createdFresh = false
  if (linkId) {
    const existing = await verifyReviewDocumentLink({
      linkId,
      expectedDocumentId: august.papermark_document_id,
      expectedAllowList: approved,
    })
    if (existing.ok) linkUrl = existing.value.url
  }

  if (!linkUrl) {
    const created = await createReviewDocumentLink({
      documentId: august.papermark_document_id,
      slotKey: "MIN",
      documentTitle: august.title,
      allowList: approved,
    })
    if (!created.ok) {
      return { message: `August remains unpublished: ${created.message}` }
    }
    linkId = created.value.linkId
    createdFresh = true

    const verified = await verifyReviewDocumentLink({
      linkId,
      expectedDocumentId: august.papermark_document_id,
      expectedAllowList: approved,
    })
    if (!verified.ok) {
      const cleanup = await revokeReviewDocumentLink(linkId)
      return {
        message:
          `August remains unpublished: ${verified.message}` +
          (cleanup.ok
            ? " The failed new link was revoked."
            : " The failed new link requires manual cleanup."),
      }
    }
    linkUrl = verified.value.url
  }

  try {
    const saved = (await sql`
      update review_publication_editions
      set secure_link_id = ${linkId},
          secure_link_url = ${linkUrl},
          secure_link_document_id = ${august.papermark_document_id},
          secure_link_verified_at = now(),
          publication_state = 'published',
          is_latest = false,
          updated_at = now()
      where id = ${august.id}::uuid and is_latest = false
      returning id
    `) as { id: string }[]
    if (!saved[0])
      throw new Error(
        "August changed concurrently; September was left unchanged.",
      )
  } catch (error) {
    const cleanup = createdFresh
      ? await revokeReviewDocumentLink(linkId)
      : { ok: true as const }
    return {
      message:
        `August remains unpublished because its verified link could not be saved. ${
          error instanceof
          Error
            ? error.message
            : ""
        }` +
        (cleanup.ok
          ? " The orphan link was revoked."
          : " The orphan link requires manual cleanup."),
    }
  }

  await sql`
    insert into app_settings (key, value)
    values ('review_august_min_recovery_status', 'complete')
    on conflict (key) do update set value = excluded.value
  `

  refresh()
  return {
    ok: true,
    message: "August MIN recovered as a published historical edition. September remains latest and unchanged.",
  }
}

/** Publish an edition without deleting, archiving, or revoking its predecessor. */
export async function publishEditionAsLatest(editionId: string): Promise<FormState> {
  await requireOwner()
  if (!UUID.test(editionId)) return { message: "Invalid edition." }
  const sql = getSql()
  const verified = await verifyEditionForPublishing(sql, editionId)
  if (!verified?.ok) return verified ?? { message: "Edition verification failed." }
  try {
    await sql`select promote_review_publication_edition(${editionId}::uuid)`
  } catch (error) {
    return { message: error instanceof Error ? error.message : "Edition could not be published." }
  }
  refresh()
  return { ok: true, message: "Published as latest. The previous edition and its secure link remain active." }
}

/** Publish a historical edition without changing the series' latest edition. */
export async function publishHistoricalEdition(editionId: string): Promise<FormState> {
  await requireOwner()
  if (!UUID.test(editionId)) return { message: "Invalid edition." }
  const sql = getSql()
  const verified = await verifyEditionForPublishing(sql, editionId)
  if (!verified?.ok) return verified ?? { message: "Edition verification failed." }
  const updated = (await sql`
    update review_publication_editions
    set publication_state = 'published', is_latest = false, updated_at = now()
    where id = ${editionId}::uuid and secure_link_id is not null
      and secure_link_url <> '' and secure_link_verified_at is not null
      and secure_link_document_id = papermark_document_id
    returning id
  `) as { id: string }[]
  if (!updated[0])
    return {
      message: "Not published: verify an exact-document secure link first.",
    }
  refresh()
  return {
    ok: true,
    message:
      "Historical edition published; the current latest edition is unchanged.",
  }
}

export async function updateEditionDetails(
  editionId: string,
  details: {
    series: string
    editionLabel: string
    title: string
    publicationType: string
    description: string
    frequency: string
    audience: string
  },
): Promise<FormState> {
  await requireOwner()
  if (!UUID.test(editionId)) return { message: "Invalid edition." }
  if (!isReviewSeries(details.series))
    return { message: "Choose MIN, AIU or PLM." }
  const cleanTitle = details.title.trim().replace(/\s+/g, " ").slice(0, 300)
  if (
    cleanTitle.length <
    3
  )
    return { message: "A title needs at least three characters." }
  const sql = getSql()
  await sql`
    update review_publication_editions set series = ${details.series}, title = ${cleanTitle},
      edition_label = ${details.editionLabel.trim().slice(0, 120)},
      edition_sort_key = ${editionSortKey(details.editionLabel, null)},
      publication_type = ${details.publicationType.trim().slice(0, 200)},
      description = ${details.description.trim().slice(0, 2000)},
      frequency = ${details.frequency.trim().slice(0, 120)},
      audience = ${details.audience.trim().slice(0, 600)},
      owner_edited_fields = array['title','edition_label','publication_type','description','frequency','audience'],
      updated_at = now()
    where id = ${editionId}::uuid
  `
  refresh()
  return {
    ok: true,
    message: "Edition details saved; its document and link were unchanged.",
  }
}

export async function generateEditionDefaults(
  editionId: string,
): Promise<FormState> {
  await requireOwner()
  if (!UUID.test(editionId)) return { message: "Invalid edition." }
  const sql = getSql()
  const rows = (await sql`select series, papermark_filename, owner_edited_fields
    from review_publication_editions where id = ${editionId}::uuid limit 1`) as Array<{
    series: string | null
    papermark_filename: string
    owner_edited_fields: string[]
  }>
  const row = rows[0]
  if (!row?.series || !isReviewSeries(row.series))
    return { message: "Assign a series first." }
  const value = generateReviewMetadata(row.series, row.papermark_filename)
  const edited =
    row.owner_edited_fields ??
    []
  await sql`update review_publication_editions set
    edition_label = case when edition_label = '' and not ('edition_label' = any(${edited})) then ${value.editionLabel} else edition_label end,
    publication_type = case when publication_type = '' and not ('publication_type' = any(${edited})) then ${value.publicationType} else publication_type end,
    description = case when description = '' and not ('description' = any(${edited})) then ${value.description} else description end,
    frequency = case when frequency = '' and not ('frequency' = any(${edited})) then ${value.frequency} else frequency end,
    audience = case when audience = '' and not ('audience' = any(${edited})) then ${value.audience} else audience end,
    updated_at = now() where id = ${editionId}::uuid`
  refresh()
  return {
    ok: true,
    message: "Missing series defaults applied; owner edits were preserved.",
  }
}

export async function setEditionReviewState(
  editionId: string,
  state: "draft" | "ignored",
): Promise<FormState> {
  await requireOwner()
  if (!UUID.test(editionId) || !["draft", "ignored"].includes(state))
    return { message: "Invalid edition state." }
  const sql = getSql()
  await sql`update review_publication_editions set publication_state = ${state}, is_latest = false,
    updated_at = now() where id = ${editionId}::uuid and publication_state <> 'published'`
  refresh()
  return {
    ok: true,
    message:
      state ===
      "ignored"
        ? "Document ignored; Papermark was not changed."
        : "Edition returned to Draft.",
  }
}

async function verifyEditionForPublishing(
  sql: ReturnType<typeof getSql>,
  editionId: string,
): Promise<FormState> {
  const rows = (await sql`select secure_link_id, papermark_document_id
    from review_publication_editions where id = ${editionId}::uuid limit 1`) as Array<{
    secure_link_id: string | null
    papermark_document_id: string
  }>
  if (!rows[0]?.secure_link_id)
    return { message: "Not published: prepare a secure link first." }
  const approved = await readApprovedRecipients(sql)
  if (!canProvisionLinks(approved))
    return {
      message: "Not published: no approved-recipient policy is configured.",
    }
  const { verifyReviewDocumentLink } = await import("@/lib/papermark-datarooms")
  const check = await verifyReviewDocumentLink({
    linkId: rows[0].secure_link_id,
    expectedDocumentId: rows[0].papermark_document_id,
    expectedAllowList: approved,
  })
  if (!check.ok) return { message: `Not published: ${check.message}` }
  await sql`update review_publication_editions set secure_link_url = ${check.value.url},
    secure_link_document_id = ${rows[0].papermark_document_id}, secure_link_verified_at = now(),
    updated_at = now() where id = ${editionId}::uuid`
  return { ok: true }
}

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
  const dataroomId = drRow[0]?.value ?? ""

  if (!dataroomId)
    return {
      ok: true,
      message: "No Data Room configured.",
      added: 0,
      updated: 0,
    }

  const { listDataRoomDocuments } = await import("@/lib/papermark-datarooms")
  const docsResult = await listDataRoomDocuments(dataroomId)
  if (!docsResult.ok)
    return { ok: false, message: docsResult.message, added: 0, updated: 0 }

  let added = 0
  let updated = 0

  for (const d of docsResult.value) {
    const classification = classifyReviewDocument(
      d.document_name,
      d.folder_path,
    )
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
          ${d.created ? new Date(d.created) : null}, ${
            d.created ? new Date(d.created) : null
          },
          ${classification.series ?? ""}, ${classification.editionDate ?? null}, ${vKey},
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

  return {
    ok: true,
    message: `${added} new, ${updated} updated`,
    added,
    updated,
  }
}
