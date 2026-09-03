import 'server-only'
import { getSql } from './db'
import {
  isPapermarkConfigured,
  listLinks,
  listViewsForLink,
  getViewDetail,
} from './papermark'
import { recordView, recordDownload, refreshLastViewed } from './view-attribution'
import { completionFromPages, enrichmentCoverage, type Maybe } from './engagement-metrics'

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
const ENRICH_LIMIT = 25

/** Views older than this are ignored: this is a catch-up, not a backfill. */
const LOOKBACK_DAYS = 14

export type CollectionSummary = {
  ok: boolean
  skipped?: string
  linksChecked: number
  viewsFound: number
  newViews: number
  downloadsRecorded: number
  unmatched: number
  attributed: number
  enriched: number
  enrichmentCoveragePct: Maybe<number>
  failures: number
  /** Link ids Papermark returned that APRI has no record of. */
  unknownLinkIds: number
  elapsedMs: number
  errors: string[]
}

/**
 * Every Papermark link id APRI has on file.
 *
 * All five sources are consulted. Before Phase 6 this read only two of them,
 * so views arriving on a per-document link, a Data Room link or a
 * Complimentary Review link were polled only by accident — via the fallback
 * below, which was worse than the gap it covered.
 */
export async function knownLinkIds(): Promise<Set<string>> {
  const sql = getSql()

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
  `) as { id: string }[]

  return new Set(rows.map((r) => r.id).filter(Boolean))
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
} = {}): Promise<CollectionSummary> {
  const startedAt = Date.now()
  const errors: string[] = []

  const empty: CollectionSummary = {
    ok: true,
    linksChecked: 0,
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

  let links: Awaited<ReturnType<typeof listLinks>>
  try {
    links = await listLinks()
  } catch {
    // No detail echoed: a Papermark error message can quote the request, which
    // carries the bearer token.
    return {
      ...empty,
      ok: false,
      failures: 1,
      errors: ['Could not list links from Papermark.'],
      elapsedMs: Date.now() - startedAt,
    }
  }

  const allIds = links.map((l) => l.id).filter((id): id is string => Boolean(id))
  const candidates = allIds.filter((id) => known.has(id))
  const unknownLinkIds = allIds.length - candidates.length

  const since = (options.now ?? new Date()).getTime() - LOOKBACK_DAYS * 86_400_000
  const enrichLimit = options.enrichLimit ?? ENRICH_LIMIT

  let viewsFound = 0
  let newViews = 0
  let attributed = 0
  let unmatched = 0
  let downloadsRecorded = 0
  let enriched = 0
  let failures = 0
  const touched = new Set<string>()

  for (const linkId of candidates) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break

    let views
    try {
      views = await listViewsForLink(linkId)
    } catch {
      failures++
      continue // One bad link must not end the run.
    }

    for (const view of views) {
      if (!view?.id) continue

      const viewedAtMs = view.viewed_at ? Date.parse(view.viewed_at) : NaN
      if (Number.isFinite(viewedAtMs) && viewedAtMs < since) continue

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

  // Enrichment runs after ingestion, over whatever is still unenriched, so an
  // interrupted run resumes instead of restarting. `last_enriched_at` is the
  // resume marker: null means never attempted.
  if (Date.now() - startedAt < TIME_BUDGET_MS) {
    enriched = await enrichPendingViews(enrichLimit, startedAt)
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
    linksChecked: candidates.length,
    viewsFound,
    newViews,
    downloadsRecorded,
    unmatched,
    attributed,
    enriched,
    enrichmentCoveragePct: coverage,
    failures,
    unknownLinkIds,
    elapsedMs: Date.now() - startedAt,
    errors,
  }

  await recordRun(summary)
  return summary
}

/**
 * Fetches duration and page data for views that have none, in a bounded batch.
 *
 * Ordered oldest-unenriched first so every view is eventually covered rather
 * than the newest being re-fetched forever. `last_enriched_at` is stamped even
 * when Papermark returns nothing usable, so a view with genuinely no data is
 * not retried on every run — the coverage figure is what shows how much is
 * missing.
 */
async function enrichPendingViews(limit: number, startedAt: number): Promise<number> {
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
    if (Date.now() - startedAt > TIME_BUDGET_MS) break

    let duration: number | null = null
    let completion: Maybe<number> = null

    try {
      const detail = await getViewDetail(row.papermark_view_id)

      if (typeof detail?.total_duration_seconds === 'number' &&
          Number.isFinite(detail.total_duration_seconds) &&
          detail.total_duration_seconds >= 0) {
        duration = Math.round(detail.total_duration_seconds)
      }

      // Completion is computed only when Papermark returned enough page data.
      // A missing page count stays null; it must never become 0%, which would
      // read as "opened and not read".
      const d = detail as Record<string, unknown> | null
      completion = completionFromPages(
        pickNumber(d, ['pages_viewed', 'pagesViewed', 'completed_pages']),
        pickNumber(d, ['num_pages', 'numPages', 'total_pages', 'totalPages']),
      )
    } catch {
      // Stamp it anyway below: a view Papermark cannot describe should not be
      // retried on every future run.
    }

    try {
      await sql`
        update document_views set
          duration_seconds = coalesce(${duration}, duration_seconds),
          completion_pct   = coalesce(${completion}, completion_pct),
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
