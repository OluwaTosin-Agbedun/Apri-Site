import "server-only"
import { getSql } from "./db"
import { noticeSchemaReady } from "./publication-notifications"

/** Retained switch; both it and the owner's approved baseline gate sending. */
export function newDocumentEmailsEnabled(): boolean {
  return process.env.DATAROOM_NEW_DOCUMENT_EMAILS === "enabled"
}

/** Sync/webhook compatibility. Uploads never send; approved release events are
 * stored transactionally and the bounded notification worker sends them. */
export async function notifyNewDataRoomDocuments(
  dataroomId: string,
): Promise<{
  sent: number
  skipped: number
  held: number
  queued: number
  mode: string
}> {
  if (!newDocumentEmailsEnabled())
    return { sent: 0, skipped: 0, held: 0, queued: 0, mode: "sending_paused" }
  if (!(await noticeSchemaReady()))
    return {
      sent: 0,
      skipped: 0,
      held: 0,
      queued: 0,
      mode: "migration_required",
    }
  const [row] = await getSql()`select count(distinct e.id)::int as events,
    count(distinct j.id) filter(where j.state='held')::int as held
    from publication_notice_events e join papermark_dataroom_documents d on d.publication_id=e.publication_id
    left join publication_notice_jobs j on j.event_id=e.id
    where d.papermark_dataroom_id=${dataroomId} and e.state<>'cancelled'
      and (e.state in ('pending','fanning') or j.state in ('pending','held','failed'))`
  return {
    sent: 0,
    skipped: 0,
    held: Number(row?.held ?? 0),
    queued: Number(row?.events ?? 0),
    mode: "durable_queue",
  }
}
export async function reconcileAllDataRooms(): Promise<{
  rooms: number
  sent: number
  skipped: number
  held: number
  queued: number
  emailsEnabled: boolean
}> {
  if (!newDocumentEmailsEnabled())
    return {
      rooms: 0,
      sent: 0,
      skipped: 0,
      held: 0,
      queued: 0,
      emailsEnabled: false,
    }
  const rooms =
    await getSql()`select distinct papermark_dataroom_id from papermark_level_rooms`
  let held = 0,
    queued = 0
  for (const room of rooms) {
    const result = await notifyNewDataRoomDocuments(
      String(room.papermark_dataroom_id),
    )
    held += result.held
    queued += result.queued
  }
  return {
    rooms: rooms.length,
    sent: 0,
    skipped: 0,
    held,
    queued,
    emailsEnabled: true,
  }
}
