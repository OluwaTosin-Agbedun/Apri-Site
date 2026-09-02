/**
 * Complimentary Review document classification — Phase 3.
 *
 * Pure functions with no server or network dependency, safe to import
 * in tests. Classifies Papermark filenames into the three supported
 * review series (MIN, AIU, PLM) and generates Chancellor-approved
 * metadata for each.
 */

export type ReviewSeries = 'MIN' | 'AIU' | 'PLM'

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
// ---------------------------------------------------------------------------

const SERIES_META: Record<ReviewSeries, {
  displayTitle: string
  publicationType: string
  description: string
  frequency: string
}> = {
  MIN: {
    displayTitle: 'Nigeria Political & Regulatory Environment',
    publicationType: 'Monthly Intelligence Note',
    description:
      'A monthly assessment of Nigeria’s political, regulatory and political-economy operating environment, highlighting significant developments, implications and issues organisations should monitor when making strategic and operating decisions.',
    frequency: 'Monthly',
  },
  AIU: {
    displayTitle: 'Athena Intelligence Update',
    publicationType: 'Periodic Focused Briefing',
    description:
      'A focused intelligence update issued when a significant political, regulatory, electoral, institutional or operating-risk development occurs between regular monthly publications.',
    frequency: 'As developments require',
  },
  PLM: {
    displayTitle: 'Political Landscape Monitor',
    publicationType: 'Monthly Strategic Assessment',
    description:
      'A monthly monitoring product covering Nigeria’s democratic, electoral and political landscape. Although public-facing, it should appear here as part of the broader monthly intelligence bouquet available to APRI readers.',
    frequency: 'Monthly',
  },
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
    s = s.replace(pattern, '')
  }
  return s
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || raw
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
    .replace(/[-_]+/g, ' ')
    .replace(/&/g, '&')
    .replace(/\s+/g, ' ')
    .trim()

  for (const pat of MIN_PATTERNS) if (pat.test(s)) return 'MIN'
  for (const pat of AIU_PATTERNS) if (pat.test(s)) return 'AIU'
  for (const pat of PLM_PATTERNS) if (pat.test(s)) return 'PLM'

  return null
}

// ---------------------------------------------------------------------------
// Edition date parsing (reuses the same logic as papermark-dataroom-contract)
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
] as const

const MONTH_ABBREVS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
] as const

export function parseReviewEditionDate(title: string): string | null {
  const s = title.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()

  const ymd = s.match(/\b(20\d{2})\s+(\d{1,2})(?:\s+(\d{1,2}))?\b/)
  if (ymd) {
    const m = parseInt(ymd[2]!, 10)
    if (m >= 1 && m <= 12) {
      const d = ymd[3] ? Math.min(parseInt(ymd[3]!, 10), 28) : 1
      return `${ymd[1]}-${String(m).padStart(2, '0')}-${String(d || 1).padStart(2, '0')}`
    }
  }

  for (let i = 0; i < MONTH_NAMES.length; i++) {
    const nameRe = new RegExp(`\\b${MONTH_NAMES[i]!}\\b.*\\b(20\\d{2})\\b|\\b(20\\d{2})\\b.*\\b${MONTH_NAMES[i]!}\\b`)
    const abbrRe = new RegExp(`\\b${MONTH_ABBREVS[i]!}\\b.*\\b(20\\d{2})\\b|\\b(20\\d{2})\\b.*\\b${MONTH_ABBREVS[i]!}\\b`)
    const nameMatch = s.match(nameRe) || s.match(abbrRe)
    if (nameMatch) {
      const year = nameMatch[1] || nameMatch[2]
      return `${year}-${String(i + 1).padStart(2, '0')}-01`
    }
  }

  const quarter = s.match(/\bq([1-4])\b.*\b(20\d{2})\b|\b(20\d{2})\b.*\bq([1-4])\b/)
  if (quarter) {
    const q = parseInt(quarter[1] || quarter[4]!, 10)
    const year = quarter[2] || quarter[3]
    const m = (q - 1) * 3 + 1
    return `${year}-${String(m).padStart(2, '0')}-01`
  }

  return null
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function classifyReviewDocument(filename: string, folderPath?: string | null): ReviewClassification {
  const clean = cleanFilename(filename)
  const series = detectSeries(filename) ?? (folderPath ? detectSeries(folderPath) : null)
  const editionDate = parseReviewEditionDate(filename)

  return { series, cleanTitle: clean, editionDate }
}

export function generateReviewMetadata(
  series: ReviewSeries,
  filename: string,
): ReviewMetadata {
  const meta = SERIES_META[series]
  const editionDate = parseReviewEditionDate(filename)

  let editionLabel = ''
  if (editionDate) {
    const [y, m] = editionDate.split('-')
    if (y && m) {
      const mi = parseInt(m, 10) - 1
      const monthName = mi >= 0 && mi < 12
        ? MONTH_NAMES[mi]!.charAt(0).toUpperCase() + MONTH_NAMES[mi]!.slice(1)
        : m
      editionLabel = `${monthName} ${y}`
    }
  }

  return {
    displayTitle: meta.displayTitle,
    publicationType: meta.publicationType,
    description: meta.description,
    frequency: meta.frequency,
    audience: 'APRI subscribers and prospective readers',
    editionLabel,
  }
}

export const SUPPORTED_SERIES: readonly ReviewSeries[] = ['MIN', 'AIU', 'PLM']

export function isReviewSeries(value: string): value is ReviewSeries {
  return (SUPPORTED_SERIES as readonly string[]).includes(value)
}
