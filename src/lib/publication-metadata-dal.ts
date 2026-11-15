import "server-only"
import { createHash } from "node:crypto"
import { getSql } from "./db"
import {
  EMPTY_METADATA,
  TAG_KINDS,
  isTagKind,
  isUuid,
  labelsByKind,
  summarySearchText,
  type EditorialMetadata,
  type ReaderPublicationDetails,
  type TagKind,
  type TagRecord,
} from "./publication-metadata"
import { approvedSummaries, readStoredSummary, type StoredSummary } from "./publication-summaries"

/**
 * Publication editorial metadata and tags in the database
 * (db/migrations/20261114_publication_editorial_metadata.sql).
 *
 * Until that migration has run nothing here can exist: readers get no extra
 * details (exactly as before), and the editor says which fields need it. A
 * read that fails also gives readers no extra details: they are decoration on
 * a card, never a condition for listing or opening an edition.
 */

export type MetadataSql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>

const RECHECK_MS = 30_000
let applied = false
let lastCheckedAt = 0

/**
 * Whether the migration has been applied. One-way once true; re-checked at
 * most every 30 seconds otherwise, or every time with `fresh` (Admin and
 * every save). A check that fails counts as "not yet".
 */
export async function editorialMetadataReady(sql: MetadataSql, options: { fresh?: boolean } = {}): Promise<boolean> {
  if (applied) return true
  const now = Date.now()
  if (!options.fresh && now - lastCheckedAt < RECHECK_MS) return false
  lastCheckedAt = now
  try {
    const rows = (await sql`
      select to_regclass('public.publication_tags') is not null
         and to_regclass('public.publication_tag_assignments') is not null
         and to_regclass('public.publication_summaries') is not null
         and exists (
           select 1 from information_schema.columns
           where table_schema = current_schema() and table_name = 'documents' and column_name = 'reading_time_minutes'
         ) as ready
    `) as { ready: boolean | string }[]
    applied = rows[0]?.ready === true || rows[0]?.ready === "t" || rows[0]?.ready === "true"
  } catch {
    applied = false
  }
  return applied
}

/** For tests that build databases at different schemas in one process. */
export function resetEditorialMetadataCache() {
  applied = false
  lastCheckedAt = 0
}

type MetadataRow = {
  id: string
  author_editor: string | null
  covered_period_start: string | null
  covered_period_end: string | null
  information_cutoff: string | null
  reading_time_minutes: number | string | null
}

function metadataFrom(row: MetadataRow | undefined): EditorialMetadata {
  if (!row) return { ...EMPTY_METADATA }
  const minutes = row.reading_time_minutes === null ? null : Number(row.reading_time_minutes)
  return {
    authorEditor: row.author_editor || null,
    coveredPeriodStart: row.covered_period_start,
    coveredPeriodEnd: row.covered_period_end,
    informationCutoff: row.information_cutoff,
    readingMinutes: minutes !== null && Number.isInteger(minutes) && minutes > 0 ? minutes : null,
  }
}

/**
 * The reader details (metadata, tag labels, approved summary) of the given
 * publications, by publication id. Callers pass only editions the access
 * policy already lists for the signed-in reader -- the subscriber library
 * loaders do (src/lib/papermark-client-library.ts, src/lib/subscriber-dal.ts).
 *
 * An edition with nothing stated gets no entry, so its card is unchanged.
 * Never throws: before the migration, or on any failure, it returns nothing.
 */
export async function loadReaderPublicationDetails(
  publicationIds: readonly (string | null | undefined)[],
  options: { sql?: MetadataSql } = {},
): Promise<Map<string, ReaderPublicationDetails>> {
  const out = new Map<string, ReaderPublicationDetails>()
  const ids = [...new Set(publicationIds.filter(isUuid))]
  if (!ids.length) return out
  try {
    const sql = options.sql ?? getSql()
    if (!(await editorialMetadataReady(sql))) return out
    const metadataRows = (await sql`
      select d.id, d.author_editor,
             to_char(d.covered_period_start, 'YYYY-MM-DD') as covered_period_start,
             to_char(d.covered_period_end, 'YYYY-MM-DD') as covered_period_end,
             to_char(d.information_cutoff, 'YYYY-MM-DD') as information_cutoff,
             d.reading_time_minutes
      from documents d
      where d.id = any(${ids}::uuid[])
    `) as MetadataRow[]
    const tagRows = (await sql`
      select a.publication_id, t.kind, t.label
      from publication_tag_assignments a
      join publication_tags t on t.id = a.tag_id
      where a.publication_id = any(${ids}::uuid[])
    `) as { publication_id: string; kind: string; label: string }[]
    const summaries = await approvedSummaries(sql, ids)

    const metadata = new Map(metadataRows.map((row) => [row.id, metadataFrom(row)]))
    const tags = new Map<string, { kind: TagKind; label: string }[]>()
    for (const row of tagRows) {
      if (!isTagKind(row.kind)) continue
      tags.set(row.publication_id, [...(tags.get(row.publication_id) ?? []), { kind: row.kind, label: row.label }])
    }
    for (const id of ids) {
      const m = metadata.get(id) ?? { ...EMPTY_METADATA }
      const labels = labelsByKind(tags.get(id) ?? [])
      const summary = summaries.get(id) ?? null
      const details: ReaderPublicationDetails = {
        authorEditor: m.authorEditor,
        coveredPeriod: m.coveredPeriodStart && m.coveredPeriodEnd ? { start: m.coveredPeriodStart, end: m.coveredPeriodEnd } : null,
        informationCutoff: m.informationCutoff,
        readingMinutes: m.readingMinutes,
        tags: labels,
        summary,
        summaryText: summarySearchText(summary),
      }
      const anything =
        details.authorEditor || details.coveredPeriod || details.informationCutoff || details.readingMinutes || summary ||
        TAG_KINDS.some((kind) => labels[kind].length > 0)
      if (anything) out.set(id, details)
    }
    return out
  } catch {
    return new Map()
  }
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export type EditorPanel = {
  /** Whether the migration has been applied (otherwise nothing can be saved). */
  ready: boolean
  metadata: EditorialMetadata
  /** Tags the editor may choose: every active tag, plus retired ones this publication already carries. */
  tags: TagRecord[]
  /** The ids of the tags this publication carries. */
  assigned: string[]
  /** detailsVersion() of the details and tags shown: the save refuses if they have changed since. */
  detailsVersion: string
  summary: StoredSummary | null
}

/**
 * A fingerprint of a publication's reader details and the tags it carries
 * (by id, so renaming or retiring a tag does not change it). The editor's form
 * sends back the one it was rendered with, and the save refuses when the
 * stored details no longer match, so one editor's save never silently undoes
 * a change another editor saved in the meantime.
 */
export function detailsVersion(metadata: EditorialMetadata, assigned: readonly string[]): string {
  const state = JSON.stringify([
    metadata.authorEditor,
    metadata.coveredPeriodStart,
    metadata.coveredPeriodEnd,
    metadata.informationCutoff,
    metadata.readingMinutes,
    [...assigned].map((id) => id.toLowerCase()).sort(),
  ])
  return createHash("sha256").update(state).digest("hex")
}

/** The stored details and tag ids of one publication, or null when there is no such record. */
async function readDetails(sql: MetadataSql, publicationId: string): Promise<{ metadata: EditorialMetadata; assigned: string[] } | null> {
  const [row] = (await sql`
    select d.id, d.author_editor,
           to_char(d.covered_period_start, 'YYYY-MM-DD') as covered_period_start,
           to_char(d.covered_period_end, 'YYYY-MM-DD') as covered_period_end,
           to_char(d.information_cutoff, 'YYYY-MM-DD') as information_cutoff,
           d.reading_time_minutes
    from documents d where d.id = ${publicationId}::uuid limit 1
  `) as MetadataRow[]
  if (!row) return null
  const assignedRows = (await sql`
    select tag_id from publication_tag_assignments where publication_id = ${publicationId}::uuid
  `) as { tag_id: string }[]
  return { metadata: metadataFrom(row), assigned: assignedRows.map((r) => r.tag_id) }
}

/**
 * The details version of one publication as stored now (for the save's
 * check), or null when there is no such record. Call only once the migration
 * is known to be applied.
 */
export async function currentDetailsVersion(sql: MetadataSql, publicationId: string): Promise<string | null> {
  if (!isUuid(publicationId)) return null
  const stored = await readDetails(sql, publicationId)
  return stored ? detailsVersion(stored.metadata, stored.assigned) : null
}

/** Everything the publication editor's metadata, tag and summary panels show. Admin pages only. */
export async function loadEditorPanel(sql: MetadataSql, publicationId: string): Promise<EditorPanel> {
  const empty: EditorPanel = { ready: false, metadata: { ...EMPTY_METADATA }, tags: [], assigned: [], detailsVersion: "", summary: null }
  if (!isUuid(publicationId)) return empty
  if (!(await editorialMetadataReady(sql, { fresh: true }))) return empty
  const stored = await readDetails(sql, publicationId)
  const metadata = stored?.metadata ?? { ...EMPTY_METADATA }
  const assigned = stored?.assigned ?? []
  const tagRows = (await sql`
    select t.id, t.kind, t.label, t.active
    from publication_tags t
    where t.active or t.id = any(${assigned}::uuid[])
    order by t.kind, lower(t.label), t.label
  `) as { id: string; kind: string; label: string; active: boolean }[]
  return {
    ready: true,
    metadata,
    tags: tagRows.filter((t) => isTagKind(t.kind)).map((t) => ({ id: t.id, kind: t.kind as TagKind, label: t.label, active: t.active === true })),
    assigned,
    detailsVersion: detailsVersion(metadata, assigned),
    summary: await readStoredSummary(sql, publicationId),
  }
}

/**
 * Whether a publication record holds a written protected summary (any text or
 * source date, draft or approved). Deleting the record would discard it with
 * the record (on delete cascade), so Admin refuses to delete such a record, as
 * the rollback refuses to drop saved summaries. False only when the summaries
 * table does not exist yet (nothing can be saved). A failed read throws, so
 * the caller deletes nothing.
 */
export async function hasWrittenSummary(sql: MetadataSql, publicationId: string): Promise<boolean> {
  if (!isUuid(publicationId)) return false
  const yes = (value: unknown) => value === true || value === "t" || value === "true"
  const [table] = (await sql`select to_regclass('public.publication_summaries') is not null as present`) as { present: unknown }[]
  if (!yes(table?.present)) return false
  const [row] = (await sql`
    select exists (
      select 1 from publication_summaries s
      where s.publication_id = ${publicationId}::uuid
        and (btrim(s.what_changed) <> '' or btrim(s.why_it_matters) <> '' or btrim(s.implications) <> ''
             or btrim(s.watch_next) <> '' or btrim(s.uncertainty) <> '' or s.source_date is not null)
    ) as written
  `) as { written: unknown }[]
  return yes(row?.written)
}

export type VocabularyTag = TagRecord & {
  /** How many publication records carry it. */
  publications: number
  createdBy: string | null
  createdAt: string | null
  retiredBy: string | null
  retiredAt: string | null
}

/** The whole vocabulary with usage, for Admin -> Publication Tags. */
export async function loadTagVocabulary(sql: MetadataSql): Promise<{ ready: boolean; tags: VocabularyTag[] }> {
  if (!(await editorialMetadataReady(sql, { fresh: true }))) return { ready: false, tags: [] }
  const rows = (await sql`
    select t.id, t.kind, t.label, t.active, t.created_at, t.retired_at,
           (select a.name from admins a where a.id = t.created_by) as created_by,
           (select a.name from admins a where a.id = t.retired_by) as retired_by,
           (select count(*)::int from publication_tag_assignments x where x.tag_id = t.id) as publications
    from publication_tags t
    order by t.kind, t.active desc, lower(t.label), t.label
  `) as { id: string; kind: string; label: string; active: boolean; created_at: string | null; retired_at: string | null; created_by: string | null; retired_by: string | null; publications: number | string }[]
  return {
    ready: true,
    tags: rows.filter((r) => isTagKind(r.kind)).map((r) => ({
      id: r.id,
      kind: r.kind as TagKind,
      label: r.label,
      active: r.active === true,
      publications: Number(r.publications) || 0,
      createdBy: r.created_by,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
      retiredBy: r.retired_by,
      retiredAt: r.retired_at ? new Date(r.retired_at).toISOString() : null,
    })),
  }
}
