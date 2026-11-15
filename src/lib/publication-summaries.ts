import "server-only"
import {
  isUuid,
  readApprovedSummary,
  summaryStatus,
  type SummaryStatus,
  type SummaryText,
} from "./publication-metadata"

/**
 * Protected summaries in the database (publication_summaries, from
 * db/migrations/20261114_publication_editorial_metadata.sql).
 *
 * One row per publication holds the saved text, a revision number and, once
 * an owner approves, an exact copy of the approved text. Every write is a
 * compare-and-set on the revision the editor was shown, and bumps it, so two
 * people acting on the same summary at once cannot both succeed, and nobody
 * can approve or overwrite text they have not seen.
 *
 * A subscriber sees a summary only through approvedSummaries(): the approved
 * copy, and only while it is still equal to the saved text. That query never
 * selects the saved (possibly draft) text itself.
 *
 * The approved copy is always built in SQL from the row's own columns with the
 * same expression the reader query compares against (APPROVED_COPY below,
 * written out in both statements), never from anything the browser sent.
 */

export type SummarySql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>

type Row = {
  revision: string | number
  what_changed: string
  why_it_matters: string
  implications: string
  watch_next: string
  source_date: string | null
  uncertainty: string
  approved_fields: unknown
  approved_revision: string | number | null
  approved_at: string | Date | null
  approved_by_name: string | null
  updated_at: string | Date | null
  updated_by_name: string | null
  approval_removed_reason: string | null
  approval_removed_at: string | Date | null
  removed_by_name: string | null
}

/** A summary as Admin sees it: the saved text, where it stands and who did what. Never sent to subscribers. */
export type StoredSummary = {
  revision: number
  text: SummaryText
  approved: SummaryText | null
  status: SummaryStatus
  approvedRevision: number | null
  approvedAt: string | null
  approvedBy: string | null
  updatedAt: string | null
  updatedBy: string | null
  removedReason: "edited" | "withdrawn" | null
  removedAt: string | null
  removedBy: string | null
}

const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : null)

function fromRow(row: Row): StoredSummary {
  const text: SummaryText = {
    whatChanged: row.what_changed ?? "",
    whyItMatters: row.why_it_matters ?? "",
    implications: row.implications ?? "",
    watchNext: row.watch_next ?? "",
    sourceDate: row.source_date ?? null,
    uncertainty: row.uncertainty ?? "",
  }
  const approved = readApprovedSummary(row.approved_fields)
  const removedReason = row.approval_removed_reason === "edited" || row.approval_removed_reason === "withdrawn" ? row.approval_removed_reason : null
  return {
    revision: Number(row.revision),
    text,
    approved,
    status: summaryStatus({ text, approved, removedReason }),
    approvedRevision: row.approved_revision === null ? null : Number(row.approved_revision),
    approvedAt: iso(row.approved_at),
    approvedBy: row.approved_by_name,
    updatedAt: iso(row.updated_at),
    updatedBy: row.updated_by_name,
    removedReason,
    removedAt: iso(row.approval_removed_at),
    removedBy: row.removed_by_name,
  }
}

/** The stored summary for one publication (Admin only), or null when none has been saved. */
export async function readStoredSummary(sql: SummarySql, publicationId: string): Promise<StoredSummary | null> {
  if (!isUuid(publicationId)) return null
  const rows = (await sql`
    select s.revision, s.what_changed, s.why_it_matters, s.implications, s.watch_next,
           to_char(s.source_date, 'YYYY-MM-DD') as source_date, s.uncertainty,
           s.approved_fields, s.approved_revision, s.approved_at, s.updated_at, s.approval_removed_reason, s.approval_removed_at,
           (select a.name from admins a where a.id = s.approved_by) as approved_by_name,
           (select a.name from admins a where a.id = s.updated_by) as updated_by_name,
           (select a.name from admins a where a.id = s.approval_removed_by) as removed_by_name
    from publication_summaries s
    where s.publication_id = ${publicationId}::uuid
    limit 1
  `) as Row[]
  return rows[0] ? fromRow(rows[0]) : null
}

/**
 * The approved summaries of the given publications, by publication id: the
 * approved copy, only where it still equals the saved text, and complete.
 * Callers pass only editions the access policy already lists for the reader.
 */
export async function approvedSummaries(sql: SummarySql, publicationIds: readonly string[]): Promise<Map<string, SummaryText>> {
  const ids = [...new Set(publicationIds.filter(isUuid))]
  const out = new Map<string, SummaryText>()
  if (!ids.length) return out
  const rows = (await sql`
    select s.publication_id, s.approved_fields
    from publication_summaries s
    where s.publication_id = any(${ids}::uuid[])
      and s.approved_fields is not null
      and s.approved_fields = jsonb_build_object(
        'whatChanged', s.what_changed, 'whyItMatters', s.why_it_matters,
        'implications', s.implications, 'watchNext', s.watch_next,
        'sourceDate', to_char(s.source_date, 'YYYY-MM-DD'), 'uncertainty', s.uncertainty)
  `) as { publication_id: string; approved_fields: unknown }[]
  for (const row of rows) {
    const summary = readApprovedSummary(row.approved_fields)
    if (summary) out.set(row.publication_id, summary)
  }
  return out
}

export type WriteResult = "saved" | "stale"

/**
 * Saves the text as the next revision, only if the stored revision is still
 * `revision` (0: no summary saved yet). Changing approved text removes the
 * approval in the same statement (`invalidates`); unchanged text is never
 * written (the caller checks).
 */
export async function saveSummaryText(
  sql: SummarySql,
  args: { publicationId: string; revision: number; text: SummaryText; adminId: string; invalidates: boolean },
): Promise<WriteResult> {
  const t = args.text
  if (args.revision === 0) {
    const rows = (await sql`
      insert into publication_summaries (publication_id, what_changed, why_it_matters, implications, watch_next,
                                         source_date, uncertainty, revision, updated_by, updated_at)
      select d.id, ${t.whatChanged}, ${t.whyItMatters}, ${t.implications}, ${t.watchNext},
             ${t.sourceDate}::date, ${t.uncertainty}, 1, ${args.adminId}::uuid, now()
      from documents d where d.id = ${args.publicationId}::uuid
      on conflict (publication_id) do nothing
      returning revision
    `) as unknown[]
    return rows.length ? "saved" : "stale"
  }
  const rows = (await sql`
    update publication_summaries s set
      what_changed = ${t.whatChanged}, why_it_matters = ${t.whyItMatters},
      implications = ${t.implications}, watch_next = ${t.watchNext},
      source_date = ${t.sourceDate}::date, uncertainty = ${t.uncertainty},
      revision = s.revision + 1, updated_by = ${args.adminId}::uuid, updated_at = now(),
      approved_fields = case when ${args.invalidates}::boolean then null else s.approved_fields end,
      approved_revision = case when ${args.invalidates}::boolean then null else s.approved_revision end,
      approved_by = case when ${args.invalidates}::boolean then null else s.approved_by end,
      approved_at = case when ${args.invalidates}::boolean then null else s.approved_at end,
      approval_removed_reason = case when ${args.invalidates}::boolean then 'edited' else s.approval_removed_reason end,
      approval_removed_by = case when ${args.invalidates}::boolean then ${args.adminId}::uuid else s.approval_removed_by end,
      approval_removed_at = case when ${args.invalidates}::boolean then now() else s.approval_removed_at end
    where s.publication_id = ${args.publicationId}::uuid and s.revision = ${args.revision}
    returning s.revision
  `) as unknown[]
  return rows.length ? "saved" : "stale"
}

/**
 * Approves the saved text of revision `revision`, exactly as stored: the
 * approved copy is built from the row's own columns in SQL, so an approval
 * can never carry text from the request. Refused (stale) when the revision
 * has moved on, when a required field is empty, or when that text is already
 * the approved one.
 */
export async function approveSummaryRevision(
  sql: SummarySql,
  args: { publicationId: string; revision: number; adminId: string },
): Promise<WriteResult> {
  const rows = (await sql`
    update publication_summaries s set
      approved_fields = jsonb_build_object(
        'whatChanged', s.what_changed, 'whyItMatters', s.why_it_matters,
        'implications', s.implications, 'watchNext', s.watch_next,
        'sourceDate', to_char(s.source_date, 'YYYY-MM-DD'), 'uncertainty', s.uncertainty),
      approved_revision = s.revision,
      approved_by = ${args.adminId}::uuid,
      approved_at = now(),
      approval_removed_reason = null, approval_removed_by = null, approval_removed_at = null,
      revision = s.revision + 1
    where s.publication_id = ${args.publicationId}::uuid
      and s.revision = ${args.revision}
      and btrim(s.what_changed) <> '' and btrim(s.why_it_matters) <> ''
      and btrim(s.implications) <> '' and btrim(s.watch_next) <> ''
      and s.approved_fields is distinct from jsonb_build_object(
        'whatChanged', s.what_changed, 'whyItMatters', s.why_it_matters,
        'implications', s.implications, 'watchNext', s.watch_next,
        'sourceDate', to_char(s.source_date, 'YYYY-MM-DD'), 'uncertainty', s.uncertainty)
    returning s.revision
  `) as unknown[]
  return rows.length ? "saved" : "stale"
}

/** Takes an approval down without changing the text (kept as a draft). Compare-and-set like the others. */
export async function withdrawSummaryApproval(
  sql: SummarySql,
  args: { publicationId: string; revision: number; adminId: string },
): Promise<WriteResult> {
  const rows = (await sql`
    update publication_summaries s set
      approved_fields = null, approved_revision = null, approved_by = null, approved_at = null,
      approval_removed_reason = 'withdrawn', approval_removed_by = ${args.adminId}::uuid, approval_removed_at = now(),
      revision = s.revision + 1
    where s.publication_id = ${args.publicationId}::uuid
      and s.revision = ${args.revision}
      and s.approved_fields is not null
    returning s.revision
  `) as unknown[]
  return rows.length ? "saved" : "stale"
}
