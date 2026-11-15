/**
 * The one publication catalogue: which publication categories exist, what
 * they are called, the order every library shows them in, and which Papermark
 * Data Room folders file a document into one.
 *
 * Pure and dependency-free, so the subscriber library search (a client
 * component), the server and the tests all read the same rules. The owner
 * edits labels, order, the active flag and folder mappings in Admin ->
 * Publication Categories (db/migrations/20261114_publication_catalogue.sql);
 * src/lib/publication-catalogue-dal.ts lays those edits over the defaults
 * below. Until that migration is applied, the defaults below are the
 * catalogue -- and they are the single source the migration's seed copies
 * (tests/publication-catalogue-migration.test.mjs checks that they agree).
 *
 * A category never grants access. Who may open an edition is decided only by
 * the access policy (src/lib/access-policy.ts) on the linked publication
 * record, and for Complimentary Review by the edition's own recipients.
 */

/**
 * Every stored category code, in the default order. These are the values the
 * database accepts in documents.series (and, without BP, in
 * review_publication_editions.series). Codes are never renamed or deleted: a
 * new code needs a migration that widens those constraints.
 */
export const CATALOGUE_CODES = ["MIN", "AIU", "PLM", "AEO", "QIB", "OTHER", "BP"] as const
export type CatalogueCode = (typeof CATALOGUE_CODES)[number]

export type CatalogueCategory = {
  code: CatalogueCode
  /** Plural label: section headings, navigation and folder names. */
  label: string
  /** Singular label: the type shown on one card. */
  singularLabel: string
  /** Lower comes first. Ties keep the default code order. */
  sortOrder: number
  /** An inactive category is offered nowhere new, but anything already in it still shows. */
  active: boolean
  /** Historical or alternative names, for owners. Never used to guess a category. */
  aliases: readonly string[]
}

/** The built-in catalogue (also the migration's seed). */
export const DEFAULT_CATALOGUE: readonly CatalogueCategory[] = [
  { code: "MIN", label: "Monthly Intelligence Notes", singularLabel: "Monthly Intelligence Note", sortOrder: 10, active: true, aliases: [] },
  { code: "AIU", label: "Athena Intelligence Updates", singularLabel: "Athena Intelligence Update", sortOrder: 20, active: true, aliases: [] },
  { code: "PLM", label: "Political Landscape Monitor", singularLabel: "Political Landscape Monitor", sortOrder: 30, active: true, aliases: [] },
  { code: "AEO", label: "Election & Democratic Governance Monitor", singularLabel: "Election & Democratic Governance Monitor", sortOrder: 40, active: true, aliases: ["Election Observatory"] },
  { code: "QIB", label: "Quarterly Intelligence Briefs", singularLabel: "Quarterly Intelligence Brief", sortOrder: 50, active: true, aliases: [] },
  { code: "OTHER", label: "Other Assigned Publications", singularLabel: "Other assigned publication", sortOrder: 60, active: true, aliases: [] },
  { code: "BP", label: "Board Papers", singularLabel: "Board Paper", sortOrder: 70, active: false, aliases: [] },
]

/**
 * Codes a Complimentary Review edition may not carry. Mirrors
 * review_publication_editions_series_check: Board Papers are never offered as
 * Complimentary Review editions.
 */
export const REVIEW_EXCLUDED_CODES: readonly CatalogueCode[] = ["BP"]

export type FolderMapping = { folderSlug: string; code: CatalogueCode }

/**
 * The built-in folder mappings (also the migration's seed): only the folder
 * labels in APRI's Papermark Data Rooms and the folder slugs already observed
 * there. A folder is never guessed from a code or label inside its name: it
 * files a document into a category only when it is listed here, exactly.
 * `election-watch` is the one older name kept, as an explicit mapping the
 * owner can remove. Board Intelligence Updates is deliberately not mapped.
 *
 * Papermark stores a folder's path as its name run through
 * @sindresorhus/slugify (safeSlugify in Papermark's lib/utils.ts), which
 * spells "&" as "and": the folder "Election & Democratic Governance Monitor"
 * is the path "/election-and-democratic-governance-monitor". Both that slug
 * and the "&"-dropped form are mapped.
 */
export const DEFAULT_FOLDER_MAPPINGS: readonly FolderMapping[] = [
  { folderSlug: "monthly-intelligence-notes", code: "MIN" },
  { folderSlug: "monthly-intelligence-note", code: "MIN" },
  { folderSlug: "athena-intelligence-updates", code: "AIU" },
  { folderSlug: "political-landscape-monitor", code: "PLM" },
  { folderSlug: "election-and-democratic-governance-monitor", code: "AEO" },
  { folderSlug: "election-democratic-governance-monitor", code: "AEO" },
  { folderSlug: "election-watch", code: "AEO" },
  { folderSlug: "quarterly-intelligence-briefs", code: "QIB" },
  { folderSlug: "other-assigned-publications", code: "OTHER" },
]

/** The neutral section for permitted editions no category has claimed yet. */
export const UNASSIGNED_KEY = "unassigned"
export const UNASSIGNED_LABEL = "Publications awaiting a category"
export const UNASSIGNED_SINGULAR_LABEL = "Publication"

export const MAX_LABEL_LENGTH = 80
export const MAX_ALIASES = 10
export const MAX_FOLDER_SLUG_LENGTH = 120
export const MAX_SORT_ORDER = 9999

export function isCatalogueCode(value: unknown): value is CatalogueCode {
  return typeof value === "string" && (CATALOGUE_CODES as readonly string[]).includes(value)
}

/** Whether a Complimentary Review edition may be filed under this code. */
export function isReviewCode(value: unknown): value is CatalogueCode {
  return isCatalogueCode(value) && !REVIEW_EXCLUDED_CODES.includes(value)
}

export function defaultCategory(code: CatalogueCode): CatalogueCategory {
  return DEFAULT_CATALOGUE.find((c) => c.code === code)!
}

/** Catalogue order: sort order, then the default code order. Never mutates its input. */
export function sortCategories<T extends Pick<CatalogueCategory, "code" | "sortOrder">>(categories: readonly T[]): T[] {
  return [...categories].sort(
    (a, b) => a.sortOrder - b.sortOrder || CATALOGUE_CODES.indexOf(a.code) - CATALOGUE_CODES.indexOf(b.code),
  )
}

/** The codes in catalogue order. */
export function catalogueOrder(categories: readonly CatalogueCategory[] = DEFAULT_CATALOGUE): CatalogueCode[] {
  return sortCategories(categories).map((c) => c.code)
}

/** The review-eligible codes, in catalogue order. */
export function reviewCodes(categories: readonly CatalogueCategory[] = DEFAULT_CATALOGUE): CatalogueCode[] {
  return catalogueOrder(categories).filter(isReviewCode)
}

/** A label tidied for storage, or null when it cannot be one. */
export function cleanLabel(value: unknown): string | null {
  if (typeof value !== "string") return null
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()
  return text.length >= 1 && text.length <= MAX_LABEL_LENGTH ? text : null
}

/** Aliases from a comma- or line-separated field: tidied, de-duplicated, at most ten. */
export function parseAliases(value: unknown): string[] | null {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,\n]/) : []
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== "string" || item.trim() === "") continue
    const label = cleanLabel(item)
    if (!label) return null
    if (!out.some((a) => a.toLowerCase() === label.toLowerCase())) out.push(label)
  }
  return out.length <= MAX_ALIASES ? out : null
}

export type CatalogueRow = {
  code: string
  label?: string | null
  singular_label?: string | null
  sort_order?: number | string | null
  active?: boolean | string | null
  aliases?: readonly string[] | string | null
}

/**
 * The catalogue with the owner's saved edits laid over the defaults. Every
 * default code is always present (a code cannot be deleted); a stored row for
 * an unknown code is ignored; a stored value that is not valid falls back to
 * the default rather than breaking a library.
 */
export function mergeCatalogue(rows: readonly CatalogueRow[]): CatalogueCategory[] {
  const merged = DEFAULT_CATALOGUE.map((base) => {
    const row = rows.find((r) => r.code === base.code)
    if (!row) return { ...base, aliases: [...base.aliases] }
    const sort = typeof row.sort_order === "string" ? Number(row.sort_order) : row.sort_order
    const active = row.active === true || row.active === "t" || row.active === "true" ? true : row.active === false || row.active === "f" || row.active === "false" ? false : base.active
    const aliases = parsePgTextArray(row.aliases)
    return {
      code: base.code,
      label: cleanLabel(row.label) ?? base.label,
      singularLabel: cleanLabel(row.singular_label) ?? base.singularLabel,
      sortOrder: Number.isInteger(sort) && (sort as number) >= 0 && (sort as number) <= MAX_SORT_ORDER ? (sort as number) : base.sortOrder,
      active,
      aliases: aliases ? parseAliases(aliases) ?? [...base.aliases] : [...base.aliases],
    }
  })
  return sortCategories(merged)
}

/** A Postgres text[] as the driver may hand it over: an array, or its text form. */
function parsePgTextArray(value: CatalogueRow["aliases"]): string[] | null {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string")
  if (typeof value !== "string") return null
  const inner = value.trim().replace(/^\{/, "").replace(/\}$/, "")
  if (!inner) return []
  const out: string[] = []
  const re = /"((?:[^"\\]|\\.)*)"|([^,]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(inner))) out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : m[2]!.trim())
  return out
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

/**
 * Normalise a folder path segment for classification matching.
 *
 * 1. Decode URI characters safely.
 * 2. Convert to lowercase.
 * 3. Replace hyphens and underscores with spaces.
 * 4. Remove harmless leading numeric prefixes (e.g. "04-", "04_", "04 ").
 * 5. Collapse repeated whitespace.
 * 6. Trim.
 */
export function normaliseSegment(raw: string): string {
  let s: string
  try { s = decodeURIComponent(raw) } catch { s = raw }
  return s
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/&/g, " ")
    .replace(/^\d+\s+/, "")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * The key a folder is mapped by: its normalised name as a slug, with "&"
 * spelt "and" as Papermark spells it in folder paths. So the folder name an
 * owner types, "Election & Democratic Governance Monitor", and the path
 * Papermark stores for it, "/election-and-democratic-governance-monitor",
 * are the same key; "04_Monthly_Intelligence_Notes" is
 * "monthly-intelligence-notes".
 */
export function folderSlug(raw: string): string {
  return normaliseSegment(raw.replace(/&|%26/gi, " and "))
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-")
}

/** Each folder of a Papermark folder path, as slugs, outermost first. */
export function folderSegments(path: string | null | undefined): string[] {
  return (path ?? "").split("/").map(folderSlug).filter(Boolean)
}

export type FolderResolution =
  | { kind: "none" }
  | { kind: "mapped"; code: CatalogueCode; folderSlug: string }
  | { kind: "unmapped"; folder: string }

/**
 * Which category a folder path files a document into. A mapped folder is
 * matched exactly, segment by segment; the innermost mapped folder wins. A
 * folder that is not mapped is reported as such -- never guessed from a code
 * or a word inside its name, so "Admin" is not a Monthly Intelligence Note.
 */
export function resolveFolder(path: string | null | undefined, mappings: readonly FolderMapping[]): FolderResolution {
  const segments = folderSegments(path)
  if (segments.length === 0) return { kind: "none" }
  for (let i = segments.length - 1; i >= 0; i--) {
    const found = mappings.find((m) => m.folderSlug === segments[i])
    if (found && isCatalogueCode(found.code)) return { kind: "mapped", code: found.code, folderSlug: found.folderSlug }
  }
  return { kind: "unmapped", folder: segments.join("/") }
}

/** A catalogue code at the very start of a name, separator required ("MIN-2026-08 ..."). */
export function leadingCatalogueCode(title: string): CatalogueCode | null {
  const match = title.trim().toUpperCase().match(/^([A-Z]{3})[-_\s]/)
  return match && isCatalogueCode(match[1]) ? match[1] : null
}

export type CategoryResolution = {
  /** null: no category yet ("Publications awaiting a category"). */
  code: CatalogueCode | null
  source: "series" | "folder" | "title" | "unassigned"
  /** For an unmapped folder: which one, so Admin can offer to map it. */
  unmappedFolder?: string
}

/**
 * The category of one edition:
 *  1. the publication record's series, when it is a catalogue code (the
 *     editorial decision wins);
 *  2. otherwise the folder it is filed in, when that folder is mapped;
 *  3. for a document in no folder at all, a catalogue code at the start of its
 *     name -- never for a document in a folder nobody has mapped;
 *  4. otherwise none: it is listed under "Publications awaiting a category",
 *     and is never hidden for want of one.
 */
export function resolveCategory(args: {
  series?: string | null
  folderPath?: string | null
  title?: string | null
  mappings: readonly FolderMapping[]
}): CategoryResolution {
  const series = (args.series ?? "").trim()
  if (isCatalogueCode(series)) return { code: series, source: "series" }
  const folder = resolveFolder(args.folderPath, args.mappings)
  if (folder.kind === "mapped") return { code: folder.code, source: "folder" }
  if (folder.kind === "unmapped") return { code: null, source: "unassigned", unmappedFolder: folder.folder }
  const code = leadingCatalogueCode(args.title ?? "")
  return code ? { code, source: "title" } : { code: null, source: "unassigned" }
}

// ---------------------------------------------------------------------------
// Labels and sections
// ---------------------------------------------------------------------------

/** The plural label for a category key (a code or UNASSIGNED_KEY). */
export function categoryLabel(key: string | null, categories: readonly CatalogueCategory[] = DEFAULT_CATALOGUE): string {
  if (!key || key === UNASSIGNED_KEY) return UNASSIGNED_LABEL
  return categories.find((c) => c.code === key)?.label ?? (isCatalogueCode(key) ? defaultCategory(key).label : key)
}

/** The singular label shown on one card. */
export function categorySingularLabel(key: string | null, categories: readonly CatalogueCategory[] = DEFAULT_CATALOGUE): string {
  if (!key || key === UNASSIGNED_KEY) return UNASSIGNED_SINGULAR_LABEL
  return categories.find((c) => c.code === key)?.singularLabel ?? (isCatalogueCode(key) ? defaultCategory(key).singularLabel : key)
}

/** The key a section is shown under: its code, or UNASSIGNED_KEY. */
export function sectionKey(code: CatalogueCode | null): string {
  return code ?? UNASSIGNED_KEY
}

export type CategorySection<T> = {
  key: string
  code: CatalogueCode | null
  label: string
  singularLabel: string
  items: T[]
}

/**
 * A library's sections, in catalogue order: every active category (an empty
 * one says so), an inactive category only when something in it is listed,
 * and "Publications awaiting a category" last, only when it holds something.
 * Items keep the order they are given in.
 */
export function categorySections<T>(
  items: readonly T[],
  categories: readonly CatalogueCategory[],
  codeOf: (item: T) => CatalogueCode | null,
): CategorySection<T>[] {
  const ordered = mergeCatalogueKeepingOrder(categories)
  const byKey = new Map<string, T[]>()
  for (const item of items) {
    const code = codeOf(item)
    const key = sectionKey(isCatalogueCode(code) ? code : null)
    byKey.set(key, [...(byKey.get(key) ?? []), item])
  }
  const sections: CategorySection<T>[] = []
  for (const category of ordered) {
    const list = byKey.get(category.code) ?? []
    if (!category.active && list.length === 0) continue
    sections.push({ key: category.code, code: category.code, label: category.label, singularLabel: category.singularLabel, items: list })
  }
  const unassigned = byKey.get(UNASSIGNED_KEY) ?? []
  if (unassigned.length) {
    sections.push({ key: UNASSIGNED_KEY, code: null, label: UNASSIGNED_LABEL, singularLabel: UNASSIGNED_SINGULAR_LABEL, items: unassigned })
  }
  return sections
}

/** Any list of categories, completed with defaults for missing codes, in catalogue order. */
function mergeCatalogueKeepingOrder(categories: readonly CatalogueCategory[]): CatalogueCategory[] {
  const present = new Set(categories.map((c) => c.code))
  return sortCategories([...categories, ...DEFAULT_CATALOGUE.filter((c) => !present.has(c.code))])
}

export type SearchTypeOption = { value: string; label: string }

/**
 * The publication-type filter's options: only the categories present among
 * the editions this reader is permitted to see, in catalogue order, with
 * "Publications awaiting a category" last when it has any.
 */
export function searchTypeOptions(
  entries: readonly { series: string | null }[],
  categories: readonly CatalogueCategory[] = DEFAULT_CATALOGUE,
): SearchTypeOption[] {
  const present = new Set(entries.map((e) => (e.series && isCatalogueCode(e.series) ? e.series : UNASSIGNED_KEY)))
  const options: SearchTypeOption[] = mergeCatalogueKeepingOrder(categories)
    .filter((c) => present.has(c.code))
    .map((c) => ({ value: c.code, label: c.label }))
  if (present.has(UNASSIGNED_KEY)) options.push({ value: UNASSIGNED_KEY, label: UNASSIGNED_LABEL })
  return options
}

export type SeriesChoice = { code: CatalogueCode; label: string; disabled: boolean }

/**
 * The series an editor may choose for a publication record: the active
 * categories in catalogue order with their card labels, plus the record's
 * current series even when that category is now inactive (so saving the form
 * never silently clears it). OTHER cannot be stored until the catalogue
 * migration has widened documents_series_check.
 */
export function seriesChoices(
  categories: readonly CatalogueCategory[],
  current: string,
  options: { migrated: boolean },
): SeriesChoice[] {
  return mergeCatalogueKeepingOrder(categories)
    .filter((c) => c.active || c.code === current)
    .map((c) => ({
      code: c.code,
      label: c.active ? c.singularLabel : `${c.singularLabel} (inactive)`,
      disabled: c.code === "OTHER" && !options.migrated && current !== "OTHER",
    }))
}

// ---------------------------------------------------------------------------
// Owner edits (Admin -> Publication Categories)
// ---------------------------------------------------------------------------

export type CategoryEdit = {
  code: CatalogueCode
  label: string
  singularLabel: string
  sortOrder: number
  active: boolean
  aliases: string[]
}

export type Validation<T> = { ok: true; value: T } | { ok: false; field: string; message: string }

/** Validates one category's edit. The code must already exist: Admin cannot create one. */
export function validateCategoryEdit(input: {
  code: unknown
  label: unknown
  singularLabel: unknown
  sortOrder: unknown
  active: unknown
  aliases: unknown
}): Validation<CategoryEdit> {
  if (!isCatalogueCode(input.code)) {
    return { ok: false, field: "code", message: "Unknown category. New categories need a database migration." }
  }
  const label = cleanLabel(input.label)
  if (!label) return { ok: false, field: "label", message: `Enter a section label of 1 to ${MAX_LABEL_LENGTH} characters.` }
  const singularLabel = cleanLabel(input.singularLabel)
  if (!singularLabel) return { ok: false, field: "singularLabel", message: `Enter a card label of 1 to ${MAX_LABEL_LENGTH} characters.` }
  const rawSort = typeof input.sortOrder === "string" ? input.sortOrder.trim() : input.sortOrder
  const sortOrder = typeof rawSort === "number" ? rawSort : /^\d{1,4}$/.test(String(rawSort ?? "")) ? Number(rawSort) : NaN
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > MAX_SORT_ORDER) {
    return { ok: false, field: "sortOrder", message: `Enter a position from 0 to ${MAX_SORT_ORDER}.` }
  }
  const aliases = parseAliases(input.aliases ?? "")
  if (!aliases) return { ok: false, field: "aliases", message: `Up to ${MAX_ALIASES} other names, each 1 to ${MAX_LABEL_LENGTH} characters, separated by commas.` }
  const active = input.active === true || input.active === "on" || input.active === "true"
  return { ok: true, value: { code: input.code, label, singularLabel, sortOrder, active, aliases } }
}

/** Validates a folder an owner wants to map: one folder name or slug, never a path. */
export function validateFolderInput(raw: unknown): Validation<string> {
  if (typeof raw !== "string" || raw.trim() === "") return { ok: false, field: "folder", message: "Enter the Papermark folder name." }
  if (raw.length > 200) return { ok: false, field: "folder", message: "That folder name is too long." }
  const parts = raw.split("/").map((p) => p.trim()).filter(Boolean)
  if (parts.length !== 1) return { ok: false, field: "folder", message: "Enter one folder name, not a path." }
  const slug = folderSlug(parts[0]!)
  if (!slug || slug.length > MAX_FOLDER_SLUG_LENGTH || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return { ok: false, field: "folder", message: "That folder name has no letters or numbers to match on." }
  }
  // The innermost mapped folder wins in every path, so a folder named only
  // with digits (a year such as "2026") would capture that subfolder in every
  // category's folder. Map the folder above it instead.
  if (/^\d+$/.test(slug)) {
    return { ok: false, field: "folder", message: "A folder named only with numbers, such as a year, sits inside many folders. Map the folder above it instead." }
  }
  return { ok: true, value: slug }
}
