import 'server-only'
import { getSql } from './db'
import {
  resolveDataRoom,
  getDataRoomLink,
  saveDataRoomLink,
  markLinkRevoked,
  recordAssignment,
  assignDataRoomToSubscriber,
} from './dataroom-dal'
import {
  createDataRoomLink,
  revokeDataRoomLink,
  updateDataRoomLink,
} from './papermark-datarooms'
import { watermarkText } from './papermark-dataroom-contract'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type SubscriberRow = {
  id: string
  full_name: string
  email: string
  public_tier: string
  term_end: string | null
  papermark_dataroom_id: string | null
  papermark_dataroom_override: string | null
}

async function loadSubscriber(subscriberId: string): Promise<SubscriberRow | null> {
  if (!UUID.test(subscriberId)) return null
  const sql = getSql()
  const rows = (await sql`
    select id, full_name, email, public_tier, term_end,
           papermark_dataroom_id, papermark_dataroom_override
    from subscribers where id = ${subscriberId} and client_type = 'subscriber' limit 1
  `) as SubscriberRow[]
  return rows[0] ?? null
}

/**
 * Reassigns a subscriber's Data Room when their level changes.
 *
 * If the old and new levels map to the same room, the link is left alone.
 * Otherwise the old link is revoked and a new one created for the new room.
 * An override trumps the level mapping and is never touched by this.
 */
export async function reassignDataRoomOnLevelChange(args: {
  subscriberId: string
  oldPublicTier: string | null
  newPublicTier: string | null
  changedById: string
  changedByName: string
}): Promise<{ action: 'reassigned' | 'revoked' | 'created' | 'unchanged' | 'skipped' }> {
  const sub = await loadSubscriber(args.subscriberId)
  if (!sub) return { action: 'skipped' }

  if (sub.papermark_dataroom_override) return { action: 'skipped' }

  const oldRoom = args.oldPublicTier
    ? await resolveDataRoom({ subscriberId: sub.id, publicTier: args.oldPublicTier })
    : null
  const newRoom = args.newPublicTier
    ? await resolveDataRoom({ subscriberId: sub.id, publicTier: args.newPublicTier })
    : null

  if (oldRoom?.dataroomId === newRoom?.dataroomId) return { action: 'unchanged' }

  if (oldRoom) {
    const oldLink = await getDataRoomLink({ subscriberId: sub.id, dataroomId: oldRoom.dataroomId })
    if (oldLink) {
      await revokeDataRoomLink(oldLink.papermarkLinkId)
      await markLinkRevoked(oldLink.id)
      await recordAssignment({
        subscriberId: sub.id,
        previousDataroomId: oldRoom.dataroomId,
        previousLinkId: oldLink.papermarkLinkId,
        reason: `Level changed from ${args.oldPublicTier ?? 'none'} to ${args.newPublicTier ?? 'none'}`,
        changedById: args.changedById,
        changedByName: args.changedByName,
      })
    }
  }

  if (!newRoom) {
    return oldRoom ? { action: 'revoked' } : { action: 'unchanged' }
  }

  if (!sub.term_end) return oldRoom ? { action: 'revoked' } : { action: 'skipped' }

  const result = await createDataRoomLink({
    dataroomId: newRoom.dataroomId,
    assignedName: sub.full_name,
    assignedEmail: sub.email,
    expiresAt: sub.term_end,
  })

  if (!result.ok) return oldRoom ? { action: 'revoked' } : { action: 'skipped' }

  await saveDataRoomLink({
    subscriberId: sub.id,
    dataroomId: newRoom.dataroomId,
    papermarkLinkId: result.value.linkId,
    linkUrl: result.value.url,
    assignedName: sub.full_name,
    assignedEmail: sub.email,
    watermarkEnabled: true,
    watermarkText: watermarkText(sub.full_name, sub.email),
    allowDownload: result.value.settings.allow_download,
    screenshotProtection: result.value.settings.enable_screenshot_protection,
    expiresAt: result.value.settings.expires_at,
  })

  await assignDataRoomToSubscriber(sub.id, newRoom.dataroomId)

  await recordAssignment({
    subscriberId: sub.id,
    newDataroomId: newRoom.dataroomId,
    newLinkId: result.value.linkId,
    reason: `Level changed to ${args.newPublicTier}`,
    changedById: args.changedById,
    changedByName: args.changedByName,
  })

  return oldRoom ? { action: 'reassigned' } : { action: 'created' }
}

/**
 * Revokes all live Data Room links for a subscriber.
 *
 * Called when a subscription is deactivated, expired, or the subscriber is
 * being deleted. Revokes in Papermark first, then marks locally; a Papermark
 * failure still marks the link locally so the admin can see it needs manual
 * attention.
 */
export async function revokeAllDataRoomLinks(args: {
  subscriberId: string
  reason: string
  changedById: string
  changedByName: string
}): Promise<number> {
  if (!UUID.test(args.subscriberId)) return 0
  const sql = getSql()

  const links = (await sql`
    select id, papermark_link_id, papermark_dataroom_id
    from papermark_dataroom_links
    where subscriber_id = ${args.subscriberId}::uuid and revoke_state = 'live'
  `) as { id: string; papermark_link_id: string; papermark_dataroom_id: string }[]

  let count = 0
  for (const link of links) {
    await revokeDataRoomLink(link.papermark_link_id)
    await markLinkRevoked(link.id)
    await recordAssignment({
      subscriberId: args.subscriberId,
      previousDataroomId: link.papermark_dataroom_id,
      previousLinkId: link.papermark_link_id,
      reason: args.reason,
      changedById: args.changedById,
      changedByName: args.changedByName,
    })
    count++
  }

  return count
}

/**
 * Updates the expiry on all live Data Room links for a subscriber.
 *
 * Called when a subscription is renewed. The watermark is rewritten from the
 * stored assignment so a link cannot drift into naming the wrong person.
 */
export async function updateDataRoomLinkExpiry(args: {
  subscriberId: string
  newTermEnd: string
}): Promise<number> {
  if (!UUID.test(args.subscriberId)) return 0
  const sql = getSql()

  const links = (await sql`
    select id, papermark_link_id, assigned_name, assigned_email
    from papermark_dataroom_links
    where subscriber_id = ${args.subscriberId}::uuid and revoke_state = 'live'
  `) as { id: string; papermark_link_id: string; assigned_name: string; assigned_email: string }[]

  let count = 0
  for (const link of links) {
    const result = await updateDataRoomLink({
      linkId: link.papermark_link_id,
      assignedName: link.assigned_name,
      assignedEmail: link.assigned_email,
      expiresAt: args.newTermEnd,
    })

    if (result.ok) {
      await sql`
        update papermark_dataroom_links
        set expires_at = ${args.newTermEnd}::timestamptz, updated_at = now()
        where id = ${link.id}::uuid
      `
      count++
    }
  }

  return count
}

/**
 * Reconciles downloads from Papermark views for a specific link.
 *
 * Queries the views endpoint, checks `downloaded_at`, and idempotently
 * records any downloads not already captured. This is the primary download
 * detection mechanism — the `link.downloaded` webhook is accepted when
 * available but not relied upon.
 */
export async function reconcileDownloadsFromViews(args: {
  linkRecordId: string
  subscriberId: string | null
  briefingRequestId?: string | null
}): Promise<number> {
  const sql = getSql()
  const { listViewsForLink } = await import('./papermark')

  const linkRows = (await sql`
    select papermark_link_id from papermark_dataroom_links
    where id = ${args.linkRecordId}::uuid limit 1
  `) as { papermark_link_id: string }[]

  const papermarkLinkId = linkRows[0]?.papermark_link_id
  if (!papermarkLinkId) return 0

  let views: Awaited<ReturnType<typeof listViewsForLink>>
  try {
    views = await listViewsForLink(papermarkLinkId, 3)
  } catch {
    return 0
  }

  let recorded = 0
  for (const view of views) {
    if (!view.downloaded_at) continue

    const viewId = view.id
    if (!viewId) continue

    const existing = await sql`
      select 1 from client_engagement_events
      where webhook_event_id = ${'dl-' + viewId} limit 1
    `
    if (existing.length > 0) continue

    const subscriberId = args.subscriberId
    const briefingId = args.briefingRequestId ?? null

    await sql`
      insert into client_engagement_events
        (subscriber_id, briefing_request_id, event_type, webhook_event_id, occurred_at)
      values (
        ${subscriberId}::uuid, ${briefingId}::uuid,
        'document_downloaded', ${'dl-' + viewId},
        ${view.downloaded_at}::timestamptz
      )
      on conflict (webhook_event_id) where webhook_event_id is not null do nothing
    `
    recorded++
  }

  return recorded
}
