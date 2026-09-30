import 'server-only'
import { getSql } from './db'
import { tierDisplayName, levelLabel, isLevel } from './entitlements'
import { portalDocumentTitle } from './papermark-dataroom-contract'
import { editionRecipientsReady, editionWithdrawalReady } from './edition-recipients-schema'
import { readSharedRecipients } from './edition-recipients-dal'
import { pageProgressReady, PAGE_PROGRESS_MIGRATION_PENDING } from './page-progress-schema'
import { CAPABILITY_KEY } from './page-progress-collector'
import { normaliseEmail } from './engagement-metrics'
import type { PageEvidence } from './page-progress'
import {
  accessRouteLabel,
  accessStatus,
  editionActivity,
  lagosToday,
  likePattern,
  type DateRange,
  type DownloadInput,
  type EditionActivity,
  type SessionInput,
} from './reader-monitoring-rules'

/**
 * The Admin Engagement monitor's reads.
 *
 * Two contexts, never mixed:
 *
 *  - Subscribers: every subscriber record (all levels and statuses, with or
 *    without activity), their authentication records, and the Papermark
 *    sessions attributed to that record -- paid context only.
 *  - Complimentary Review: every approved recipient, verified prospect and
 *    review reader, keyed by verified email, and the sessions Papermark
 *    recorded on review links -- review context only.
 *
 * One email that is both a subscriber and a review reader appears in both,
 * each with only its own context's activity. Nothing here guesses an
 * identity: a session belongs to a reader only through its stored
 * attribution.
 */

type Sql = ReturnType<typeof getSql>

export type MonitorFilters = {
  q: string
  level: string
  status: string
  series: string
  range: DateRange | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function iso(value: unknown): string | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** A calendar date (YYYY-MM-DD, read as text) in words. Never shifted by a time zone. */
function dayLabel(value: unknown): string {
  const day = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
  if (!day) return ''
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' })
}

async function adminEmails(sql: Sql): Promise<Set<string>> {
  const rows = (await sql`select lower(email) as email from admins`) as { email: string }[]
  return new Set(rows.map((r) => r.email))
}

async function pagesFor(sql: Sql, viewIds: string[]): Promise<Map<string, PageEvidence[]>> {
  const out = new Map<string, PageEvidence[]>()
  if (viewIds.length === 0 || !(await pageProgressReady(sql))) return out
  const rows = (await sql`
    select view_id, page_number, duration_seconds from document_view_pages
    where view_id = any(${viewIds}::uuid[])
    order by view_id, page_number
  `) as { view_id: string; page_number: number; duration_seconds: string | number }[]
  for (const r of rows) {
    const list = out.get(r.view_id) ?? []
    list.push({ pageNumber: Number(r.page_number), durationSeconds: Number(r.duration_seconds) })
    out.set(r.view_id, list)
  }
  return out
}

// ---------------------------------------------------------------------------
// Status line
// ---------------------------------------------------------------------------

export type MonitorStatus = {
  lastPollAt: string | null
  lastWebhookAt: string | null
  pageProgressReady: boolean
  pageProgressNote: string | null
  /** The last limitation Papermark reported for analytics, if any. */
  capability: { at: string | null; message: string } | null
}

export async function getMonitorStatus(): Promise<MonitorStatus> {
  const sql = getSql()
  const rows = (await sql`
    select key, value from app_settings
    where key in ('papermark_last_poll', 'papermark_last_webhook_at', ${CAPABILITY_KEY})
  `) as { key: string; value: string }[]
  const get = (k: string) => rows.find((r) => r.key === k)?.value ?? ''
  let lastPollAt: string | null = null
  try {
    const parsed = JSON.parse(get('papermark_last_poll') || '{}') as { at?: unknown }
    lastPollAt = typeof parsed.at === 'string' ? parsed.at : null
  } catch {
    lastPollAt = null
  }
  let capability: MonitorStatus['capability'] = null
  try {
    const raw = get(CAPABILITY_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { at?: unknown; message?: unknown }
      if (typeof parsed.message === 'string') capability = { at: typeof parsed.at === 'string' ? parsed.at : null, message: parsed.message }
    }
  } catch {
    capability = null
  }
  const ready = await pageProgressReady(sql, { fresh: true })
  return {
    lastPollAt,
    lastWebhookAt: get('papermark_last_webhook_at') || null,
    pageProgressReady: ready,
    pageProgressNote: ready ? null : PAGE_PROGRESS_MIGRATION_PENDING,
    capability,
  }
}

// ---------------------------------------------------------------------------
// Subscribers
// ---------------------------------------------------------------------------

export type SubscriberReaderRow = {
  id: string
  name: string
  email: string
  level: string
  status: { key: string; label: string }
  isAdministrator: boolean
  /** All time, from successful sign-in records only. */
  lastLoginAt: string | null
  /** All time, authenticated portal page loads. */
  lastPortalVisitAt: string | null
  /** All time, the latest confirmed Papermark session. */
  lastViewedAt: string | null
  /** In the selected period (or all time without one). */
  sessions: number
  editions: number
}

/**
 * Every Papermark session in the paid context, with the document it was on
 * resolved through APRI's own mappings. A Data Room view (opening the room)
 * is not a reading session and is left out.
 */
const PAID_SESSIONS = `
  select v.*,
         coalesce(v.publication_id, dd.publication_id, dx.id) as pub_id,
         dd.title as synced_title
  from document_views v
  left join lateral (
    select d.publication_id, d.title from papermark_dataroom_documents d
    where d.papermark_document_id = v.papermark_document_id
    order by d.last_seen_at desc limit 1
  ) dd on true
  left join lateral (
    select d.id from documents d where d.papermark_document_id = v.papermark_document_id limit 1
  ) dx on true
  where v.subscriber_id is not null
    and v.reader_type is distinct from 'complimentary_review'
    and coalesce(to_jsonb(v) ->> 'view_type', '') <> 'DATAROOM_VIEW'
`

export async function listSubscriberReaders(filters: MonitorFilters): Promise<SubscriberReaderRow[]> {
  const sql = getSql()
  const pattern = likePattern(filters.q)
  const rows = (await sql.query(
    `with paid as (${PAID_SESSIONS}),
     scoped as (
       select p.* from paid p
       left join documents d on d.id = p.pub_id
       where ($1::timestamptz is null or p.viewed_at >= $1::timestamptz)
         and ($2::timestamptz is null or p.viewed_at <  $2::timestamptz)
         and ($3::text = '' or upper(coalesce(d.series, '')) = upper($3::text))
     ),
     auth as (
       select subscriber_id,
              max(occurred_at) filter (where event_type = 'signin_completed') as last_login,
              max(occurred_at) filter (where event_type = 'portal_opened') as last_visit
       from client_engagement_events
       where subscriber_id is not null and event_type in ('signin_completed', 'portal_opened')
       group by subscriber_id
     )
     select s.id, coalesce(nullif(s.full_name, ''), s.name, '') as name, s.email,
            s.public_tier, s.level, s.seats, s.status, to_char(s.term_end, 'YYYY-MM-DD') as term_end,
            a.last_login, a.last_visit,
            (select max(p.viewed_at) from paid p where p.subscriber_id = s.id) as last_viewed,
            (select count(distinct x.papermark_view_id)::int from scoped x where x.subscriber_id = s.id) as sessions,
            (select count(distinct coalesce(x.papermark_document_id, x.pub_id::text))::int from scoped x where x.subscriber_id = s.id) as editions
     from subscribers s
     left join auth a on a.subscriber_id = s.id
     where s.client_type = 'subscriber'
       and ($4::text is null or s.email ilike $4::text or coalesce(s.full_name, s.name, '') ilike $4::text)
       and ($5::text = '' or s.public_tier = $5::text)
     order by greatest(coalesce(a.last_visit, 'epoch'), coalesce(a.last_login, 'epoch'),
                       coalesce((select max(p.viewed_at) from paid p where p.subscriber_id = s.id), 'epoch')) desc,
              lower(coalesce(nullif(s.full_name, ''), s.name, s.email))
     limit 1000`,
    [filters.range?.fromIso ?? null, filters.range?.toIso ?? null, filters.series, pattern, filters.level],
  )) as Record<string, unknown>[]

  const admins = await adminEmails(sql)
  const today = lagosToday()
  return rows
    .map((r) => {
      const status = accessStatus(String(r.status ?? ''), r.term_end as string | null, today)
      const tier = String(r.public_tier ?? '')
      return {
        id: String(r.id),
        name: String(r.name ?? ''),
        email: String(r.email ?? ''),
        level: tier ? tierDisplayName(tier) : isLevel(r.level) ? levelLabel(r.level, Number(r.seats ?? 1)) : '—',
        status,
        isAdministrator: admins.has(String(r.email ?? '').toLowerCase()),
        lastLoginAt: iso(r.last_login),
        lastPortalVisitAt: iso(r.last_visit),
        lastViewedAt: iso(r.last_viewed),
        sessions: Number(r.sessions ?? 0),
        editions: Number(r.editions ?? 0),
      }
    })
    .filter((r) => !filters.status || r.status.key === filters.status)
}

export type SubscriberMonitorDetail = {
  subscriber: Omit<SubscriberReaderRow, 'sessions' | 'editions'> & { termEnd: string | null }
  editions: EditionActivity[]
  /** Sessions that could not be tied to any document (kept, not guessed). */
  unidentifiedSessions: number
}

/** One subscriber's publication activity: one row per exact edition and version. */
export async function getSubscriberMonitorDetail(
  subscriberId: string,
  options: { range: DateRange | null; series: string },
): Promise<SubscriberMonitorDetail | null> {
  if (!UUID.test(subscriberId)) return null
  const sql = getSql()
  const [sub] = (await sql`
    select s.id, coalesce(nullif(s.full_name, ''), s.name, '') as name, s.email, s.public_tier, s.level, s.seats,
           s.status, to_char(s.term_end, 'YYYY-MM-DD') as term_end,
           (select max(occurred_at) from client_engagement_events
             where subscriber_id = s.id and event_type = 'signin_completed') as last_login,
           (select max(occurred_at) from client_engagement_events
             where subscriber_id = s.id and event_type = 'portal_opened') as last_visit
    from subscribers s
    where s.id = ${subscriberId}::uuid and s.client_type = 'subscriber'
    limit 1
  `) as Record<string, unknown>[]
  if (!sub) return null

  const views = (await sql.query(
    `with paid as (${PAID_SESSIONS})
     select p.id, p.papermark_view_id, p.papermark_document_id, p.pub_id, p.viewed_at, p.duration_seconds,
            coalesce(p.downloaded, false) as downloaded, p.attribution_method, p.synced_title,
            nullif(to_jsonb(p) ->> 'document_version_number', '')::int as version_number,
            nullif(to_jsonb(p) ->> 'total_pages', '')::int as total_pages,
            d.title as doc_title, d.series, to_char(d.edition_date, 'YYYY-MM-DD') as edition_date,
            coalesce((to_jsonb(d) ->> 'portal_title_override')::boolean, false) as title_override,
            (select cd.title from papermark_client_documents cd
              where cd.papermark_document_id = p.papermark_document_id and cd.subscriber_id = p.subscriber_id
              limit 1) as folder_title
     from paid p
     left join documents d on d.id = p.pub_id
     where p.subscriber_id = $1::uuid
       and ($2::timestamptz is null or p.viewed_at >= $2::timestamptz)
       and ($3::timestamptz is null or p.viewed_at <  $3::timestamptz)
       and ($4::text = '' or upper(coalesce(d.series, '')) = upper($4::text))
     order by p.viewed_at desc
     limit 5000`,
    [subscriberId, options.range?.fromIso ?? null, options.range?.toIso ?? null, options.series],
  )) as Record<string, unknown>[]

  const downloads = (await sql.query(
    `select source_event_id, papermark_view_id, papermark_document_id, publication_id, downloaded_at
     from document_download_events
     where subscriber_id = $1::uuid and reader_type <> 'complimentary_review'
       and ($2::timestamptz is null or downloaded_at >= $2::timestamptz)
       and ($3::timestamptz is null or downloaded_at <  $3::timestamptz)`,
    [subscriberId, options.range?.fromIso ?? null, options.range?.toIso ?? null],
  )) as Record<string, unknown>[]

  const pages = await pagesFor(sql, views.map((v) => String(v.id)))
  let unidentified = 0
  const sessions: SessionInput[] = []
  for (const v of views) {
    const editionKey = v.papermark_document_id ? `pm:${v.papermark_document_id}` : v.pub_id ? `pub:${v.pub_id}` : null
    if (!editionKey) {
      unidentified++
      continue
    }
    const editorial = v.doc_title ? String(v.doc_title) : ''
    const title = v.synced_title
      ? portalDocumentTitle({ syncedName: String(v.synced_title), editorialTitle: editorial, editorialTitleIsOverride: v.title_override === true })
      : editorial || (v.folder_title ? String(v.folder_title) : 'Untitled document')
    sessions.push({
      viewId: String(v.id),
      papermarkViewId: String(v.papermark_view_id),
      editionKey,
      title,
      editionLabel: [v.series ? String(v.series) : '', dayLabel(v.edition_date)].filter(Boolean).join(' · '),
      versionNumber: v.version_number === null || v.version_number === undefined ? null : Number(v.version_number),
      viewedAt: iso(v.viewed_at)!,
      durationSeconds: v.duration_seconds === null || v.duration_seconds === undefined ? null : Number(v.duration_seconds),
      totalPages: v.total_pages === null || v.total_pages === undefined ? null : Number(v.total_pages),
      pages: pages.get(String(v.id)) ?? [],
      downloaded: v.downloaded === true,
      accessRoute: accessRouteLabel(v.attribution_method as string | null),
    })
  }
  const downloadInputs: DownloadInput[] = downloads
    .map((d) => ({
      sourceEventId: String(d.source_event_id),
      papermarkViewId: d.papermark_view_id ? String(d.papermark_view_id) : null,
      editionKey: d.papermark_document_id ? `pm:${d.papermark_document_id}` : d.publication_id ? `pub:${d.publication_id}` : '',
      downloadedAt: iso(d.downloaded_at)!,
    }))
    .filter((d) => d.editionKey)

  const admins = await adminEmails(sql)
  const tier = String(sub.public_tier ?? '')
  return {
    subscriber: {
      id: String(sub.id),
      name: String(sub.name ?? ''),
      email: String(sub.email ?? ''),
      level: tier ? tierDisplayName(tier) : isLevel(sub.level) ? levelLabel(sub.level, Number(sub.seats ?? 1)) : '—',
      status: accessStatus(String(sub.status ?? ''), sub.term_end as string | null, lagosToday()),
      isAdministrator: admins.has(String(sub.email ?? '').toLowerCase()),
      lastLoginAt: iso(sub.last_login),
      lastPortalVisitAt: iso(sub.last_visit),
      lastViewedAt: sessions[0]?.viewedAt ?? null,
      termEnd: sub.term_end ? String(sub.term_end instanceof Date ? sub.term_end.toISOString().slice(0, 10) : sub.term_end).slice(0, 10) : null,
    },
    editions: editionActivity(sessions, downloadInputs),
    unidentifiedSessions: unidentified,
  }
}

// ---------------------------------------------------------------------------
// Weekly digest -- the same definitions as the monitor
// ---------------------------------------------------------------------------

export type DigestPerson = {
  name: string
  email: string
  level: string
  lastLoginAt: string | null
  lastViewedAt: string | null
  termEnd: string | null
}

export type DigestData = {
  /** Active, inside their term, and no confirmed session in the last 30 days. */
  notReading: DigestPerson[]
  /** Active, and the term ends within 30 days (today included). */
  termEnding: DigestPerson[]
  /** Views in the last 7 days that no rule could attribute (kept, not guessed). */
  unmatchedLastWeek: number
  /** Complimentary Review sessions and distinct readers in the last 7 days. */
  review: { sessions: number; readers: number }
}

export async function getDigestData(): Promise<DigestData> {
  const sql = getSql()
  const today = lagosToday()
  const rows = (await sql.query(
    `with paid as (${PAID_SESSIONS})
     select coalesce(nullif(s.full_name, ''), s.name, '') as name, s.email, s.public_tier, s.level, s.seats,
            to_char(s.term_end, 'YYYY-MM-DD') as term_end,
            (select max(occurred_at) from client_engagement_events e
              where e.subscriber_id = s.id and e.event_type = 'signin_completed') as last_login,
            (select max(p.viewed_at) from paid p where p.subscriber_id = s.id) as last_viewed,
            exists (select 1 from paid p where p.subscriber_id = s.id and p.viewed_at >= now() - interval '30 days') as read_recently
     from subscribers s
     where s.client_type = 'subscriber' and lower(s.status) = 'active'
       and (s.term_end is null or s.term_end >= $1::date)
     order by lower(coalesce(nullif(s.full_name, ''), s.name, s.email))`,
    [today],
  )) as Record<string, unknown>[]

  const person = (r: Record<string, unknown>): DigestPerson => {
    const tier = String(r.public_tier ?? '')
    return {
      name: String(r.name ?? ''),
      email: String(r.email ?? ''),
      level: tier ? tierDisplayName(tier) : isLevel(r.level) ? levelLabel(r.level, Number(r.seats ?? 1)) : '—',
      lastLoginAt: iso(r.last_login),
      lastViewedAt: iso(r.last_viewed),
      termEnd: r.term_end ? String(r.term_end instanceof Date ? r.term_end.toISOString().slice(0, 10) : r.term_end).slice(0, 10) : null,
    }
  }
  const in30 = new Date(`${today}T00:00:00Z`)
  in30.setUTCDate(in30.getUTCDate() + 30)
  const horizon = in30.toISOString().slice(0, 10)

  const [counts] = (await sql`
    select
      (select count(*)::int from document_views v
        where v.subscriber_id is null and v.briefing_request_id is null
          and (v.reader_type is null or v.reader_type = 'unknown')
          and v.viewed_at >= now() - interval '7 days') as unmatched,
      (select count(distinct v.papermark_view_id)::int from document_views v
        where v.reader_type = 'complimentary_review' and v.viewed_at >= now() - interval '7 days') as review_sessions,
      (select count(distinct lower(v.viewer_email))::int from document_views v
        where v.reader_type = 'complimentary_review' and v.viewer_email is not null
          and v.viewed_at >= now() - interval '7 days') as review_readers
  `) as { unmatched: number; review_sessions: number; review_readers: number }[]

  return {
    notReading: rows.filter((r) => r.read_recently !== true).map(person),
    termEnding: rows.map(person).filter((p) => p.termEnd !== null && p.termEnd >= today && p.termEnd <= horizon),
    unmatchedLastWeek: counts?.unmatched ?? 0,
    review: { sessions: counts?.review_sessions ?? 0, readers: counts?.review_readers ?? 0 },
  }
}

// ---------------------------------------------------------------------------
// Complimentary Review
// ---------------------------------------------------------------------------

export type ReviewAssignment = {
  editionKey: string
  title: string
  editionLabel: string
  /** active: currently approved; removed: approval withdrawn (kept as history). */
  state: 'active' | 'removed'
  via: 'edition' | 'shared_list'
  editionState: string
  grantedAt: string | null
  removedAt: string | null
}

export type ReviewReaderRow = {
  key: string
  email: string
  /** A real name where the reader requested review access; else null (email is shown). */
  name: string | null
  verified: boolean
  isAdministrator: boolean
  assignments: ReviewAssignment[]
  editions: EditionActivity[]
  lastViewedAt: string | null
  sessions: number
}

type EditionMeta = {
  id: string
  series: string | null
  title: string
  label: string
  state: string
  recipientMode: string
  documentId: string
  secureLinkId: string | null
  oldLinkId: string | null
  numPages: number | null
}

function reviewTitle(e: Pick<EditionMeta, 'title' | 'label'>): string {
  return [e.title, e.label].filter(Boolean).join(' — ') || 'Untitled edition'
}

/**
 * Every review reader: approved recipients (current and removed, per edition
 * and on the shared list), verified prospects, and anyone Papermark recorded
 * on a review link -- including readers with no recorded views. Keyed by the
 * normalised email; a name is used only where the person gave one in a review
 * request. Review access is by the Papermark link itself (Papermark verifies
 * the email), so no APRI login is shown for it.
 */
export async function listReviewReaders(filters: MonitorFilters): Promise<ReviewReaderRow[]> {
  const sql = getSql()
  const withdrawal = await editionWithdrawalReady(sql)
  const recipientsReady = await editionRecipientsReady(sql)

  const editionRows = (await sql`
    select e.id, e.series, e.title, coalesce(to_jsonb(e) ->> 'edition_label', '') as label,
           e.publication_state, coalesce(to_jsonb(e) ->> 'recipient_mode', 'edition') as recipient_mode,
           e.papermark_document_id, e.secure_link_id,
           case when ${withdrawal}::boolean then to_jsonb(e) ->> 'withdrawal_link_id' end as old_link_id,
           nullif(to_jsonb(e) ->> 'num_pages', '')::int as num_pages
    from review_publication_editions e
    where e.publication_state <> 'ignored'
  `) as Record<string, unknown>[]
  const editions: EditionMeta[] = editionRows.map((e) => ({
    id: String(e.id),
    series: e.series ? String(e.series) : null,
    title: String(e.title ?? ''),
    label: String(e.label ?? ''),
    state: String(e.publication_state ?? ''),
    recipientMode: String(e.recipient_mode ?? 'edition'),
    documentId: String(e.papermark_document_id ?? ''),
    secureLinkId: e.secure_link_id ? String(e.secure_link_id) : null,
    oldLinkId: e.old_link_id ? String(e.old_link_id) : null,
    numPages: e.num_pages === null || e.num_pages === undefined ? null : Number(e.num_pages),
  }))
  const byLink = new Map<string, EditionMeta>()
  const byDocument = new Map<string, EditionMeta>()
  for (const e of editions) {
    if (e.secureLinkId) byLink.set(e.secureLinkId, e)
    if (e.oldLinkId) byLink.set(e.oldLinkId, e)
    if (e.documentId) byDocument.set(e.documentId, e)
  }
  const seriesMatch = (series: string | null) => !filters.series || (series ?? '').toUpperCase() === filters.series.toUpperCase()

  const legacySlots = (await sql`
    select slot_key, secure_link_id from complimentary_review_items where secure_link_id is not null
  `) as { slot_key: string; secure_link_id: string }[]
  const slotByLink = new Map(legacySlots.map((s) => [s.secure_link_id, s.slot_key]))

  // Approved recipients: per-edition grants, and the shared list for editions
  // still judged by it.
  const assignments = new Map<string, ReviewAssignment[]>()
  const assign = (email: string, a: ReviewAssignment) => {
    const list = assignments.get(email) ?? []
    list.push(a)
    assignments.set(email, list)
  }
  if (recipientsReady) {
    const grants = (await sql`
      select edition_id, email, granted_at, revoked_at from review_edition_recipients
    `) as { edition_id: string; email: string; granted_at: unknown; revoked_at: unknown }[]
    const editionById = new Map(editions.map((e) => [e.id, e]))
    for (const g of grants) {
      const e = editionById.get(String(g.edition_id))
      const email = normaliseEmail(g.email)
      if (!e || !email || !seriesMatch(e.series)) continue
      assign(email, {
        editionKey: `edition:${e.id}`,
        title: reviewTitle(e),
        editionLabel: e.series ?? '',
        state: g.revoked_at ? 'removed' : 'active',
        via: 'edition',
        editionState: e.state,
        grantedAt: iso(g.granted_at),
        removedAt: iso(g.revoked_at),
      })
    }
    const shared = (await readSharedRecipients(sql)).map((e) => normaliseEmail(e)).filter((e): e is string => Boolean(e))
    for (const e of editions) {
      if (e.recipientMode !== 'shared_legacy' || e.state !== 'published' || !seriesMatch(e.series)) continue
      for (const email of shared) {
        assign(email, {
          editionKey: `edition:${e.id}`,
          title: reviewTitle(e),
          editionLabel: e.series ?? '',
          state: 'active',
          via: 'shared_list',
          editionState: e.state,
          grantedAt: null,
          removedAt: null,
        })
      }
    }
  }

  const prospects = (await sql`
    select lower(email) as email, full_name, verified_at from review_prospects
  `) as { email: string; full_name: string | null; verified_at: unknown }[]
  const prospectByEmail = new Map(prospects.map((p) => [p.email, p]))

  const views = (await sql`
    select v.id, v.papermark_view_id, v.papermark_link_id, v.papermark_document_id, lower(v.viewer_email) as email,
           v.viewed_at, v.duration_seconds, coalesce(v.downloaded, false) as downloaded, v.attribution_method,
           nullif(to_jsonb(v) ->> 'document_version_number', '')::int as version_number,
           nullif(to_jsonb(v) ->> 'total_pages', '')::int as total_pages
    from document_views v
    where v.reader_type = 'complimentary_review' and v.viewer_email is not null
      and (${filters.range?.fromIso ?? null}::timestamptz is null or v.viewed_at >= ${filters.range?.fromIso ?? null}::timestamptz)
      and (${filters.range?.toIso ?? null}::timestamptz is null or v.viewed_at <  ${filters.range?.toIso ?? null}::timestamptz)
    order by v.viewed_at desc
    limit 20000
  `) as Record<string, unknown>[]
  const downloads = (await sql`
    select source_event_id, papermark_view_id, papermark_link_id, papermark_document_id, lower(viewer_email) as email, downloaded_at
    from document_download_events
    where reader_type = 'complimentary_review' and viewer_email is not null
      and (${filters.range?.fromIso ?? null}::timestamptz is null or downloaded_at >= ${filters.range?.fromIso ?? null}::timestamptz)
      and (${filters.range?.toIso ?? null}::timestamptz is null or downloaded_at <  ${filters.range?.toIso ?? null}::timestamptz)
  `) as Record<string, unknown>[]

  const pages = await pagesFor(sql, views.map((v) => String(v.id)))
  const editionFor = (linkId: unknown, documentId: unknown): { key: string; title: string; label: string; series: string | null; pages: number | null } => {
    // By its link first (the link is what was opened); by the Papermark file
    // only for a session already classified as a review read.
    const e: EditionMeta | null =
      (linkId ? byLink.get(String(linkId)) : undefined) ?? (documentId ? byDocument.get(String(documentId)) : undefined) ?? null
    if (e) return { key: `edition:${e.id}`, title: `${reviewTitle(e)}${e.state === 'withdrawn' ? ' (withdrawn)' : ''}`, label: e.series ?? '', series: e.series, pages: e.numPages }
    const slot = linkId ? slotByLink.get(String(linkId)) : undefined
    if (slot) return { key: `slot:${slot}`, title: `Retired review link (${slot})`, label: slot, series: slot, pages: null }
    return { key: `pm:${documentId ?? linkId ?? 'unknown'}`, title: 'Review document (edition not identified)', label: '', series: null, pages: null }
  }

  const sessionsByEmail = new Map<string, SessionInput[]>()
  for (const v of views) {
    const email = normaliseEmail(String(v.email ?? ''))
    if (!email) continue
    const ed = editionFor(v.papermark_link_id, v.papermark_document_id)
    if (!seriesMatch(ed.series)) continue
    const list = sessionsByEmail.get(email) ?? []
    list.push({
      viewId: String(v.id),
      papermarkViewId: String(v.papermark_view_id),
      editionKey: ed.key,
      title: ed.title,
      editionLabel: ed.label,
      versionNumber: v.version_number === null || v.version_number === undefined ? null : Number(v.version_number),
      viewedAt: iso(v.viewed_at)!,
      durationSeconds: v.duration_seconds === null || v.duration_seconds === undefined ? null : Number(v.duration_seconds),
      totalPages: v.total_pages === null || v.total_pages === undefined ? null : Number(v.total_pages),
      pages: pages.get(String(v.id)) ?? [],
      downloaded: v.downloaded === true,
      accessRoute: accessRouteLabel(v.attribution_method as string | null),
    })
    sessionsByEmail.set(email, list)
  }
  const downloadsByEmail = new Map<string, DownloadInput[]>()
  for (const d of downloads) {
    const email = normaliseEmail(String(d.email ?? ''))
    if (!email) continue
    const ed = editionFor(d.papermark_link_id, d.papermark_document_id)
    const list = downloadsByEmail.get(email) ?? []
    list.push({
      sourceEventId: String(d.source_event_id),
      papermarkViewId: d.papermark_view_id ? String(d.papermark_view_id) : null,
      editionKey: ed.key,
      downloadedAt: iso(d.downloaded_at)!,
    })
    downloadsByEmail.set(email, list)
  }

  const emails = new Set<string>([
    ...assignments.keys(),
    ...sessionsByEmail.keys(),
    ...prospects.filter((p) => p.verified_at).map((p) => p.email),
  ])
  const admins = await adminEmails(sql)
  const pattern = filters.q.trim().toLowerCase()

  const rows: ReviewReaderRow[] = []
  for (const email of emails) {
    const prospect = prospectByEmail.get(email)
    const name = prospect?.full_name?.trim() || null
    if (pattern && !email.includes(pattern) && !(name ?? '').toLowerCase().includes(pattern)) continue
    const sessions = sessionsByEmail.get(email) ?? []
    const activity = editionActivity(sessions, downloadsByEmail.get(email) ?? [])
    const assigned = assignments.get(email) ?? []
    // With a series or period filter, a reader with nothing matching is left out.
    if ((filters.series || filters.range) && sessions.length === 0 && assigned.length === 0) continue
    rows.push({
      key: email,
      email,
      name,
      verified: Boolean(prospect?.verified_at),
      isAdministrator: admins.has(email),
      assignments: assigned,
      editions: activity,
      lastViewedAt: sessions.map((s) => s.viewedAt).sort().at(-1) ?? null,
      sessions: new Set(sessions.map((s) => s.papermarkViewId)).size,
    })
  }
  return rows.sort(
    (a, b) =>
      (b.lastViewedAt ? Date.parse(b.lastViewedAt) : 0) - (a.lastViewedAt ? Date.parse(a.lastViewedAt) : 0) ||
      (a.name ?? a.email).localeCompare(b.name ?? b.email),
  )
}
