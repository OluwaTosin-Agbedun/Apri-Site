import 'server-only'
import { getSql } from './db'
import { LEVELS, visibilitiesForLevel, type Level, isLevel } from './entitlements'

/**
 * Subscriber engagement, for the admin's renewal-risk view.
 *
 * Admin-only by construction: nothing here is imported by a portal page or a
 * public route, and there is no per-subscriber accessor a signed-in subscriber
 * could reach. A subscriber must never see their own engagement record, let
 * alone anyone else's.
 *
 * The rules below exist to prevent false alarms, which are worse than no alarm
 * at all -- a renewal conversation opened on bad data damages the relationship
 * this feature is meant to protect.
 */

/** Series that appear on a schedule. Board papers are ad hoc and excluded. */
export const REGULAR_SERIES = ['PLM', 'AEO', 'AIU', 'MIN', 'QIB'] as const

export const DEFAULT_WINDOW = 2

export type EngagementRow = {
  id: string
  fullName: string
  organisation: string
  email: string
  level: Level | null
  publicTier: string
  /** Distinguishes the two L2 tiers when the level is displayed. */
  seats: number
  termEnd: string | null
  daysUntilTermEnd: number | null
  lastOpenedAt: string | null
  opensLast90Days: number
  /** Recent entitled editions considered, after the term_start cut-off. */
  editionsConsidered: number
  /** How many of those they opened. */
  editionsOpened: number
  /**
   * True only when they were entitled to at least `window` editions in their
   * term and opened none of them.
   */
  flagged: boolean
  /** Why no flag was raised, when that needs explaining in the UI. */
  exemptReason: 'too-few-editions' | null
}

/** The configured window, or the default when unset or nonsensical. */
export async function getEngagementWindow(): Promise<number> {
  const sql = getSql()
  const rows = (await sql`
    select value from app_settings where key = 'engagement_window' limit 1
  `) as { value: string }[]

  const parsed = Number.parseInt(rows[0]?.value ?? '', 10)
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 12) return DEFAULT_WINDOW
  return parsed
}

export async function setEngagementWindow(n: number): Promise<void> {
  const clamped = Math.min(12, Math.max(1, Math.round(n)))
  const sql = getSql()
  await sql`
    insert into app_settings (key, value)
    values ('engagement_window', ${String(clamped)})
    on conflict (key) do update set value = excluded.value
  `
}

type SubscriberRow = {
  id: string
  full_name: string | null
  name: string
  organization: string
  email: string
  level: string | null
  public_tier: string
  seats: number
  // Typed as Date too, not just string: the driver returns `date` columns as
  // Date objects, and pretending otherwise is what hid the NULL-binding bug.
  term_start: string | Date | null
  term_end: string | Date | null
}

/**
 * Every active subscriber, worst-engaged first.
 *
 * One query per subscriber for their recent editions, rather than a single
 * clever join: each subscriber's candidate set depends on their own level and
 * their own term_start, so a shared query would need a lateral join that is
 * harder to read and no faster at this scale (tens of seats, not thousands).
 */
export async function getEngagement(window: number): Promise<EngagementRow[]> {
  const sql = getSql()

  // Active only. A lapsed or suspended seat is not a renewal risk to chase --
  // it is already a different conversation.
  const subscribers = (await sql`
    select id, full_name, name, organization, email, level,
           public_tier, seats, term_start, term_end
    from subscribers
    where client_type = 'subscriber'
      and lower(status) = 'active'
    order by created_at desc
  `) as SubscriberRow[]

  const rows: EngagementRow[] = []

  for (const s of subscribers) {
    const level = isLevel(s.level) ? s.level : null

    // Views of OPEN publications are excluded. Those are public reading, left
    // out of entitlement everywhere else, so counting them here would let a
    // subscriber who opens only the free monitor read as engaged while never
    // touching a paid edition -- the exact false reassurance this page exists
    // to avoid. A view with no publication attached is also excluded: we cannot
    // tell which lane it belonged to.
    const [stats] = (await sql`
      select
        max(v.viewed_at) as last_opened,
        count(*) filter (where v.viewed_at > now() - interval '90 days') as opens_90
      from document_views v
      join documents d on d.id = v.publication_id
      where v.subscriber_id = ${s.id}
        and d.visibility <> 'OPEN'
    `) as { last_opened: string | Date | null; opens_90: number }[]

    let editionsConsidered = 0
    let editionsOpened = 0

    if (level) {
      // Their entitlement as at now, from the shared rule -- not re-derived
      // here, so the attention list and the portal can never disagree about
      // what a level includes.
      const visibilities = visibilitiesForLevel(level)

      // The last `window` regular editions published after their term began.
      // The term_start cut-off is what stops a subscriber who joined last week
      // being flagged for editions that predate them.
      //
      // Two details that are easy to get wrong and both cause false alarms:
      //
      // 1. term_start is passed as a 'YYYY-MM-DD' string. The driver returns a
      //    date column as a JS Date, and handing that straight back as a
      //    parameter binds as NULL -- which makes `$3::date is null` true and
      //    silently disables the whole cut-off.
      //
      // 2. created_at closes the coalesce chain. An edition with neither an
      //    edition date nor a published-at would otherwise compare NULL
      //    against the cut-off, be excluded for everybody, and leave the flag
      //    permanently unreachable.
      const editions = (await sql.query(
        `select d.id
         from documents d
         where d.status = 'published'
           and d.visibility = any($1::text[])
           and d.series = any($2::text[])
           and ($3::date is null
                or coalesce(d.edition_date, d.published_at::date, d.created_at::date) >= $3::date)
         order by coalesce(d.edition_date, d.published_at::date, d.created_at::date) desc,
                  d.created_at desc
         limit $4`,
        [visibilities, REGULAR_SERIES as unknown as string[], asDateParam(s.term_start), window]
      )) as { id: string }[]

      editionsConsidered = editions.length

      if (editions.length > 0) {
        const [opened] = (await sql.query(
          `select count(distinct publication_id)::int as n
           from document_views
           where subscriber_id = $1 and publication_id = any($2::uuid[])`,
          [s.id, editions.map((e) => e.id)]
        )) as { n: number }[]

        editionsOpened = opened?.n ?? 0
      }
    }

    // Never flag someone with fewer than `window` entitled editions: with one
    // edition behind them, "opened none of the last two" is an artefact of the
    // calendar, not a signal about them.
    const enoughToJudge = editionsConsidered >= window
    const flagged = enoughToJudge && editionsOpened === 0

    rows.push({
      id: s.id,
      fullName: s.full_name || s.name || '',
      organisation: s.organization,
      email: s.email,
      level,
      publicTier: s.public_tier,
      seats: Number(s.seats ?? 1),
      termEnd: asIsoOrNull(s.term_end),
      daysUntilTermEnd: daysUntil(s.term_end),
      lastOpenedAt: asIsoOrNull(stats?.last_opened),
      opensLast90Days: Number(stats?.opens_90 ?? 0),
      editionsConsidered,
      editionsOpened,
      flagged,
      exemptReason: enoughToJudge ? null : 'too-few-editions',
    })
  }

  return rows.sort(compareWorstFirst)
}

/**
 * Worst first: flagged seats, then by how soon the term ends, then by how long
 * since they last opened anything. The ordering is the point of the page -- the
 * seat needing a conversation soonest should be the first thing read.
 */
function compareWorstFirst(a: EngagementRow, b: EngagementRow): number {
  if (a.flagged !== b.flagged) return a.flagged ? -1 : 1

  const aDays = a.daysUntilTermEnd ?? Number.POSITIVE_INFINITY
  const bDays = b.daysUntilTermEnd ?? Number.POSITIVE_INFINITY
  if (aDays !== bDays) return aDays - bDays

  const aSeen = a.lastOpenedAt ? Date.parse(a.lastOpenedAt) : 0
  const bSeen = b.lastOpenedAt ? Date.parse(b.lastOpenedAt) : 0
  return aSeen - bSeen
}

/**
 * Normalises a date column for use as a query parameter.
 *
 * The Neon driver hands back a `date` column as a JS Date, and passing that
 * object straight into a parameter slot binds as NULL rather than as the date --
 * which turns any `is null or …` guard into an unconditional pass. Every date
 * that travels from a result row back into a query goes through here.
 */
function asDateParam(value: string | Date | null): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  // UTC, so a local timezone cannot shift the day either side of midnight.
  return date.toISOString().slice(0, 10)
}

/** A timestamp column rendered as an ISO string for the UI layer. */
function asIsoOrNull(value: string | Date | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function daysUntil(date: string | Date | null): number | null {
  if (!date) return null
  const then = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(then.getTime())) return null

  const now = new Date()
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const target = Date.UTC(then.getFullYear(), then.getMonth(), then.getDate())

  return Math.round((target - today) / 86_400_000)
}

// ---------------------------------------------------------------------------
// Unmatched views
// ---------------------------------------------------------------------------

export type UnmatchedView = {
  id: string
  papermarkViewId: string
  papermarkLinkId: string | null
  viewerEmail: string | null
  publicationTitle: string | null
  viewedAt: string
  source: string
}

/**
 * Views we could not attribute to a subscriber.
 *
 * Surfaced so an attribution problem shows up as a visible list rather than as
 * a subscriber who merely looks inactive. A link pasted into the admin without
 * its Papermark link id lands here.
 */
export async function getUnmatchedViews(limit = 50): Promise<UnmatchedView[]> {
  const sql = getSql()
  const rows = (await sql`
    select v.id, v.papermark_view_id, v.papermark_link_id, v.viewer_email,
           v.viewed_at, v.source, d.title as publication_title
    from document_views v
    left join documents d on d.id = v.publication_id
    where v.subscriber_id is null
    order by v.viewed_at desc
    limit ${limit}
  `) as {
    id: string
    papermark_view_id: string
    papermark_link_id: string | null
    viewer_email: string | null
    viewed_at: string | Date
    source: string
    publication_title: string | null
  }[]

  return rows.map((r) => ({
    id: r.id,
    papermarkViewId: r.papermark_view_id,
    papermarkLinkId: r.papermark_link_id,
    viewerEmail: r.viewer_email,
    publicationTitle: r.publication_title,
    viewedAt: asIsoOrNull(r.viewed_at) ?? '',
    source: r.source,
  }))
}

/** Summary counts for the page header. */
export async function getEngagementSummary(): Promise<{
  totalViews: number
  unmatchedViews: number
  lastPollAt: string | null
}> {
  const sql = getSql()

  const [counts] = (await sql`
    select count(*)::int as total,
           count(*) filter (where subscriber_id is null)::int as unmatched
    from document_views
  `) as { total: number; unmatched: number }[]

  const [setting] = (await sql`
    select value from app_settings where key = 'papermark_last_poll' limit 1
  `) as { value: string }[]

  let lastPollAt: string | null = null
  if (setting?.value) {
    try {
      const parsed = JSON.parse(setting.value) as { at?: string }
      lastPollAt = typeof parsed.at === 'string' ? parsed.at : null
    } catch {
      lastPollAt = null
    }
  }

  return {
    totalViews: counts?.total ?? 0,
    unmatchedViews: counts?.unmatched ?? 0,
    lastPollAt,
  }
}

export type OpenEditionLead = {
  email: string
  firstSeenAt: string
  lastSeenAt: string
  viewCount: number
  lastPublicationTitle: string | null
}

/**
 * Readers of open publications, from the view events we already receive.
 *
 * These are leads, not subscribers. They verified an email at the Papermark
 * gate and hold no person record. Read from their own table and never joined to
 * subscribers, so nothing here can be mistaken for someone who has paid us.
 */
export async function getOpenEditionLeads(limit = 200): Promise<OpenEditionLead[]> {
  const sql = getSql()

  const rows = (await sql`
    select l.email, l.first_seen_at, l.last_seen_at, l.view_count,
           d.title as last_publication_title
    from open_edition_leads l
    left join documents d on d.id = l.last_publication_id
    order by l.last_seen_at desc
    limit ${limit}
  `) as {
    email: string
    first_seen_at: string | Date
    last_seen_at: string | Date
    view_count: number
    last_publication_title: string | null
  }[]

  return rows.map((r) => ({
    email: r.email,
    firstSeenAt: asIsoOrNull(r.first_seen_at) ?? '',
    lastSeenAt: asIsoOrNull(r.last_seen_at) ?? '',
    viewCount: Number(r.view_count ?? 0),
    lastPublicationTitle: r.last_publication_title,
  }))
}

/** Active seats whose term ends within `days`. Used by the weekly digest. */
export async function getExpiringSoon(days = 30): Promise<EngagementRow[]> {
  const window = await getEngagementWindow()
  const all = await getEngagement(window)
  return all.filter(
    (r) => r.daysUntilTermEnd !== null && r.daysUntilTermEnd <= days && r.daysUntilTermEnd >= 0
  )
}

export { LEVELS }
