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
import { requireAdmin, requireOwner } from "@/lib/dal"
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
import { queueSubscriberAccessReconciliation, reconcileSubscriberAccess } from "@/lib/subscriber-access-reconciliation"
import { accessHealthSchemaReady, ACCESS_HEALTH_MIGRATION_PENDING } from "@/lib/access-health-schema"
import { readSubscriberTerm } from "@/lib/subscriber-principal"
import { signInDecision } from "@/lib/subscription-term"

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
        select level, public_tier, to_char(term_end, 'YYYY-MM-DD') as term_end, library_link_url, papermark_folder_id
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
    const periodOwner = id
      ? id
      : String(((await sql`select id from subscribers where lower(email)=${d.email} limit 1`) as { id:string }[])[0]?.id ?? "")
    if (periodOwner && termStart && termEnd && level) {
      // The agreed term is a paid period. A period with these exact dates that
      // was voided as a mistake stays voided: the conflict leaves it alone.
      const added = (await sql`
        insert into subscriber_subscription_periods (subscriber_id, starts_on, ends_on, level, source)
        values (${periodOwner}::uuid, ${termStart}::date, ${termEnd}::date, ${level}, 'admin-agreed-term')
        on conflict do nothing
        returning id
      `) as { id: string }[]
      if (added[0] && (await accessHealthSchemaReady(sql))) {
        await sql`
          update subscriber_subscription_periods set created_by = ${admin.id}::uuid where id = ${added[0].id}::uuid
        `
        await sql`
          insert into subscriber_period_events (subscriber_id, period_id, action, starts_on, ends_on, level, reason, administrator_id)
          values (${periodOwner}::uuid, ${added[0].id}::uuid, 'added', ${termStart}::date, ${termEnd}::date, ${level},
                  'Agreed term saved on the subscriber record', ${admin.id}::uuid)
        `
        linkNote += " The agreed term was added to the paid periods; if it corrects an earlier term, void the mistaken period under Paid periods."
      }
      await queueSubscriberAccessReconciliation(periodOwner, "admin_change")
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
      if (previousLevel !== level || previousTermEnd !== termEnd) {
        try {
          const trigger = previousLevel !== level ? "level_change" : "renewal"
          await queueSubscriberAccessReconciliation(id, trigger)
          const reconciled = await reconcileSubscriberAccess(id, { trigger })
          if (reconciled.state !== "complete" && reconciled.state !== "not_applicable") {
            linkNote += ` Document access: ${reconciled.message} Use Repair document links on this page to retry.`
          }
        } catch {
          linkNote += " Document access could not be updated just now. Use Repair document links on this page to retry."
        }
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

/**
 * Automatic / Allow / Block for one subscriber and one publication, with the
 * administrator and reason recorded -- including a return to Automatic, which
 * removes the exception. Allow never lifts the subscriber above their level,
 * outside an active subscription or out of their library; Block always wins.
 * Access is then reconciled at once, and the result shown on the page.
 */
export async function setPublicationException(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin()
  const subscriberId = String(formData.get("subscriberId") ?? "")
  const publicationId = String(formData.get("publicationId") ?? "")
  const decision = String(formData.get("decision") ?? "automatic")
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500)
  if (!UUID.test(subscriberId) || !UUID.test(publicationId)) return { message: "Unknown subscriber or publication." }
  if (!["automatic", "allow", "block"].includes(decision)) return { message: "Unknown access control." }
  if (!reason) return { message: "Record a reason before changing access." }
  const sql = getSql()
  const { editionEntitlementSchemaReady, EDITION_ENTITLEMENT_MIGRATION_PENDING } = await import("@/lib/edition-entitlement-schema")
  if (!(await editionEntitlementSchemaReady(sql))) return { message: EDITION_ENTITLEMENT_MIGRATION_PENDING }
  if (!(await accessHealthSchemaReady(sql))) return { message: ACCESS_HEALTH_MIGRATION_PENDING }
  const known = (await sql`
    select 1 from subscribers s, documents d
    where s.id = ${subscriberId}::uuid and s.client_type = 'subscriber' and d.id = ${publicationId}::uuid
  `) as unknown[]
  if (known.length === 0) return { message: "Unknown subscriber or publication." }
  if (decision === "automatic") {
    await sql`delete from subscriber_publication_exceptions where subscriber_id = ${subscriberId}::uuid and publication_id = ${publicationId}::uuid`
  } else {
    await sql`
      insert into subscriber_publication_exceptions (subscriber_id, publication_id, decision, reason, administrator_id)
      values (${subscriberId}::uuid, ${publicationId}::uuid, ${decision}, ${reason}, ${admin.id}::uuid)
      on conflict (subscriber_id, publication_id) do update
        set decision = excluded.decision, reason = excluded.reason, administrator_id = excluded.administrator_id, updated_at = now()
    `
  }
  await sql`
    insert into subscriber_exception_events (subscriber_id, publication_id, decision, reason, administrator_id)
    values (${subscriberId}::uuid, ${publicationId}::uuid, ${decision}, ${reason}, ${admin.id}::uuid)
  `
  await queueSubscriberAccessReconciliation(subscriberId, "admin_change")
  const reconciled = await reconcileSubscriberAccess(subscriberId, { trigger: "admin_change" })
  revalidatePath(`/admin/subscribers/${subscriberId}`)
  const label = decision === "automatic" ? "Automatic" : decision === "allow" ? "Allow" : "Block"
  return { ok: reconciled.state === "complete", message: `${label} recorded. ${reconciled.message}` }
}

/**
 * Repair document links: recalculate the subscriber's entitlement, create what
 * is missing, repair what is wrong, withdraw what is no longer permitted, and
 * verify. Never sends email. The reconciliation record is created when it
 * does not exist yet.
 */
export async function reconcilePublicationAccess(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireOwner()
  const subscriberId = String(formData.get("subscriberId") ?? "")
  if (!UUID.test(subscriberId)) return { message: "Unknown subscriber." }
  await queueSubscriberAccessReconciliation(subscriberId, "admin_repair")
  const reconciled = await reconcileSubscriberAccess(subscriberId, { trigger: "admin_repair" })
  revalidatePath(`/admin/subscribers/${subscriberId}`)
  revalidatePath("/admin/subscribers/access-health")
  return { ok: reconciled.state === "complete" || reconciled.state === "not_applicable", message: reconciled.message }
}

/** What a level change did to the new room's personal links, when it needs saying. */
function levelChangeLinkNote(moved: Awaited<ReturnType<typeof reassignDataRoomOnLevelChange>>): string {
  if (moved.action === "no_room") {
    return " The new level has no Data Room mapped, so the subscriber keeps their current library. Map one under Data Rooms."
  }
  if (moved.action !== "reassigned" && moved.action !== "created") return ""
  const links = moved.links
  if (!links) {
    return " The new Data Room's personal document links could not be checked. Use Repair document links on this page."
  }
  if (links.state === "complete" || links.state === "not_applicable") return ` ${links.message}`
  return ` ${links.message} Use Repair document links on this page to retry.`
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
  // The portal's own sign-in rule: an email whose link would be refused is not sent.
  const term = await readSubscriberTerm({ id })
  const signIn = term ? signInDecision(term.subscription) : { ok: false as const, reason: "inactive" as const }
  if (!signIn.ok) {
    return signIn.reason === "subscription-expired"
      ? "This subscriber's term has ended, so the portal would refuse their sign-in. Nothing was sent."
      : "This subscriber cannot sign in at the moment, so nothing was sent."
  }
  const access = await ensureSubscriberLibraryAccess({
    subscriberId: id,
    publicTier: row.public_tier,
    trigger: "resend",
    changedById: admin.id,
    changedByName: admin.name,
  })
  // No Data Room: the legacy library, which the portal serves them.
  if (access.state === "no_room" || access.state === "ready") return null
  return `${access.message} Use Repair document links on this page, then try again.`
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

// ---------------------------------------------------------------------------
// Paid periods: added and voided with the administrator and reason recorded
// ---------------------------------------------------------------------------

const PERIOD_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Adds a paid period: the dates a subscriber paid for, at a level. Editions
 * dated inside any period (at or below its level) are covered. A renewal is a
 * new period; an unpaid gap is simply the absence of one.
 */
export async function addPaidPeriod(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin()
  const subscriberId = String(formData.get("subscriberId") ?? "")
  const startsOn = String(formData.get("startsOn") ?? "")
  const endsOn = String(formData.get("endsOn") ?? "")
  const level = String(formData.get("level") ?? "")
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500)
  if (!UUID.test(subscriberId)) return { message: "Unknown subscriber." }
  if (!PERIOD_DATE.test(startsOn) || !PERIOD_DATE.test(endsOn) || Number.isNaN(Date.parse(startsOn)) || Number.isNaN(Date.parse(endsOn))) {
    return { message: "Enter both dates." }
  }
  if (endsOn < startsOn) return { message: "The period must end on or after the day it starts." }
  if (!(LEVELS as readonly string[]).includes(level)) return { message: "Choose the level that was paid for." }
  if (!reason) return { message: "Record why this period is being added (for example the invoice or agreement)." }
  const sql = getSql()
  if (!(await accessHealthSchemaReady(sql))) return { message: ACCESS_HEALTH_MIGRATION_PENDING }
  const known = (await sql`select 1 from subscribers where id = ${subscriberId}::uuid and client_type = 'subscriber'`) as unknown[]
  if (known.length === 0) return { message: "Unknown subscriber." }
  const rows = (await sql`
    insert into subscriber_subscription_periods (subscriber_id, starts_on, ends_on, level, source, created_by, note)
    values (${subscriberId}::uuid, ${startsOn}::date, ${endsOn}::date, ${level}, 'admin-period', ${admin.id}::uuid, ${reason})
    on conflict (subscriber_id, starts_on, ends_on, level) do nothing
    returning id
  `) as { id: string }[]
  if (!rows[0]) return { message: "That exact period is already recorded. Restore it instead if it was voided." }
  await sql`
    insert into subscriber_period_events (subscriber_id, period_id, action, starts_on, ends_on, level, reason, administrator_id)
    values (${subscriberId}::uuid, ${rows[0].id}::uuid, 'added', ${startsOn}::date, ${endsOn}::date, ${level}, ${reason}, ${admin.id}::uuid)
  `
  await queueSubscriberAccessReconciliation(subscriberId, "admin_change")
  const reconciled = await reconcileSubscriberAccess(subscriberId, { trigger: "admin_change" })
  revalidatePath(`/admin/subscribers/${subscriberId}`)
  return { ok: true, message: `Paid period added. ${reconciled.message}` }
}

/**
 * Voids a period recorded by mistake, or restores one voided in error. A
 * voided period grants nothing but stays in the history with who voided it
 * and why, so a correction never silently rewrites what was paid.
 */
export async function setPaidPeriodVoided(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin()
  const subscriberId = String(formData.get("subscriberId") ?? "")
  const periodId = String(formData.get("periodId") ?? "")
  const action = String(formData.get("action") ?? "")
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500)
  if (!UUID.test(subscriberId) || !UUID.test(periodId)) return { message: "Unknown period." }
  if (action !== "void" && action !== "restore") return { message: "Unknown action." }
  if (!reason) return { message: "Record why." }
  const sql = getSql()
  if (!(await accessHealthSchemaReady(sql))) return { message: ACCESS_HEALTH_MIGRATION_PENDING }
  const rows = (await sql`
    update subscriber_subscription_periods
    set voided_at = case when ${action === "void"}::boolean then now() else null end,
        voided_by = case when ${action === "void"}::boolean then ${admin.id}::uuid else null end,
        void_reason = case when ${action === "void"}::boolean then ${reason} else null end
    where id = ${periodId}::uuid and subscriber_id = ${subscriberId}::uuid
      and ((${action === "void"}::boolean and voided_at is null) or (${action === "restore"}::boolean and voided_at is not null))
    returning starts_on, ends_on, level
  `) as { starts_on: string; ends_on: string; level: string }[]
  if (!rows[0]) return { message: "That period has already been changed. Refresh the page." }
  await sql`
    insert into subscriber_period_events (subscriber_id, period_id, action, starts_on, ends_on, level, reason, administrator_id)
    values (${subscriberId}::uuid, ${periodId}::uuid, ${action === "void" ? "voided" : "restored"},
            ${rows[0].starts_on}::date, ${rows[0].ends_on}::date, ${rows[0].level}, ${reason}, ${admin.id}::uuid)
  `
  await queueSubscriberAccessReconciliation(subscriberId, "admin_change")
  const reconciled = await reconcileSubscriberAccess(subscriberId, { trigger: "admin_change" })
  revalidatePath(`/admin/subscribers/${subscriberId}`)
  return { ok: true, message: `Period ${action === "void" ? "voided" : "restored"}. ${reconciled.message}` }
}
