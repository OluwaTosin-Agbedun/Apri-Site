"use server"
// What this person is to us. A subscriber holds a level and gets a library;
// an engagement client holds neither and receives documents one at a time.

/** Create or update one subscriber seat. */
// Identity is needed, not just authorisation: a level change is recorded
// against whoever made it.

// An active seat with no level would be entitled to nothing and would read as
// a bug rather than a decision, so it is refused here.

// An engagement client holds no level, by design. They can still be issued a
// named document through the copies queue; what they must not have is a
// library, and a level is what would give them one. The database enforces
// this too, so a crafted POST cannot slip one past.

// Read before writing, so a level change can be detected and acted on. An
// upgrade widens the copies queue on its own; a downgrade leaves live links
// that nothing else would notice.

// Consequences of a level change, applied after the row is written so the
// queue recomputes against the new level.

/**
 * Activate a seat and send its welcome email.
 *
 * The single action taken after payment lands. Everything it needs -- level,
 * seats, term -- must already be on the record, because activating with a
 * missing term would create a seat with no end date.
 */

// The welcome carries a working sign-in link so the first visit needs no
// second step. Issued after the status change, so the token is usable the
// moment it lands.

// Names the level that was granted, so the confirmation states what the
// subscriber can now read rather than only that something happened.

/** Send a fresh sign-in link to an active seat, on request. */

/**
 * Set a per-subscriber link for one publication.
 *
 * Used for board papers, where each seat gets its own dedicated document rather
 * than a general library link.
 */

/**
 * Notify every entitled active seat that an edition has been published.
 *
 * Each message is addressed to one seat and carries that seat's own link, so
 * nobody receives a link watermarked for someone else and no recipient can see
 * who else is on the list. That is why this sends N messages rather than one
 * with N recipients.
 *
 * The alert payload is built once per recipient and handed to a channel
 * function, so adding SMS or WhatsApp later means adding a second call here
 * rather than restructuring the query.
 */

/** The split shown to the operator before an alert is committed. */

// ---------------------------------------------------------------------------
import { revalidatePath } from "next/cache"
import * as z from "zod"
import { requireAdmin } from "@/lib/dal"
import { getSql } from "@/lib/db"
import { issueToken } from "@/lib/magic-link"
import { sendWelcome } from "@/lib/subscriber-email"
import { sendPublishAlert as sendAlert, previewAlert } from "@/lib/alerts"
import {
  PUBLIC_TIER_NAMES,
  levelForPublicTier,
  isEntitled,
  isLevel,
  isVisibility,
  levelLabel,
  LEVELS,
  type Level,
} from "@/lib/entitlements"
import { applyLevelChange, type LevelChangeOutcome } from "@/lib/level-changes"
import { fieldErrors, type FormState } from "@/lib/definitions"
import { papermarkEmbedUrl } from "@/lib/papermark-embed"
import { normalisePapermarkUrl } from "@/lib/papermark-embed"
import {
  resolveDataRoom,
  getDataRoomLink,
  saveDataRoomLink,
  recordAssignment,
  assignDataRoomToSubscriber,
} from "@/lib/dataroom-dal"
import { createDataRoomLink } from "@/lib/papermark-datarooms"
import { watermarkText } from "@/lib/papermark-dataroom-contract"
import {
  reassignDataRoomOnLevelChange,
  updateDataRoomLinkExpiry,
  revokeAllDataRoomLinks,
} from "@/lib/dataroom-lifecycle"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function normaliseSecureLink(value: unknown): unknown {
  if (typeof value !== "string") return value
  const trimmed = value.trim()
  if (!trimmed) return ""
  if (/^[a-z0-9.-]+\.[a-z]{2,}(?:\/|$)/i.test(trimmed)) {
    return `https://${trimmed}`
  }
  return trimmed
}

const httpsOrBlank = z
  .union([
    z.literal(""),
    z
      .string()
      .trim()
      .max(500)
      .pipe(z.url({ protocol: /^https$/, error: "Must be an https:// URL." })),
  ])
  .default("")

const optionalIsoDate = z
  .union([
    z.literal(""),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
      error: "Use a valid date in YYYY-MM-DD format.",
    }),
  ])
  .refine((value) => value === "" || isRealIsoDate(value), {
    error: "Enter a real calendar date.",
  })

const SubscriberAdminSchema = z.object({
  fullName: z.string().trim().min(1, { error: "A name is required." }).max(160),
  organisation: z.string().trim().max(200).default(""),
  roleTitle: z.string().trim().max(160).default(""),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(254)
    .pipe(z.email({ error: "Enter a valid email address." })),
  phone: z.string().trim().max(40).default(""),
  publicTier: z
    .enum(PUBLIC_TIER_NAMES as [string, ...string[]])
    .or(z.literal("")),
  seats: z.coerce.number().int().min(1).max(500).default(1),
  termStart: optionalIsoDate.default(""),
  termEnd: optionalIsoDate.default(""),
  invoiceRef: z.string().trim().max(120).default(""),
  libraryLinkUrl: httpsOrBlank,
  papermarkFolderId: z.string().trim().max(200).default(""),
  note: z.string().trim().max(600).default(""),
})
export async function saveSubscriber(
  id: string | null,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin()
  if (id && !UUID.test(id)) return { message: "Unknown subscriber." }

  const hasLegacyLibraryFields = formData.has("libraryLinkUrl")

  const parsed = SubscriberAdminSchema.safeParse({
    fullName: formData.get("fullName"),
    organisation: formData.get("organisation") ?? "",
    roleTitle: formData.get("roleTitle") ?? "",
    email: formData.get("email"),
    phone: formData.get("phone") ?? "",
    publicTier: formData.get("publicTier") ?? "",
    seats: formData.get("seats") ?? 1,
    termStart: formData.get("termStart") ?? "",
    termEnd: formData.get("termEnd") ?? "",
    invoiceRef: formData.get("invoiceRef") ?? "",
    libraryLinkUrl: hasLegacyLibraryFields
      ? normalisePapermarkUrl(String(formData.get("libraryLinkUrl") ?? ""))
      : "",
    papermarkFolderId: hasLegacyLibraryFields
      ? (formData.get("papermarkFolderId") ?? "")
      : "",
    note: formData.get("note") ?? "",
  })

  if (!parsed.success) return { errors: fieldErrors(parsed.error) }
  const d = parsed.data
  const level = levelForPublicTier(d.publicTier)
  const seats = d.publicTier === "Individual Access" ? 1 : d.seats
  if (hasLegacyLibraryFields && d.libraryLinkUrl && !papermarkEmbedUrl(d.libraryLinkUrl, process.env.PAPERMARK_CUSTOM_DOMAIN)) {
    return {
      errors: {
        libraryLinkUrl: [
          "Use an HTTPS Papermark share link or the configured APRI Papermark custom domain.",
        ],
      },
    }
  }
  const termStart = d.termStart || null
  const termEnd = d.termEnd || null
  let sql: ReturnType<typeof getSql>
  try {
    sql = getSql()
  } catch {
    return { message: "Subscriber storage is temporarily unavailable. Please try again." }
  }
  let previousLevel: string | null = null
  let previousPublicTier: string | null = null
  let previousTermEnd: string | null = null
  let outcome: LevelChangeOutcome = { direction: "none", revocationsQueued: 0 }

  try {
    if (hasLegacyLibraryFields && d.libraryLinkUrl) {
      const duplicates = await sql`
        select 1 from subscribers
        where library_link_url = ${d.libraryLinkUrl}
          and (${id}::uuid is null or id <> ${id}::uuid)
        union all
        select 1 from briefing_requests where private_link_url = ${d.libraryLinkUrl}
        limit 1
      `
      if (duplicates.length > 0) {
        return {
          message:
            "That private Papermark link is already assigned to another client.",
        }
      }
    }
    if (hasLegacyLibraryFields && d.papermarkFolderId) {
      const folderDuplicates = await sql`
        select 1 from subscribers where papermark_folder_id=${d.papermarkFolderId}
          and lower(status)='active' and (${id}::uuid is null or id<>${id}::uuid)
        union all
        select 1 from briefing_requests where papermark_folder_id=${d.papermarkFolderId}
          and lower(status)='active' limit 1`
      if (folderDuplicates.length) return { message:"That private Papermark folder is assigned to another active client." }
    }
    let existingLibraryLinkUrl: string | null = null
    let existingPapermarkFolderId: string | null = null
    if (id) {
      const before = (await sql`
        select level, public_tier, term_end, library_link_url, papermark_folder_id
        from subscribers where id = ${id} limit 1
      `) as { level: string | null; public_tier: string | null; term_end: string | null; library_link_url: string | null; papermark_folder_id: string | null }[]
      previousLevel = before[0]?.level ?? null
      previousPublicTier = before[0]?.public_tier ?? null
      previousTermEnd = before[0]?.term_end ?? null
      existingLibraryLinkUrl = before[0]?.library_link_url ?? null
      existingPapermarkFolderId = before[0]?.papermark_folder_id ?? null
    }
    const libraryLinkForDb = hasLegacyLibraryFields ? (d.libraryLinkUrl || null) : existingLibraryLinkUrl
    const folderIdForDb = hasLegacyLibraryFields ? (d.papermarkFolderId || null) : existingPapermarkFolderId

    if (id) {
      const updated = await sql`
        update subscribers set
          full_name = ${d.fullName}, name = ${d.fullName},
          organization = ${d.organisation}, role_title = ${d.roleTitle},
          email = ${d.email}, phone = ${d.phone},
          public_tier = ${d.publicTier}, subscription_level = ${d.publicTier},
          level = ${level}, seats = ${seats},
          term_start = ${termStart}::date, term_end = ${termEnd}::date,
          invoice_ref = ${d.invoiceRef},
          library_link_updated_at = case when library_link_url is distinct from ${libraryLinkForDb} then now() else library_link_updated_at end,
          library_link_url = ${libraryLinkForDb},
          papermark_folder_id = ${folderIdForDb},
          note = ${d.note}, updated_at = now()
        where id = ${id}
        returning id
      `
      if (!updated[0]) return { message: "That subscriber no longer exists." }
    } else {
      await sql`
        insert into subscribers (
          full_name, name, organization, role_title, email, phone,
          client_type, public_tier, subscription_level, level, seats,
          term_start, term_end, status, invoice_ref, library_link_url, papermark_folder_id, library_link_updated_at, note
        ) values (
          ${d.fullName}, ${d.fullName}, ${d.organisation}, ${d.roleTitle},
          ${d.email}, ${d.phone}, 'subscriber',
          ${d.publicTier}, ${d.publicTier},
          ${level}, ${seats}, ${termStart}::date, ${termEnd}::date,
          'pending', ${d.invoiceRef}, ${libraryLinkForDb}, ${folderIdForDb},
          ${libraryLinkForDb ? new Date() : null}, ${d.note}
        )
      `
    }
    if (id) {
      outcome = await applyLevelChange({
        subscriberId: id,
        subscriberEmail: d.email,
        oldLevel: previousLevel,
        newLevel: level,
        changedById: admin.id,
        changedByName: admin.name,
      })

      if (previousPublicTier !== d.publicTier && d.publicTier) {
        try {
          await reassignDataRoomOnLevelChange({
            subscriberId: id,
            oldPublicTier: previousPublicTier,
            newPublicTier: d.publicTier,
            changedById: admin.id,
            changedByName: admin.name,
          })
        } catch {}
      }

      if (termEnd && termEnd !== previousTermEnd) {
        try {
          await updateDataRoomLinkExpiry({
            subscriberId: id,
            newTermEnd: termEnd,
          })
        } catch {}
      }
    }
  } catch (error) {
    return {
      message: isUniqueViolation(error)
        ? "A subscriber with that email address or private library link already exists."
        : "The subscriber could not be saved. Please check the fields and try again.",
    }
  }

  refresh()

  if (outcome.direction === "upgrade") {
    return {
      ok: true,
      message:
        "Saved. Access widened — any newly entitled editions will appear in Copies needed.",
    }
  }
  if (outcome.revocationsQueued > 0) {
    return {
      ok: true,
      message: `Saved. ${outcome.revocationsQueued} link${
        outcome.revocationsQueued === 1 ? "" : "s"
      } no longer covered by this level — listed under Revoke manually.`,
    }
  }

  return { ok: true, message: "Saved." }
}
export async function activateSubscriber(id: string): Promise<FormState> {
  await requireAdmin()
  if (!UUID.test(id)) return { message: "Unknown subscriber." }

  let sql: ReturnType<typeof getSql>
  try {
    sql = getSql()
  } catch {
    return { message: "Subscriber storage is temporarily unavailable. Please try again." }
  }

  let rows: {
    id: string
    full_name: string | null
    name: string
    email: string
    level: string | null
    public_tier: string
    seats: number
    term_end: string | null
    status: string
    library_link_url: string | null
    papermark_folder_id: string | null
  }[]
  try {
    rows = (await sql`
      select id, full_name, name, email, level, public_tier, seats, term_end, status, library_link_url, papermark_folder_id
      from subscribers where id = ${id} limit 1
    `) as typeof rows
  } catch {
    return { message: "The subscriber could not be loaded for activation. Please try again." }
  }

  const row = rows[0]
  if (!row) return { message: "That subscriber no longer exists." }

  if (!row.public_tier) {
    return { message: "Set Subscription access level before activating." }
  }
  if (!isLevel(row.level)) {
    return {
      message: "Save a valid Subscription access level before activating.",
    }
  }
  if (!row.term_end) {
    return { message: "Set a term end date before activating this seat." }
  }
  if (row.library_link_url && !papermarkEmbedUrl(row.library_link_url, process.env.PAPERMARK_CUSTOM_DOMAIN)) {
    return { message: "Replace the private library link with a valid Papermark share link before activating." }
  }
  try {
    if (row.papermark_folder_id) {
      const folderDuplicates = await sql`
        select 1 from subscribers where papermark_folder_id=${row.papermark_folder_id} and id<>${id} and lower(status)='active'
        union all select 1 from briefing_requests where papermark_folder_id=${row.papermark_folder_id} and lower(status)='active' limit 1`
      if (folderDuplicates.length) return { message:"That private folder is assigned to another active client." }
    }
    if (row.library_link_url) {
      const duplicates = await sql`
        select 1 from subscribers
        where library_link_url = ${row.library_link_url} and id <> ${id}
        union all
        select 1 from briefing_requests where private_link_url = ${row.library_link_url}
        limit 1
      `
      if (duplicates.length > 0) {
        return {
          message:
            "That private Papermark link is assigned to another client. Give this subscriber a unique link before activating.",
        }
      }
    }
  } catch {
    return { message: "Activation checks could not be completed. Please try again." }
  }
  if (new Date(row.term_end) < startOfToday()) {
    return {
      message:
        "That term end date is in the past. Extend it before activating.",
    }
  }

  let token: string
  try {
    await sql`
      update subscribers
      set status = 'active',
          term_start = coalesce(term_start, current_date),
          updated_at = now()
      where id = ${id}
    `
    token = await issueToken(id)
  } catch {
    refresh()
    return {
      message:
        "The subscriber was not fully activated. Refresh the page and use Activate or Resend sign-in link again.",
    }
  }

  let drNote = ""
  try {
    const room = await resolveDataRoom({ subscriberId: id, publicTier: row.public_tier })
    if (room) {
      const existingLink = await getDataRoomLink({ subscriberId: id, dataroomId: room.dataroomId })
      if (!existingLink) {
        const drResult = await createDataRoomLink({
          dataroomId: room.dataroomId,
          assignedName: row.full_name || row.name,
          assignedEmail: row.email,
          expiresAt: row.term_end,
        })
        if (drResult.ok) {
          await saveDataRoomLink({
            subscriberId: id,
            dataroomId: room.dataroomId,
            papermarkLinkId: drResult.value.linkId,
            linkUrl: drResult.value.url,
            assignedName: row.full_name || row.name,
            assignedEmail: row.email,
            watermarkEnabled: true,
            watermarkText: watermarkText(row.full_name || row.name, row.email),
            allowDownload: drResult.value.settings.allow_download,
            screenshotProtection: drResult.value.settings.enable_screenshot_protection,
            expiresAt: drResult.value.settings.expires_at,
          })
          await assignDataRoomToSubscriber(id, room.dataroomId)
          const admin = await requireAdmin()
          await recordAssignment({
            subscriberId: id,
            newDataroomId: room.dataroomId,
            newLinkId: drResult.value.linkId,
            reason: "Auto-created on activation",
            changedById: admin.id,
            changedByName: admin.name,
          })
          drNote = " Data Room link created."
        }
      }
    }
  } catch {}

  let mailed = true
  try {
    await sendWelcome({
      subscriberId: id,
      email: row.email,
      fullName: row.full_name || row.name || "",
      publicTier: row.public_tier,
      termEnd: row.term_end,
      token,
    })
  } catch {
    mailed = false
  }

  refresh()
  const granted = levelLabel(row.level, row.seats)

  return {
    ok: true,
    message: mailed
      ? `Seat activated at ${granted}, and the welcome email has been sent.${drNote}`
      : `Seat activated at ${granted}, but the welcome email could not be sent. Check the email configuration.${drNote}`,
  }
}

/** Permanently remove one subscriber and their dependent portal access records. */
export async function deleteSubscriber(id: string, confirmationEmail: string): Promise<FormState> {
  const admin = await requireAdmin()
  if (admin.role !== "owner") return { message: "Only an owner can delete subscribers." }
  if (!UUID.test(id)) return { message: "Unknown subscriber." }

  const sql = getSql()
  const rows = await sql`
    delete from subscribers
    where id = ${id} and client_type = 'subscriber'
      and lower(email) = ${confirmationEmail.trim().toLowerCase()}
    returning id
  `
  if (!rows[0]) return { message: "The confirmation email did not match." }

  refresh()
  return { ok: true, message: "Subscriber deleted from APRI. Revoke the Papermark link separately." }
}

export async function resendSignInLink(id: string): Promise<FormState> {
  await requireAdmin()
  if (!UUID.test(id)) return { message: "Unknown subscriber." }

  let rows: {
    id: string
    full_name: string | null
    name: string
    email: string
    public_tier: string
    term_end: string | null
    status: string
  }[]
  try {
    const sql = getSql()
    rows = (await sql`
      select id, full_name, name, email, public_tier, term_end, status
      from subscribers where id = ${id} limit 1
    `) as typeof rows
  } catch {
    return { message: "The subscriber sign-in link could not be prepared. Please try again." }
  }

  const row = rows[0]
  if (!row) return { message: "That subscriber no longer exists." }
  if (row.status.toLowerCase() !== "active") {
    return { message: "Only an active seat can be sent a sign-in link." }
  }

  try {
    const token = await issueToken(id)
    await sendWelcome({
      subscriberId: id,
      email: row.email,
      fullName: row.full_name || row.name || "",
      publicTier: row.public_tier,
      termEnd: row.term_end,
      token,
    })
  } catch {
    return {
      message: "Could not send the email. Check the email configuration.",
    }
  }

  return {
    ok: true,
    message: `A fresh sign-in link has been sent to ${row.email}.`,
  }
}
export async function setPublicationAccess(
  subscriberId: string,
  publicationId: string,
  linkUrl: string,
): Promise<FormState> {
  await requireAdmin()
  if (!UUID.test(subscriberId) || !UUID.test(publicationId)) {
    return { message: "Unknown record." }
  }

  const parsed = httpsOrBlank.safeParse(linkUrl)
  if (!parsed.success)
    return { message: "That link must be an https:// address." }

  const sql = getSql()

  if (!parsed.data) {
    await sql`
      delete from publication_access
      where subscriber_id = ${subscriberId} and publication_id = ${publicationId}
    `
    refresh()
    return { ok: true, message: "Override removed." }
  }

  await sql`
    insert into publication_access (subscriber_id, publication_id, link_url)
    values (${subscriberId}, ${publicationId}, ${parsed.data})
    on conflict (subscriber_id, publication_id)
    do update set link_url = excluded.link_url, updated_at = now()
  `

  refresh()
  return { ok: true, message: "Link saved for this subscriber." }
}
export async function sendPublishAlert(
  publicationId: string,
): Promise<FormState> {
  await requireAdmin()
  if (!UUID.test(publicationId)) return { message: "Unknown publication." }

  const outcome = await sendAlert(publicationId)
  return { ok: outcome.ok, message: outcome.message }
}
export async function getAlertPreview(publicationId: string) {
  await requireAdmin()
  if (!UUID.test(publicationId)) return null
  return previewAlert(publicationId)
}

function startOfToday(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

function isRealIsoDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "23505",
  )
}

function refresh() {
  revalidatePath("/admin")
  revalidatePath("/admin/subscribers")
  revalidatePath("/portal")
}
