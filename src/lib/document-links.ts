import 'server-only'
import { getSql } from './db'
import {
  getDocumentLink,
  saveDocumentLink,
  markDocumentLinkRevoked,
  getLiveDocumentLinksForSubscriber,
  getDocumentsNeedingLinks,
} from './dataroom-dal'
import {
  createDocumentLink,
  revokeDataRoomLink,
  updateDataRoomLink,
} from './papermark-datarooms'
import { watermarkText } from './papermark-dataroom-contract'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type SubscriberInfo = {
  id: string
  fullName: string
  email: string
  termEnd: string | null
  dataroomId: string | null
}

async function loadSubscriberForDocLinks(subscriberId: string): Promise<SubscriberInfo | null> {
  if (!UUID.test(subscriberId)) return null
  const sql = getSql()
  const rows = (await sql`
    select id, full_name, email, term_end,
           coalesce(papermark_dataroom_override, papermark_dataroom_id) as dataroom_id
    from subscribers
    where id = ${subscriberId} and client_type = 'subscriber'
      and lower(status) = 'active'
    limit 1
  `) as {
    id: string; full_name: string; email: string
    term_end: string | null; dataroom_id: string | null
  }[]
  const r = rows[0]
  return r ? {
    id: r.id, fullName: r.full_name, email: r.email,
    termEnd: r.term_end, dataroomId: r.dataroom_id,
  } : null
}

/**
 * Ensures a document link exists for one subscriber + one Papermark document.
 *
 * Idempotent: returns the existing live link if one exists, creates a new one
 * otherwise. The unique index on (subscriber_id, papermark_document_id) where
 * revoke_state = 'live' prevents duplicates even under concurrent calls.
 */
export async function ensureDocumentLink(args: {
  subscriberId: string
  papermarkDocumentId: string
  documentTitle?: string
}): Promise<{ ok: true; linkUrl: string; created: boolean } | { ok: false; message: string }> {
  const sub = await loadSubscriberForDocLinks(args.subscriberId)
  if (!sub) return { ok: false, message: 'Subscriber not found or inactive.' }

  const existing = await getDocumentLink({
    subscriberId: sub.id,
    papermarkDocumentId: args.papermarkDocumentId,
  })
  if (existing) return { ok: true, linkUrl: existing.linkUrl, created: false }

  const result = await createDocumentLink({
    documentId: args.papermarkDocumentId,
    assignedName: sub.fullName,
    assignedEmail: sub.email,
    expiresAt: sub.termEnd,
    documentTitle: args.documentTitle,
  })

  if (!result.ok) return { ok: false, message: result.message }

  await saveDocumentLink({
    subscriberId: sub.id,
    papermarkDocumentId: args.papermarkDocumentId,
    papermarkLinkId: result.value.linkId,
    linkUrl: result.value.url,
    assignedName: sub.fullName,
    assignedEmail: sub.email,
    watermarkText: watermarkText(sub.fullName, sub.email),
    allowDownload: result.value.settings.allow_download,
    screenshotProtection: result.value.settings.enable_screenshot_protection,
    expiresAt: result.value.settings.expires_at,
  })

  return { ok: true, linkUrl: result.value.url, created: true }
}

/**
 * Creates document links for every document in a subscriber's Data Room that
 * does not already have one.
 *
 * Called during: subscriber activation, Data Room sync (for new docs), and the
 * admin backfill action. Never sends publication emails — that is handled
 * separately by the notification system which has its own baseline guard, time
 * window and dedup.
 */
export async function ensureAllDocumentLinks(
  subscriberId: string,
): Promise<{ created: number; skipped: number; errors: number }> {
  const sub = await loadSubscriberForDocLinks(subscriberId)
  if (!sub || !sub.dataroomId) return { created: 0, skipped: 0, errors: 0 }

  const needed = await getDocumentsNeedingLinks({
    subscriberId: sub.id,
    dataroomId: sub.dataroomId,
  })

  let created = 0
  let skipped = 0
  let errors = 0

  for (const doc of needed) {
    const result = await createDocumentLink({
      documentId: doc.papermarkDocumentId,
      assignedName: sub.fullName,
      assignedEmail: sub.email,
      expiresAt: sub.termEnd,
      documentTitle: doc.title,
    })

    if (!result.ok) {
      errors++
      continue
    }

    const id = await saveDocumentLink({
      subscriberId: sub.id,
      papermarkDocumentId: doc.papermarkDocumentId,
      papermarkLinkId: result.value.linkId,
      linkUrl: result.value.url,
      assignedName: sub.fullName,
      assignedEmail: sub.email,
      watermarkText: watermarkText(sub.fullName, sub.email),
      allowDownload: result.value.settings.allow_download,
      screenshotProtection: result.value.settings.enable_screenshot_protection,
      expiresAt: result.value.settings.expires_at,
    })

    if (id) created++
    else skipped++
  }

  return { created, skipped, errors }
}

/**
 * Revokes all live document links for a subscriber.
 *
 * Called on deactivation, expiry, or subscriber deletion. Revokes each link in
 * Papermark first, then marks locally.
 */
export async function revokeAllDocumentLinks(subscriberId: string): Promise<number> {
  if (!UUID.test(subscriberId)) return 0

  const links = await getLiveDocumentLinksForSubscriber(subscriberId)
  let count = 0

  for (const link of links) {
    await revokeDataRoomLink(link.papermarkLinkId)
    await markDocumentLinkRevoked(link.id)
    count++
  }

  return count
}

/**
 * Updates expiry on all live document links for a subscriber.
 *
 * Called on subscription renewal.
 */
export async function updateDocumentLinkExpiry(args: {
  subscriberId: string
  newTermEnd: string
}): Promise<number> {
  if (!UUID.test(args.subscriberId)) return 0
  const sql = getSql()

  const links = (await sql`
    select id, papermark_link_id, assigned_name, assigned_email
    from papermark_subscriber_document_links
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
        update papermark_subscriber_document_links
        set expires_at = ${args.newTermEnd}::timestamptz, updated_at = now()
        where id = ${link.id}::uuid
      `
      count++
    }
  }

  return count
}
