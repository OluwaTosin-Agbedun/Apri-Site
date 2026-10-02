import 'server-only'
import { getSql } from './db'
import {
  isPapermarkConfigured,
  listViewsForLink,
  getViewAnalytics,
} from './papermark'
import { enrichViewPages } from './page-progress-collector'
import { pageProgressReady } from './page-progress-schema'
import { parseViewAnalytics } from './page-progress'
import { editionWithdrawalReady } from './edition-recipients-schema'
import { orderFromCursor } from './engagement-metrics'
import { recordView, recordDownload, refreshLastViewed } from './view-attribution'
import { enrichmentCoverage, type Maybe } from './engagement-metrics'

/**
 * The Papermark collection safety net, in one place.
 *
 * Used by both the cron route and the owner's "Sync Papermark analytics now"
 * button, so a manual run and a scheduled run cannot behave differently. That
 * matters because the manual run is what the owner uses to check whether the
 * scheduled one is working.
 *
 * Everything is written through `recordView` / `recordDownload`, which conflict
 * on Papermark's own ids, so running this twice — or running it over data the
 * webhook already delivered — changes nothing.
 */

/** Vercel's ceiling for the cron invocation. The budget is ours, not theirs. */
export const MAX_DURATION_SECONDS = 60

/** Leave headroom so a run ends by reporting rather than being killed. */
const TIME_BUDGET_MS = (MAX_DURATION_SECONDS - 12) * 1000

/** How many views get a second call for duration/page data per run. */
const ENRICH_LIMIT = 100

/**
 * Views seen more recently than this are always re-read, so a late download or
 * a late attribution is picked up. Older views are still read -- every view on
 * a known link is ingested once -- but one already stored and attributed is
 * not rewritten on every run.
 */
const REFRESH_DAYS = 14

/** Pages of 100 views read per link: enough for every view on any APRI link. */
const VIEW_PAGES_PER_LINK = 20

/** Where the next run resumes, so a run cut short by its budget never starves the same links. */
const CURSOR_KEY = 'papermark_poll_cursor'

export type CollectionSummary = {
  ok: boolean
  skipped?: string
  /** Links polled in this run. */
  linksChecked: number
  /** Links APRI has on file. */
  linksKnown: number
  /** Every known link was polled in this run (otherwise the next run resumes). */
  allLinksCovered: boolean
  viewsFound: number
  newViews: number
  downloadsRecorded: number
  unmatched: number
  attributed: number
  enriched: number
  enrichmentCoveragePct: Maybe<number>
  failures: number
  /** Link ids on stored views that match none of APRI's link records. */
  unknownLinkIds: number
  /** Papermark's analytics rate limit stopped enrichment early; it resumes next run. */
  analyticsRateLimited?: boolean
  /** Papermark refused analytics (scope or plan), with its reason. */
  analyticsNotPermitted?: string
  elapsedMs: number
  errors: string[]
}

/**
 * Every Papermark link id APRI has on file -- for the subscriber portal and the
 * Complimentary Review alike.
 *
 * Subscriber portal: personal document links, Data Room links, per-publication
 * access links, legacy client-folder links and the legacy link on the
 * subscriber record. Complimentary Review: each edition's current link and,
 * once withdrawals exist, the link an edition had before it was withdrawn (its
 * earlier views still count), plus the retired fixed-slot links for history.
 *
 * Before this, the review editions and the client-folder links were missing,
 * so their views were never polled at all.
 */
export async function knownLinkIds(): Promise<Set<string>> {
  const sql = getSql()

  const editions = (await sql`
    select secure_link_id as id from review_publication_editions
    where secure_link_id is not null and secure_link_id <> ''
  `) as { id: string }[]
  const withdrawn = (await editionWithdrawalReady(sql))
    ? ((await sql`
        select withdrawal_link_id as id from review_publication_editions
        where withdrawal_link_id is not null and withdrawal_link_id <> ''
      `) as { id: string }[])
    : []

  const rows = (await sql`
    select papermark_link_id as id
      from papermark_subscriber_document_links
      where papermark_link_id is not null and papermark_link_id <> ''
    union
    select papermark_link_id as id
      from papermark_dataroom_links
      where papermark_link_id is not null and papermark_link_id <> ''
    union
    select secure_link_id as id
      from complimentary_review_items
      where secure_link_id is not null and secure_link_id <> ''
    union
    select papermark_link_id as id
      from publication_access
      where papermark_link_id is not null and papermark_link_id <> ''
    union
    -- Still-supported legacy field on the subscriber record.
    select papermark_link_id as id
      from subscribers
      where papermark_link_id is not null and papermark_link_id <> ''
    union
    -- Legacy client-folder documents served by the older portal.
    select papermark_link_id as id
      from papermark_client_documents
      where papermark_link_id is not null and papermark_link_id <> ''
  `) as { id: string }[]

  // Personal reader rooms (20261009), when present.
  let rooms: { id: string }[] = []
  try {
    rooms = (await sql`
      select papermark_link_id as id from review_reader_rooms
      where papermark_link_id is not null and papermark_link_id <> ''
    `) as { id: string }[]
  } catch {
    rooms = []
  }

  return new Set([...rows, ...editions, ...withdrawn, ...rooms].map((r) => r.id).filter(Boolean))
}

/**
 * Runs one collection pass.
 *
 * The single most important line in this function is the filter on `known`:
 * when APRI has no link ids on file the poll checks **zero** links. The
 * previous behaviour — `known.size === 0 || known.has(id)` — fell back to
 * polling every link in the Papermark account, which pulled in views for
 * documents belonging to other work and attributed them to nobody. A poll that
 * finds nothing is the correct outcome of having nothing to look for.
 */
export async function collectPapermarkAnalytics(options: {
  now?: Date
  enrichLimit?: number
  /** A shorter budget, for a caller that has other work in the same invocation. */
  timeBudgetMs?: number
} = {}): Promise<CollectionSummary> {
  const budgetMs = Math.min(options.timeBudgetMs ?? TIME_BUDGET_MS, TIME_BUDGET_MS)
  const startedAt = Date.now()
  const errors: string[] = []

  const empty: CollectionSummary = {
    ok: true,
    linksChecked: 0,
    linksKnown: 0,
    allLinksCovered: false,
    viewsFound: 0,
    newViews: 0,
    downloadsRecorded: 0,
    unmatched: 0,
    attributed: 0,
    enriched: 0,
    enrichmentCoveragePct: null,
    failures: 0,
    unknownLinkIds: 0,
    elapsedMs: 0,
    errors,
  }

  if (!isPapermarkConfigured()) {
    return { ...empty, skipped: 'papermark-not-configured', elapsedMs: Date.now() - startedAt }
  }

  const known = await knownLinkIds()

  // Nothing on file means nothing to poll. Never every link in the account.
  if (known.size === 0) {
    await recordRun({ ...empty, skipped: 'no-known-links' })
    return { ...empty, skipped: 'no-known-links', elapsedMs: Date.now() - startedAt }
  }

  // Every known link is polled directly -- never a page of the account's links
  // filtered afterwards, which capped the poll at the first 2000 links and
  // silently dropped the rest. The order rotates from where the last run
  // stopped, so a run cut short by its budget resumes with the links it did
  // not reach instead of starting from the same place every day.
  const cursor = await readCursor()
  const candidates = orderFromCursor([...known], cursor)

  const refreshSince = (options.now ?? new Date()).getTime() - REFRESH_DAYS * 86_400_000
  const enrichLimit = options.enrichLimit ?? ENRICH_LIMIT

  let viewsFound = 0
  let newViews = 0
  let attributed = 0
  let unmatched = 0
  let downloadsRecorded = 0
  let enriched = 0
  let failures = 0
  const touched = new Set<string>()
  const progressReady = await pageProgressReady(getSql())
  let linksPolled = 0
  let lastPolled: string | null = null

  for (const linkId of candidates) {
    if (Date.now() - startedAt > budgetMs) break

    let views
    try {
      views = await listViewsForLink(linkId, VIEW_PAGES_PER_LINK)
    } catch {
      // Counted, never described: a Papermark error message can quote the
      // request, which carries the bearer token.
      failures++
      linksPolled++
      lastPolled = linkId
      continue // One bad link must not end the run.
    }
    linksPolled++
    lastPolled = linkId

    // What is already stored for this link, so an old view that is stored and
    // attributed is not rewritten on every run -- while one never stored,
    // still unattributed, or downloaded since it was stored is ingested
    // whatever its age.
    const settled = await settledViewIds(linkId)

    for (const view of views) {
      if (!view?.id) continue

      const viewedAtMs = view.viewed_at ? Date.parse(view.viewed_at) : NaN
      const recent = !Number.isFinite(viewedAtMs) || viewedAtMs >= refreshSince
      const known = settled.get(view.id)
      if (!recent && known && (known.downloaded || !view.downloaded_at) && known.viewType) continue

      viewsFound++

      try {
        const { created, attribution } = await recordView({
          papermarkViewId: view.id,
          papermarkLinkId: view.link_id ?? linkId,
          papermarkDocumentId: view.document_id ?? null,
          viewerEmail: view.viewer_email ?? null,
          viewedAt: view.viewed_at ?? null,
          // Enrichment is a separate, resumable pass. Nulls here stay null
          // rather than being written as zero.
          durationSeconds: null,
          completionPct: null,
          downloaded: Boolean(view.downloaded_at),
          source: 'poll',
        })

        if (created) newViews++
        // What kind of view it was: opening a Data Room is not reading a
        // document, and is never counted as a reading session.
        if (progressReady && view.view_type) {
          await getSql()`
            update document_views set view_type = ${String(view.view_type).slice(0, 40)}
            where papermark_view_id = ${view.id} and view_type is distinct from ${String(view.view_type).slice(0, 40)}
          `
        }
        if (attribution.subscriberId || attribution.briefingRequestId ||
            attribution.readerType === 'complimentary_review') {
          attributed++
          if (attribution.subscriberId) touched.add(attribution.subscriberId)
        } else {
          unmatched++
        }

        // Backfill a download the webhook missed. Keyed on the view id so the
        // same download delivered by webhook and poll is one row.
        if (view.downloaded_at) {
          const { created: dlCreated } = await recordDownload({
            sourceEventId: `view:${view.id}`,
            papermarkViewId: view.id,
            papermarkLinkId: view.link_id ?? linkId,
            papermarkDocumentId: view.document_id ?? null,
            viewerEmail: view.viewer_email ?? null,
            downloadedAt: view.downloaded_at,
            collectionSource: 'poll',
            attribution,
          })
          if (dlCreated) downloadsRecorded++
        }
      } catch {
        failures++
      }
    }
  }

  const allLinksCovered = linksPolled === candidates.length
  await writeCursor(allLinksCovered ? null : lastPolled)

  // Enrichment runs after ingestion, over whatever is still unenriched, so an
  // interrupted run resumes instead of restarting. `last_enriched_at` is the
  // resume marker: null means never attempted.
  let rateLimited = false
  let notPermitted: string | null = null
  if (Date.now() - startedAt < budgetMs) {
    if (progressReady) {
      const result = await enrichViewPages({ limit: enrichLimit, startedAt, budgetMs })
      enriched = result.enriched
      rateLimited = result.rateLimited
      notPermitted = result.notPermitted
    } else {
      enriched = await enrichPendingViews(enrichLimit, startedAt, budgetMs)
    }
  }

  for (const subscriberId of touched) {
    try {
      await refreshLastViewed(subscriberId)
    } catch {
      // Derived field; not worth failing the run.
    }
  }

  const coverage = await getEnrichmentCoverage()

  const summary: CollectionSummary = {
    ok: true,
    // The links actually polled in this run, not the number on file.
    linksChecked: linksPolled,
    linksKnown: candidates.length,
    allLinksCovered,
    viewsFound,
    newViews,
    downloadsRecorded,
    unmatched,
    attributed,
    enriched,
    enrichmentCoveragePct: coverage,
    ...(rateLimited ? { analyticsRateLimited: true } : {}),
    ...(notPermitted ? { analyticsNotPermitted: notPermitted } : {}),
    failures,
    unknownLinkIds: await countUnknownViewLinks(),
    elapsedMs: Date.now() - startedAt,
    errors,
  }

  await recordRun(summary)
  return summary
}

/**
 * Views on this link already stored with an attribution, with whether a
 * download and the view type are on record: a view re-read with nothing new
 * to add is skipped, one downloaded since is not.
 */
async function settledViewIds(linkId: string): Promise<Map<string, { downloaded: boolean; viewType: boolean }>> {
  try {
    const sql = getSql()
    const ready = await pageProgressReady(sql)
    const rows = (await sql`
      select papermark_view_id, coalesce(downloaded, false) as downloaded,
             case when ${ready}::boolean then (to_jsonb(document_views) ->> 'view_type') is not null else true end as has_type
      from document_views
      where papermark_link_id = ${linkId}
        and reader_type is not null and reader_type <> 'unknown'
    `) as { papermark_view_id: string; downloaded: boolean; has_type: boolean }[]
    return new Map(rows.map((r) => [r.papermark_view_id, { downloaded: r.downloaded === true, viewType: r.has_type === true }]))
  } catch {
    return new Map()
  }
}

/** Link ids on stored views that match none of APRI's link records. */
async function countUnknownViewLinks(): Promise<number> {
  try {
    const known = await knownLinkIds()
    const sql = getSql()
    const rows = (await sql`
      select distinct papermark_link_id as id from document_views where papermark_link_id is not null
    `) as { id: string }[]
    return rows.filter((r) => !known.has(r.id)).length
  } catch {
    return 0
  }
}

async function readCursor(): Promise<string | null> {
  try {
    const sql = getSql()
    const rows = (await sql`select value from app_settings where key = ${CURSOR_KEY} limit 1`) as { value: string }[]
    return rows[0]?.value || null
  } catch {
    return null
  }
}

async function writeCursor(value: string | null): Promise<void> {
  try {
    const sql = getSql()
    await sql`
      insert into app_settings (key, value) values (${CURSOR_KEY}, ${value ?? ''})
      on conflict (key) do update set value = excluded.value
    `
  } catch {
    // The next run starts from the beginning instead; nothing is lost.
  }
}

/**
 * Before the page-progress migration: fetches the recorded duration for views
 * that have none, in a bounded batch, newest first. A view is marked enriched
 * only when Papermark answered -- a failed or rate-limited call leaves it for
 * the next run -- and a rate limit ends the batch.
 */
async function enrichPendingViews(limit: number, startedAt: number, budgetMs: number): Promise<number> {
  const sql = getSql()

  const pending = (await sql`
    select papermark_view_id
    from document_views
    where last_enriched_at is null
      and papermark_view_id is not null
    order by viewed_at desc
    limit ${limit}
  `) as { papermark_view_id: string }[]

  let done = 0

  for (const row of pending) {
    if (Date.now() - startedAt > budgetMs) break

    const read = await getViewAnalytics(row.papermark_view_id)
    if (!read.ok) {
      if (read.kind === 'rate_limited' || read.kind === 'not_permitted') break
      if (read.kind === 'failed') continue
    }
    const parsed = read.ok ? parseViewAnalytics(read.data) : null
    const duration =
      parsed?.ok && parsed.totalDurationSeconds !== null ? Math.round(parsed.totalDurationSeconds) : null

    try {
      // Completion is not set here: it needs the version's page total, which
      // only the page-progress collection establishes. Missing stays null.
      await sql`
        update document_views set
          duration_seconds = coalesce(${duration}, duration_seconds),
          last_enriched_at = now()
        where papermark_view_id = ${row.papermark_view_id}
      `
      done++
    } catch {
      // Leave last_enriched_at null so the next run retries this one.
    }
  }

  return done
}

/** The share of views that carry duration data, for the diagnostics panel. */
export async function getEnrichmentCoverage(): Promise<Maybe<number>> {
  try {
    const sql = getSql()
    const rows = (await sql`
      select count(*)::int as total,
             count(duration_seconds)::int as with_duration
      from document_views
    `) as { total: number; with_duration: number }[]

    const row = rows[0]
    if (!row) return null
    return enrichmentCoverage(row.total, row.with_duration)
  } catch {
    return null
  }
}

/** Leaves a trace of the last run, so a silent cron is visible in the admin. */
async function recordRun(summary: Partial<CollectionSummary> & { skipped?: string }): Promise<void> {
  try {
    const sql = getSql()
    const value = JSON.stringify({
      at: new Date().toISOString(),
      linksChecked: summary.linksChecked ?? 0,
      linksKnown: summary.linksKnown ?? 0,
      allLinksCovered: summary.allLinksCovered ?? false,
      viewsFound: summary.viewsFound ?? 0,
      newViews: summary.newViews ?? 0,
      downloadsRecorded: summary.downloadsRecorded ?? 0,
      unmatched: summary.unmatched ?? 0,
      failures: summary.failures ?? 0,
      unknownLinkIds: summary.unknownLinkIds ?? 0,
      ...(summary.skipped ? { skipped: summary.skipped } : {}),
    })
    await sql`
      insert into app_settings (key, value)
      values ('papermark_last_poll', ${value})
      on conflict (key) do update set value = excluded.value
    `
  } catch {
    // Diagnostics only.
  }
}

function pickNumber(
  source: Record<string, unknown> | null | undefined,
  keys: string[],
): number | null {
  if (!source) return null
  for (const k of keys) {
    const v = source[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return null
}
