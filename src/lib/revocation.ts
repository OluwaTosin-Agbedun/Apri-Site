import 'server-only'
import { getSql } from './db'
import { revokeLink } from './papermark'

/**
 * Withdrawing access when a term ends.
 *
 * Every stamped document carries the reader's name, so a link that still works
 * after their term has ended is a leak we authored. Revocation is therefore
 * part of lapsing, not a tidy-up afterwards.
 *
 * publication_access rows are never deleted. We need the record of what someone
 * had access to for longer than they have the access itself -- if a document
 * surfaces somewhere it should not, the row is how we know whose copy it was.
 * Revoke the link, keep the history.
 */

export type RevocationSummary = {
  attempted: number
  revoked: number
  manualRequired: number
}

/**
 * Revokes every live link belonging to one subscriber.
 *
 * A link the API will not revoke is marked `manual_required` rather than left
 * as `live`: the admin queue is the backstop, and a failure that silently kept
 * the row live would be indistinguishable from success.
 */
export async function revokeSubscriberAccess(
  subscriberId: string
): Promise<RevocationSummary> {
  const sql = getSql()

  const rows = (await sql`
    select id, papermark_link_id
    from publication_access
    where subscriber_id = ${subscriberId} and revoke_state = 'live'
  `) as { id: string; papermark_link_id: string | null }[]

  let revoked = 0
  let manualRequired = 0

  for (const row of rows) {
    // No link id means nothing to call the API about -- it was provisioned by
    // hand, so it has to be withdrawn by hand.
    const result = row.papermark_link_id
      ? await revokeLink(row.papermark_link_id)
      : { ok: false as const, reason: 'failed' as const, message: 'No link id recorded.' }

    if (result.ok) {
      await sql`
        update publication_access
        set revoke_state = 'revoked', revoked_at = now(), updated_at = now()
        where id = ${row.id}
      `
      revoked++
    } else {
      await sql`
        update publication_access
        set revoke_state = 'manual_required', revoked_at = now(), updated_at = now()
        where id = ${row.id}
      `
      manualRequired++
    }
  }

  return { attempted: rows.length, revoked, manualRequired }
}

/**
 * Sweeps every subscriber whose access has ended but whose links are still live.
 *
 * Catches the case nobody clicked: a term that simply ran out. Status alone is
 * not enough, because a seat can sit at 'active' with a term_end in the past.
 */
export async function revokeLapsedAccess(): Promise<RevocationSummary> {
  const sql = getSql()

  const rows = (await sql`
    select distinct pa.subscriber_id
    from publication_access pa
    join subscribers s on s.id = pa.subscriber_id
    where pa.revoke_state = 'live'
      and (
        lower(s.status) in ('lapsed', 'suspended')
        or (s.term_end is not null and s.term_end < current_date)
      )
  `) as { subscriber_id: string }[]

  const total: RevocationSummary = { attempted: 0, revoked: 0, manualRequired: 0 }

  for (const row of rows) {
    const summary = await revokeSubscriberAccess(row.subscriber_id)
    total.attempted += summary.attempted
    total.revoked += summary.revoked
    total.manualRequired += summary.manualRequired
  }

  return total
}

export type ManualRevocation = {
  id: string
  subscriberId: string
  subscriberName: string
  organisation: string
  status: string
  publicationCode: string | null
  publicationTitle: string
  linkUrl: string
  papermarkLinkId: string | null
  revokedAt: string | null
}

/**
 * Links the API could not withdraw, for the "Revoke manually" queue.
 *
 * A work queue, so it reads as empty when there is nothing outstanding.
 */
export async function getManualRevocations(): Promise<ManualRevocation[]> {
  const sql = getSql()

  const rows = (await sql`
    select pa.id, pa.subscriber_id, pa.link_url, pa.papermark_link_id, pa.revoked_at,
           coalesce(nullif(s.full_name, ''), s.name) as subscriber_name,
           s.organization as organisation, s.status,
           d.code as publication_code, d.title as publication_title
    from publication_access pa
    join subscribers s on s.id = pa.subscriber_id
    join documents d on d.id = pa.publication_id
    where pa.revoke_state = 'manual_required'
    order by pa.revoked_at asc nulls first
  `) as {
    id: string
    subscriber_id: string
    link_url: string
    papermark_link_id: string | null
    revoked_at: string | Date | null
    subscriber_name: string | null
    organisation: string
    status: string
    publication_code: string | null
    publication_title: string
  }[]

  return rows.map((r) => ({
    id: r.id,
    subscriberId: r.subscriber_id,
    subscriberName: r.subscriber_name || '',
    organisation: r.organisation,
    status: r.status.toLowerCase(),
    publicationCode: r.publication_code,
    publicationTitle: r.publication_title,
    linkUrl: r.link_url,
    papermarkLinkId: r.papermark_link_id,
    revokedAt: r.revoked_at
      ? new Date(r.revoked_at).toISOString()
      : null,
  }))
}

/** Marks a manual revocation as done, once an admin has withdrawn it by hand. */
export async function confirmManualRevocation(accessId: string): Promise<void> {
  const sql = getSql()
  await sql`
    update publication_access
    set revoke_state = 'revoked', revoked_at = coalesce(revoked_at, now()), updated_at = now()
    where id = ${accessId} and revoke_state = 'manual_required'
  `
}
