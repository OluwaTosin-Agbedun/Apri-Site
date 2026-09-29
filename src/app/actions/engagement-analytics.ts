"use server"

import { revalidatePath } from "next/cache"
import { requireOwner } from "@/lib/dal"
import { getSql } from "@/lib/db"
import { attribute } from "@/lib/view-attribution"
import { collectPapermarkAnalytics } from "@/lib/papermark-collector"

/**
 * Owner-only engagement maintenance.
 *
 * Two jobs: run the same Papermark collection the cron runs, and repair
 * historical `document_views` rows whose attribution was never resolved --
 * either because the row predates the canonical resolver or because its link
 * had not been provisioned when the view arrived.
 */

export type ManualSyncResult = {
  ok: boolean
  message: string
  linksChecked?: number
  viewsFound?: number
  newViews?: number
  downloadsRecorded?: number
  unmatched?: number
  failures?: number
}

/**
 * Runs the collector on demand.
 *
 * Exactly the same function the cron route calls, which is the point: the owner
 * uses this to check whether the scheduled job is working, so it must not be a
 * different code path.
 */
export async function syncPapermarkAnalyticsNow(): Promise<ManualSyncResult> {
  await requireOwner()

  const summary = await collectPapermarkAnalytics()

  revalidatePath("/admin/engagement")

  if (summary.skipped === 'papermark-not-configured') {
    return { ok: false, message: "No Papermark API token is configured, so there is nothing to poll." }
  }
  if (summary.skipped === 'no-known-links') {
    return {
      ok: true,
      message:
        "No Papermark link ids are on file, so no links were checked. This is correct: " +
        "the poll never falls back to reading every link in the account.",
      linksChecked: 0,
    }
  }
  if (!summary.ok) {
    return { ok: false, message: summary.errors[0] ?? "Collection failed." }
  }

  return {
    ok: true,
    message:
      `Polled ${summary.linksChecked} of ${summary.linksKnown} known links` +
      (summary.allLinksCovered ? '' : ' (the next run resumes with the rest)') +
      `: ${summary.viewsFound} views read, ` +
      `${summary.newViews} new, ${summary.downloadsRecorded} downloads recorded, ` +
      `${summary.unmatched} unmatched, ${summary.failures} failures.`,
    linksChecked: summary.linksChecked,
    viewsFound: summary.viewsFound,
    newViews: summary.newViews,
    downloadsRecorded: summary.downloadsRecorded,
    unmatched: summary.unmatched,
    failures: summary.failures,
  }
}

// ---------------------------------------------------------------------------
// Historical attribution repair
// ---------------------------------------------------------------------------

export type RepairCandidateRow = {
  papermarkViewId: string
  viewedAt: string
  currentSubscriberId: string | null
  currentPublicationId: string | null
  currentReaderType: string | null
  proposedSubscriberId: string | null
  proposedPublicationId: string | null
  proposedReaderType: string
  proposedMethod: string
  /** Which fields this row would actually gain. */
  fillsFields: string[]
}

export type RepairPreview = {
  ok: boolean
  message: string
  examined: number
  repairable: number
  rows: RepairCandidateRow[]
}

const REPAIR_PAGE = 200

/** Stays inside the server action's time limit; a repeat click resumes. */
const REPAIR_BUDGET_MS = 40_000

type RepairRow = {
  papermark_view_id: string
  viewed_at: string
  subscriber_id: string | null
  publication_id: string | null
  reader_type: string | null
  papermark_link_id: string | null
  papermark_document_id: string | null
  viewer_email: string | null
  cursor_at: string
}

/**
 * The rows a repair can still learn something about -- read page by page, so
 * every one is examined rather than the same newest batch each time:
 *
 *  - a view with no reader at all (no subscriber or briefing client, and no
 *    reader type or only the 'unknown' placeholder), and
 *  - a subscriber or briefing view with no publication.
 *
 * A Complimentary Review view has no subscriber and no publication id by
 * design, so it is complete and is not a candidate.
 */
async function* repairCandidates(sql: ReturnType<typeof getSql>, deadline: number): AsyncGenerator<RepairRow> {
  let after: { viewedAt: string; id: string } | null = null
  while (Date.now() < deadline) {
    const page = (await sql`
      select papermark_view_id, viewed_at, viewed_at::text as cursor_at, subscriber_id, publication_id,
             reader_type, papermark_link_id, papermark_document_id, viewer_email
      from document_views
      where (
          (subscriber_id is null and briefing_request_id is null
           and (reader_type is null or reader_type = 'unknown'))
          or (publication_id is null and reader_type in ('subscriber', 'briefing'))
        )
        and (${after?.viewedAt ?? null}::timestamptz is null
             or (viewed_at, papermark_view_id) < (${after?.viewedAt ?? null}::timestamptz, ${after?.id ?? ''}))
      order by viewed_at desc, papermark_view_id desc
      limit ${REPAIR_PAGE}
    `) as RepairRow[]
    if (page.length === 0) return
    for (const row of page) yield row
    const last = page[page.length - 1]!
    // The database's own text form keeps microseconds, so no row is skipped.
    after = { viewedAt: last.cursor_at, id: last.papermark_view_id }
    if (page.length < REPAIR_PAGE) return
  }
}

function attributionFor(row: RepairRow) {
  return attribute({
    papermarkViewId: row.papermark_view_id,
    papermarkLinkId: row.papermark_link_id,
    papermarkDocumentId: row.papermark_document_id,
    viewerEmail: row.viewer_email,
    viewedAt: row.viewed_at,
    durationSeconds: null,
    completionPct: null,
    downloaded: false,
    source: 'poll',
  })
}

const unknownType = (value: string | null) => !value || value === 'unknown'

/**
 * Shows what a repair would change, without changing anything.
 *
 * Only rows with a genuinely missing field are considered, and only the missing
 * fields are ever proposed. A row that already has a subscriber keeps it even
 * if the resolver would now pick a different one: a stored attribution is
 * evidence from the time the view arrived, and silently rewriting it would
 * change historical figures with no record of why. The 'unknown' placeholder
 * is not an attribution, so it can be filled.
 */
export async function previewAttributionRepair(): Promise<RepairPreview> {
  await requireOwner()
  const sql = getSql()
  const deadline = Date.now() + REPAIR_BUDGET_MS

  const candidates: RepairCandidateRow[] = []
  let examined = 0
  let complete = true

  for await (const row of repairCandidates(sql, deadline)) {
    if (Date.now() > deadline) {
      complete = false
      break
    }
    examined++
    const attribution = await attributionFor(row)

    // Only count a field as fillable when it is currently empty AND the
    // resolver has something to put there.
    const fills: string[] = []
    if (!row.subscriber_id && attribution.subscriberId) fills.push('subscriber')
    if (!row.publication_id && attribution.publicationId) fills.push('publication')
    if (unknownType(row.reader_type) && attribution.readerType !== 'unknown') fills.push('reader type')

    if (fills.length === 0) continue

    candidates.push({
      papermarkViewId: row.papermark_view_id,
      viewedAt: row.viewed_at,
      currentSubscriberId: row.subscriber_id,
      currentPublicationId: row.publication_id,
      currentReaderType: row.reader_type,
      proposedSubscriberId: attribution.subscriberId,
      proposedPublicationId: attribution.publicationId,
      proposedReaderType: attribution.readerType,
      proposedMethod: attribution.matchedBy,
      fillsFields: fills,
    })
  }

  const scope = complete ? 'every incomplete row' : `${examined} incomplete rows (the rest on the next preview)`
  return {
    ok: true,
    message:
      candidates.length === 0
        ? `Examined ${scope}. None can be resolved with the current link mappings.`
        : `Examined ${scope}. ${candidates.length} can be filled in.`,
    examined,
    repairable: candidates.length,
    rows: candidates.slice(0, 50),
  }
}

/**
 * Applies the repair to every incomplete row it can reach in the time limit.
 *
 * Every write only fills what is empty -- `coalesce(existing, new)`, with the
 * 'unknown' placeholder counted as empty -- so an existing attribution can only
 * be added to, never replaced. That is enforced in SQL rather than in the
 * preview loop, so even a stale preview cannot cause an overwrite.
 */
export async function applyAttributionRepair(): Promise<{
  ok: boolean
  message: string
  updated: number
}> {
  await requireOwner()
  const sql = getSql()
  const deadline = Date.now() + REPAIR_BUDGET_MS

  let examined = 0
  let updated = 0
  let failures = 0
  let complete = true

  for await (const row of repairCandidates(sql, deadline)) {
    if (Date.now() > deadline) {
      complete = false
      break
    }
    examined++
    try {
      const attribution = await attributionFor(row)

      const hasSomething =
        attribution.subscriberId ||
        attribution.briefingRequestId ||
        attribution.publicationId ||
        attribution.readerType !== 'unknown'
      if (!hasSomething) continue

      const result = (await sql`
        update document_views set
          subscriber_id       = coalesce(subscriber_id, ${attribution.subscriberId}),
          briefing_request_id = coalesce(briefing_request_id, ${attribution.briefingRequestId}),
          publication_id      = coalesce(publication_id, ${attribution.publicationId}),
          viewer_email        = coalesce(viewer_email, ${attribution.viewerEmail}),
          reader_type         = case when reader_type is null or reader_type = 'unknown'
                                     then ${attribution.readerType} else reader_type end,
          attribution_method  = case when attribution_method is null or attribution_method = 'none'
                                     then ${attribution.matchedBy} else attribution_method end
        where papermark_view_id = ${row.papermark_view_id}
          -- Only touch a row that is still missing something, so a concurrent
          -- write cannot be clobbered by this one.
          and (subscriber_id is null or publication_id is null
               or reader_type is null or reader_type = 'unknown')
        returning papermark_view_id
      `) as { papermark_view_id: string }[]

      if (result[0]) updated++
    } catch {
      failures++
    }
  }

  revalidatePath("/admin/engagement")

  return {
    ok: failures === 0,
    message:
      `Repaired ${updated} of ${examined} incomplete rows examined` +
      (complete ? ' (every incomplete row)' : '; run it again to continue with the rest') +
      (failures > 0 ? `; ${failures} failed and were left unchanged.` : '.') +
      ' Existing attributions were not modified.',
    updated,
  }
}
