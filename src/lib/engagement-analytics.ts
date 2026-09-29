import 'server-only'
import { getSql } from './db'
import {
  repeatSessions,
  enrichmentCoverage,
  type DateWindow,
  type Maybe,
  type ReaderType,
} from './engagement-metrics'
import { editionWithdrawalReady } from './edition-recipients-schema'
import { portalTitleOverrideReady } from './portal-title-schema'
import { portalDocumentTitle } from './papermark-dataroom-contract'

/**
 * Which records the figures read.
 *
 *  - Every stored view, download and click in the window, for the subscriber
 *    portal (personal document links, Data Room links, per-publication links,
 *    legacy client-folder links) and for the Complimentary Review (each
 *    edition's link, the link it had before a withdrawal, and the retired
 *    fixed-slot links).
 *  - Except reads by APRI's own administrators, identified by their account
 *    address: an owner checking a link is not reader engagement. Excluded in
 *    SQL, so the admin list never leaves the server.
 *  - "Active subscribers" is a current state: status active AND inside their
 *    term. A seat still marked active after its term ended is not counted.
 */

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
        where client_type = 'subscriber' and lower(status) = 'active'
          and (term_end is null or term_end >= current_date)) as active_subscribers,

      -- unique_reader for paid readers: distinct subscriber id.
      (select count(distinct dv.subscriber_id)::int from document_views dv
        where dv.subscriber_id is not null
          and dv.viewed_at >= ${fromIso}::timestamptz
          and dv.viewed_at <  ${toIso}::timestamptz
          and not exists (select 1 from admins a where lower(a.email) = lower(dv.viewer_email))) as unique_paid_readers,

      -- unique_reader for prospects: distinct normalised verified email.
      (select count(distinct lower(dv.viewer_email))::int from document_views dv
        where dv.reader_type = 'complimentary_review'
          and dv.viewer_email is not null
          and dv.viewed_at >= ${fromIso}::timestamptz
          and dv.viewed_at <  ${toIso}::timestamptz
          and not exists (select 1 from admins a where lower(a.email) = lower(dv.viewer_email))) as unique_prospect_readers,

      -- view_sessions: distinct Papermark view ids, never a row count.
      (select count(distinct dv.papermark_view_id)::int from document_views dv
        where dv.viewed_at >= ${fromIso}::timestamptz
          and dv.viewed_at <  ${toIso}::timestamptz
          and not exists (select 1 from admins a where lower(a.email) = lower(dv.viewer_email))) as view_sessions,

      -- download_events: distinct confirmed download event ids.
      (select count(distinct de.source_event_id)::int from document_download_events de
        where de.downloaded_at >= ${fromIso}::timestamptz
          and de.downloaded_at <  ${toIso}::timestamptz
          and not exists (select 1 from admins a where lower(a.email) = lower(de.viewer_email))) as download_events,

      -- unique_downloaders: subscriber id, else verified email.
      (select count(distinct coalesce(de.subscriber_id::text, lower(de.viewer_email)))::int
        from document_download_events de
        where (de.subscriber_id is not null or de.viewer_email is not null)
          and de.downloaded_at >= ${fromIso}::timestamptz
          and de.downloaded_at <  ${toIso}::timestamptz
          and not exists (select 1 from admins a where lower(a.email) = lower(de.viewer_email))) as unique_downloaders,

      -- access_clicks: unique event ids. An APRI intent signal, never summed
      -- with view_sessions above.
      (select count(distinct pae.event_id)::int from publication_access_events pae
        where pae.occurred_at >= ${fromIso}::timestamptz
          and pae.occurred_at <  ${toIso}::timestamptz) as access_clicks,

      (select count(distinct pae.visitor_id)::int from publication_access_events pae
        where pae.visitor_id <> ''
          and pae.occurred_at >= ${fromIso}::timestamptz
          and pae.occurred_at <  ${toIso}::timestamptz) as unique_clickers,

      -- Active, in-term subscribers with no confirmed view in the window.
      (select count(*)::int from subscribers s
        where s.client_type = 'subscriber' and lower(s.status) = 'active'
          and (s.term_end is null or s.term_end >= current_date)
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
          and dv.viewed_at <  ${toIso}::timestamptz
          and not exists (select 1 from admins a where lower(a.email) = lower(dv.viewer_email))) as unmatched_views
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
  const [paid, review] = await Promise.all([getPaidPublicationRows(window), getReviewPublicationRows(window)])
  return [...review, ...paid].sort((a, b) => {
    const at = a.lastActivity ? Date.parse(a.lastActivity) : 0
    const bt = b.lastActivity ? Date.parse(b.lastActivity) : 0
    return bt - at || a.title.localeCompare(b.title)
  })
}

/**
 * Subscriber-portal and briefing publications: every document with a read,
 * download or click in the window. Complimentary Review reads are counted on
 * the review rows below, never here -- the same Papermark file can be both a
 * paid edition and a review edition, and a prospect's read is not a paid one.
 */
async function getPaidPublicationRows(window: DateWindow): Promise<PublicationRow[]> {
  const sql = getSql()
  const { fromIso, toIso } = window

  const rows = (await sql`
    with scoped_views as (
      select v.* from document_views v
      where v.viewed_at >= ${fromIso}::timestamptz and v.viewed_at < ${toIso}::timestamptz
        and v.reader_type is distinct from 'complimentary_review'
        and not exists (select 1 from admins a where lower(a.email) = lower(v.viewer_email))
    ),
    scoped_downloads as (
      select de.* from document_download_events de
      where de.downloaded_at >= ${fromIso}::timestamptz and de.downloaded_at < ${toIso}::timestamptz
        and de.reader_type <> 'complimentary_review'
        and not exists (select 1 from admins a where lower(a.email) = lower(de.viewer_email))
    ),
    scoped_clicks as (
      select * from publication_access_events
      where occurred_at >= ${fromIso}::timestamptz and occurred_at < ${toIso}::timestamptz
        and slot_key is null
    )
    select
      d.id                          as publication_id,
      coalesce(nullif(d.title, ''), 'Untitled') as title,
      coalesce(d.series, '')        as series,
      coalesce(d.product_line, '')  as publication_type,
      coalesce(d.visibility, '')    as visibility,
      d.edition_date                as edition_date,
      (select dd.title from papermark_dataroom_documents dd
        where dd.publication_id = d.id and dd.is_present
        order by dd.last_seen_at desc limit 1) as synced_title,

      (select count(distinct pae.event_id)::int from scoped_clicks pae
        where pae.publication_id = d.id) as access_clicks,

      (select count(distinct coalesce(v.subscriber_id::text, v.briefing_request_id::text, lower(v.viewer_email)))::int
        from scoped_views v
        where v.publication_id = d.id
          and (v.subscriber_id is not null or v.briefing_request_id is not null or v.viewer_email is not null)) as unique_readers,

      (select count(distinct v.papermark_view_id)::int from scoped_views v
        where v.publication_id = d.id) as view_sessions,

      (select count(distinct de.source_event_id)::int from scoped_downloads de
        where de.publication_id = d.id) as download_events,

      (select count(distinct coalesce(de.subscriber_id::text, de.briefing_request_id::text, lower(de.viewer_email)))::int
        from scoped_downloads de
        where de.publication_id = d.id
          and (de.subscriber_id is not null or de.briefing_request_id is not null or de.viewer_email is not null)) as unique_downloaders,

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
        coalesce((select max(pae.occurred_at) from scoped_clicks pae where pae.publication_id = d.id), 'epoch'::timestamptz)
      ) as last_activity,

      -- Eligible subscribers only means something for a paid tier: active,
      -- in-term subscribers whose level reaches this document's.
      case
        when d.visibility in ('L1','L2','L3','L4') then (
          select count(*)::int from subscribers s
          where s.client_type = 'subscriber' and lower(s.status) = 'active'
            and (s.term_end is null or s.term_end >= current_date)
            and s.level in ('L1','L2','L3','L4')
            and substring(s.level from 2)::int >= substring(d.visibility from 2)::int
        )
        else null
      end as eligible_subscribers

    from documents d
    where exists (select 1 from scoped_views v where v.publication_id = d.id)
       or exists (select 1 from scoped_downloads de where de.publication_id = d.id)
       or exists (select 1 from scoped_clicks pae where pae.publication_id = d.id)
    order by last_activity desc nulls last, d.title
    limit 300
  `) as Record<string, unknown>[]

  // The title the portal shows: the synced Papermark name, unless an
  // administrator kept the editorial title on purpose.
  const overrides = await titleOverrides(sql, rows.map((r) => (r.publication_id ? String(r.publication_id) : null)))

  return rows.map((r) => {
    const sessions = Number(r.view_sessions ?? 0)
    const readers = Number(r.unique_readers ?? 0)
    const id = r.publication_id ? String(r.publication_id) : null
    const editorial = String(r.title ?? '')
    const title = r.synced_title
      ? portalDocumentTitle({
          syncedName: String(r.synced_title),
          editorialTitle: editorial,
          editorialTitleIsOverride: id ? overrides.has(id) : false,
        })
      : editorial

    return {
      publicationId: id,
      slotKey: null,
      title,
      series: String(r.series ?? ''),
      publicationType: String(r.publication_type ?? ''),
      audience: String(r.visibility ?? '') === 'OPEN' ? 'briefing' : 'paid',
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

/**
 * Complimentary Review publications, one row per edition.
 *
 * A review read belongs to an edition by its link -- the current one, or the
 * one the edition had before it was withdrawn -- or, for a read on a retired
 * fixed-slot link, by the Papermark document. Reads that match no edition are
 * still counted, on one "retired review link" row per series, so every review
 * record is read. Clicks match an edition by its Papermark document.
 *
 * Every edition that is published or withdrawn is listed while it has
 * activity in the window; the one currently featured for each series is
 * listed always, so a new edition shows with zero reads rather than not at all.
 */
async function getReviewPublicationRows(window: DateWindow): Promise<PublicationRow[]> {
  const sql = getSql()
  const { fromIso, toIso } = window
  const withdrawal = await editionWithdrawalReady(sql)

  const rows = (await sql`
    with editions as (
      select e.id, e.series, e.title, e.edition_label, e.edition_date, e.publication_type,
             e.papermark_document_id, e.secure_link_id, e.publication_state,
             case when ${withdrawal}::boolean
                  then coalesce((to_jsonb(e) ->> 'complimentary_featured')::boolean, false)
                  else e.is_latest end as featured,
             case when ${withdrawal}::boolean then (to_jsonb(e) ->> 'withdrawal_link_id') end as old_link_id
      from review_publication_editions e
      where e.publication_state in ('published', 'withdrawn')
    ),
    review_views as (
      select v.* from document_views v
      where v.reader_type = 'complimentary_review'
        and v.viewed_at >= ${fromIso}::timestamptz and v.viewed_at < ${toIso}::timestamptz
        and not exists (select 1 from admins a where lower(a.email) = lower(v.viewer_email))
    ),
    review_downloads as (
      select de.* from document_download_events de
      where de.reader_type = 'complimentary_review'
        and de.downloaded_at >= ${fromIso}::timestamptz and de.downloaded_at < ${toIso}::timestamptz
        and not exists (select 1 from admins a where lower(a.email) = lower(de.viewer_email))
    ),
    review_clicks as (
      select * from publication_access_events
      where slot_key is not null
        and occurred_at >= ${fromIso}::timestamptz and occurred_at < ${toIso}::timestamptz
    ),
    -- Each read, download and click assigned to at most one edition.
    view_edition as (
      select v.papermark_view_id, v.viewer_email, v.viewed_at, v.duration_seconds, v.completion_pct,
             coalesce(v.slot_key_hint, '') as slot_hint,
             (select e.id from editions e
               where e.secure_link_id = v.papermark_link_id or e.old_link_id = v.papermark_link_id
                  or e.papermark_document_id = v.papermark_document_id
               order by (e.secure_link_id = v.papermark_link_id or e.old_link_id = v.papermark_link_id) desc
               limit 1) as edition_id
      from (select rv.*, (select ri.slot_key from complimentary_review_items ri
                           where ri.secure_link_id = rv.papermark_link_id limit 1) as slot_key_hint
            from review_views rv) v
    ),
    download_edition as (
      select de.source_event_id, de.viewer_email, de.downloaded_at,
             (select ri.slot_key from complimentary_review_items ri
               where ri.secure_link_id = de.papermark_link_id limit 1) as slot_hint,
             (select e.id from editions e
               where e.secure_link_id = de.papermark_link_id or e.old_link_id = de.papermark_link_id
                  or e.papermark_document_id = de.papermark_document_id
               limit 1) as edition_id
      from review_downloads de
    ),
    click_edition as (
      select c.event_id, c.visitor_id, c.occurred_at, c.slot_key,
             (select e.id from editions e where e.papermark_document_id = c.papermark_document_id limit 1) as edition_id
      from review_clicks c
    ),
    activity as (
      select edition_id, coalesce(nullif(slot_hint, ''), 'unknown') as slot from view_edition
      union all select edition_id, coalesce(slot_hint, 'unknown') from download_edition
      union all select edition_id, slot_key from click_edition
    ),
    targets as (
      select e.id as edition_id, null::text as slot from editions e
      where e.featured or exists (select 1 from activity a where a.edition_id = e.id)
      union
      select null::uuid, a.slot from activity a where a.edition_id is null
    )
    select
      t.edition_id,
      coalesce(e.series, t.slot)                       as series,
      e.title, e.edition_label, e.edition_date, e.publication_type, e.publication_state, e.featured,
      (select count(distinct c.event_id)::int from click_edition c
        where (t.edition_id is not null and c.edition_id = t.edition_id)
           or (t.edition_id is null and c.edition_id is null and c.slot_key = t.slot)) as access_clicks,
      (select count(distinct lower(v.viewer_email))::int from view_edition v
        where v.viewer_email is not null
          and ((t.edition_id is not null and v.edition_id = t.edition_id)
            or (t.edition_id is null and v.edition_id is null and coalesce(nullif(v.slot_hint, ''), 'unknown') = t.slot))) as unique_readers,
      (select count(distinct v.papermark_view_id)::int from view_edition v
        where (t.edition_id is not null and v.edition_id = t.edition_id)
           or (t.edition_id is null and v.edition_id is null and coalesce(nullif(v.slot_hint, ''), 'unknown') = t.slot)) as view_sessions,
      (select count(distinct d.source_event_id)::int from download_edition d
        where (t.edition_id is not null and d.edition_id = t.edition_id)
           or (t.edition_id is null and d.edition_id is null and coalesce(d.slot_hint, 'unknown') = t.slot)) as download_events,
      (select count(distinct lower(d.viewer_email))::int from download_edition d
        where d.viewer_email is not null
          and ((t.edition_id is not null and d.edition_id = t.edition_id)
            or (t.edition_id is null and d.edition_id is null and coalesce(d.slot_hint, 'unknown') = t.slot))) as unique_downloaders,
      (select avg(v.duration_seconds) from view_edition v
        where v.duration_seconds is not null
          and ((t.edition_id is not null and v.edition_id = t.edition_id)
            or (t.edition_id is null and v.edition_id is null and coalesce(nullif(v.slot_hint, ''), 'unknown') = t.slot))) as avg_duration,
      (select avg(v.completion_pct) from view_edition v
        where v.completion_pct is not null and v.completion_pct >= 0 and v.completion_pct <= 100
          and ((t.edition_id is not null and v.edition_id = t.edition_id)
            or (t.edition_id is null and v.edition_id is null and coalesce(nullif(v.slot_hint, ''), 'unknown') = t.slot))) as avg_completion,
      greatest(
        coalesce((select max(v.viewed_at) from view_edition v
          where (t.edition_id is not null and v.edition_id = t.edition_id)
             or (t.edition_id is null and v.edition_id is null and coalesce(nullif(v.slot_hint, ''), 'unknown') = t.slot)), 'epoch'::timestamptz),
        coalesce((select max(d.downloaded_at) from download_edition d
          where (t.edition_id is not null and d.edition_id = t.edition_id)
             or (t.edition_id is null and d.edition_id is null and coalesce(d.slot_hint, 'unknown') = t.slot)), 'epoch'::timestamptz),
        coalesce((select max(c.occurred_at) from click_edition c
          where (t.edition_id is not null and c.edition_id = t.edition_id)
             or (t.edition_id is null and c.edition_id is null and c.slot_key = t.slot)), 'epoch'::timestamptz)
      ) as last_activity
    from targets t
    left join editions e on e.id = t.edition_id
    limit 300
  `) as Record<string, unknown>[]

  return rows.map((r) => {
    const sessions = Number(r.view_sessions ?? 0)
    const readers = Number(r.unique_readers ?? 0)
    const series = r.series ? String(r.series) : ''
    const edition = Boolean(r.edition_id)
    const label = [r.title ? String(r.title) : '', r.edition_label ? String(r.edition_label) : '']
      .filter(Boolean)
      .join(' -- ')
    const state = String(r.publication_state ?? '')
    const title = edition
      ? `${label || 'Untitled edition'}${state === 'withdrawn' ? ' (withdrawn)' : r.featured ? ' (featured)' : ''}`
      : `Retired review link${series && series !== 'unknown' ? ` (${series})` : ''}`

    return {
      publicationId: edition ? String(r.edition_id) : null,
      slotKey: series || null,
      title,
      series,
      publicationType: String(r.publication_type ?? ''),
      audience: 'complimentary_review',
      editionDate: r.edition_date ? String(r.edition_date) : null,
      eligibleSubscribers: null,
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

async function titleOverrides(sql: ReturnType<typeof getSql>, ids: (string | null)[]): Promise<Set<string>> {
  const list = [...new Set(ids.filter((id): id is string => Boolean(id)))]
  if (list.length === 0) return new Set()
  try {
    if (!(await portalTitleOverrideReady(sql))) return new Set()
    const rows = (await sql`
      select id from documents where portal_title_override = true and id = any(${list}::uuid[])
    `) as { id: string }[]
    return new Set(rows.map((r) => r.id))
  } catch {
    return new Set()
  }
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
      select v.* from document_views v
      where v.viewed_at >= ${fromIso}::timestamptz and v.viewed_at < ${toIso}::timestamptz
        and not exists (select 1 from admins a where lower(a.email) = lower(v.viewer_email))
    ),
    scoped_downloads as (
      select de.* from document_download_events de
      where de.downloaded_at >= ${fromIso}::timestamptz and de.downloaded_at < ${toIso}::timestamptz
        and not exists (select 1 from admins a where lower(a.email) = lower(de.viewer_email))
    ),
    keyed as (
      select
        coalesce(v.subscriber_id::text, 'email:' || lower(v.viewer_email)) as reader_key,
        v.subscriber_id,
        lower(v.viewer_email) as email,
        coalesce(v.reader_type, 'unknown') as reader_type,
        -- A review edition has no APRI publication id; its Papermark file
        -- identifies the document instead, so it still counts as opened.
        coalesce(v.publication_id::text, 'pm:' || v.papermark_document_id) as document_key,
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
      count(distinct k.document_key)::int as documents_opened,
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
    order by last_activity desc nulls last, view_sessions desc
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
  const withdrawal = await editionWithdrawalReady(sql)

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
      -- Rows the repair can still learn something about: no reader at all, or
      -- a subscriber or briefing read with no publication. A review read has no
      -- publication id by design and is complete without one.
      (select count(*)::int from document_views
        where (subscriber_id is null and briefing_request_id is null
               and (reader_type is null or reader_type = 'unknown'))
           or (publication_id is null and reader_type in ('subscriber', 'briefing'))) as repairable_rows,
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
            select 1 from review_publication_editions x
            where x.secure_link_id = dv.papermark_link_id
               or (${withdrawal}::boolean and (to_jsonb(x) ->> 'withdrawal_link_id') = dv.papermark_link_id)
          )
          and not exists (
            select 1 from publication_access x where x.papermark_link_id = dv.papermark_link_id
          )
          and not exists (
            select 1 from papermark_client_documents x where x.papermark_link_id = dv.papermark_link_id
          )
          and not exists (
            select 1 from subscribers x where x.papermark_link_id = dv.papermark_link_id
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
