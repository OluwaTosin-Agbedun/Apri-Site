import "server-only"
import { getSql } from "./db"
import {
  CATALOGUE_CODES,
  DEFAULT_CATALOGUE,
  DEFAULT_FOLDER_MAPPINGS,
  isCatalogueCode,
  mergeCatalogue,
  resolveCategory,
  resolveFolder,
  sortCategories,
  type CatalogueCategory,
  type CatalogueCode,
  type CatalogueRow,
  type FolderMapping,
} from "./publication-catalogue"

/**
 * The publication catalogue as the owner has set it.
 *
 * Reads db/migrations/20261114_publication_catalogue.sql's tables. Until that
 * migration has run, the built-in defaults in src/lib/publication-catalogue.ts
 * are the catalogue: every library keeps working, Admin -> Publication
 * Categories says the migration is needed and changes nothing, and no stored
 * value outside the old constraints (series OTHER, a Complimentary Review
 * edition outside MIN/AIU/PLM) can be written yet.
 *
 * A read that fails also falls back to the defaults (`degraded`): the
 * catalogue only places and labels editions, it never grants access, so the
 * defaults are always a safe answer.
 */

type Sql = ReturnType<typeof getSql>

/** A query function shaped like the Neon tag, so tests can hand in an isolated database. */
export type CatalogueSql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>

export type PublicationCatalogue = {
  /** Every code, in the owner's order. */
  categories: CatalogueCategory[]
  folders: FolderMapping[]
  /** Whether the catalogue tables exist (owner edits are possible). */
  migrated: boolean
  /** A read failed: the defaults are shown and nothing can be edited until it works again. */
  degraded: boolean
}

export const CATALOGUE_MIGRATION = "20261114_publication_catalogue.sql"

const RECHECK_MS = 30_000
let applied = false
let lastCheckedAt = 0

/**
 * Whether the catalogue migration has been applied. One-way once true;
 * re-checked at most every 30 seconds otherwise, or every time with `fresh`
 * (Admin). A check that fails counts as "not yet".
 */
export async function catalogueSchemaReady(sql: CatalogueSql, options: { fresh?: boolean } = {}): Promise<boolean> {
  if (applied) return true
  const now = Date.now()
  if (!options.fresh && now - lastCheckedAt < RECHECK_MS) return false
  lastCheckedAt = now
  try {
    const rows = (await sql`
      select to_regclass('public.publication_categories') is not null
         and to_regclass('public.publication_category_folders') is not null as ready
    `) as { ready: boolean | string }[]
    applied = rows[0]?.ready === true || rows[0]?.ready === "t" || rows[0]?.ready === "true"
  } catch {
    applied = false
  }
  return applied
}

/** For tests that build databases at different schemas in one process. */
export function resetCatalogueSchemaCache() {
  applied = false
  lastCheckedAt = 0
}

export function defaultPublicationCatalogue(options: { degraded?: boolean } = {}): PublicationCatalogue {
  return {
    categories: sortCategories(DEFAULT_CATALOGUE.map((c) => ({ ...c, aliases: [...c.aliases] }))),
    folders: DEFAULT_FOLDER_MAPPINGS.map((m) => ({ ...m })),
    migrated: false,
    degraded: options.degraded === true,
  }
}

/** The catalogue from one database. Exported for tests; pages use getPublicationCatalogue. */
export async function loadPublicationCatalogue(sql: CatalogueSql, options: { fresh?: boolean } = {}): Promise<PublicationCatalogue> {
  if (!(await catalogueSchemaReady(sql, options))) return defaultPublicationCatalogue()
  try {
    const rows = (await sql`
      select code, label, singular_label, sort_order, active, aliases
      from publication_categories
    `) as CatalogueRow[]
    const folderRows = (await sql`
      select folder_slug, category_code from publication_category_folders order by folder_slug
    `) as { folder_slug: string; category_code: string }[]
    return {
      categories: mergeCatalogue(rows),
      folders: folderRows
        .filter((r) => isCatalogueCode(r.category_code))
        .map((r) => ({ folderSlug: r.folder_slug, code: r.category_code as CatalogueCode })),
      migrated: true,
      degraded: false,
    }
  } catch {
    return { ...defaultPublicationCatalogue({ degraded: true }), migrated: true }
  }
}

/** The catalogue for this request. Never throws. */
export async function getPublicationCatalogue(options: { fresh?: boolean } = {}): Promise<PublicationCatalogue> {
  let sql: Sql
  try {
    sql = getSql()
  } catch {
    return defaultPublicationCatalogue({ degraded: true })
  }
  return loadPublicationCatalogue(sql as unknown as CatalogueSql, options)
}

/** The catalogue's codes in order: what SQL orders review editions by (array_position). */
export function orderedCodes(catalogue: Pick<PublicationCatalogue, "categories">): string[] {
  return catalogue.categories.map((c) => c.code)
}

export type CategoryUsage = {
  publications: number
  reviewEditions: number
  folders: number
  featured: number
}

/**
 * Where each code is in use: publication records, Complimentary Review
 * editions, folder mappings and homepage offers. A category in use is never
 * deleted, and deactivating one needs a confirmation.
 */
export async function catalogueUsage(sql: CatalogueSql): Promise<Map<CatalogueCode, CategoryUsage>> {
  const usage = new Map<CatalogueCode, CategoryUsage>(
    CATALOGUE_CODES.map((code) => [code, { publications: 0, reviewEditions: 0, folders: 0, featured: 0 }]),
  )
  const add = (code: string, key: keyof CategoryUsage, n: number | string) => {
    if (isCatalogueCode(code)) usage.get(code)![key] += Number(n) || 0
  }
  const publications = (await sql`select series, count(*)::int as n from documents where series <> '' group by series`) as { series: string; n: number }[]
  for (const r of publications) add(r.series, "publications", r.n)
  const hasReview = (await sql`select to_regclass('public.review_publication_editions') is not null as ok`) as { ok: boolean }[]
  if (hasReview[0]?.ok) {
    const editions = (await sql`
      select series, count(*)::int as n,
             count(*) filter (where (to_jsonb(e) ->> 'complimentary_featured')::boolean is true)::int as featured
      from review_publication_editions e where series is not null group by series
    `) as { series: string; n: number; featured: number }[]
    for (const r of editions) {
      add(r.series, "reviewEditions", r.n)
      add(r.series, "featured", r.featured)
    }
  }
  if (await catalogueSchemaReady(sql, { fresh: true })) {
    const folders = (await sql`select category_code, count(*)::int as n from publication_category_folders group by category_code`) as { category_code: string; n: number }[]
    for (const r of folders) add(r.category_code, "folders", r.n)
  }
  return usage
}

export function inUse(u: CategoryUsage | undefined): boolean {
  return Boolean(u && (u.publications || u.reviewEditions || u.folders || u.featured))
}

export type UnassignedOverview = {
  /** Data Room documents in no category: listed to entitled readers under "Publications awaiting a category". */
  documents: number
  /**
   * Published paid records outside any Data Room with no catalogue series (the
   * legacy library). Drafts, archived and withheld records are not counted:
   * no reader sees them.
   */
  records: number
  /** Folders holding documents that no mapping claims, with how many each holds. */
  folders: { folder: string; documents: number }[]
  /**
   * Complimentary Review Data Room folders no mapping claims (from the review
   * sync's candidates), so an owner can map them: review sync proposes a
   * draft's category from the folder mapping first.
   */
  reviewFolders: { folder: string; documents: number }[]
}

const byCountThenName = (folders: Map<string, number>) =>
  [...folders.entries()].map(([folder, n]) => ({ folder, documents: n })).sort((a, b) => b.documents - a.documents || a.folder.localeCompare(b.folder))

/**
 * What has no category yet, for owners: so a permitted edition is never
 * quietly mis-filed, and an unmapped folder is visible until it is mapped.
 */
export async function unassignedOverview(sql: CatalogueSql, catalogue: Pick<PublicationCatalogue, "folders">): Promise<UnassignedOverview> {
  const rows = (await sql`
    select dd.title, dd.folder_path, d.series
    from papermark_dataroom_documents dd
    left join documents d on d.id = dd.publication_id
    where dd.is_present = true
  `) as { title: string; folder_path: string | null; series: string | null }[]
  const folders = new Map<string, number>()
  let documents = 0
  for (const r of rows) {
    const resolved = resolveCategory({ series: r.series, folderPath: r.folder_path, title: r.title, mappings: catalogue.folders })
    if (resolved.code) continue
    documents++
    if (resolved.unmappedFolder) folders.set(resolved.unmappedFolder, (folders.get(resolved.unmappedFolder) ?? 0) + 1)
  }
  // paid_release_state is read through to_jsonb so this works before its
  // migration (20261004) too.
  const [records] = (await sql`
    select count(*)::int as n from documents d
    where d.visibility <> 'OPEN'
      and d.status = 'published'
      and (to_jsonb(d) ->> 'paid_release_state') is distinct from 'withheld'
      and not (d.series = any(${[...CATALOGUE_CODES]}::text[]))
      and not exists (select 1 from papermark_dataroom_documents dd where dd.publication_id = d.id and dd.is_present = true)
  `) as { n: number }[]

  const reviewFolders = new Map<string, number>()
  const hasReviewSync = (await sql`select to_regclass('public.review_sync_candidates') is not null as ok`) as { ok: boolean | string }[]
  if (hasReviewSync[0]?.ok === true || hasReviewSync[0]?.ok === "t") {
    const reviewRows = (await sql`
      select folder_path from review_sync_candidates where is_present = true and coalesce(folder_path, '') <> ''
    `) as { folder_path: string }[]
    for (const r of reviewRows) {
      const folder = resolveFolder(r.folder_path, catalogue.folders)
      if (folder.kind === "unmapped") reviewFolders.set(folder.folder, (reviewFolders.get(folder.folder) ?? 0) + 1)
    }
  }
  return {
    documents,
    records: Number(records?.n ?? 0),
    folders: byCountThenName(folders),
    reviewFolders: byCountThenName(reviewFolders),
  }
}
