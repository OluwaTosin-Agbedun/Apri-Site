import 'server-only'
import { getSql } from './db'
import { visibilitiesForLevel, isLevel, type Level } from './entitlements'

/**
 * Reconciliation: which stamped copies still need making.
 *
 * Under stamping, the thing that fails silently is not a permission — it is a
 * copy nobody made. A subscriber pays, an edition publishes, no stamped copy is
 * produced for them, and the portal shows them nothing. No permission check
 * catches that, because nothing is being denied.
 *
 * So this is computed, never stored. A stored gap row would linger after the
 * copy was made and turn a work queue into a log; the queue has to read empty
 * when all is well or nobody will trust it.
 *
 * Entitlement comes from visibilitiesForLevel and nowhere else. The rule is not
 * restated here.
 */

export type CopyGap = {
  subscriberId: string
  subscriberName: string
  organisation: string
  level: Level
  seats: number
  publicationId: string
  publicationCode: string | null
  publicationTitle: string
  visibility: string
  /** When this gap opened: whichever is later, publication or term start. */
  openedAt: string
  /** Whole days the gap has been open. */
  ageDays: number
}

/**
 * Every active subscriber × every published edition they are entitled to,
 * minus the rows that already exist.
 *
 * One query rather than a loop per subscriber: the cross join is bounded by
 * seats × editions, which at this scale is tens of rows, and doing it in SQL
 * means the queue cannot disagree with itself between two page loads.
 *
 * A gap only counts from when the subscriber could first have expected the
 * document — the later of the edition publishing and their term beginning — so
 * a new subscriber is not immediately shown as owed every past edition.
 *
 * Scoped to `client_type = 'subscriber'` with a level, an active status and a
 * current term. Without that filter the queue would demand stamped editions for
 * briefing clients, who hold no level and are owed no library, and it would
 * never read empty — which is the one property that makes a work queue usable.
 */
export async function getCopyGaps(): Promise<CopyGap[]> {
  const sql = getSql()

  // Levels are expanded here from the shared rule, then bound as a pair list,
  // so SQL never re-implements the ranking.
  const pairs: { level: Level; visibility: string }[] = []
  for (const level of ['L1', 'L2', 'L3', 'L4'] as Level[]) {
    for (const visibility of visibilitiesForLevel(level)) {
      pairs.push({ level, visibility })
    }
  }

  const rows = (await sql.query(
    `with entitlement (level, visibility) as (
       select * from unnest($1::text[], $2::text[])
     )
     select s.id            as subscriber_id,
            coalesce(nullif(s.full_name, ''), s.name) as subscriber_name,
            s.organization  as organisation,
            s.level,
            s.seats,
            d.id            as publication_id,
            d.code          as publication_code,
            d.title         as publication_title,
            d.visibility,
            greatest(
              coalesce(d.edition_date::timestamptz, d.published_at, d.created_at),
              coalesce(s.term_start::timestamptz, s.created_at)
            ) as opened_at
     from subscribers s
     join entitlement e on e.level = s.level
     join documents d
       on d.visibility = e.visibility
      and d.status = 'published'
      and d.visibility <> 'OPEN'
      -- A shared, unstamped publication needs no per-subscriber copy.
      and d.is_shared_copy = false
     left join publication_access pa
       on pa.subscriber_id = s.id and pa.publication_id = d.id
     where s.client_type = 'subscriber'
       and s.level is not null
       and lower(s.status) = 'active'
       and s.term_end is not null
       and s.term_end >= current_date
       -- Only editions from the subscriber's own term onward.
       and coalesce(d.edition_date, d.published_at::date, d.created_at::date)
           >= coalesce(s.term_start, s.created_at::date)
       -- The gap itself: no row at all. A revoked row is not a gap; that
       -- subscriber's access ended deliberately.
       and pa.id is null
     order by opened_at asc`,
    [pairs.map((p) => p.level), pairs.map((p) => p.visibility)]
  )) as {
    subscriber_id: string
    subscriber_name: string | null
    organisation: string
    level: string
    seats: number
    publication_id: string
    publication_code: string | null
    publication_title: string
    visibility: string
    opened_at: string | Date
  }[]

  const now = Date.now()

  return rows.flatMap((r) => {
    if (!isLevel(r.level)) return []
    const opened = r.opened_at instanceof Date ? r.opened_at : new Date(r.opened_at)
    if (Number.isNaN(opened.getTime())) return []

    return [{
      subscriberId: r.subscriber_id,
      subscriberName: r.subscriber_name || '',
      organisation: r.organisation,
      level: r.level,
      seats: Number(r.seats ?? 1),
      publicationId: r.publication_id,
      publicationCode: r.publication_code,
      publicationTitle: r.publication_title,
      visibility: r.visibility,
      openedAt: opened.toISOString(),
      ageDays: Math.max(0, Math.floor((now - opened.getTime()) / 86_400_000)),
    }]
  })
}

/**
 * Gaps open longer than `hours` that we have not yet emailed about.
 *
 * Someone paying for something they cannot open is not a dashboard row, so it
 * escalates — but only once per gap, or the nightly run would nag until it was
 * filled and the alert would stop being read.
 */
export async function getUnalertedGaps(hours = 24): Promise<CopyGap[]> {
  const gaps = await getCopyGaps()
  const overdue = gaps.filter((g) => g.ageDays * 24 >= hours)
  if (overdue.length === 0) return []

  const sql = getSql()
  const alerted = (await sql.query(
    `select subscriber_id, publication_id from copy_gap_alerts
     where subscriber_id = any($1::uuid[]) and publication_id = any($2::uuid[])`,
    [overdue.map((g) => g.subscriberId), overdue.map((g) => g.publicationId)]
  )) as { subscriber_id: string; publication_id: string }[]

  const seen = new Set(alerted.map((a) => `${a.subscriber_id}:${a.publication_id}`))
  return overdue.filter((g) => !seen.has(`${g.subscriberId}:${g.publicationId}`))
}

/** Records that a gap has been escalated, so it is not emailed twice. */
export async function markGapsAlerted(gaps: CopyGap[]): Promise<void> {
  if (gaps.length === 0) return
  const sql = getSql()

  await sql.query(
    `insert into copy_gap_alerts (subscriber_id, publication_id)
     select * from unnest($1::uuid[], $2::uuid[])
     on conflict (subscriber_id, publication_id) do nothing`,
    [gaps.map((g) => g.subscriberId), gaps.map((g) => g.publicationId)]
  )
}

/**
 * Clears the alert record once a copy exists.
 *
 * Without this, a gap that was filled and then reopened -- a link revoked and
 * reissued -- would never escalate a second time.
 */
export async function clearGapAlert(
  subscriberId: string,
  publicationId: string
): Promise<void> {
  const sql = getSql()
  await sql`
    delete from copy_gap_alerts
    where subscriber_id = ${subscriberId} and publication_id = ${publicationId}
  `
}
