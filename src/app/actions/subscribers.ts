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
import { resendSecureAccessEmail, sendOnboardingEmails } from "@/lib/subscriber-onboarding"
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
  reassignDataRoomOnLevelChange,
  updateDataRoomLinkExpiry,
  revokeAllDataRoomLinks,
  ensureSubscriberLibraryAccess,
} from "@/lib/dataroom-lifecycle"
import { activateSubscriberRecord, activationDone } from "@/lib/subscriber-activation"
import { describePersonalLinks } from "@/lib/personal-links"

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
  let linkNote = ""

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
          const moved = await reassignDataRoomOnLevelChange({
            subscriberId: id,
            oldPublicTier: previousPublicTier,
            newPublicTier: d.publicTier,
            changedById: admin.id,
            changedByName: admin.name,
          })
          linkNote = levelChangeLinkNote(moved)
        } catch {
          linkNote =
            " The Data Room could not be updated for the new level. Check the Data Room panel on this page."
        }
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
      message: `Saved. Access widened — any newly entitled editions will appear in Copies needed.${linkNote}`,
    }
  }
  if (outcome.revocationsQueued > 0) {
    return {
      ok: true,
      message: `Saved. ${outcome.revocationsQueued} link${
        outcome.revocationsQueued === 1 ? "" : "s"
      } no longer covered by this level — listed under Revoke manually.${linkNote}`,
    }
  }

  return { ok: true, message: `Saved.${linkNote}` }
}

/** What a level change did to the new room's personal links, when it needs saying. */
function levelChangeLinkNote(moved: Awaited<ReturnType<typeof reassignDataRoomOnLevelChange>>): string {
  if (moved.action !== "reassigned" && moved.action !== "created") return ""
  const links = moved.links
  if (!links) {
    return " The new Data Room's personal document links could not be checked. Use Check and repair document links on this page."
  }
  if (links.state === "not_eligible") return ` ${links.message}`
  if (links.report.complete) return ""
  return ` ${describePersonalLinks(links.report)} Use Check and repair document links on this page to retry.`
}
/**
 * Activate one seat: verify its library, make it active, then send its two
 * onboarding emails.
 *
 * The work -- including the acquisition gate for a subscriber who came from
 * an Individual or Professional subscription request -- is in
 * activateSubscriberRecord (src/lib/subscriber-activation.ts), the one path
 * every activation takes. `ok` only when access is ready and no onboarding
 * email is left owed.
 */
export async function activateSubscriber(id: string): Promise<FormState> {
  const admin = await requireAdmin()
  const result = await activateSubscriberRecord({ subscriberId: id, admin })
  refresh()
  return { ok: activationDone(result), message: result.message }
}

/**
 * Retry whatever onboarding email an active subscriber is still owed: the
 * welcome if the provider never accepted it, then the secure-access email.
 * An email already accepted is never sent again, and a subscriber whose
 * onboarding never started (active before it was tracked) is sent nothing.
 */
export async function retryOnboardingEmails(id: string): Promise<FormState> {
  const admin = await requireAdmin()
  if (!UUID.test(id)) return { message: "Unknown subscriber." }

  const gate = await libraryGate(id, admin)
  if (gate) {
    refresh()
    return { message: `The onboarding emails were not sent because the library is not ready. ${gate}` }
  }
  let run: Awaited<ReturnType<typeof sendOnboardingEmails>>
  try {
    run = await sendOnboardingEmails({ subscriberId: id, start: false })
  } catch {
    return { message: "The onboarding emails could not be retried. Please try again." }
  }
  refresh()
  return { ok: run.state === "ran" && run.report.complete, message: run.message }
}

/**
 * The library check every email that says "your library is open" passes
 * first. Returns why it is not ready, or null. A subscriber off Data Rooms, or
 * whose term has ended, has no room to prepare.
 */
async function libraryGate(id: string, admin: { id: string; name: string }): Promise<string | null> {
  let rows: { full_name: string | null; name: string; email: string; public_tier: string; term_end: string | null; status: string }[]
  try {
    rows = (await getSql()`
      select full_name, name, email, public_tier, term_end, status
      from subscribers where id = ${id} and client_type = 'subscriber' limit 1
    `) as typeof rows
  } catch {
    return "The subscriber could not be loaded. Please try again."
  }
  const row = rows[0]
  if (!row) return "That subscriber no longer exists."
  if (row.status.toLowerCase() !== "active") return "Only an active seat can be sent onboarding or sign-in emails."
  const access = await ensureSubscriberLibraryAccess({
    subscriberId: id,
    publicTier: row.public_tier,
    assignedName: row.full_name || row.name,
    assignedEmail: row.email,
    termEnd: row.term_end,
    createRoomLink: false,
    changedById: admin.id,
    changedByName: admin.name,
  })
  // No room link means they are still on the legacy library, which the
  // portal serves them: nothing of a room's to prepare. Refused only when a
  // room's links are incomplete or blocked.
  if (access.state === "incomplete" || (access.state === "blocked" && access.reason !== "term_ended")) {
    return `${access.message} Use Check and repair document links on this page, then try again.`
  }
  return null
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

/**
 * Resend sign-in link: the secure-access email only -- never the welcome
 * again. Claimed atomically, so a double-click sends one link; older links are
 * revoked only once the provider has accepted the new one. See
 * resendSecureAccessEmail in src/lib/subscriber-onboarding.ts.
 */
export async function resendSignInLink(id: string): Promise<FormState> {
  const admin = await requireAdmin()
  if (!UUID.test(id)) return { message: "Unknown subscriber." }

  // The link opens the library, so it goes out only once the library is ready.
  const gate = await libraryGate(id, admin)
  if (gate) {
    refresh()
    return { message: `The sign-in email was not sent because the library is not ready yet. ${gate}` }
  }

  let result: Awaited<ReturnType<typeof resendSecureAccessEmail>>
  try {
    result = await resendSecureAccessEmail(id)
  } catch {
    return { message: "The sign-in link could not be sent. Please try again." }
  }
  refresh()
  return { ok: result.ok, message: result.message }
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
