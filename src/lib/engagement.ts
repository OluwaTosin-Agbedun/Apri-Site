import 'server-only'
import { getSql } from './db'
import { LEVELS, visibilitiesForLevel, type Level, isLevel } from './entitlements'
import { getReachMonths } from './provisioning'

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
 * One query, not one per subscriber.
 *
 * The previous shape ran three queries inside a loop over subscribers -- their
 * view stats, their recent editions, and how many of those they had opened. At
 * fifty seats that is a hundred and fifty round trips to open one page, and the
 * cost grew with every subscriber sold. A lateral join does the same work in a
 * single statement.
 *
 * The entitlement rule is still not restated here: the (level, visibility) pairs
 * are expanded from visibilitiesForLevel and bound as parameters, so SQL matches
 * against a list it was handed rather than one it decides.
 */
export async function getEngagement(window: number): Promise<EngagementRow[]> {
  const sql = getSql()
  const reachMonths = await getReachMonths()

  const pairs: { level: Level; visibility: string }[] = []
  for (const level of LEVELS) {
    for (const visibility of visibilitiesForLevel(level)) {
      pairs.push({ level, visibility })
    }
  }

  const rows = (await sql.query(
    `with entitlement (level, visibility) as (
       select * from unnest($1::text[], $2::text[])
     ),
     active as (
       select s.id, s.created_at,
              coalesce(nullif(s.full_name, ''), s.name) as full_name,
              s.organization, s.email, s.level, s.public_tier, s.seats,
              s.term_start, s.term_end
       from subscribers s
       where s.client_type = 'subscriber'
         and lower(s.status) = 'active'
         and s.level is not null
     ),
     -- The last N regular editions each subscriber was entitled to, bounded by
     -- their own term start and by the back-catalogue reach.
     recent as (
       select a.id as subscriber_id, e.id as publication_id
       from active a
       left join lateral (
         select d.id
         from documents d
         join entitlement en
           on en.level = a.level and en.visibility = d.visibility
         where d.status = 'published'
           and d.visibility <> 'OPEN'
           and d.series = any($3::text[])
           and coalesce(d.edition_date, d.published_at::date, d.created_at::date)
               >= greatest(
                    coalesce(a.term_start, a.created_at::date),
                    (current_date - ($4::int || ' months')::interval)::date
                  )
         order by coalesce(d.edition_date, d.published_at::date, d.created_at::date) desc,
                  d.created_at desc
         limit $5
       ) e on true
     ),
     considered as (
       select subscriber_id, count(publication_id)::int as n
       from recent group by subscriber_id
     ),
     opened as (
       select r.subscriber_id, count(distinct r.publication_id)::int as n
       from recent r
       join document_views v
         on v.subscriber_id = r.subscriber_id
        and v.publication_id = r.publication_id
       group by r.subscriber_id
     ),
     -- Views of OPEN publications are excluded: public reading must not make a
     -- subscriber who never opens a paid edition look engaged.
     stats as (
       select v.subscriber_id,
              max(v.viewed_at) as last_opened,
              count(*) filter (where v.viewed_at > now() - interval '90 days')::int as opens_90
       from document_views v
       join documents d on d.id = v.publication_id
       where d.visibility <> 'OPEN'
       group by v.subscriber_id
     )
     select a.id, a.full_name, a.organization, a.email, a.level, a.public_tier,
            a.seats, a.term_end,
            coalesce(c.n, 0) as editions_considered,
            coalesce(o.n, 0) as editions_opened,
            st.last_opened,
            coalesce(st.opens_90, 0) as opens_90
     from active a
     left join considered c on c.subscriber_id = a.id
     left join opened o     on o.subscriber_id = a.id
     left join stats st     on st.subscriber_id = a.id
     order by a.created_at desc`,
    [
      pairs.map((p) => p.level),
      pairs.map((p) => p.visibility),
      REGULAR_SERIES as unknown as string[],
      reachMonths,
      window,
    ]
  )) as {
    id: string
    full_name: string | null
    organization: string
    email: string
    level: string | null
    public_tier: string
    seats: number
    term_end: string | Date | null
    editions_considered: number
    editions_opened: number
    last_opened: string | Date | null
    opens_90: number
  }[]

  const result: EngagementRow[] = rows.map((r) => {
    const editionsConsidered = Number(r.editions_considered ?? 0)
    const editionsOpened = Number(r.editions_opened ?? 0)

    // Never flag someone with fewer than `window` entitled editions: with one
    // edition behind them, "opened none of the last two" is an artefact of the
    // calendar, not a signal about them.
    const enoughToJudge = editionsConsidered >= window

    return {
      id: r.id,
      fullName: r.full_name || '',
      organisation: r.organization,
      email: r.email,
      level: isLevel(r.level) ? r.level : null,
      publicTier: r.public_tier,
      seats: Number(r.seats ?? 1),
      termEnd: asIsoOrNull(r.term_end),
      daysUntilTermEnd: daysUntil(r.term_end),
      lastOpenedAt: asIsoOrNull(r.last_opened),
      opensLast90Days: Number(r.opens_90 ?? 0),
      editionsConsidered,
      editionsOpened,
      flagged: enoughToJudge && editionsOpened === 0,
      exemptReason: enoughToJudge ? null : 'too-few-editions',
    }
  })

  return result.sort(compareWorstFirst)
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
