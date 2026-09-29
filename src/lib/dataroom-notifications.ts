import "server-only"
import { getSql } from "./db"
import { sendEditionAlert } from "./subscriber-email"
import { recordClientEvent } from "./client-engagement"
import { ensureAllDocumentLinks } from "./document-links"

/**
 * Automatic new-document emails stay off unless DATAROOM_NEW_DOCUMENT_EMAILS
 * is set to "enabled".
 *
 * Until this change the sender below could never send: it read its queries'
 * columns under names the queries did not return, so its first claim failed
 * before any email went out, and the webhook swallowed the error. Correcting
 * that would start emailing real subscribers, which is the owner's decision to
 * make, not a side effect of a fix -- so it waits for this setting.
 */
export function newDocumentEmailsEnabled(): boolean {
  return process.env.DATAROOM_NEW_DOCUMENT_EMAILS === "enabled"
}

type NewDocument = {
  dataroomDocumentId: string
  papermarkDocumentId: string
  dataroomId: string
  title: string
  versionKey: string
}

type EligibleRecipient = {
  subscriberId: string
  email: string
  fullName: string
  linkUrl: string | null
  hasRoomLink: boolean
}

/**
 * Notify subscribers about new documents in a Data Room.
 *
 * Three guards prevent a blast of unwanted email:
 *
 * 1. **Baseline guard** — only documents with `notification_eligible = true` are
 *    considered. The migration sets every pre-existing document to `false`, so
 *    the first cron run after deployment sends nothing. Only documents inserted
 *    after the migration (which default to `true`) can trigger emails.
 *
 * 2. **Time window** — even among eligible documents, only those with
 *    `first_seen_at` within the last hour are processed. This caps the blast
 *    radius of a bulk import or a Data Room mapped for the first time.
 *
 * 3. **Insert-before-send dedup** — the notification record is inserted (with
 *    a unique constraint) *before* the email is sent. If two processes race on
 *    the same (subscriber, document, version), only the one whose insert succeeds
 *    sends the email; the loser's insert is a no-op and no email goes out.
 *
 * And one guard against an email nobody can act on: a subscriber on Data Rooms
 * is told about a document only once their personal link to it exists. It is
 * prepared here if it is missing; if it still cannot be, their notification is
 * held -- not claimed -- so a later run inside the window can still send it.
 */
export async function notifyNewDataRoomDocuments(
  dataroomId: string,
): Promise<{ sent: number; skipped: number; held: number }> {
  if (!newDocumentEmailsEnabled()) return { sent: 0, skipped: 0, held: 0 }
  const sql = getSql()

  // Find documents that are new, eligible and within the time window.
  // No document-level "already notified" filter — dedup is per-subscriber
  // inside the loop, so every eligible subscriber gets their chance.
  const newDocs = (await sql`
    select dd.id as "dataroomDocumentId", dd.papermark_document_id as "papermarkDocumentId",
      dd.papermark_dataroom_id as "dataroomId", dd.title, dd.version_key as "versionKey"
    from papermark_dataroom_documents dd
    where dd.papermark_dataroom_id = ${dataroomId}
      and dd.is_present = true
      and dd.notification_eligible = true
      and dd.first_seen_at > now() - interval '1 hour'
  `) as NewDocument[]

  if (newDocs.length === 0) return { sent: 0, skipped: 0, held: 0 }

  const publicTierRow = (await sql`
    select public_tier from papermark_level_rooms
    where papermark_dataroom_id = ${dataroomId} limit 1
  `) as { public_tier: string }[]

  if (!publicTierRow[0]) return { sent: 0, skipped: 0, held: 0 }

  const recipients = (await sql`
    select s.id as "subscriberId", s.email,
      coalesce(nullif(s.full_name, ''), s.name) as "fullName",
      dl.link_url as "linkUrl",
      (dl.id is not null) as "hasRoomLink"
    from subscribers s
    left join papermark_dataroom_links dl
      on dl.subscriber_id = s.id
      and dl.papermark_dataroom_id = ${dataroomId}
      and dl.revoke_state = 'live'
    where s.client_type = 'subscriber'
      and lower(s.status) = 'active'
      and (s.term_end is null or s.term_end >= current_date)
      and (s.papermark_dataroom_override = ${dataroomId}
        or (s.papermark_dataroom_override is null
          and s.public_tier = ${publicTierRow[0].public_tier}))
  `) as EligibleRecipient[]

  let sent = 0
  let skipped = 0
  let held = 0

  for (const doc of newDocs) {
    for (const recipient of recipients) {
      // Only once the link it leads to exists. Held, not claimed, so a later
      // run inside the window can still send it once the link is ready.
      if (recipient.hasRoomLink && !(await personalLinkReady(recipient.subscriberId, doc))) {
        held++
        continue
      }

      // Insert-before-send: claim the slot first. The unique index on
      // (subscriber_id, dataroom_document_id, version_key) means at most
      // one process wins. If the insert returns no row (conflict), skip.
      const claimed = (await sql`
        insert into papermark_document_notifications
          (subscriber_id, dataroom_document_id, version_key)
        values (${recipient.subscriberId}::uuid, ${doc.dataroomDocumentId}::uuid, ${doc.versionKey})
        on conflict (subscriber_id, dataroom_document_id, version_key)
          where subscriber_id is not null do nothing
        returning id
      `) as { id: string }[]

      if (claimed.length === 0) {
        skipped++
        continue
      }

      try {
        const outcome = await sendEditionAlert({
          email: recipient.email,
          fullName: recipient.fullName,
          title: doc.title,
          series: "",
          editionDate: null,
          summary: "",
          linkUrl: recipient.linkUrl?.startsWith("https://") ? recipient.linkUrl : null,
        }, `dataroom-alert:${claimed[0]!.id}`)
        if (outcome.status !== "accepted") {
          // Not sent (or not known to be). A message the provider refused or
          // that could not be sent at all releases its claim, so a later run
          // can send it; one whose outcome is unknown keeps it, since it may
          // already be in the inbox.
          if (outcome.status !== "unknown") {
            await sql`delete from papermark_document_notifications where id = ${claimed[0]!.id}::uuid`
          }
          skipped++
          continue
        }

        await recordClientEvent(
          { type: "subscriber", id: recipient.subscriberId },
          "publication_notification_sent",
        )

        sent++
      } catch {
        skipped++
      }
    }
  }

  return { sent, skipped, held }
}

/** Whether a subscriber's personal link to one document exists, preparing it if not. */
async function personalLinkReady(subscriberId: string, doc: NewDocument): Promise<boolean> {
  try {
    const outcome = await ensureAllDocumentLinks(subscriberId, {
      dataroomId: doc.dataroomId,
      papermarkDocumentId: doc.papermarkDocumentId,
    })
    return outcome.state === "prepared" && outcome.report.total === 1 && outcome.report.complete
  } catch {
    return false
  }
}

export async function reconcileAllDataRooms(): Promise<{
  rooms: number
  sent: number
  skipped: number
  held: number
  emailsEnabled: boolean
}> {
  if (!newDocumentEmailsEnabled()) {
    return { rooms: 0, sent: 0, skipped: 0, held: 0, emailsEnabled: false }
  }

  const sql = getSql()

  const rooms = (await sql`
    select papermark_dataroom_id from papermark_level_rooms
  `) as { papermark_dataroom_id: string }[]

  let totalSent = 0
  let totalSkipped = 0
  let totalHeld = 0

  for (const room of rooms) {
    const result = await notifyNewDataRoomDocuments(room.papermark_dataroom_id)
    totalSent += result.sent
    totalSkipped += result.skipped
    totalHeld += result.held
  }

  return { rooms: rooms.length, sent: totalSent, skipped: totalSkipped, held: totalHeld, emailsEnabled: true }
}
