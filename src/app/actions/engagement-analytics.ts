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
      `Checked ${summary.linksChecked} links: ${summary.viewsFound} views found, ` +
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

const REPAIR_BATCH = 200

/**
 * Shows what a repair would change, without changing anything.
 *
 * Only rows with a genuinely missing field are considered, and only the missing
 * fields are ever proposed. A row that already has a subscriber keeps it even
 * if the resolver would now pick a different one: a stored attribution is
 * evidence from the time the view arrived, and silently rewriting it would
 * change historical figures with no record of why.
 */
export async function previewAttributionRepair(): Promise<RepairPreview> {
  await requireOwner()
  const sql = getSql()

  const rows = (await sql`
    select papermark_view_id, viewed_at, subscriber_id, publication_id,
           reader_type, papermark_link_id, papermark_document_id, viewer_email
    from document_views
    where subscriber_id is null
       or publication_id is null
       or reader_type is null
    order by viewed_at desc
    limit ${REPAIR_BATCH}
  `) as {
    papermark_view_id: string
    viewed_at: string
    subscriber_id: string | null
    publication_id: string | null
    reader_type: string | null
    papermark_link_id: string | null
    papermark_document_id: string | null
    viewer_email: string | null
  }[]

  const candidates: RepairCandidateRow[] = []

  for (const row of rows) {
    const attribution = await attribute({
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

    // Only count a field as fillable when it is currently empty AND the
    // resolver has something to put there.
    const fills: string[] = []
    if (!row.subscriber_id && attribution.subscriberId) fills.push('subscriber')
    if (!row.publication_id && attribution.publicationId) fills.push('publication')
    if (!row.reader_type && attribution.readerType !== 'unknown') fills.push('reader type')

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

  return {
    ok: true,
    message:
      candidates.length === 0
        ? `Examined ${rows.length} incomplete rows. None can be resolved with the current link mappings.`
        : `Examined ${rows.length} incomplete rows. ${candidates.length} can be filled in.`,
    examined: rows.length,
    repairable: candidates.length,
    rows: candidates.slice(0, 50),
  }
}

/**
 * Applies the repair.
 *
 * Every write is `coalesce(existing, new)`, so an existing attribution can only
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

  const rows = (await sql`
    select papermark_view_id, viewed_at, subscriber_id, publication_id,
           reader_type, papermark_link_id, papermark_document_id, viewer_email
    from document_views
    where subscriber_id is null
       or publication_id is null
       or reader_type is null
    order by viewed_at desc
    limit ${REPAIR_BATCH}
  `) as {
    papermark_view_id: string
    viewed_at: string
    subscriber_id: string | null
    publication_id: string | null
    reader_type: string | null
    papermark_link_id: string | null
    papermark_document_id: string | null
    viewer_email: string | null
  }[]

  let updated = 0
  let failures = 0

  for (const row of rows) {
    try {
      const attribution = await attribute({
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

      const hasSomething =
        attribution.subscriberId ||
        attribution.publicationId ||
        attribution.readerType !== 'unknown'
      if (!hasSomething) continue

      const result = (await sql`
        update document_views set
          subscriber_id       = coalesce(subscriber_id, ${attribution.subscriberId}),
          briefing_request_id = coalesce(briefing_request_id, ${attribution.briefingRequestId}),
          publication_id      = coalesce(publication_id, ${attribution.publicationId}),
          viewer_email        = coalesce(viewer_email, ${attribution.viewerEmail}),
          reader_type         = coalesce(reader_type, ${attribution.readerType}),
          attribution_method  = coalesce(attribution_method, ${attribution.matchedBy})
        where papermark_view_id = ${row.papermark_view_id}
          -- Only touch a row that is still missing something, so a concurrent
          -- write cannot be clobbered by this one.
          and (subscriber_id is null or publication_id is null or reader_type is null)
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
      `Repaired ${updated} of ${rows.length} incomplete rows` +
      (failures > 0 ? `; ${failures} failed and were left unchanged.` : '.') +
      ' Existing attributions were not modified.',
    updated,
  }
}
