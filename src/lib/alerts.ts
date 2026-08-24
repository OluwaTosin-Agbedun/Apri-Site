import 'server-only'
import { getSql } from './db'
import { LEVELS, isEntitled, isVisibility, type Visibility } from './entitlements'
import { sendEditionAlert } from './subscriber-email'

/**
 * New-edition alerts, gated on the copy existing.
 *
 * Under stamping an alert is only meaningful if there is a document to open. A
 * subscriber with no publication_access row who receives one would follow a
 * link to nothing — worse than silence, because it looks like our fault twice.
 *
 * So the audience is split: entitled subscribers with a copy are emailed now,
 * and entitled subscribers without one are *held*, not skipped. Skipping would
 * mean they simply never heard about the edition. The hold is released the
 * moment their copy lands.
 */

export type AlertSplit = {
  publicationId: string
  publicationTitle: string
  /** Entitled, active, in term. */
  entitled: number
  /** Of those, how many have a live copy. */
  withCopies: number
  /** Of those, how many will be held until provisioned. */
  held: number
}

type Recipient = {
  id: string
  email: string
  fullName: string
  linkUrl: string | null
}

type PublicationRow = {
  id: string
  title: string
  series: string
  summary: string
  description: string
  edition_date: string | Date | null
  visibility: string
  status: string
}

async function loadPublication(publicationId: string): Promise<PublicationRow | null> {
  const sql = getSql()
  const rows = (await sql`
    select id, title, series, summary, description, edition_date, visibility, status
    from documents where id = ${publicationId} limit 1
  `) as PublicationRow[]
  return rows[0] ?? null
}

/**
 * The entitled audience, split by whether a live copy exists.
 *
 * Entitlement comes from the shared rule, so the alert audience cannot drift
 * from what the portal actually shows. The link is read only from
 * publication_access — there is deliberately no fallback to a shared or library
 * link, because an alert carrying someone else's stamped document is the exact
 * failure stamping exists to prevent.
 */
async function loadAudience(
  publicationId: string,
  visibility: Visibility
): Promise<{ withCopies: Recipient[]; held: Recipient[] }> {
  const sql = getSql()
  const eligible = LEVELS.filter((level) => isEntitled(level, visibility))

  if (eligible.length === 0) return { withCopies: [], held: [] }

  const rows = (await sql.query(
    `select s.id, s.email,
            coalesce(nullif(s.full_name, ''), s.name) as full_name,
            case when pa.revoke_state = 'live' then pa.link_url else null end as link_url
     from subscribers s
     left join publication_access pa
       on pa.subscriber_id = s.id and pa.publication_id = $1
     where lower(s.status) = 'active'
       and s.level = any($2::text[])
       and (s.term_end is null or s.term_end >= current_date)
     order by s.created_at`,
    [publicationId, eligible as unknown as string[]]
  )) as { id: string; email: string; full_name: string | null; link_url: string | null }[]

  const withCopies: Recipient[] = []
  const held: Recipient[] = []

  for (const r of rows) {
    const recipient: Recipient = {
      id: r.id,
      email: r.email,
      fullName: r.full_name || '',
      linkUrl: r.link_url && r.link_url.startsWith('https://') ? r.link_url : null,
    }
    if (recipient.linkUrl) withCopies.push(recipient)
    else held.push(recipient)
  }

  return { withCopies, held }
}

/**
 * The split, for the operator to see before committing.
 *
 * "9 entitled · 7 have copies · 2 will be alerted when provisioned" — shown
 * because an alert cannot be recalled, and the number held is the number of
 * people who are paying for something not yet made.
 */
export async function previewAlert(publicationId: string): Promise<AlertSplit | null> {
  const pub = await loadPublication(publicationId)
  if (!pub || !isVisibility(pub.visibility) || pub.visibility === 'OPEN') return null

  const { withCopies, held } = await loadAudience(publicationId, pub.visibility)

  return {
    publicationId: pub.id,
    publicationTitle: pub.title,
    entitled: withCopies.length + held.length,
    withCopies: withCopies.length,
    held: held.length,
  }
}

export type AlertOutcome = {
  ok: boolean
  sent: number
  held: number
  failed: number
  message: string
}

/**
 * Sends to everyone who has a copy, and records a hold for everyone who
 * does not.
 */
export async function sendPublishAlert(publicationId: string): Promise<AlertOutcome> {
  const pub = await loadPublication(publicationId)

  if (!pub) {
    return { ok: false, sent: 0, held: 0, failed: 0, message: 'That publication no longer exists.' }
  }
  if (pub.status !== 'published') {
    return { ok: false, sent: 0, held: 0, failed: 0, message: 'Publish this edition before alerting subscribers.' }
  }
  if (!isVisibility(pub.visibility) || pub.visibility === 'OPEN') {
    return {
      ok: false, sent: 0, held: 0, failed: 0,
      message: 'This edition is open to all readers, so it has no subscriber audience.',
    }
  }

  const { withCopies, held } = await loadAudience(publicationId, pub.visibility)

  if (withCopies.length === 0 && held.length === 0) {
    return { ok: false, sent: 0, held: 0, failed: 0, message: 'No active subscriber is entitled to this edition yet.' }
  }

  let sent = 0
  let failed = 0

  for (const person of withCopies) {
    try {
      await sendEditionAlert({
        email: person.email,
        fullName: person.fullName,
        title: pub.title,
        series: pub.series,
        editionDate: normaliseDate(pub.edition_date),
        summary: pub.summary || pub.description,
        linkUrl: person.linkUrl,
      })
      sent++
    } catch {
      // One bad address must not stop the rest of the run.
      failed++
    }
  }

  await holdAlerts(publicationId, held.map((h) => h.id))

  const parts = [`Alert sent to ${sent} ${sent === 1 ? 'subscriber' : 'subscribers'}`]
  if (held.length > 0) {
    parts.push(`${held.length} held until provisioned`)
  }
  if (failed > 0) parts.push(`${failed} could not be delivered`)

  return {
    ok: sent > 0 || held.length > 0,
    sent,
    held: held.length,
    failed,
    message: `${parts.join('; ')}.`,
  }
}

async function holdAlerts(publicationId: string, subscriberIds: string[]): Promise<void> {
  if (subscriberIds.length === 0) return
  const sql = getSql()

  await sql.query(
    `insert into alert_holds (subscriber_id, publication_id)
     select unnest($1::uuid[]), $2::uuid
     on conflict (subscriber_id, publication_id) do nothing`,
    [subscriberIds, publicationId]
  )
}

/**
 * Fires a held alert now that the copy exists.
 *
 * Called from provisioning, so the subscriber hears about the edition as soon
 * as it is theirs to open rather than waiting for someone to notice.
 */
export async function releaseHeldAlert(
  subscriberId: string,
  publicationId: string
): Promise<boolean> {
  const sql = getSql()

  const held = (await sql`
    select 1 from alert_holds
    where subscriber_id = ${subscriberId}
      and publication_id = ${publicationId}
      and released_at is null
    limit 1
  `) as unknown[]

  if (held.length === 0) return false

  const rows = (await sql`
    select s.email,
           coalesce(nullif(s.full_name, ''), s.name) as full_name,
           d.title, d.series, d.summary, d.description, d.edition_date,
           case when pa.revoke_state = 'live' then pa.link_url else null end as link_url
    from subscribers s
    join documents d on d.id = ${publicationId}
    left join publication_access pa
      on pa.subscriber_id = s.id and pa.publication_id = d.id
    where s.id = ${subscriberId}
      and lower(s.status) = 'active'
      and (s.term_end is null or s.term_end >= current_date)
    limit 1
  `) as {
    email: string
    full_name: string | null
    title: string
    series: string
    summary: string
    description: string
    edition_date: string | Date | null
    link_url: string | null
  }[]

  const row = rows[0]
  // Still no live link, or no longer active: leave the hold in place rather
  // than releasing it into nothing.
  if (!row?.link_url?.startsWith('https://')) return false

  try {
    await sendEditionAlert({
      email: row.email,
      fullName: row.full_name || '',
      title: row.title,
      series: row.series,
      editionDate: normaliseDate(row.edition_date),
      summary: row.summary || row.description,
      linkUrl: row.link_url,
    })
  } catch {
    return false
  }

  await sql`
    update alert_holds set released_at = now()
    where subscriber_id = ${subscriberId} and publication_id = ${publicationId}
  `

  return true
}

export type HeldAlert = {
  subscriberId: string
  subscriberName: string
  organisation: string
  publicationId: string
  publicationCode: string | null
  publicationTitle: string
  heldAt: string
  ageDays: number
}

/** The held queue, for the admin. Empty when nothing is outstanding. */
export async function getHeldAlerts(): Promise<HeldAlert[]> {
  const sql = getSql()

  const rows = (await sql`
    select h.subscriber_id, h.publication_id, h.held_at,
           coalesce(nullif(s.full_name, ''), s.name) as subscriber_name,
           s.organization as organisation,
           d.code as publication_code, d.title as publication_title
    from alert_holds h
    join subscribers s on s.id = h.subscriber_id
    join documents d on d.id = h.publication_id
    where h.released_at is null
    order by h.held_at asc
  `) as {
    subscriber_id: string
    publication_id: string
    held_at: string | Date
    subscriber_name: string | null
    organisation: string
    publication_code: string | null
    publication_title: string
  }[]

  const now = Date.now()

  return rows.map((r) => {
    const heldAt = r.held_at instanceof Date ? r.held_at : new Date(r.held_at)
    return {
      subscriberId: r.subscriber_id,
      subscriberName: r.subscriber_name || '',
      organisation: r.organisation,
      publicationId: r.publication_id,
      publicationCode: r.publication_code,
      publicationTitle: r.publication_title,
      heldAt: heldAt.toISOString(),
      ageDays: Math.max(0, Math.floor((now - heldAt.getTime()) / 86_400_000)),
    }
  })
}

function normaliseDate(value: string | Date | null): string | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
