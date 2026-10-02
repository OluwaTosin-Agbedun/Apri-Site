"use server"
import { scheduleRoomReconcile } from "@/lib/review-reader-rooms"

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
import {
  decideAddressBookChange,
  decideLinkPreparation,
  MIGRATION_PENDING_MESSAGE,
  recipientListHash,
} from "@/lib/edition-recipients"
import {
  expectedRecipientsForEdition,
  loadActiveRecipients,
  loadEditionForAccess,
} from "@/lib/edition-recipients-dal"
import { editionRecipientsReady, editionWithdrawalReady } from "@/lib/edition-recipients-schema"

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

  // Each series stands alone: enabling needs at least one series with a
  // verified edition to offer, not all three. Once the withdrawal migration has
  // run, that is the edition the series offers; before it, its latest.
  let offered: string[] = []
  let missing: string[] = []
  if (enabled) {
    const offering = await editionWithdrawalReady(sql, { fresh: true })
    const current = (offering
      ? await sql`
      select series from review_publication_editions
      where publication_state = 'published' and complimentary_featured
        and secure_link_url <> '' and secure_link_verified_at is not null
        and secure_link_document_id = papermark_document_id
    `
      : await sql`
      select series from review_publication_editions
      where publication_state = 'published' and is_latest = true
        and secure_link_url <> '' and secure_link_verified_at is not null
        and secure_link_document_id = papermark_document_id
    `) as { series: string }[]
    const present = new Set(current.map((row) => row.series))
    offered = FIXED_SLOTS.filter((series) => present.has(series))
    missing = FIXED_SLOTS.filter((series) => !present.has(series))
    if (offered.length === 0)
      return {
        message: "Cannot enable: no series has a verified edition to offer.",
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
    message: enabled
      ? `Library enabled. Offered: ${offered.join(", ")}.` +
        (missing.length ? ` ${missing.join(" and ")} offer${missing.length === 1 ? "s" : ""} no edition yet.` : "")
      : "Library disabled.",
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
/** Published editions still judged by the shared list, i.e. not yet adopted. */
async function countLegacyPublishedEditions(
  sql: ReturnType<typeof getSql>,
): Promise<number> {
  const rows = (await sql`
    select count(*)::int as n from review_publication_editions
    where recipient_mode = 'shared_legacy' and publication_state = 'published'
  `) as { n: number }[]
  return rows[0]?.n ?? 0
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
  // Readers with a personal room are brought into line after the response.
  scheduleRoomReconcile("all")

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
  // Until the migration has run, every published edition is still judged by
  // this list, exactly as when it is locked below.
  if (!(await editionRecipientsReady(sql, { fresh: true }))) {
    return { message: MIGRATION_PENDING_MESSAGE }
  }
  const change = decideAddressBookChange({
    current: await readApprovedRecipients(sql),
    proposed: parsed.emails,
    legacyPublishedEditions: await countLegacyPublishedEditions(sql),
  })
  if (!change.ok) return { message: change.message }
  if (!change.changed) {
    return { ok: true, message: "No change: the address book already holds exactly these addresses." }
  }

  // The lock is re-checked inside the write, so an edition that has not been
  // adopted can never find its list changed underneath it.
  const written = (await sql`
    insert into app_settings (key, value)
    select ${RECIPIENTS_KEY}, ${serialiseRecipients(parsed.emails)}
    where not exists (
      select 1 from review_publication_editions
      where recipient_mode = 'shared_legacy' and publication_state = 'published'
    )
    on conflict (key) do update set value = excluded.value
    returning key
  `) as { key: string }[]
  if (!written[0]) {
    return {
      message:
        "Not saved: a published edition is still checked against this list. Adopt every " +
        "published edition in Review Library first; after that this list is an address book only.",
    }
  }

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
    "Saving this list grants no access by itself: choose each edition's recipients in its own panel.",
  )

  return { ok: true, message: notes.join(" ") }
}

// ---------------------------------------------------------------------------
// There is deliberately no action that applies one recipient list to many
// editions. The former global "Apply email restrictions" wrote the shared list
// to every published edition, which would overwrite each edition's own list.
// Recipients are now previewed, applied and verified one edition at a time in
// src/app/actions/review-edition-access.ts.
// ---------------------------------------------------------------------------

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

/**
 * Confirms exactly one unambiguous current document is mapped to a slot.
 *
 * Refusing here rather than guessing is deliberate: creating a link against the
 * wrong document would publish the wrong PDF, and the sync deliberately leaves
 * a newly detected edition pending rather than replacing the mapping.
 */

/**
 * Creates the slot's public review link through the Papermark API.
 *
 * Idempotent: a slot that already has a verified link for the same document is
 * left alone rather than accumulating duplicate public links for one PDF.
 */
const RETIRED_LINK_ACTION_MESSAGE =
  "Retired: Complimentary Review links are now managed per edition in Review Library administration. Nothing was changed."

function retiredLegacyLinkAction(): FormState {
  return { message: RETIRED_LINK_ACTION_MESSAGE }
}

/**
 * Retired: created a slot link with the shared list.
 *
 * Every pre-edition slot action that minted, re-applied or revoked a Papermark
 * link did so with the shared recipient list. The versioning migration carried
 * several of those slot links over as edition links, so running any of them now
 * could overwrite an edition's own list or end its readers' access. Each is
 * kept only as an owner-gated refusal, so a stale client is told why rather
 * than writing anything. Links are managed per edition instead.
 */
export async function createSlotSecureLink(_slotKey: string): Promise<FormState> {
  await requireOwner()
  return retiredLegacyLinkAction()
}

/**
 * Re-checks the slot's saved link against Papermark, repairing its settings.
 *
 * Touches only the link id already stored for this slot -- never lists, never
 * walks the Data Room, and never goes near a subscriber link.
 */
/**
 * Retired: re-applied the full policy, including the shared list, to a slot link.
 *
 * Every pre-edition slot action that minted, re-applied or revoked a Papermark
 * link did so with the shared recipient list. The versioning migration carried
 * several of those slot links over as edition links, so running any of them now
 * could overwrite an edition's own list or end its readers' access. Each is
 * kept only as an owner-gated refusal, so a stale client is told why rather
 * than writing anything. Links are managed per edition instead.
 */
export async function verifySlotSecureLink(_slotKey: string): Promise<FormState> {
  await requireOwner()
  return retiredLegacyLinkAction()
}

/**
 * Creates a link for a pending new edition without touching the live card.
 *
 * Writes only the `pending_secure_link_*` columns, so the public page keeps
 * serving the current edition until the owner confirms Make current.
 */
/**
 * Retired: created a pending slot link with the shared list.
 *
 * Every pre-edition slot action that minted, re-applied or revoked a Papermark
 * link did so with the shared recipient list. The versioning migration carried
 * several of those slot links over as edition links, so running any of them now
 * could overwrite an edition's own list or end its readers' access. Each is
 * kept only as an owner-gated refusal, so a stale client is told why rather
 * than writing anything. Links are managed per edition instead.
 */
export async function preparePendingSecureLink(_slotKey: string): Promise<FormState> {
  await requireOwner()
  return retiredLegacyLinkAction()
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

/**
 * Retired: switched a slot to a new link and revoked the previous one.
 *
 * Every pre-edition slot action that minted, re-applied or revoked a Papermark
 * link did so with the shared recipient list. The versioning migration carried
 * several of those slot links over as edition links, so running any of them now
 * could overwrite an edition's own list or end its readers' access. Each is
 * kept only as an owner-gated refusal, so a stale client is told why rather
 * than writing anything. Links are managed per edition instead.
 */
export async function makeVersionCurrent(_slotKey: string): Promise<FormState> {
  await requireOwner()
  return retiredLegacyLinkAction()
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
  if (!(await editionRecipientsReady(sql, { fresh: true }))) {
    return { message: MIGRATION_PENDING_MESSAGE }
  }
  const edition = await loadEditionForAccess(sql, editionId)
  if (!edition) return { message: "Edition not found." }
  if (!edition.series) return { message: "Assign a series first. No link was created." }

  // A link is created with exactly this edition's recipients -- never the
  // shared list -- and not at all until at least one has been chosen.
  const recipients =
    edition.recipientMode === "edition" ? await loadActiveRecipients(sql, editionId) : []
  const decision = decideLinkPreparation({
    mode: edition.recipientMode,
    hasExactLink: Boolean(
      edition.secureLinkId &&
        edition.secureLinkUrl &&
        edition.secureLinkDocumentId === edition.papermarkDocumentId,
    ),
    hasAnyLink: Boolean(edition.secureLinkId),
    recipients,
  })
  if (decision.kind === "already_linked") {
    return {
      ok: true,
      message:
        "This edition already has an exact-document link. Preview and apply its recipients, then verify it before publishing.",
    }
  }
  if (decision.kind === "refuse") return { message: decision.message }

  const {
    createReviewDocumentLink,
    verifyReviewDocumentLink,
    revokeReviewDocumentLink,
  } = await import("@/lib/papermark-datarooms")
  const created = await createReviewDocumentLink({
    documentId: edition.papermarkDocumentId,
    slotKey: edition.series,
    documentTitle: edition.title,
    allowList: decision.emails,
  })
  if (!created.ok) return { message: created.message }
  const verified = await verifyReviewDocumentLink({
    linkId: created.value.linkId,
    expectedDocumentId: edition.papermarkDocumentId,
    expectedAllowList: decision.emails,
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

  let saved = false
  try {
    // Guarded on secure_link_id is null: if another link was stored in the
    // meantime, this one is revoked below instead of overwriting it.
    const rows = (await sql`
      update review_publication_editions set secure_link_id = ${created.value.linkId},
        secure_link_url = ${verified.value.url},
        secure_link_document_id = ${edition.papermarkDocumentId},
        secure_link_verified_at = now(),
        recipients_applied_at = now(),
        recipients_verified_at = now(),
        recipients_verified_hash = ${recipientListHash(decision.emails)},
        updated_at = now()
      where id = ${edition.id}::uuid and recipient_mode = 'edition' and secure_link_id is null
      returning id
    `) as { id: string }[]
    saved = Boolean(rows[0])
  } catch {
    saved = false
  }
  if (!saved) {
    const cleanup = await revokeReviewDocumentLink(created.value.linkId)
    return {
      message:
        "The new link could not be stored against this edition, so it was not kept. " +
        (cleanup.ok ? "The orphan link was revoked." : "The orphan link requires manual cleanup in Papermark."),
    }
  }
  refresh()
  return {
    ok: true,
    message: `Exact-document secure link prepared and verified with this edition's ${decision.emails.length} recipient${decision.emails.length === 1 ? "" : "s"}.`,
  }
}
/**
 * Retired: a one-off, hard-coded August 2026 MIN recovery that created its link with the shared list. That edition is now handled like any other: choose its recipients, prepare its link, then publish it as historical.
 *
 * Every pre-edition slot action that minted, re-applied or revoked a Papermark
 * link did so with the shared recipient list. The versioning migration carried
 * several of those slot links over as edition links, so running any of them now
 * could overwrite an edition's own list or end its readers' access. Each is
 * kept only as an owner-gated refusal, so a stale client is told why rather
 * than writing anything. Links are managed per edition instead.
 */
export async function recoverAugustMinEdition(): Promise<FormState> {
  await requireOwner()
  return retiredLegacyLinkAction()
}

/**
 * Publish an edition as its series' latest, without deleting, archiving, or
 * revoking its predecessor. Publishing as latest is also the owner's explicit
 * choice to offer it: once the withdrawal migration has run it becomes the
 * edition its series offers on the homepage.
 */
export async function publishEditionAsLatest(editionId: string): Promise<FormState> {
  const admin = await requireOwner()
  if (!UUID.test(editionId)) return { message: "Invalid edition." }
  // Readers with a personal room are brought into line after the response.
  scheduleRoomReconcile({ editionId })
  const sql = getSql()
  const verified = await verifyEditionForPublishing(sql, editionId)
  if (!verified?.ok) return verified ?? { message: "Edition verification failed." }
  const offering = await editionWithdrawalReady(sql, { fresh: true })
  try {
    if (offering) {
      await sql`select promote_review_publication_edition(${editionId}::uuid, ${admin.id}::uuid)`
    } else {
      await sql`select promote_review_publication_edition(${editionId}::uuid)`
    }
  } catch (error) {
    return { message: error instanceof Error ? error.message : "Edition could not be published." }
  }
  refresh()
  return {
    ok: true,
    message:
      "Published as latest and offered on the homepage for its series. The previous edition and its secure link remain active.",
  }
}

/** Publish a historical edition without changing the series' latest edition. */
export async function publishHistoricalEdition(editionId: string): Promise<FormState> {
  await requireOwner()
  if (!UUID.test(editionId)) return { message: "Invalid edition." }
  // Readers with a personal room are brought into line after the response.
  scheduleRoomReconcile({ editionId })
  const sql = getSql()
  const verified = await verifyEditionForPublishing(sql, editionId)
  if (!verified?.ok) return verified ?? { message: "Edition verification failed." }
  // Never a withdrawn edition: it is offered again only through re-offering,
  // which clears its revoked link and requires a new, verified one.
  const updated = (await sql`
    update review_publication_editions
    set publication_state = 'published', is_latest = false, updated_at = now()
    where id = ${editionId}::uuid and secure_link_id is not null
      and publication_state in ('draft', 'published')
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
  // Neither a published nor a withdrawn edition changes state here: one is
  // withdrawn through the withdrawal workflow, the other re-offered through it.
  await sql`update review_publication_editions set publication_state = ${state}, is_latest = false,
    updated_at = now() where id = ${editionId}::uuid and publication_state in ('draft', 'ignored')`
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
  // Covers both publish actions, which call this before changing anything.
  if (!(await editionRecipientsReady(sql, { fresh: true }))) {
    return { message: MIGRATION_PENDING_MESSAGE }
  }
  const edition = await loadEditionForAccess(sql, editionId)
  if (edition?.publicationState === "withdrawn")
    return {
      message:
        "Not published: this edition is withdrawn. Offer it again first; that needs its recipients and a new verified link.",
    }
  if (!edition?.secureLinkId)
    return { message: "Not published: prepare a secure link first." }

  // A shared_legacy edition is still judged by the shared list until it is
  // adopted; every other edition by its own recipients only.
  const expected = await expectedRecipientsForEdition(sql, edition)
  if (expected.length === 0)
    return {
      message:
        edition.recipientMode === "shared_legacy"
          ? "Not published: the shared list this edition still uses is empty."
          : "Not published: choose, apply and verify at least one recipient for this edition first.",
    }
  const { verifyReviewDocumentLink } = await import("@/lib/papermark-datarooms")
  const check = await verifyReviewDocumentLink({
    linkId: edition.secureLinkId,
    expectedDocumentId: edition.papermarkDocumentId,
    expectedAllowList: expected,
  })
  if (!check.ok) return { message: `Not published: ${check.message}` }
  if (edition.recipientMode === "edition") {
    await sql`update review_publication_editions set secure_link_url = ${check.value.url},
      secure_link_document_id = ${edition.papermarkDocumentId}, secure_link_verified_at = now(),
      recipients_verified_at = now(), recipients_verified_hash = ${recipientListHash(expected)},
      updated_at = now() where id = ${editionId}::uuid`
  } else {
    await sql`update review_publication_editions set secure_link_url = ${check.value.url},
      secure_link_document_id = ${edition.papermarkDocumentId}, secure_link_verified_at = now(),
      updated_at = now() where id = ${editionId}::uuid`
  }
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
