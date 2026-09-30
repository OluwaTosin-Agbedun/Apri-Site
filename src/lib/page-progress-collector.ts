import 'server-only'
import { getSql } from './db'
import { getViewAnalytics, listDocumentVersions, type AnalyticsRead } from './papermark'
import { pageProgressReady } from './page-progress-schema'
import {
  parseViewAnalytics,
  versionForView,
  sessionProgress,
  nextEnrichmentAt,
  type DocumentVersion,
  type EnrichmentOutcome,
  type PageEvidence,
} from './page-progress'

type Sql = ReturnType<typeof getSql>

/** Where the last limitation Papermark reported is kept, for Diagnostics. */
export const CAPABILITY_KEY = 'papermark_analytics_capability'

/** A cached version list older than this is read again. */
const VERSION_CACHE_MS = 6 * 60 * 60_000

export type EnrichmentSummary = {
  /** Sessions whose analytics were read and stored in this run. */
  enriched: number
  /** Stopped early because Papermark's rate limit was reached. */
  rateLimited: boolean
  /** Papermark refused analytics (scope or plan); nothing more was attempted. */
  notPermitted: string | null
}

type DueRow = {
  id: string
  papermark_view_id: string
  papermark_document_id: string | null
  viewed_at: string | Date
  enrichment_attempts: number
}

/**
 * Collects page-level evidence for sessions that need it, within the budget:
 * sessions never enriched under this scheme (so historical views are
 * backfilled in turn), and sessions whose refresh is due (recent reading, or
 * a retry after a failure).
 *
 * A session is marked done only when Papermark answered. A rate limit stops
 * the run and schedules the retry for when the limit resets. A permission or
 * plan refusal stops the run and is recorded for Diagnostics, so it is
 * reported rather than silently producing empty figures.
 */
export async function enrichViewPages(args: { limit: number; startedAt: number; budgetMs: number }): Promise<EnrichmentSummary> {
  const sql = getSql()
  const summary: EnrichmentSummary = { enriched: 0, rateLimited: false, notPermitted: null }
  if (!(await pageProgressReady(sql))) return summary

  const due = (await sql`
    select id, papermark_view_id, papermark_document_id, viewed_at, enrichment_attempts
    from document_views
    where papermark_view_id is not null
      and (view_type is null or view_type <> 'DATAROOM_VIEW')
      and (enrichment_state is null or (next_enrichment_at is not null and next_enrichment_at <= now()))
    order by next_enrichment_at nulls first, viewed_at desc
    limit ${args.limit}
  `) as DueRow[]

  const versionsByDocument = new Map<string, AnalyticsRead<DocumentVersion[]>>()

  for (const row of due) {
    if (Date.now() - args.startedAt > args.budgetMs) break

    const read = await getViewAnalytics(row.papermark_view_id)
    if (!read.ok) {
      if (read.kind === 'rate_limited') {
        await settle(sql, row, 'rate_limited', read.message, { retryAfterMs: read.retryAfterMs })
        summary.rateLimited = true
        break
      }
      if (read.kind === 'not_permitted') {
        await settle(sql, row, 'failed', read.message)
        await recordCapability(sql, read.message)
        summary.notPermitted = read.message
        break
      }
      await settle(sql, row, read.kind === 'not_found' ? 'unavailable' : 'failed', read.message)
      continue
    }

    const parsed = parseViewAnalytics(read.data)
    if (!parsed.ok) {
      await settle(sql, row, 'unavailable', parsed.reason)
      continue
    }

    // The page total of the exact version this session was on.
    let version: DocumentVersion | null = null
    let versionNote: string | null = null
    if (row.papermark_document_id) {
      let versions = versionsByDocument.get(row.papermark_document_id)
      if (!versions) {
        versions = await documentVersions(sql, row.papermark_document_id, row.viewed_at)
        versionsByDocument.set(row.papermark_document_id, versions)
      }
      if (versions.ok) {
        version = versionForView(versions.data, row.viewed_at)
        if (!version) versionNote = 'The document version this session was on could not be determined.'
      } else {
        versionNote = versions.message
        if (versions.kind === 'not_permitted') {
          await recordCapability(sql, versions.message)
          summary.notPermitted = versions.message
        }
        if (versions.kind === 'rate_limited') summary.rateLimited = true
      }
    } else {
      versionNote = 'Papermark did not say which document this session was on.'
    }

    await storePages(sql, row.id, parsed.pages)
    const stored = await storedPages(sql, row.id)
    const total = version?.numPages ?? null
    const progress = sessionProgress(stored, total)
    const outcome: EnrichmentOutcome = total ? 'complete' : 'partial'
    const next = nextEnrichmentAt({ outcome, viewedAt: row.viewed_at, attempts: 0, now: Date.now() })

    await sql`
      update document_views set
        duration_seconds = case
          when ${parsed.totalDurationSeconds}::numeric is null then duration_seconds
          else greatest(coalesce(duration_seconds, 0), round(${parsed.totalDurationSeconds}::numeric))
        end,
        document_version_id = coalesce(${version?.versionId ?? null}, document_version_id),
        document_version_number = coalesce(${version?.versionNumber ?? null}::int, document_version_number),
        total_pages = coalesce(${total}::int, total_pages),
        pages_viewed = ${total ? progress.pagesViewed : null}::int,
        furthest_page = ${total ? progress.furthestPage : null}::int,
        enrichment_state = ${outcome},
        enrichment_attempts = 0,
        enrichment_error = ${versionNote ?? (progress.outOfRange ? `${progress.outOfRange} page(s) beyond the version's page total were ignored.` : null)},
        next_enrichment_at = ${next ? next.toISOString() : null}::timestamptz,
        last_enriched_at = now()
      where id = ${row.id}::uuid
    `
    summary.enriched++
    if (summary.rateLimited || summary.notPermitted) break
  }

  // Analytics answered in this run: an earlier refusal no longer applies.
  if (summary.enriched > 0 && !summary.notPermitted) {
    try {
      await sql`delete from app_settings where key = ${CAPABILITY_KEY}`
    } catch {
      // Diagnostics only.
    }
  }

  return summary
}

/** Records a session's attempt that produced no page evidence. */
async function settle(
  sql: Sql,
  row: DueRow,
  outcome: EnrichmentOutcome,
  message: string,
  extra: { retryAfterMs?: number | null } = {},
): Promise<void> {
  const attempts = outcome === 'failed' ? row.enrichment_attempts + 1 : row.enrichment_attempts
  const next = nextEnrichmentAt({ outcome, viewedAt: row.viewed_at, attempts, now: Date.now(), retryAfterMs: extra.retryAfterMs })
  await sql`
    update document_views set
      enrichment_state = ${outcome},
      enrichment_attempts = ${attempts},
      enrichment_error = ${message.slice(0, 300)},
      next_enrichment_at = ${next ? next.toISOString() : null}::timestamptz,
      last_enriched_at = case when ${outcome} = 'unavailable' then now() else last_enriched_at end
    where id = ${row.id}::uuid
  `
}

/**
 * Upserts one snapshot of a session's pages. A repeated snapshot updates the
 * same rows (never duplicates them) and keeps the larger recorded time, since
 * a session's page times only grow while it is being read.
 */
async function storePages(sql: Sql, viewId: string, pages: readonly PageEvidence[]): Promise<void> {
  if (pages.length === 0) return
  await sql`
    insert into document_view_pages (view_id, page_number, duration_seconds)
    select ${viewId}::uuid, p, d
    from unnest(${pages.map((p) => p.pageNumber)}::int[], ${pages.map((p) => p.durationSeconds)}::numeric[]) as t(p, d)
    on conflict (view_id, page_number) do update set
      duration_seconds = greatest(document_view_pages.duration_seconds, excluded.duration_seconds),
      updated_at = now()
  `
}

async function storedPages(sql: Sql, viewId: string): Promise<PageEvidence[]> {
  const rows = (await sql`
    select page_number, duration_seconds from document_view_pages where view_id = ${viewId}::uuid order by page_number
  `) as { page_number: number; duration_seconds: string | number }[]
  return rows.map((r) => ({ pageNumber: Number(r.page_number), durationSeconds: Number(r.duration_seconds) }))
}

/**
 * A document's versions: from the cache when it is fresh and covers the
 * session's time, otherwise read from Papermark and cached.
 */
async function documentVersions(sql: Sql, documentId: string, viewedAt: string | Date): Promise<AnalyticsRead<DocumentVersion[]>> {
  const cached = (await sql`
    select version_id, version_number, num_pages, version_created_at, is_primary, fetched_at
    from papermark_document_versions
    where papermark_document_id = ${documentId}
  `) as {
    version_id: string
    version_number: number | null
    num_pages: number | null
    version_created_at: string | Date | null
    is_primary: boolean
    fetched_at: string | Date
  }[]
  // Fresh, and read after this session began: a list read before it could be
  // missing a version uploaded since, and give the session the wrong total.
  const sessionAt = new Date(viewedAt).getTime()
  const fresh =
    cached.length > 0 &&
    cached.every((c) => {
      const fetched = new Date(c.fetched_at).getTime()
      return Date.now() - fetched < VERSION_CACHE_MS && fetched >= sessionAt
    })
  const fromCache = cached.map((c) => ({
    versionId: c.version_id,
    versionNumber: c.version_number,
    numPages: c.num_pages,
    createdAt: c.version_created_at ? new Date(c.version_created_at).toISOString() : null,
    isPrimary: c.is_primary,
  }))
  if (fresh && versionForView(fromCache, viewedAt)) return { ok: true, data: fromCache }

  const read = await listDocumentVersions(documentId)
  if (!read.ok) return cached.length > 0 ? { ok: true, data: fromCache } : read
  for (const v of read.data) {
    await sql`
      insert into papermark_document_versions
        (papermark_document_id, version_id, version_number, num_pages, is_primary, version_created_at, fetched_at)
      values (${documentId}, ${v.versionId}, ${v.versionNumber}, ${v.numPages}, ${v.isPrimary}, ${v.createdAt}::timestamptz, now())
      on conflict (papermark_document_id, version_id) do update set
        version_number = excluded.version_number, num_pages = excluded.num_pages,
        is_primary = excluded.is_primary, version_created_at = excluded.version_created_at, fetched_at = now()
    `
  }
  return read
}

async function recordCapability(sql: Sql, message: string): Promise<void> {
  try {
    const value = JSON.stringify({ at: new Date().toISOString(), message: message.slice(0, 300) })
    await sql`
      insert into app_settings (key, value) values (${CAPABILITY_KEY}, ${value})
      on conflict (key) do update set value = excluded.value
    `
  } catch {
    // Diagnostics only.
  }
}
