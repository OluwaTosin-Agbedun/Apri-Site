import 'server-only'
import { getSql } from './db'
import {
  repeatSessions,
  enrichmentCoverage,
  type DateWindow,
  type Maybe,
  type ReaderType,
} from './engagement-metrics'

/**
 * The dashboard's queries.
 *
 * Every figure below is filtered by the same `DateWindow`. That single rule is
 * what the previous dashboard lacked: it placed lifetime totals ("all
 * document_views rows ever") in the same row as 30-day figures, so a reader had
 * no way to know which period any number covered, and the two could not be
 * compared with each other.
 *
 * The counting rules themselves live in `engagement-metrics.ts` and are
 * expressed here as the equivalent SQL: distinct ids rather than row counts,
 * and averages that exclude missing readings rather than treating them as zero.
 */

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export type OverviewMetrics = {
  activeSubscribers: number
  uniquePaidReaders: number
  uniqueProspectReaders: number
  viewSessions: number
  downloadEvents: number
  uniqueDownloaders: number
  accessClicks: number
  uniqueClickers: number
  dormantSubscribers: number
  unmatchedViews: number
  lastWebhookAt: string | null
  lastPollAt: string | null
  dataSince: string | null
}

export async function getOverviewMetrics(window: DateWindow): Promise<OverviewMetrics> {
  const sql = getSql()
  const { fromIso, toIso } = window

  const rows = (await sql`
    select
      -- Not date-filtered on purpose: "how many people currently pay us" is a
      -- state, not an event in the window. Labelled as such in the UI.
      (select count(*)::int from subscribers
        where client_type = 'subscriber' and lower(status) = 'active') as active_subscribers,

      -- unique_reader for paid readers: distinct subscriber id.
      (select count(distinct dv.subscriber_id)::int from document_views dv
        where dv.subscriber_id is not null
          and dv.viewed_at >= ${fromIso}::timestamptz
          and dv.viewed_at <  ${toIso}::timestamptz) as unique_paid_readers,

      -- unique_reader for prospects: distinct normalised verified email.
      (select count(distinct lower(dv.viewer_email))::int from document_views dv
        where dv.reader_type = 'complimentary_review'
          and dv.viewer_email is not null
          and dv.viewed_at >= ${fromIso}::timestamptz
          and dv.viewed_at <  ${toIso}::timestamptz) as unique_prospect_readers,

      -- view_sessions: distinct Papermark view ids, never a row count.
      (select count(distinct dv.papermark_view_id)::int from document_views dv
        where dv.viewed_at >= ${fromIso}::timestamptz
          and dv.viewed_at <  ${toIso}::timestamptz) as view_sessions,

      -- download_events: distinct confirmed download event ids.
      (select count(distinct de.source_event_id)::int from document_download_events de
        where de.downloaded_at >= ${fromIso}::timestamptz
          and de.downloaded_at <  ${toIso}::timestamptz) as download_events,

      -- unique_downloaders: subscriber id, else verified email.
      (select count(distinct coalesce(de.subscriber_id::text, lower(de.viewer_email)))::int
        from document_download_events de
        where (de.subscriber_id is not null or de.viewer_email is not null)
          and de.downloaded_at >= ${fromIso}::timestamptz
          and de.downloaded_at <  ${toIso}::timestamptz) as unique_downloaders,

      -- access_clicks: unique event ids. An APRI intent signal, never summed
      -- with view_sessions above.
      (select count(distinct pae.event_id)::int from publication_access_events pae
        where pae.occurred_at >= ${fromIso}::timestamptz
          and pae.occurred_at <  ${toIso}::timestamptz) as access_clicks,

      (select count(distinct pae.visitor_id)::int from publication_access_events pae
        where pae.visitor_id <> ''
          and pae.occurred_at >= ${fromIso}::timestamptz
          and pae.occurred_at <  ${toIso}::timestamptz) as unique_clickers,

      -- Active subscribers with no confirmed view in the window.
      (select count(*)::int from subscribers s
        where s.client_type = 'subscriber' and lower(s.status) = 'active'
          and not exists (
            select 1 from document_views dv
            where dv.subscriber_id = s.id
              and dv.viewed_at >= ${fromIso}::timestamptz
              and dv.viewed_at <  ${toIso}::timestamptz
          )) as dormant_subscribers,

      (select count(*)::int from document_views dv
        where dv.subscriber_id is null
          and dv.briefing_request_id is null
          and (dv.reader_type is null or dv.reader_type = 'unknown')
          and dv.viewed_at >= ${fromIso}::timestamptz
          and dv.viewed_at <  ${toIso}::timestamptz) as unmatched_views
  `) as Record<string, number>[]

  const r = rows[0] ?? {}

  const [lastWebhookAt, lastPollAt, dataSince] = await Promise.all([
    readSetting('papermark_last_webhook_at'),
    readPollTimestamp(),
    readSetting('engagement_click_tracking_since'),
  ])

  return {
    activeSubscribers: r.active_subscribers ?? 0,
    uniquePaidReaders: r.unique_paid_readers ?? 0,
    uniqueProspectReaders: r.unique_prospect_readers ?? 0,
    viewSessions: r.view_sessions ?? 0,
    downloadEvents: r.download_events ?? 0,
    uniqueDownloaders: r.unique_downloaders ?? 0,
    accessClicks: r.access_clicks ?? 0,
    uniqueClickers: r.unique_clickers ?? 0,
    dormantSubscribers: r.dormant_subscribers ?? 0,
    unmatchedViews: r.unmatched_views ?? 0,
    lastWebhookAt,
    lastPollAt,
    dataSince,
  }
}

// ---------------------------------------------------------------------------
// Publications
// ---------------------------------------------------------------------------

export type PublicationRow = {
  publicationId: string | null
  slotKey: string | null
  title: string
  series: string
  publicationType: string
  /** 'paid' | 'briefing' | 'complimentary_review' */
  audience: string
  editionDate: string | null
  /** Null where the concept does not apply, e.g. a prospect publication. */
  eligibleSubscribers: Maybe<number>
  accessClicks: number
  uniqueReaders: number
  viewSessions: number
  repeatSessions: number
  downloadEvents: number
  uniqueDownloaders: number
  averageEngagedTime: Maybe<number>
  completionPct: Maybe<number>
  lastActivity: string | null
}

export async function getPublicationRows(window: DateWindow): Promise<PublicationRow[]> {
  const sql = getSql()
  const { fromIso, toIso } = window

  const rows = (await sql`
    with review_slots as (
      select ri.slot_key, ri.publication_id
      from complimentary_review_items ri
      where ri.slot_key in ('MIN', 'AIU', 'PLM') and ri.is_active = true
    ),
    scoped_views as (
      select * from document_views
      where viewed_at >= ${fromIso}::timestamptz and viewed_at < ${toIso}::timestamptz
    ),
    scoped_downloads as (
      select * from document_download_events
      where downloaded_at >= ${fromIso}::timestamptz and downloaded_at < ${toIso}::timestamptz
    ),
    scoped_clicks as (
      select * from publication_access_events
      where occurred_at >= ${fromIso}::timestamptz and occurred_at < ${toIso}::timestamptz
    )
    select
      d.id                          as publication_id,
      rs.slot_key                   as slot_key,
      coalesce(nullif(d.title, ''), 'Untitled') as title,
      coalesce(d.series, '')        as series,
      coalesce(d.product_line, '')  as publication_type,
      coalesce(d.visibility, '')    as visibility,
      d.edition_date                as edition_date,

      (select count(distinct pae.event_id)::int from scoped_clicks pae
        where pae.publication_id = d.id
           or (rs.slot_key is not null and pae.slot_key = rs.slot_key)) as access_clicks,

      (select count(distinct coalesce(v.subscriber_id::text, lower(v.viewer_email)))::int
        from scoped_views v
        where v.publication_id = d.id
          and (v.subscriber_id is not null or v.viewer_email is not null)) as unique_readers,

      (select count(distinct v.papermark_view_id)::int from scoped_views v
        where v.publication_id = d.id) as view_sessions,

      (select count(distinct de.source_event_id)::int from scoped_downloads de
        where de.publication_id = d.id) as download_events,

      (select count(distinct coalesce(de.subscriber_id::text, lower(de.viewer_email)))::int
        from scoped_downloads de
        where de.publication_id = d.id
          and (de.subscriber_id is not null or de.viewer_email is not null)) as unique_downloaders,

      -- avg() ignores nulls, which is exactly the rule: a view that reported no
      -- duration is excluded from the average rather than counted as zero.
      (select avg(v.duration_seconds) from scoped_views v
        where v.publication_id = d.id and v.duration_seconds is not null) as avg_duration,

      (select avg(v.completion_pct) from scoped_views v
        where v.publication_id = d.id
          and v.completion_pct is not null
          and v.completion_pct >= 0 and v.completion_pct <= 100) as avg_completion,

      greatest(
        coalesce((select max(v.viewed_at) from scoped_views v where v.publication_id = d.id), 'epoch'::timestamptz),
        coalesce((select max(de.downloaded_at) from scoped_downloads de where de.publication_id = d.id), 'epoch'::timestamptz),
        coalesce((select max(pae.occurred_at) from scoped_clicks pae
          where pae.publication_id = d.id
             or (rs.slot_key is not null and pae.slot_key = rs.slot_key)), 'epoch'::timestamptz)
      ) as last_activity,

      -- Eligible subscribers only means something for a paid tier. A prospect
      -- publication has no eligibility, and is reported as such rather than as
      -- zero eligible readers.
      case
        when rs.slot_key is not null then null
        when d.visibility in ('L1','L2','L3','L4') then (
          select count(*)::int from subscribers s
          where s.client_type = 'subscriber' and lower(s.status) = 'active'
        )
        else null
      end as eligible_subscribers

    from documents d
    left join review_slots rs on rs.publication_id = d.id
    where exists (select 1 from scoped_views v where v.publication_id = d.id)
       or exists (select 1 from scoped_downloads de where de.publication_id = d.id)
       or exists (select 1 from scoped_clicks pae
            where pae.publication_id = d.id
               or (rs.slot_key is not null and pae.slot_key = rs.slot_key))
       or rs.slot_key is not null
    order by last_activity desc nulls last, d.title
    limit 300
  `) as Record<string, unknown>[]

  return rows.map((r) => {
    const sessions = Number(r.view_sessions ?? 0)
    const readers = Number(r.unique_readers ?? 0)
    const slotKey = r.slot_key ? String(r.slot_key) : null

    return {
      publicationId: r.publication_id ? String(r.publication_id) : null,
      slotKey,
      title: String(r.title ?? ''),
      series: String(r.series ?? ''),
      publicationType: String(r.publication_type ?? ''),
      audience: slotKey
        ? 'complimentary_review'
        : String(r.visibility ?? '') === 'OPEN'
          ? 'briefing'
          : 'paid',
      editionDate: r.edition_date ? String(r.edition_date) : null,
      eligibleSubscribers: r.eligible_subscribers === null || r.eligible_subscribers === undefined
        ? null
        : Number(r.eligible_subscribers),
      accessClicks: Number(r.access_clicks ?? 0),
      uniqueReaders: readers,
      viewSessions: sessions,
      repeatSessions: repeatSessions(sessions, readers),
      downloadEvents: Number(r.download_events ?? 0),
      uniqueDownloaders: Number(r.unique_downloaders ?? 0),
      averageEngagedTime: numOrNull(r.avg_duration),
      completionPct: numOrNull(r.avg_completion),
      lastActivity: epochToNull(r.last_activity),
    }
  })
}

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

export type ReaderRow = {
  readerKey: string
  /** Present only for a reader who holds a subscriber record. */
  subscriberId: string | null
  name: string | null
  email: string | null
  readerType: ReaderType
  subscriptionLevel: string | null
  documentsOpened: number
  viewSessions: number
  downloadEvents: number
  lastActivity: string | null
  averageCompletion: Maybe<number>
}

export async function getReaderRows(window: DateWindow): Promise<ReaderRow[]> {
  const sql = getSql()
  const { fromIso, toIso } = window

  const rows = (await sql`
    with scoped_views as (
      select * from document_views
      where viewed_at >= ${fromIso}::timestamptz and viewed_at < ${toIso}::timestamptz
    ),
    scoped_downloads as (
      select * from document_download_events
      where downloaded_at >= ${fromIso}::timestamptz and downloaded_at < ${toIso}::timestamptz
    ),
    keyed as (
      select
        coalesce(v.subscriber_id::text, 'email:' || lower(v.viewer_email)) as reader_key,
        v.subscriber_id,
        lower(v.viewer_email) as email,
        coalesce(v.reader_type, 'unknown') as reader_type,
        v.publication_id,
        v.papermark_view_id,
        v.completion_pct
      from scoped_views v
      where v.subscriber_id is not null or v.viewer_email is not null
    )
    select
      k.reader_key,
      max(k.subscriber_id::text) as subscriber_id,
      max(k.email) as email,
      -- A reader classified once keeps that classification; 'unknown' loses to
      -- any real type so a partially attributed reader is not shown as unknown.
      coalesce(max(nullif(k.reader_type, 'unknown')), 'unknown') as reader_type,
      count(distinct k.publication_id)::int as documents_opened,
      count(distinct k.papermark_view_id)::int as view_sessions,
      avg(k.completion_pct) filter (
        where k.completion_pct is not null
          and k.completion_pct >= 0 and k.completion_pct <= 100
      ) as avg_completion,
      (select count(distinct de.source_event_id)::int from scoped_downloads de
        where (de.subscriber_id::text = max(k.subscriber_id::text))
           or (lower(de.viewer_email) = max(k.email))) as download_events,
      (select max(v2.viewed_at) from scoped_views v2
        where (v2.subscriber_id::text = max(k.subscriber_id::text))
           or (lower(v2.viewer_email) = max(k.email))) as last_activity
    from keyed k
    group by k.reader_key
    order by view_sessions desc
    limit 500
  `) as Record<string, unknown>[]

  // Names and levels come from the subscriber record where one exists. A
  // Complimentary Review reader has no record by design, so their verified
  // address is the only identity shown -- never invented, never merged into a
  // subscriber.
  const subscriberIds = rows
    .map((r) => (r.subscriber_id ? String(r.subscriber_id) : null))
    .filter((v): v is string => Boolean(v))

  const profiles = new Map<string, { name: string; level: string | null }>()
  if (subscriberIds.length > 0) {
    const profileRows = (await sql`
      select id, coalesce(nullif(full_name, ''), name) as name, public_tier
      from subscribers
      where id = any(${subscriberIds}::uuid[])
    `) as { id: string; name: string; public_tier: string | null }[]
    for (const p of profileRows) {
      profiles.set(p.id, { name: p.name ?? '', level: p.public_tier ?? null })
    }
  }

  return rows.map((r) => {
    const subscriberId = r.subscriber_id ? String(r.subscriber_id) : null
    const profile = subscriberId ? profiles.get(subscriberId) : undefined

    return {
      readerKey: String(r.reader_key),
      subscriberId,
      name: profile?.name || null,
      email: r.email ? String(r.email) : null,
      readerType: (String(r.reader_type ?? 'unknown') as ReaderType),
      subscriptionLevel: profile?.level ?? null,
      documentsOpened: Number(r.documents_opened ?? 0),
      viewSessions: Number(r.view_sessions ?? 0),
      downloadEvents: Number(r.download_events ?? 0),
      lastActivity: r.last_activity ? String(r.last_activity) : null,
      averageCompletion: numOrNull(r.avg_completion),
    }
  })
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export type Diagnostics = {
  webhookConfigured: boolean
  lastWebhookAt: string | null
  lastPollAt: string | null
  lastPollSummary: Record<string, unknown> | null
  failedWebhookEvents: number
  unmatchedViewsAllTime: number
  unknownLinkIds: number
  enrichmentCoveragePct: Maybe<number>
  viewsAwaitingEnrichment: number
  repairableRows: number
}

export async function getDiagnostics(): Promise<Diagnostics> {
  const sql = getSql()

  const rows = (await sql`
    select
      (select count(*)::int from papermark_webhook_events
        where outcome = 'failed') as failed_webhook_events,
      (select count(*)::int from document_views
        where subscriber_id is null and briefing_request_id is null
          and (reader_type is null or reader_type = 'unknown')) as unmatched_all_time,
      (select count(*)::int from document_views) as total_views,
      (select count(duration_seconds)::int from document_views) as views_with_duration,
      (select count(*)::int from document_views where last_enriched_at is null) as awaiting_enrichment,
      (select count(*)::int from document_views
        where subscriber_id is null or publication_id is null or reader_type is null) as repairable_rows,
      (select count(distinct papermark_link_id)::int from document_views dv
        where dv.papermark_link_id is not null
          and not exists (
            select 1 from papermark_subscriber_document_links x where x.papermark_link_id = dv.papermark_link_id
          )
          and not exists (
            select 1 from papermark_dataroom_links x where x.papermark_link_id = dv.papermark_link_id
          )
          and not exists (
            select 1 from complimentary_review_items x where x.secure_link_id = dv.papermark_link_id
          )
          and not exists (
            select 1 from publication_access x where x.papermark_link_id = dv.papermark_link_id
          )) as unknown_link_ids
  `) as Record<string, number>[]

  const r = rows[0] ?? {}
  const pollRaw = await readSetting('papermark_last_poll')

  let lastPollSummary: Record<string, unknown> | null = null
  let lastPollAt: string | null = null
  if (pollRaw) {
    try {
      const parsed = JSON.parse(pollRaw) as Record<string, unknown>
      lastPollSummary = parsed
      lastPollAt = typeof parsed.at === 'string' ? parsed.at : null
    } catch {
      lastPollSummary = null
    }
  }

  return {
    // Reports only whether the secret is present. The value is never read into
    // a response, logged, or shown.
    webhookConfigured: Boolean(process.env.PAPERMARK_WEBHOOK_SECRET),
    lastWebhookAt: await readSetting('papermark_last_webhook_at'),
    lastPollAt,
    lastPollSummary,
    failedWebhookEvents: r.failed_webhook_events ?? 0,
    unmatchedViewsAllTime: r.unmatched_all_time ?? 0,
    unknownLinkIds: r.unknown_link_ids ?? 0,
    enrichmentCoveragePct: enrichmentCoverage(r.total_views ?? 0, r.views_with_duration ?? 0),
    viewsAwaitingEnrichment: r.awaiting_enrichment ?? 0,
    repairableRows: r.repairable_rows ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readSetting(key: string): Promise<string | null> {
  try {
    const sql = getSql()
    const rows = (await sql`
      select value from app_settings where key = ${key} limit 1
    `) as { value: string }[]
    const value = rows[0]?.value ?? ''
    return value === '' ? null : value
  } catch {
    return null
  }
}

async function readPollTimestamp(): Promise<string | null> {
  const raw = await readSetting('papermark_last_poll')
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { at?: string }
    return typeof parsed.at === 'string' ? parsed.at : null
  } catch {
    return null
  }
}

/** Preserves null rather than turning a missing average into zero. */
function numOrNull(value: unknown): Maybe<number> {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** `greatest(..., 'epoch')` yields 1970 when nothing matched; that means null. */
function epochToNull(value: unknown): string | null {
  if (!value) return null
  const s = String(value)
  const t = Date.parse(s)
  if (!Number.isFinite(t)) return null
  // Anything at or before 1970 is the sentinel, not a real activity time.
  if (t <= 86_400_000) return null
  return s
}
