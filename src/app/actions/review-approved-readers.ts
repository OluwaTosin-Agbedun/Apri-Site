"use server"

import { revalidatePath } from "next/cache"
import { requireOwner } from "@/lib/dal"
import { readerRoomJob } from "@/lib/review-room-jobs"
import { getSql } from "@/lib/db"
import { normaliseReaderEmail } from "@/lib/review-reader"
import { getReviewLibraryForEmail } from "@/lib/publications"
import { recentReviewEmailAttempts, attemptStatus } from "@/lib/review-email-attempts"
import { saveEditionRecipients, previewEditionRecipients, applyEditionRecipients } from "./review-edition-access"
import { recipientListHash } from "@/lib/edition-recipients"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ReaderEditionRow = {
  id: string
  series: string | null
  title: string
  label: string
  state: string
  /** Opens it now, by the same rule as the reader's own library. */
  canOpen: boolean
  /** On this edition's own recipient list (edition mode). */
  isRecipient: boolean
  /** Judged by the old shared list instead of its own recipients. */
  sharedLegacy: boolean
  hasLink: boolean
  /** The edition's own Papermark link carries its current reader list (confirmed by read-back). */
  papermarkInSync: boolean
}

export type ReaderLookup = {
  ok?: boolean
  message?: string
  email?: string
  editions?: ReaderEditionRow[]
  room?: { state: string; visible: number; verifiedAt: string | null; lastError: string | null; jobState?: string; nextRetryAt?: string | null } | null
  emails?: { kind: string; at: string; status: string }[]
}

async function lookup(email: string): Promise<ReaderLookup> {
  const sql = getSql()
  const opens = new Set((await getReviewLibraryForEmail(email)).map((e) => e.id))
  const rows = (await sql`
    select e.id, e.series, e.title, e.edition_label, e.publication_state, e.recipient_mode,
           (e.secure_link_id is not null) as has_link, e.recipients_verified_hash,
           coalesce((select array_agg(r.email order by r.email) from review_edition_recipients r
                     where r.edition_id = e.id and r.revoked_at is null), array[]::text[]) as active,
           exists (select 1 from review_edition_recipients r
                    where r.edition_id = e.id and r.email = ${email} and r.revoked_at is null) as is_recipient
    from review_publication_editions e
    where e.publication_state in ('published', 'draft', 'withdrawn')
    order by case e.series when 'MIN' then 1 when 'AIU' then 2 when 'PLM' then 3 else 4 end,
             (to_jsonb(e) ->> 'display_position')::int asc nulls last, e.edition_sort_key desc, e.created_at desc
  `) as { id: string; series: string | null; title: string; edition_label: string; publication_state: string; recipient_mode: string; has_link: boolean; is_recipient: boolean; recipients_verified_hash: string | null; active: string[] }[]
  let room: ReaderLookup["room"] = null
  try {
    const [r] = (await sql`select state, verified_visible, verified_at, last_error from review_reader_rooms where email = ${email}`) as {
      state: string; verified_visible: string | null; verified_at: string | Date | null; last_error: string | null
    }[]
    if (r) room = { state: r.state, visible: (r.verified_visible ?? "").split(",").filter(Boolean).length, verifiedAt: r.verified_at ? new Date(r.verified_at).toISOString() : null, lastError: r.last_error }
  } catch {
    room = null
  }
  const job = await readerRoomJob(email)
  if (room && job) { room.jobState = job.state; room.nextRetryAt = ["pending", "running"].includes(job.state) ? new Date(job.next_attempt_at).toISOString() : null }
  const attempts = await recentReviewEmailAttempts(5, email)
  return {
    ok: true,
    email,
    editions: rows.map((e) => ({
      id: e.id,
      series: e.series,
      title: e.title,
      label: e.edition_label,
      state: e.publication_state,
      canOpen: opens.has(e.id),
      isRecipient: e.is_recipient,
      sharedLegacy: e.recipient_mode === "shared_legacy",
      hasLink: e.has_link,
      papermarkInSync: e.has_link && e.recipients_verified_hash === recipientListHash(e.active),
    })),
    room,
    emails: attempts.map((a) => ({ kind: a.kind, at: a.createdAt, status: attemptStatus(a) })),
  }
}

/** Owner only: exactly which editions one address can open, and why. */
export async function lookupApprovedReader(_prev: ReaderLookup | undefined, formData: FormData): Promise<ReaderLookup> {
  await requireOwner()
  const email = normaliseReaderEmail(formData.get("email"))
  if (!email) return { message: "Enter a full email address." }
  return lookup(email)
}

/**
 * Owner only: adds or removes one address on one edition, through the same
 * safeguarded steps as the edition's own recipient panel -- save the list
 * (which refuses an empty list for a linked edition), then, if the edition has
 * a Papermark link, preview its live allow list and apply exactly that list,
 * read back by Papermark. Their personal room, if any, follows automatically.
 */
export async function changeReaderOnEdition(_prev: ReaderLookup | undefined, formData: FormData): Promise<ReaderLookup> {
  await requireOwner()
  const email = normaliseReaderEmail(formData.get("email"))
  const editionId = String(formData.get("editionId") ?? "")
  const include = formData.get("include") === "1"
  if (!email || !UUID.test(editionId)) return { message: "Unknown reader or edition." }
  const sql = getSql()
  const [edition] = (await sql`select publication_state, recipient_mode, secure_link_id from review_publication_editions where id = ${editionId}::uuid`) as {
    publication_state: string; recipient_mode: string; secure_link_id: string | null
  }[]
  if (!edition) return { ...(await lookup(email)), ok: false, message: "Unknown edition." }
  if (edition.recipient_mode === "shared_legacy") {
    return { ...(await lookup(email)), ok: false, message: "This edition is still judged by the old shared list. Adopt its Papermark access in the edition's own panel first." }
  }
  if (edition.publication_state === "withdrawn") {
    return { ...(await lookup(email)), ok: false, message: "This edition is withdrawn; its readers cannot be changed." }
  }
  const current = ((await sql`select email from review_edition_recipients where edition_id = ${editionId}::uuid and revoked_at is null`) as { email: string }[]).map((r) => r.email)
  const next = include ? [...new Set([...current, email])] : current.filter((e) => e !== email)
  const saved = await saveEditionRecipients(editionId, next)
  if (!saved.ok) return { ...(await lookup(email)), ok: false, message: saved.message }
  let message = include ? "Added." : "Removed."
  if (edition.secure_link_id) {
    const preview = await previewEditionRecipients(editionId)
    if (!preview.ok || !preview.previewHash) {
      message += ` Papermark's link was not updated: ${preview.message}`
    } else if (preview.policyProblem) {
      message += ` Papermark's link was not updated: ${preview.policyProblem}`
    } else {
      const applied = await applyEditionRecipients(editionId, preview.previewHash)
      message += applied.ok ? " The edition's Papermark link now matches, confirmed by read-back." : ` Papermark's link was not updated: ${applied.message}`
    }
  } else {
    message += " The edition has no Papermark link yet; it takes effect when its link is prepared."
  }
  revalidatePath("/admin/review-library")
  return { ...(await lookup(email)), ok: true, message }
}
