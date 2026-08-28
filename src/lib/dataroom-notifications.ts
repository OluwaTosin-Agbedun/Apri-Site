import "server-only"
import { getSql } from "./db"
import { sendEditionAlert } from "./subscriber-email"
import { recordClientEvent } from "./client-engagement"

type NewDocument = {
  dataroomDocumentId: string
  dataroomId: string
  title: string
  versionKey: string
}

type EligibleRecipient = {
  subscriberId: string
  email: string
  fullName: string
  linkUrl: string | null
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
 */
export async function notifyNewDataRoomDocuments(dataroomId: string): Promise<{ sent: number; skipped: number }> {
  const sql = getSql()

  // Find documents that are new, eligible and within the time window.
  // No document-level "already notified" filter — dedup is per-subscriber
  // inside the loop, so every eligible subscriber gets their chance.
  const newDocs = (await sql`
    select dd.id as dataroom_document_id, dd.papermark_dataroom_id as dataroom_id,
      dd.title, dd.version_key
    from papermark_dataroom_documents dd
    where dd.papermark_dataroom_id = ${dataroomId}
      and dd.is_present = true
      and dd.notification_eligible = true
      and dd.first_seen_at > now() - interval '1 hour'
  `) as NewDocument[]

  if (newDocs.length === 0) return { sent: 0, skipped: 0 }

  const publicTierRow = (await sql`
    select public_tier from papermark_level_rooms
    where papermark_dataroom_id = ${dataroomId} limit 1
  `) as { public_tier: string }[]

  if (!publicTierRow[0]) return { sent: 0, skipped: 0 }

  const recipients = (await sql`
    select s.id as subscriber_id, s.email,
      coalesce(nullif(s.full_name, ''), s.name) as full_name,
      dl.link_url
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

  for (const doc of newDocs) {
    for (const recipient of recipients) {
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
        await sendEditionAlert({
          email: recipient.email,
          fullName: recipient.fullName,
          title: doc.title,
          series: "",
          editionDate: null,
          summary: "",
          linkUrl: recipient.linkUrl?.startsWith("https://") ? recipient.linkUrl : null,
        })

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

  return { sent, skipped }
}

export async function reconcileAllDataRooms(): Promise<{ rooms: number; sent: number; skipped: number }> {
  const sql = getSql()

  const rooms = (await sql`
    select papermark_dataroom_id from papermark_level_rooms
  `) as { papermark_dataroom_id: string }[]

  let totalSent = 0
  let totalSkipped = 0

  for (const room of rooms) {
    const result = await notifyNewDataRoomDocuments(room.papermark_dataroom_id)
    totalSent += result.sent
    totalSkipped += result.skipped
  }

  return { rooms: rooms.length, sent: totalSent, skipped: totalSkipped }
}
