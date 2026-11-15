/**
 * Complimentary Review document classification.
 *
 * Pure functions with no server or network dependency, safe to import
 * in tests. Proposes a catalogue category for a newly synced Review Data
 * Room document -- by the owner's exact folder mapping first, then by the
 * Chancellor-approved series names in its filename -- for a draft the owner
 * reviews. It never publishes, assigns or offers anything. Approved card copy
 * exists only for MIN, AIU and PLM; an edition in any other category gets
 * none invented and must have its details entered before it is published.
 */
import {
  DEFAULT_FOLDER_MAPPINGS,
  isReviewCode,
  resolveFolder,
  reviewCodes,
  type CatalogueCode,
  type FolderMapping,
} from "./publication-catalogue.ts"

/** A category a Complimentary Review edition may be filed under: any catalogue code but BP. */
export type ReviewSeries = CatalogueCode

export type ReviewClassification = {
  series: ReviewSeries | null
  cleanTitle: string
  editionDate: string | null
}

export type ReviewMetadata = {
  displayTitle: string
  publicationType: string
  description: string
  frequency: string
  audience: string
  editionLabel: string
}

// ---------------------------------------------------------------------------
// Chancellor-approved card content (identical to review-prefill.ts APPROVED_CARDS)
// Only these three categories have approved copy. Nothing is invented for any
// other: its edition starts blank and the owner writes it.
// ---------------------------------------------------------------------------

const SERIES_META: Partial<Record<CatalogueCode, {
  displayTitle: string
  publicationType: string
  description: string
  frequency: string
}>> = {
  MIN: {
    displayTitle: "Nigeria Political & Regulatory Environment",
    publicationType: "Monthly Intelligence Note",
    description:
      "A monthly assessment of Nigeria’s political, regulatory and political-economy operating environment, highlighting significant developments, implications and issues organisations should monitor when making strategic and operating decisions.",
    frequency: "Monthly",
  },
  AIU: {
    displayTitle: "Athena Intelligence Update",
    publicationType: "Periodic Focused Briefing",
    description:
      "A focused intelligence update issued when a significant political, regulatory, electoral, institutional or operating-risk development occurs between regular monthly publications.",
    frequency: "As developments require",
  },
  PLM: {
    displayTitle: "Political Landscape Monitor",
    publicationType: "Monthly Strategic Assessment",
    description:
      "A monthly monitoring product covering Nigeria’s democratic, electoral and political landscape. Although public-facing, it should appear here as part of the broader monthly intelligence bouquet available to APRI readers.",
    frequency: "Monthly",
  },
}

/** The categories with Chancellor-approved card copy (the original three review series). */
export const APPROVED_REVIEW_COPY_CODES = Object.keys(SERIES_META) as CatalogueCode[]

export function hasApprovedReviewCopy(series: string | null | undefined): boolean {
  return typeof series === "string" && (APPROVED_REVIEW_COPY_CODES as readonly string[]).includes(series)
}

const sameCopy = (a: string, b: string) => {
  const norm = (s: string) => s.normalize("NFKC").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim().toLowerCase()
  return norm(a) !== "" && norm(a) === norm(b)
}

/**
 * Why an edition cannot be published yet for want of its own card copy, or
 * null when it can. Approved copy exists only for MIN, AIU and PLM. An edition
 * in any other category needs a title and description the owner has written
 * and saved -- and neither may still be the approved copy of one of those
 * three (as when a MIN draft is moved to QIB without being rewritten, which
 * saves every field as owner-edited). One rule for the publish check, the
 * save message and the Admin warning.
 */
export function reviewCopyProblem(edition: {
  series: string | null
  title: string
  description: string
  ownerEditedFields: readonly string[]
}): string | null {
  if (!edition.series) return "Assign a category first."
  if (hasApprovedReviewCopy(edition.series)) return null
  const edited = edition.ownerEditedFields
  if (!edited.includes("title") || !edited.includes("description") || !edition.description.trim()) {
    return "No approved card copy exists for this category. Enter and save this edition's public title and description first."
  }
  const borrowed = APPROVED_REVIEW_COPY_CODES.find((code) => {
    const meta = SERIES_META[code]!
    return sameCopy(edition.title, meta.displayTitle) || sameCopy(edition.description, meta.description)
  })
  if (borrowed) {
    return `The title or description is still the approved ${borrowed} card copy. Write this category's own title and description first.`
  }
  return null
}

// ---------------------------------------------------------------------------
// Filename cleaning
// ---------------------------------------------------------------------------

const STRIP_PATTERNS = [
  /\.pdf$/i,
  /\s*\(\d+\)\s*$/,
  /\s+copy\s*\d*$/i,
  /\bcomplimentary\s+review\s+copy\b/i,
  /\breview\s+copy\b/i,
]

export function cleanFilename(raw: string): string {
  let s = raw
  for (const pattern of STRIP_PATTERNS) {
    s = s.replace(pattern, "")
  }
  return s.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim() || raw
}

// ---------------------------------------------------------------------------
// Series classification
// ---------------------------------------------------------------------------

const MIN_PATTERNS = [
  /\bmin\b/i,
  /\bmonthly\s+intelligence\s+note/i,
  /\bnigeria\s+(?:political\s+[&]\s+regulatory|monthly\s+intelligence)/i,
  /\bnigeria\s+political\s+(?:and|&)\s+regulatory\s+environment/i,
]

const AIU_PATTERNS = [
  /\baiu\b/i,
  /\bathena\s+intelligence\s+update/i,
  /\bperiodic\s+focused\s+briefing/i,
]

const PLM_PATTERNS = [
  /\bplm\b/i,
  /\bpolitical\s+landscape\s+monitor/i,
  /\bmonthly\s+strategic\s+assessment/i,
]

function detectSeries(text: string): ReviewSeries | null {
  const s = text
    .replace(/[-_]+/g, " ")
    .replace(/&/g, "&")
    .replace(/\s+/g, " ")
    .trim()

  for (const pat of MIN_PATTERNS) if (pat.test(s)) return "MIN"
  for (const pat of AIU_PATTERNS) if (pat.test(s)) return "AIU"
  for (const pat of PLM_PATTERNS) if (pat.test(s)) return "PLM"

  return null
}

// ---------------------------------------------------------------------------
// Edition date parsing (reuses the same logic as papermark-dataroom-contract)
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const

const MONTH_ABBREVS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
] as const

export function parseReviewEditionDate(title: string): string | null {
  const s = title
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()

  const ymd = s.match(/\b(20\d{2})\s+(\d{1,2})(?:\s+(\d{1,2}))?\b/)
  if (ymd) {
    const m = parseInt(ymd[2]!, 10)
    if (m >= 1 && m <= 12) {
      const d = ymd[3] ? Math.min(parseInt(ymd[3]!, 10), 28) : 1
      return `${ymd[1]}-${String(m).padStart(2, "0")}-${String(d || 1).padStart(2, "0")}`
    }
  }

  for (let i = 0; i < MONTH_NAMES.length; i++) {
    const nameRe = new RegExp(
      `\\b${MONTH_NAMES[i]!}\\b.*\\b(20\\d{2})\\b|\\b(20\\d{2})\\b.*\\b${MONTH_NAMES[i]!}\\b`,
    )
    const abbrRe = new RegExp(
      `\\b${MONTH_ABBREVS[i]!}\\b.*\\b(20\\d{2})\\b|\\b(20\\d{2})\\b.*\\b${MONTH_ABBREVS[i]!}\\b`,
    )
    const nameMatch = s.match(nameRe) || s.match(abbrRe)
    if (nameMatch) {
      const year = nameMatch[1] || nameMatch[2]
      return `${year}-${String(i + 1).padStart(2, "0")}-01`
    }
  }

  const quarter = s.match(
    /\bq([1-4])\b.*\b(20\d{2})\b|\b(20\d{2})\b.*\bq([1-4])\b/,
  )
  if (quarter) {
    const q = parseInt(quarter[1] || quarter[4]!, 10)
    const year = quarter[2] || quarter[3]
    const m = (q - 1) * 3 + 1
    return `${year}-${String(m).padStart(2, "0")}-01`
  }

  return null
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * The category proposed for a synced Review Data Room document's draft:
 *  1. the folder it is filed in, when an owner has mapped that folder (exact
 *     match, as for paid documents) to a category a review edition may use;
 *  2. otherwise the Chancellor-approved series names in its filename (MIN,
 *     AIU, PLM only -- nothing else is guessed from a name);
 *  3. otherwise none: the owner assigns it.
 * A proposal only. The edition is a draft with no readers until the owner
 * assigns readers and publishes it.
 */
export function classifyReviewDocument(
  filename: string,
  folderPath?: string | null,
  mappings: readonly FolderMapping[] = DEFAULT_FOLDER_MAPPINGS,
): ReviewClassification {
  const clean = cleanFilename(filename)
  const folder = resolveFolder(folderPath, mappings)
  const series =
    (folder.kind === "mapped" && isReviewCode(folder.code) ? folder.code : null) ?? detectSeries(filename)
  const editionDate = parseReviewEditionDate(filename)

  return { series, cleanTitle: clean, editionDate }
}

/**
 * Draft defaults for an edition. The approved card copy only for MIN, AIU and
 * PLM; for every other category the copy fields stay empty -- never invented
 * -- and only the edition label is suggested.
 */
export function generateReviewMetadata(
  series: ReviewSeries,
  filename: string,
): ReviewMetadata {
  const meta = SERIES_META[series] ?? { displayTitle: "", publicationType: "", description: "", frequency: "" }
  const approved = hasApprovedReviewCopy(series)
  const editionDate = parseReviewEditionDate(filename)

  let editionLabel = inferReviewEditionLabel(filename)
  if (editionDate) {
    const [y, m] = editionDate.split("-")
    if (y && m) {
      const mi = parseInt(m, 10) - 1
      const monthName =
        mi >= 0 && mi < 12
        ? MONTH_NAMES[mi]!.charAt(0).toUpperCase() + MONTH_NAMES[mi]!.slice(1)
        : m
      editionLabel ||= `${monthName} ${y}`
    }
  }

  return {
    displayTitle: meta.displayTitle,
    publicationType: meta.publicationType,
    description: meta.description,
    frequency: meta.frequency,
    audience: approved ? "APRI subscribers and prospective readers" : "",
    editionLabel,
  }
}

/** Human-readable period without pretending a month-only edition has a day. */
export function inferReviewEditionLabel(value: string): string {
  const clean = cleanFilename(value)
  const issue = clean.match(/\bissue\s*0*(\d+)\s*(?:\(|[-–— ]*)?(20\d{2})?\)?/i)
  if (issue) {
    const number = issue[1]!.padStart(3, "0")
    return issue[2] ? `Issue ${number} (${issue[2]})` : `Issue ${number}`
  }
  const date = parseReviewEditionDate(clean)
  if (!date) return ""
  const [year, month] = date.split("-")
  const index = Number(month) - 1
  return index >= 0 && index < MONTH_NAMES.length
    ? `${MONTH_NAMES[index]![0]!.toUpperCase()}${MONTH_NAMES[index]!.slice(1)} ${year}`
    : ""
}

/** Every category a review edition may be filed under, in the default catalogue order. */
export const SUPPORTED_SERIES: readonly ReviewSeries[] = reviewCodes()

export function isReviewSeries(value: string): value is ReviewSeries {
  return isReviewCode(value)
}
