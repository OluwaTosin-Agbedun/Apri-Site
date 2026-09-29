import 'server-only'
import { getSql } from './db'
import {
  markDocumentLinkRevoked,
  getLiveDocumentLinksForSubscriber,
  getRoomDocumentsForLinks,
  getLivePersonalLinks,
  saveDocumentLink,
  setPersonalLinkExpiry,
  getActiveSubscriberIdsForRoom,
  type LivePersonalLink,
} from './dataroom-dal'
import {
  createDocumentLink,
  readSubscriberDocumentLink,
  revokeDataRoomLink,
  updateDataRoomLink,
} from './papermark-datarooms'
import { subscriberWatermarkText, type DocumentLinkSettings } from './papermark-dataroom-contract'
import { papermarkExpiresAt } from './papermark-contract'
import {
  combineReports,
  describePersonalLinks,
  preparePersonalLinks,
  type PersonalLinkReport,
  type RoomDocument,
  type StoredLink,
} from './personal-links'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type LinkSubscriber = {
  id: string
  fullName: string
  email: string
  /** The term end exactly as stored: what every link's expiry is made from. */
  termEnd: string | Date | null
  termEndDate: string | null
  termEnded: boolean
  dataroomId: string | null
  hasRoomLink: boolean
}

async function loadSubscriberForDocLinks(subscriberId: string): Promise<LinkSubscriber | null> {
  if (!UUID.test(subscriberId)) return null
  const sql = getSql()
  const rows = (await sql`
    select s.id, coalesce(nullif(s.full_name, ''), s.name, '') as full_name, s.email, s.term_end,
           to_char(s.term_end, 'YYYY-MM-DD') as term_end_date,
           (s.term_end is not null and s.term_end < current_date) as term_ended,
           coalesce(s.papermark_dataroom_override, s.papermark_dataroom_id) as dataroom_id,
           exists (
             select 1 from papermark_dataroom_links l
             where l.subscriber_id = s.id
               and l.papermark_dataroom_id = coalesce(s.papermark_dataroom_override, s.papermark_dataroom_id)
               and l.revoke_state = 'live'
           ) as has_room_link
    from subscribers s
    where s.id = ${subscriberId} and s.client_type = 'subscriber'
      and lower(s.status) = 'active'
    limit 1
  `) as {
    id: string
    full_name: string
    email: string
    term_end: string | Date | null
    term_end_date: string | null
    term_ended: boolean
    dataroom_id: string | null
    has_room_link: boolean
  }[]
  const r = rows[0]
  return r
    ? {
        id: r.id,
        fullName: r.full_name,
        email: r.email,
        termEnd: r.term_end,
        termEndDate: r.term_end_date,
        termEnded: r.term_ended === true,
        dataroomId: r.dataroom_id,
        hasRoomLink: r.has_room_link === true,
      }
    : null
}

export type NotEligibleReason = 'not_active' | 'no_room' | 'room_mismatch' | 'term_ended' | 'no_room_link'

const NOT_ELIGIBLE: Record<NotEligibleReason, string> = {
  not_active: 'This subscriber is not active, so no personal document links were prepared.',
  no_room: 'No Data Room is assigned to this subscriber, so there are no personal document links to prepare.',
  room_mismatch:
    'This subscriber is assigned to a different Data Room from the one being prepared, so no links were prepared. Check their Data Room assignment.',
  term_ended: "This subscriber's term has ended, so no personal document links were prepared.",
  no_room_link:
    'This subscriber has no live Data Room link, so no personal document links were prepared. Create the Data Room link first.',
}

export type SubscriberLinkOutcome =
  | {
      state: 'prepared'
      subscriberId: string
      subscriberName: string
      dataroomId: string
      report: PersonalLinkReport
    }
  | {
      state: 'not_eligible'
      subscriberId: string
      subscriberName: string
      reason: NotEligibleReason
      message: string
    }

function notEligible(
  subscriberId: string,
  subscriberName: string,
  reason: NotEligibleReason,
): SubscriberLinkOutcome {
  return { state: 'not_eligible', subscriberId, subscriberName, reason, message: NOT_ELIGIBLE[reason] }
}

/**
 * Prepares a subscriber's personal link for every document their library
 * lists -- or, with `papermarkDocumentId`, for that one document.
 *
 * Only for an active subscriber, inside their term, who holds a live link to
 * the Data Room they are assigned: a personal link is part of that room
 * access, never a way around it. `dataroomId` pins the room a caller is
 * preparing, so a subscriber assigned elsewhere is reported rather than given
 * links to a room they are not assigned to.
 *
 * `verify` checks each stored link with Papermark and repairs what is broken
 * (see src/lib/personal-links.ts). Idempotent, and never sends email: this is
 * the step activation, sync and the Admin repair actions all share, and none
 * of them may notify anyone through it.
 */
export async function ensureAllDocumentLinks(
  subscriberId: string,
  options: { verify?: boolean; dataroomId?: string; papermarkDocumentId?: string } = {},
): Promise<SubscriberLinkOutcome> {
  const sub = await loadSubscriberForDocLinks(subscriberId)
  if (!sub) return notEligible(subscriberId, '', 'not_active')
  if (!sub.dataroomId) return notEligible(sub.id, sub.fullName, 'no_room')
  if (options.dataroomId && options.dataroomId !== sub.dataroomId) {
    return notEligible(sub.id, sub.fullName, 'room_mismatch')
  }
  if (sub.termEnded) return notEligible(sub.id, sub.fullName, 'term_ended')
  if (!sub.hasRoomLink) return notEligible(sub.id, sub.fullName, 'no_room_link')

  const dataroomId = sub.dataroomId
  const roomDocuments = await getRoomDocumentsForLinks(dataroomId)
  const documents = options.papermarkDocumentId
    ? roomDocuments.filter((d) => d.papermarkDocumentId === options.papermarkDocumentId)
    : roomDocuments
  const live = await getLivePersonalLinks(sub.id)
  const liveByRow = new Map<string, LivePersonalLink>(live.map((l) => [l.rowId, l]))

  // The settings Papermark accepted for each link this run mints, so the row
  // records exactly what was applied.
  const minted = new Map<string, DocumentLinkSettings>()

  const report = await preparePersonalLinks(
    {
      documents,
      stored: live.map<StoredLink>((l) => ({
        rowId: l.rowId,
        papermarkDocumentId: l.papermarkDocumentId,
        papermarkLinkId: l.papermarkLinkId,
        expiresAt: l.expiresAt,
      })),
      create: async (document: RoomDocument) => {
        const result = await createDocumentLink({
          documentId: document.papermarkDocumentId,
          assignedName: sub.fullName,
          assignedEmail: sub.email,
          expiresAt: sub.termEnd,
          documentTitle: document.title,
        })
        if (!result.ok) return { ok: false as const, message: result.message }
        minted.set(result.value.linkId, result.value.settings)
        return { ok: true as const, linkId: result.value.linkId, url: result.value.url }
      },
      save: async (document, link) => {
        const settings = minted.get(link.linkId)
        // Unreachable in practice; a throw is reported as "not recorded" and
        // the link withdrawn, never mistaken for a row that already exists.
        if (!settings) throw new Error('No settings recorded for the minted link.')
        const id = await saveDocumentLink({
          subscriberId: sub.id,
          papermarkDocumentId: document.papermarkDocumentId,
          papermarkLinkId: link.linkId,
          linkUrl: link.url,
          assignedName: sub.fullName,
          assignedEmail: sub.email,
          watermarkText: subscriberWatermarkText(sub.email),
          allowDownload: settings.allow_download,
          screenshotProtection: settings.enable_screenshot_protection,
          expiresAt: settings.expires_at,
        })
        return id || null
      },
      withdraw: async (linkId) => {
        const result = await revokeDataRoomLink(linkId)
        return result.ok ? { ok: true as const } : { ok: false as const, message: result.message }
      },
      retire: (rowId) => markDocumentLinkRevoked(rowId),
      read: (linkId) => readSubscriberDocumentLink(linkId),
      correctExpiry: async (link) => {
        // The same update a renewal applies, from the identity the link was
        // issued to, so the watermark keeps naming the person it was issued to.
        const row = liveByRow.get(link.rowId)
        const result = await updateDataRoomLink({
          linkId: link.papermarkLinkId,
          assignedName: row?.assignedName || sub.fullName,
          assignedEmail: row?.assignedEmail || sub.email,
          expiresAt: sub.termEnd,
        })
        if (!result.ok) return { ok: false as const, message: result.message }
        const expiry = papermarkExpiresAt(sub.termEnd)
        await setPersonalLinkExpiry(link.rowId, expiry.ok ? expiry.value : null)
        return { ok: true as const }
      },
    },
    { verify: options.verify === true, termEndDate: sub.termEndDate },
  )

  return { state: 'prepared', subscriberId: sub.id, subscriberName: sub.fullName, dataroomId, report }
}

// ---------------------------------------------------------------------------
// Every subscriber of one Data Room
// ---------------------------------------------------------------------------

export type RoomLinkSummary = {
  /** Active subscribers holding a live link to the room. */
  subscribers: number
  outcomes: SubscriberLinkOutcome[]
  /** Subscribers who could not be checked at all, for example a database fault. */
  errors: number
  report: PersonalLinkReport
  complete: boolean
}

/**
 * Prepares personal links for every active subscriber holding a live link to
 * one Data Room: every document, or with `papermarkDocumentId` just that one.
 *
 * Used when documents arrive in a room (sync and the Papermark webhook) and by
 * the level-wide Admin action. One subscriber's failure never stops the rest.
 */
export async function prepareRoomLinks(
  dataroomId: string,
  options: { papermarkDocumentId?: string } = {},
): Promise<RoomLinkSummary> {
  const subscriberIds = await getActiveSubscriberIdsForRoom(dataroomId)
  const outcomes: SubscriberLinkOutcome[] = []
  let errors = 0

  for (const subscriberId of subscriberIds) {
    try {
      outcomes.push(
        await ensureAllDocumentLinks(subscriberId, {
          dataroomId,
          papermarkDocumentId: options.papermarkDocumentId,
        }),
      )
    } catch {
      errors++
    }
  }

  const prepared = outcomes.flatMap((o) => (o.state === 'prepared' ? [o.report] : []))
  const report = combineReports(prepared)
  // A subscriber whose term has ended or who stopped being active is not owed
  // links; one assigned to another room is a problem to look at.
  const mismatched = outcomes.some((o) => o.state === 'not_eligible' && o.reason === 'room_mismatch')
  return {
    subscribers: subscriberIds.length,
    outcomes,
    errors,
    report,
    complete: report.complete && errors === 0 && !mismatched,
  }
}

/** The administrator's account of a room-wide run. Names only, never links. */
export function describeRoomLinks(summary: RoomLinkSummary): string {
  if (summary.subscribers === 0) {
    return 'No active subscriber holds a link to this Data Room, so no personal document links were needed.'
  }

  const who = `${summary.subscribers} subscriber${summary.subscribers === 1 ? '' : 's'}`
  const done = [
    summary.report.created ? `${summary.report.created} created` : null,
    summary.report.repaired ? `${summary.report.repaired} repaired` : null,
    summary.report.stored ? `${summary.report.stored} already prepared` : null,
  ].filter(Boolean)

  if (summary.complete) {
    return `Personal document links are ready for ${who}${done.length ? ` (${done.join(', ')})` : ''}.`
  }

  const problems: string[] = []
  for (const outcome of summary.outcomes) {
    const name = outcome.subscriberName || 'A subscriber'
    if (outcome.state === 'prepared' && !outcome.report.complete) {
      problems.push(`${name}: ${describePersonalLinks(outcome.report)}`)
    } else if (outcome.state === 'not_eligible' && outcome.reason === 'room_mismatch') {
      problems.push(`${name}: ${outcome.message}`)
    }
  }
  if (summary.errors > 0) {
    problems.push(
      `${summary.errors} subscriber${summary.errors === 1 ? '' : 's'} could not be checked. Try again shortly.`,
    )
  }
  const shown = problems.slice(0, 3).join(' ')
  const more = problems.length > 3 ? ` And ${problems.length - 3} more.` : ''
  return `Personal document links are not ready for every subscriber (${who} checked${
    done.length ? `; ${done.join(', ')}` : ''
  }). ${shown}${more}`
}

// ---------------------------------------------------------------------------
// Revocation and renewal
// ---------------------------------------------------------------------------

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
