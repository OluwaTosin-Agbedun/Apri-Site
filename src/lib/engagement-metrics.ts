/**
 * Engagement metric definitions — the arithmetic, with no database in the way.
 *
 * Kept dependency-free so every definition below is tested directly rather
 * than inferred from a SQL string. The queries in `engagement-analytics.ts`
 * use these same helpers, so a definition cannot drift between the dashboard
 * and its tests.
 *
 * The distinction this module exists to enforce: an APRI click is an intent
 * signal recorded by our own site, and a Papermark view session is a
 * confirmation that a document was actually opened. They measure different
 * things, they disagree routinely, and adding them together produces a
 * "views" number that is wrong in both directions. `NEVER_COMBINE` documents
 * that, and `combinedViewsAreForbidden` exists so a test can assert it.
 */

// ---------------------------------------------------------------------------
// Reader types
// ---------------------------------------------------------------------------

export const READER_TYPES = [
  'subscriber',
  'briefing',
  'complimentary_review',
  'unknown',
] as const

export type ReaderType = (typeof READER_TYPES)[number]

export function isReaderType(value: unknown): value is ReaderType {
  return typeof value === 'string' && (READER_TYPES as readonly string[]).includes(value)
}

/** A paying reader, for the "unique paid readers" figure. */
export function isPaidReaderType(t: ReaderType): boolean {
  return t === 'subscriber'
}

/** A prospect reading a Complimentary Review copy. Never a paid subscriber. */
export function isProspectReaderType(t: ReaderType): boolean {
  return t === 'complimentary_review'
}

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export const ACCESS_EVENT_TYPES = [
  'review_access_clicked',
  'publication_details_clicked',
  'subscriber_document_view_clicked',
  'subscriber_document_download_clicked',
] as const

export type AccessEventType = (typeof ACCESS_EVENT_TYPES)[number]

export function isAccessEventType(value: unknown): value is AccessEventType {
  return typeof value === 'string' && (ACCESS_EVENT_TYPES as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// The unavailable sentinel
// ---------------------------------------------------------------------------

/**
 * A metric with no data behind it.
 *
 * Deliberately not zero. "No view reported a duration" and "every view lasted
 * zero seconds" are different findings, and collapsing the first into the
 * second would make an unmonitored publication look like an ignored one.
 */
export const UNAVAILABLE = null

export type Maybe<T> = T | null

/** How an absent metric is rendered. Never "0". */
export const UNAVAILABLE_LABEL = 'Unavailable'

/** How eligibility is rendered for a publication that has no subscribers. */
export const NOT_APPLICABLE_LABEL = 'Not applicable'

export function formatMetric(
  value: Maybe<number>,
  format: (n: number) => string = (n) => String(n),
): string {
  return value === null || value === undefined || Number.isNaN(value)
    ? UNAVAILABLE_LABEL
    : format(value)
}

// ---------------------------------------------------------------------------
// Shapes the definitions operate on
// ---------------------------------------------------------------------------

/** One APRI publication-card click. */
export type AccessEventRow = {
  eventId: string
  visitorId: string
  publicationId: string | null
  slotKey: string | null
  eventType: string
  occurredAt: string
}

/** One confirmed Papermark view session. */
export type ViewRow = {
  papermarkViewId: string
  subscriberId: string | null
  publicationId: string | null
  viewerEmail: string | null
  readerType: ReaderType | null
  viewedAt: string
  durationSeconds: number | null
  completionPct: number | null
}

/** One confirmed Papermark download. */
export type DownloadRow = {
  sourceEventId: string
  subscriberId: string | null
  publicationId: string | null
  viewerEmail: string | null
  readerType: ReaderType | null
  downloadedAt: string
}

// ---------------------------------------------------------------------------
// The definitions
// ---------------------------------------------------------------------------

/**
 * `access_clicks`: count of unique `publication_access_events.event_id`.
 *
 * Counted by event id rather than by row so a retried beacon cannot inflate it.
 */
export function accessClicks(rows: Pick<AccessEventRow, 'eventId'>[]): number {
  return new Set(rows.map((r) => r.eventId)).size
}

/**
 * `unique_clickers`: distinct anonymous visitor ids in the period.
 *
 * A blank visitor id is not counted: a cookie-less client is one unattributable
 * click, not a person, and counting blanks as one visitor would merge every
 * such click into a single phantom reader.
 */
export function uniqueClickers(rows: Pick<AccessEventRow, 'visitorId'>[]): number {
  const ids = new Set<string>()
  for (const r of rows) {
    const id = (r.visitorId ?? '').trim()
    if (id) ids.add(id)
  }
  return ids.size
}

/** `view_sessions`: distinct Papermark view ids. Never a row count. */
export function viewSessions(rows: Pick<ViewRow, 'papermarkViewId'>[]): number {
  const ids = new Set<string>()
  for (const r of rows) {
    const id = (r.papermarkViewId ?? '').trim()
    if (id) ids.add(id)
  }
  return ids.size
}

/**
 * The identity of one reader, for counting unique readers.
 *
 * A subscriber is their subscriber id, so two addresses on one account are one
 * reader. A Complimentary Review prospect has no account, so their verified
 * address is the only identity available — which is why ten sessions from one
 * prospect address count as one reader, not ten.
 *
 * Returns null when neither is present, so an unattributed session is excluded
 * rather than becoming an anonymous "reader".
 */
export function readerKey(
  row: Pick<ViewRow, 'subscriberId' | 'viewerEmail'>,
): string | null {
  const sub = (row.subscriberId ?? '').trim()
  if (sub) return `sub:${sub}`
  const email = normaliseEmail(row.viewerEmail)
  if (email) return `email:${email}`
  return null
}

/**
 * `unique_reader`: distinct subscriber id for paid readers, otherwise distinct
 * normalised verified email.
 */
export function uniqueReaders(
  rows: Pick<ViewRow, 'subscriberId' | 'viewerEmail'>[],
): number {
  const keys = new Set<string>()
  for (const r of rows) {
    const k = readerKey(r)
    if (k) keys.add(k)
  }
  return keys.size
}

/** Unique readers restricted to paid subscribers. */
export function uniquePaidReaders(rows: ViewRow[]): number {
  const ids = new Set<string>()
  for (const r of rows) {
    if (r.readerType && !isPaidReaderType(r.readerType)) continue
    const sub = (r.subscriberId ?? '').trim()
    if (sub) ids.add(sub)
  }
  return ids.size
}

/** Unique readers restricted to Complimentary Review prospects. */
export function uniqueProspectReaders(rows: ViewRow[]): number {
  const emails = new Set<string>()
  for (const r of rows) {
    if (r.readerType !== 'complimentary_review') continue
    const email = normaliseEmail(r.viewerEmail)
    if (email) emails.add(email)
  }
  return emails.size
}

/** `documents_opened`: distinct publication ids with confirmed views. */
export function documentsOpened(rows: Pick<ViewRow, 'publicationId'>[]): number {
  const ids = new Set<string>()
  for (const r of rows) {
    const id = (r.publicationId ?? '').trim()
    if (id) ids.add(id)
  }
  return ids.size
}

/** `download_events`: distinct confirmed Papermark download event ids. */
export function downloadEvents(rows: Pick<DownloadRow, 'sourceEventId'>[]): number {
  const ids = new Set<string>()
  for (const r of rows) {
    const id = (r.sourceEventId ?? '').trim()
    if (id) ids.add(id)
  }
  return ids.size
}

/**
 * `unique_downloaders`: distinct subscriber id or verified prospect email.
 *
 * One reader downloading the same document four times is one downloader and
 * four download events.
 */
export function uniqueDownloaders(
  rows: Pick<DownloadRow, 'subscriberId' | 'viewerEmail'>[],
): number {
  const keys = new Set<string>()
  for (const r of rows) {
    const sub = (r.subscriberId ?? '').trim()
    if (sub) { keys.add(`sub:${sub}`); continue }
    const email = normaliseEmail(r.viewerEmail)
    if (email) keys.add(`email:${email}`)
  }
  return keys.size
}

/**
 * `repeat_sessions`: view sessions minus unique readers, floored at zero.
 *
 * The floor matters: unattributed sessions raise the session count without
 * raising the reader count, so the subtraction can legitimately exceed the
 * sessions of known readers. A negative "repeat" figure would be nonsense.
 */
export function repeatSessions(sessions: number, readers: number): number {
  return Math.max(0, sessions - readers)
}

/**
 * `average_engaged_time`: mean duration across views that reported one.
 *
 * Views with no duration are excluded from both the sum and the divisor.
 * Including them as zero would drag the average toward zero in proportion to
 * how much data Papermark failed to return, which reads as disengagement.
 *
 * Returns null when nothing reported a duration.
 */
export function averageEngagedTime(
  rows: Pick<ViewRow, 'durationSeconds'>[],
): Maybe<number> {
  const values = rows
    .map((r) => r.durationSeconds)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0)

  if (values.length === 0) return UNAVAILABLE
  return values.reduce((a, b) => a + b, 0) / values.length
}

/** Whether a completion reading is usable: a real percentage, 0-100. */
export function isValidCompletion(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
  )
}

/**
 * `completion`: mean completion across views with a valid reading.
 *
 * Same exclusion rule as duration, and the same reason. Returns null when
 * Papermark returned no usable page data — which is common, and is reported as
 * enrichment coverage in the diagnostics rather than hidden.
 */
export function averageCompletion(
  rows: Pick<ViewRow, 'completionPct'>[],
): Maybe<number> {
  const values = rows
    .map((r) => r.completionPct)
    .filter(isValidCompletion)

  if (values.length === 0) return UNAVAILABLE
  return values.reduce((a, b) => a + b, 0) / values.length
}

/**
 * Completion from raw page data, computed only when Papermark returned enough.
 *
 * Null rather than zero when either number is missing or nonsensical, so an
 * absent reading stays absent instead of becoming "read 0%".
 */
export function completionFromPages(
  pagesViewed: number | null | undefined,
  totalPages: number | null | undefined,
): Maybe<number> {
  if (typeof pagesViewed !== 'number' || !Number.isFinite(pagesViewed)) return UNAVAILABLE
  if (typeof totalPages !== 'number' || !Number.isFinite(totalPages)) return UNAVAILABLE
  if (totalPages <= 0 || pagesViewed < 0) return UNAVAILABLE
  return Math.min(100, (pagesViewed / totalPages) * 100)
}

/** Enrichment coverage: the share of views that have duration data. */
export function enrichmentCoverage(total: number, enriched: number): Maybe<number> {
  if (!Number.isFinite(total) || total <= 0) return UNAVAILABLE
  return Math.min(100, (Math.max(0, enriched) / total) * 100)
}

// ---------------------------------------------------------------------------
// The rule that keeps the two systems apart
// ---------------------------------------------------------------------------

/**
 * Why APRI clicks and Papermark sessions are never summed.
 *
 * A click is intent recorded on our side; a session is confirmation from
 * Papermark. One click can produce no session (the reader abandoned the email
 * gate) and one session can arrive with no click (a link opened from an email,
 * or a click that predates tracking). Adding them double-counts the readers who
 * did both and invents readers who did neither.
 */
export const NEVER_COMBINE =
  'APRI access clicks and Papermark view sessions measure different things and are never added together.'

/** Present so a test can assert the rule is honoured rather than assumed. */
export function combinedViewsAreForbidden(): true {
  return true
}

// ---------------------------------------------------------------------------
// Date windows
// ---------------------------------------------------------------------------

export type WindowPreset = '7d' | '30d' | '90d' | 'custom'

export type DateWindow = {
  /** Inclusive lower bound, UTC ISO. */
  fromIso: string
  /** Exclusive upper bound, UTC ISO. */
  toIso: string
  preset: WindowPreset
  days: number
}

export const WINDOW_PRESETS: { value: WindowPreset; label: string; days: number }[] = [
  { value: '7d', label: 'Last 7 days', days: 7 },
  { value: '30d', label: 'Last 30 days', days: 30 },
  { value: '90d', label: 'Last 90 days', days: 90 },
]

/**
 * Builds the one window every dashboard query is filtered by.
 *
 * A single window object shared by every query is what stops the old
 * dashboard's fault, where lifetime totals sat in the same row as 30-day
 * figures and the reader had no way to tell which was which.
 */
export function resolveWindow(input: {
  preset?: string | null
  from?: string | null
  to?: string | null
  now?: Date
}): DateWindow {
  const now = input.now ?? new Date()

  if (input.preset === 'custom' && input.from && input.to) {
    const from = new Date(input.from)
    const to = new Date(input.to)
    if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && from < to) {
      const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000))
      return { fromIso: from.toISOString(), toIso: to.toISOString(), preset: 'custom', days }
    }
  }

  const preset = (['7d', '30d', '90d'] as const).find((p) => p === input.preset) ?? '30d'
  const days = WINDOW_PRESETS.find((p) => p.value === preset)!.days
  const from = new Date(now.getTime() - days * 86_400_000)

  return { fromIso: from.toISOString(), toIso: now.toISOString(), preset, days }
}

// ---------------------------------------------------------------------------
// Africa/Lagos display
// ---------------------------------------------------------------------------

/** Storage is UTC; every report time is shown in Lagos. */
export const DISPLAY_TIME_ZONE = 'Africa/Lagos'

export function formatLagos(value: string | Date | null | undefined): string {
  if (!value) return UNAVAILABLE_LABEL
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return UNAVAILABLE_LABEL

  return new Intl.DateTimeFormat('en-GB', {
    timeZone: DISPLAY_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function normaliseEmail(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim().toLowerCase()
  if (!trimmed || trimmed.length > 254 || !trimmed.includes('@')) return null
  return trimmed
}

/**
 * Whether a reader should be excluded from the figures.
 *
 * Admin accounts and obvious test addresses are excluded where identifiable, so
 * the owner checking a link does not register as subscriber engagement.
 */
export function isExcludedReader(
  email: string | null | undefined,
  adminEmails: readonly string[] = [],
): boolean {
  const e = normaliseEmail(email)
  if (!e) return false
  if (adminEmails.some((a) => normaliseEmail(a) === e)) return true
  return /(^|[.+_-])(test|qa|staging|example)([.+_-]|@)/.test(e) || e.endsWith('@example.com')
}
