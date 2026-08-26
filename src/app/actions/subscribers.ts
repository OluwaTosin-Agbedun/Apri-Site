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
  LEVELS,
  PUBLIC_TIER_NAMES,
  isEntitled,
  isLevel,
  isVisibility,
  levelLabel,
  type Level,
} from "@/lib/entitlements"
import { applyLevelChange, type LevelChangeOutcome } from "@/lib/level-changes"
import { fieldErrors, type FormState } from "@/lib/definitions"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

const SubscriberAdminSchema = z.object({
  clientType: z.enum(["subscriber", "engagement"]).default("subscriber"),
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
  level: z.enum(LEVELS).or(z.literal("")),
  seats: z.coerce.number().int().min(1).max(500).default(1),
  termStart: z.union([z.literal(""), z.string().trim().max(10)]).default(""),
  termEnd: z.union([z.literal(""), z.string().trim().max(10)]).default(""),
  status: z.enum(["pending", "active", "lapsed", "suspended"]),
  invoiceRef: z.string().trim().max(120).default(""),
  libraryLinkUrl: httpsOrBlank,
  note: z.string().trim().max(600).default(""),
})
export async function saveSubscriber(
  id: string | null,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin()
  if (id && !UUID.test(id)) return { message: "Unknown subscriber." }

  const parsed = SubscriberAdminSchema.safeParse({
    clientType: formData.get("clientType") ?? "subscriber",
    fullName: formData.get("fullName"),
    organisation: formData.get("organisation") ?? "",
    roleTitle: formData.get("roleTitle") ?? "",
    email: formData.get("email"),
    phone: formData.get("phone") ?? "",
    publicTier: formData.get("publicTier") ?? "",
    level: formData.get("level") ?? "",
    seats: formData.get("seats") ?? 1,
    termStart: formData.get("termStart") ?? "",
    termEnd: formData.get("termEnd") ?? "",
    status: formData.get("status") ?? "pending",
    invoiceRef: formData.get("invoiceRef") ?? "",
    libraryLinkUrl: formData.get("libraryLinkUrl") ?? "",
    note: formData.get("note") ?? "",
  })

  if (!parsed.success) return { errors: fieldErrors(parsed.error) }
  const d = parsed.data
  if (d.clientType === "engagement" && d.level) {
    return {
      message:
        "A briefing client holds no access level — they receive documents individually, not a library. Clear the level, or set this person to Subscriber.",
    }
  }

  const sql = getSql()
  const level = d.level || null
  const termStart = d.termStart || null
  const termEnd = d.termEnd || null
  if (d.libraryLinkUrl) {
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
  let previousLevel: string | null = null
  if (id && UUID.test(id)) {
    const before = (await sql`
      select level from subscribers where id = ${id} limit 1
    `) as { level: string | null }[]
    previousLevel = before[0]?.level ?? null
  }

  try {
    if (id) {
      if (!UUID.test(id)) return { message: "Unknown subscriber." }
      await sql`
        update subscribers set
          full_name = ${d.fullName}, name = ${d.fullName},
          organization = ${d.organisation}, role_title = ${d.roleTitle},
          email = ${d.email}, phone = ${d.phone},
          client_type = ${d.clientType},
          public_tier = ${d.publicTier}, subscription_level = ${d.publicTier},
          level = ${level}, seats = ${d.seats},
          term_start = ${termStart}::date, term_end = ${termEnd}::date,
          status = ${d.status}, invoice_ref = ${d.invoiceRef},
          library_link_url = ${d.libraryLinkUrl || null},
          note = ${d.note}, updated_at = now()
        where id = ${id}
      `
    } else {
      await sql`
        insert into subscribers (
          full_name, name, organization, role_title, email, phone,
          client_type, public_tier, subscription_level, level, seats,
          term_start, term_end, status, invoice_ref, library_link_url, note
        ) values (
          ${d.fullName}, ${d.fullName}, ${d.organisation}, ${d.roleTitle},
          ${d.email}, ${d.phone}, ${d.clientType},
          ${d.publicTier}, ${d.publicTier},
          ${level}, ${d.seats}, ${termStart}::date, ${termEnd}::date,
          ${d.status}, ${d.invoiceRef}, ${d.libraryLinkUrl || null}, ${d.note}
        )
      `
    }
  } catch {
    return { message: "A subscriber with that email address already exists." }
  }
  let outcome: LevelChangeOutcome = { direction: "none", revocationsQueued: 0 }
  if (id) {
    outcome = await applyLevelChange({
      subscriberId: id,
      subscriberEmail: d.email,
      oldLevel: previousLevel,
      newLevel: level,
      changedById: admin.id,
      changedByName: admin.name,
    })
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

  const sql = getSql()

  const rows = (await sql`
    select id, full_name, name, email, level, public_tier, seats, term_end, status, library_link_url
    from subscribers where id = ${id} limit 1
  `) as {
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
  }[]

  const row = rows[0]
  if (!row) return { message: "That subscriber no longer exists." }

  if (!isLevel(row.level)) {
    return {
      message: "Set an access level on this record before activating it.",
    }
  }
  if (!row.term_end) {
    return { message: "Set a term end date before activating this seat." }
  }
  if (!row.library_link_url) {
    return {
      message:
        "Set the subscriber's unique private Papermark library link before activating.",
    }
  }

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
  if (new Date(row.term_end) < startOfToday()) {
    return {
      message:
        "That term end date is in the past. Extend it before activating.",
    }
  }

  await sql`
    update subscribers
    set status = 'active',
        term_start = coalesce(term_start, current_date),
        updated_at = now()
    where id = ${id}
  `
  const token = await issueToken(id)
  let mailed = true
  try {
    await sendWelcome({
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
      ? `Seat activated at ${granted}, and the welcome email has been sent.`
      : `Seat activated at ${granted}, but the welcome email could not be sent. Check the email configuration.`,
  }
}
export async function resendSignInLink(id: string): Promise<FormState> {
  await requireAdmin()
  if (!UUID.test(id)) return { message: "Unknown subscriber." }

  const sql = getSql()
  const rows = (await sql`
    select id, full_name, name, email, public_tier, term_end, status
    from subscribers where id = ${id} limit 1
  `) as {
    id: string
    full_name: string | null
    name: string
    email: string
    public_tier: string
    term_end: string | null
    status: string
  }[]

  const row = rows[0]
  if (!row) return { message: "That subscriber no longer exists." }
  if (row.status.toLowerCase() !== "active") {
    return { message: "Only an active seat can be sent a sign-in link." }
  }

  const token = await issueToken(id)
  try {
    await sendWelcome({
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

function refresh() {
  revalidatePath("/admin")
  revalidatePath("/admin/subscribers")
  revalidatePath("/portal")
}
