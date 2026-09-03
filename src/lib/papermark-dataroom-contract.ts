/**
 * The Data Room contract: everything decidable without a network call.
 *
 * Separate from the API client so tests can import it — that module is
 * `server-only`. Field names and value ranges below come from Papermark's
 * published OpenAPI document at https://docs.papermark.com/docs/openapi.json.
 */

// ---------------------------------------------------------------------------
// Watermark — Subscriber Edition
// ---------------------------------------------------------------------------

/**
 * The Chancellor-approved Subscriber Edition watermark.
 *
 * The subscriber's normalised email is baked in at link-creation time because
 * Papermark email verification is off for paid links (APRI portal auth is the
 * gate). `{{date}}` and `{{time}}` are Papermark dynamic tokens filled at view
 * time.
 *
 * This must never include: subscriber name, IP address, access level,
 * "Assigned to", "APRI CONFIDENTIAL", or prospect review wording.
 */
export function subscriberWatermarkText(email: string): string {
  const e = email.trim().toLowerCase()
  return `APRI Subscriber Edition · ${e} · {{date}} {{time}} · Confidential · Not for redistribution`
}

/**
 * @deprecated Use `subscriberWatermarkText` — kept only so callers that have
 * not been migrated yet still compile. Will be removed after Phase 4.
 */
export function watermarkText(assignedName: string, assignedEmail: string): string {
  return subscriberWatermarkText(assignedEmail)
}

export type WatermarkConfig = {
  text: string
  is_tiled: boolean
  position: string
  rotation: number
  color: string
  font_size: number
  opacity: number
}

/**
 * Subscriber Edition watermark config. Slightly reduced opacity and font size
 * compared to the former intrusive setting — visible but restrained.
 */
export function subscriberWatermarkConfig(email: string): WatermarkConfig {
  return {
    text: subscriberWatermarkText(email),
    is_tiled: true,
    position: 'middle-center',
    rotation: 45,
    color: '#6B7280',
    font_size: 18,
    opacity: 0.15,
  }
}

/**
 * @deprecated Use `subscriberWatermarkConfig`.
 */
export function watermarkConfig(
  assignedName: string,
  assignedEmail: string
): WatermarkConfig {
  return subscriberWatermarkConfig(assignedEmail)
}

// ---------------------------------------------------------------------------
// Watermark — Complimentary Review (prospect) Edition
// ---------------------------------------------------------------------------

/**
 * The Chancellor-approved Complimentary Review watermark.
 *
 * Unlike the subscriber watermark, the address is NOT baked in: a prospect
 * proves their own address through Papermark email verification, so `{{email}}`
 * is left as a Papermark dynamic token and filled per viewer at view time. That
 * is what lets one link serve every prospect while still stamping each copy
 * with the reader who opened it.
 *
 * This must never include an IP address. IP is retained only in Papermark's
 * own private access logs, never on the page and never on the public site.
 */
export const PROSPECT_WATERMARK_TEXT =
  'APRI Complimentary Review Copy · {{email}} · {{date}} {{time}} · Confidential · Not for redistribution'

export function prospectWatermarkText(): string {
  return PROSPECT_WATERMARK_TEXT
}

/**
 * Complimentary Review watermark config. Same restraint as the subscriber
 * edition — opacity 0.15, font size 18 — so a review copy reads as cleanly as
 * a paid one while still being unmistakably marked.
 */
export function prospectWatermarkConfig(): WatermarkConfig {
  return {
    text: PROSPECT_WATERMARK_TEXT,
    is_tiled: true,
    position: 'middle-center',
    rotation: 45,
    color: '#6B7280',
    font_size: 18,
    opacity: 0.15,
  }
}

// ---------------------------------------------------------------------------
// Link settings
// ---------------------------------------------------------------------------

export type DataRoomLinkSettings = {
  dataroom_id: string
  name: string
  expires_at: string | null
  email_protected: boolean
  email_authenticated: boolean
  allow_list: string[]
  deny_list: string[]
  enable_watermark: boolean
  watermark_config: WatermarkConfig
  enable_screenshot_protection: boolean
  allow_download: boolean
  enable_agreement: boolean
  show_banner: boolean
}

export type DocumentLinkSettings = {
  document_id: string
  name: string
  expires_at: string | null
  email_protected: boolean
  email_authenticated: boolean
  allow_list: string[]
  deny_list: string[]
  enable_watermark: boolean
  watermark_config: WatermarkConfig
  enable_screenshot_protection: boolean
  allow_download: boolean
  enable_agreement: boolean
  show_banner: boolean
}

/**
 * The body for one person's Data Room link.
 *
 * Email protection is off deliberately, and that is the trade this design
 * makes: with it on, Papermark asks the reader to prove an address again after
 * APRI has already signed them in, which is the second verification we are
 * removing. What stands in its place is that the link belongs to one person and
 * every page carries their name — so the link itself is the credential, and it
 * must never be given to anybody else.
 */
export function dataRoomLinkSettings(args: {
  dataroomId: string
  assignedName: string
  assignedEmail: string
  expiresAt: string | null
  allowDownload?: boolean
  label?: string
}): DataRoomLinkSettings {
  const who = args.assignedName.trim() || args.assignedEmail.trim() || 'recipient'
  return {
    dataroom_id: args.dataroomId,
    name: `APRI — ${who}${args.label ? ` — ${args.label}` : ''}`,
    expires_at: args.expiresAt,
    email_protected: false,
    email_authenticated: false,
    allow_list: [],
    deny_list: [],
    enable_watermark: true,
    watermark_config: subscriberWatermarkConfig(args.assignedEmail),
    enable_screenshot_protection: true,
    allow_download: args.allowDownload !== false,
    enable_agreement: false,
    show_banner: false,
  }
}

/**
 * The body for one person's per-document link.
 *
 * Identical security posture to the Data Room link: no email gate, watermarked,
 * screenshot-protected, downloads enabled. The only structural difference is
 * `document_id` instead of `dataroom_id`, which gives Papermark a real target
 * and produces a working embed rather than the broken grey iframe the Data Room
 * URL + `?documentId=` construction creates.
 */
export function documentLinkSettings(args: {
  documentId: string
  assignedName: string
  assignedEmail: string
  expiresAt: string | null
  documentTitle?: string
}): DocumentLinkSettings {
  const who = args.assignedName.trim() || args.assignedEmail.trim() || 'recipient'
  const label = args.documentTitle ? ` — ${args.documentTitle.slice(0, 60)}` : ''
  return {
    document_id: args.documentId,
    name: `APRI — ${who}${label}`,
    expires_at: args.expiresAt,
    email_protected: false,
    email_authenticated: false,
    allow_list: [],
    deny_list: [],
    enable_watermark: true,
    watermark_config: subscriberWatermarkConfig(args.assignedEmail),
    enable_screenshot_protection: true,
    allow_download: true,
    enable_agreement: false,
    show_banner: false,
  }
}

// ---------------------------------------------------------------------------
// Complimentary Review link settings
// ---------------------------------------------------------------------------

export type ReviewLinkSettings = {
  document_id: string
  name: string
  expires_at: string | null
  email_protected: boolean
  email_authenticated: boolean
  allow_list: string[]
  deny_list: string[]
  enable_watermark: boolean
  watermark_config: WatermarkConfig
  enable_screenshot_protection: boolean
  allow_download: boolean
  enable_agreement: boolean
  show_banner: boolean
  domain?: string
  slug?: string
}

/**
 * The body for one review slot's public-facing document link.
 *
 * Three deliberate differences from the subscriber link:
 *
 *  - `email_protected` and `email_authenticated` are both on. A prospect is
 *    anonymous until Papermark verifies their address, and that verification is
 *    the only gate — so unlike a subscriber link, which APRI has already
 *    authenticated, this one must do the checking itself.
 *  - `allow_list` carries the approved recipient list. Papermark then verifies
 *    the address AND checks it against that list, so a review copy reaches only
 *    people the Chancellor has approved. An empty list is refused by the caller
 *    rather than sent: Papermark treats an empty allow list as "any verified
 *    address", which is the opposite of what an empty approved list means.
 *  - The watermark leaves `{{email}}` as a token rather than baking one in,
 *    because one link serves every prospect.
 *
 * `document_id` is required and `dataroom_id` is never sent: a Data Room link
 * would expose all three PDFs plus anything else in the room behind a single
 * card, which is exactly the leak the fixed-slot design exists to prevent.
 */
export function reviewLinkSettings(args: {
  documentId: string
  slotKey: string
  documentTitle?: string
  customDomain?: string | null
  slug?: string | null
  /** Approved recipient addresses. Must not be empty -- see below. */
  allowList?: readonly string[]
}): ReviewLinkSettings {
  const label = args.documentTitle ? ` — ${args.documentTitle.slice(0, 60)}` : ''
  const settings: ReviewLinkSettings = {
    document_id: args.documentId,
    name: `APRI Complimentary Review — ${args.slotKey}${label}`,
    expires_at: null,
    email_protected: true,
    email_authenticated: true,
    allow_list: [...(args.allowList ?? [])],
    deny_list: [],
    enable_watermark: true,
    watermark_config: prospectWatermarkConfig(),
    enable_screenshot_protection: true,
    allow_download: true,
    enable_agreement: false,
    show_banner: false,
  }

  // Only sent when a verified custom domain is configured. Papermark rejects a
  // domain it has not verified, so an unset value must mean "omit the field"
  // rather than a guessed hostname that would fail the whole request.
  const domain = (args.customDomain ?? '').trim()
  if (domain) {
    settings.domain = domain
    const slug = (args.slug ?? '').trim()
    if (slug) settings.slug = slug
  }

  return settings
}

/**
 * Whether a Papermark link response really is a single-document link for the
 * document we asked for.
 *
 * A link that came back pointing at a Data Room, or at a different document,
 * must never be stored: it would put the wrong PDF — or every PDF — behind a
 * public card. Papermark does not always echo `target_type`, so an absent
 * value is tolerated while a present-and-wrong one is rejected.
 */
export function isDocumentTargetedLink(
  link: {
    document_id?: string | null
    dataroom_id?: string | null
    target_type?: string | null
  },
  expectedDocumentId: string,
): { ok: true } | { ok: false; reason: string } {
  if (link.target_type && link.target_type !== 'document') {
    return { ok: false, reason: `Papermark reported target_type "${link.target_type}", not "document".` }
  }
  if (link.dataroom_id) {
    return { ok: false, reason: 'Papermark returned a Data Room link, not a document link.' }
  }
  if (!link.document_id) {
    return { ok: false, reason: 'Papermark returned a link with no document id.' }
  }
  if (link.document_id !== expectedDocumentId) {
    return {
      ok: false,
      reason: `Papermark link targets document ${link.document_id}, not the mapped document ${expectedDocumentId}.`,
    }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Portal categories
// ---------------------------------------------------------------------------

/**
 * The sections a library is shown in, in order.
 *
 * A document is placed by the Data Room folder it sits in, because that is what
 * an editor chooses when they file it. Where there is no folder, the series
 * code at the start of the title is read instead — anchored and requiring the
 * separator, so `ADMIN-notes` is not a Monthly Intelligence Note. Anything
 * still unrecognised lands in Other rather than being dropped.
 */
export const PORTAL_CATEGORIES = [
  { key: 'PLM', label: 'Political Landscape Monitor', codes: ['PLM'], aliases: [] as string[] },
  { key: 'AEO', label: 'Election & Democratic Governance Monitor', codes: ['AEO'], aliases: ['election watch'] },
  { key: 'AIU', label: 'Athena Intelligence Updates', codes: ['AIU'], aliases: [] as string[] },
  { key: 'MIN', label: 'Monthly Intelligence Notes', codes: ['MIN'], aliases: [] as string[] },
  { key: 'QIB', label: 'Quarterly Intelligence Briefs', codes: ['QIB'], aliases: [] as string[] },
  { key: 'OTHER', label: 'Other Assigned Publications', codes: [] as string[], aliases: [] as string[] },
] as const satisfies readonly { key: string; label: string; codes: readonly string[]; aliases: readonly string[] }[]

export type PortalCategoryKey = (typeof PORTAL_CATEGORIES)[number]['key']

export const PORTAL_CATEGORY_KEYS = PORTAL_CATEGORIES.map((c) => c.key)

export function portalCategoryLabel(key: PortalCategoryKey): string {
  return PORTAL_CATEGORIES.find((c) => c.key === key)?.label ?? 'Other Assigned Publications'
}

/** The singular type shown on one card. */
export function portalTypeLabel(key: PortalCategoryKey): string {
  switch (key) {
    case 'PLM':
      return 'Political Landscape Monitor'
    case 'AEO':
      return 'Election & Democratic Governance Monitor'
    case 'AIU':
      return 'Athena Intelligence Update'
    case 'MIN':
      return 'Monthly Intelligence Note'
    case 'QIB':
      return 'Quarterly Intelligence Brief'
    default:
      return 'Publication'
  }
}

/**
 * Strip `.pdf`, copy indicators like "(1)", trailing "copy 2", underscores
 * and hyphens, producing a human-readable title from a raw filename.
 */
export function humaniseFilename(raw: string): string {
  return raw
    .replace(/\.pdf$/i, '')
    .replace(/\s*\(\d+\)\s*$/g, '')
    .replace(/\s+copy\s*\d*$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || raw
}

/** A series code at the very start of a name, separator required. */
function leadingCode(value: string): string | null {
  const match = value.trim().toUpperCase().match(/^([A-Z]{3})[-_\s]/)
  return match ? match[1]! : null
}

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
    .replace(/[-_]+/g, ' ')
    .replace(/&/g, ' ')
    .replace(/^\d+\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function categoriseDataRoomDocument(args: {
  title: string
  category?: string | null
  folderPath?: string | null
}): PortalCategoryKey {
  // The folder an editor filed it in comes first: that is a decision, and a
  // file name is only a habit. Check both the stored category (which may be a
  // prior classification result like 'MIN') and the raw folder path from
  // Papermark (which may be a slug like '/monthly-intelligence-note' or a
  // human-readable name like 'Monthly Intelligence Notes').
  for (const source of [args.category, args.folderPath]) {
    const raw = (source ?? '').trim()
    if (!raw) continue

    // First check the raw value for 3-letter codes (case-insensitive).
    const upper = raw.toUpperCase()
    for (const category of PORTAL_CATEGORIES) {
      for (const code of category.codes) {
        if (upper.includes(code)) return category.key
      }
    }

    // Normalise every path segment, then match against labels and aliases.
    const segments = raw.split('/').map(normaliseSegment).filter(Boolean)
    const joined = segments.join(' ')

    for (const category of PORTAL_CATEGORIES) {
      if (category.key === 'OTHER') continue
      // Normalize the label the same way: strip &, lower, collapse spaces
      const label = category.label.toLowerCase().replace(/&/g, '').replace(/\s+/g, ' ').trim()
      // Plural label
      if (joined.includes(label)) return category.key
      // Singular form (strip trailing 's')
      if (label.endsWith('s') && joined.includes(label.slice(0, -1))) {
        return category.key
      }
      // Explicit aliases (e.g. "election watch" → AEO)
      for (const alias of category.aliases) {
        if (joined.includes(alias)) return category.key
      }
    }
  }

  const code = leadingCode(args.title)
  if (code) {
    const match = PORTAL_CATEGORIES.find((c) =>
      (c.codes as readonly string[]).includes(code),
    )
    if (match) return match.key
  }

  return 'OTHER'
}

/**
 * Maps a PortalCategoryKey to the series code stored on a documents record.
 * Returns empty string for OTHER (no series).
 */
export function categoryToSeries(key: PortalCategoryKey): string {
  return key === 'OTHER' ? '' : key
}

/**
 * Maps a PortalCategoryKey to the default visibility level for new publications.
 * Falls back to 'L1' when the tier is unknown.
 */
export function categoryToDefaultVisibility(
  key: PortalCategoryKey,
  publicTier?: string | null,
): string {
  if (publicTier) {
    if (publicTier === 'Individual Access' || publicTier === 'Professional Team Access') return 'L1'
    if (publicTier === 'Political Monitor') return 'L2'
    if (publicTier === 'Executive Intelligence') return 'L3'
    if (publicTier === 'Board Intelligence' || publicTier === 'Board Briefing') return 'L4'
  }
  switch (key) {
    case 'PLM': return 'L1'
    case 'MIN': return 'L1'
    case 'AIU': return 'L2'
    case 'QIB': return 'L3'
    case 'AEO': return 'L1'
    default: return 'L1'
  }
}

// ---------------------------------------------------------------------------
// Metadata derivation for auto-created publications
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
] as const

const MONTH_ABBREVS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
] as const

export function parseEditionDate(title: string): string | null {
  const s = title.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()

  // YYYY MM DD or YYYY MM
  const ymd = s.match(/\b(20\d{2})\s+(\d{1,2})(?:\s+(\d{1,2}))?\b/)
  if (ymd) {
    const m = parseInt(ymd[2]!, 10)
    if (m >= 1 && m <= 12) {
      const d = ymd[3] ? Math.min(parseInt(ymd[3]!, 10), 28) : 1
      return `${ymd[1]}-${String(m).padStart(2, '0')}-${String(d || 1).padStart(2, '0')}`
    }
  }

  // Month name YYYY or YYYY Month
  for (let i = 0; i < MONTH_NAMES.length; i++) {
    const nameRe = new RegExp(`\\b${MONTH_NAMES[i]!}\\b.*\\b(20\\d{2})\\b|\\b(20\\d{2})\\b.*\\b${MONTH_NAMES[i]!}\\b`)
    const abbrRe = new RegExp(`\\b${MONTH_ABBREVS[i]!}\\b.*\\b(20\\d{2})\\b|\\b(20\\d{2})\\b.*\\b${MONTH_ABBREVS[i]!}\\b`)
    const nameMatch = s.match(nameRe) || s.match(abbrRe)
    if (nameMatch) {
      const year = nameMatch[1] || nameMatch[2]
      return `${year}-${String(i + 1).padStart(2, '0')}-01`
    }
  }

  // Q1-Q4 YYYY
  const quarter = s.match(/\bq([1-4])\b.*\b(20\d{2})\b|\b(20\d{2})\b.*\bq([1-4])\b/)
  if (quarter) {
    const q = parseInt(quarter[1] || quarter[4]!, 10)
    const year = quarter[2] || quarter[3]
    const m = (q - 1) * 3 + 1
    return `${year}-${String(m).padStart(2, '0')}-01`
  }

  return null
}

export function generateEditionCode(series: string, editionDate: string | null): string {
  if (!series || !editionDate) return ''
  const [y, m] = editionDate.split('-')
  if (!y || !m) return ''
  return `APRI-${series}-${y}-${m}`
}

type SeriesTemplate = {
  productLine: string
  frequency: string
  summaryTemplate: string
  descriptionTemplate: string
  coverageAreas: string
}

const SERIES_TEMPLATES: Record<string, SeriesTemplate> = {
  PLM: {
    productLine: 'Political Intelligence',
    frequency: 'Monthly',
    summaryTemplate: 'Political Landscape Monitor — a monthly assessment of the political and policy environment.',
    descriptionTemplate: 'This edition of the Political Landscape Monitor provides a comprehensive assessment of the current political landscape, policy developments and regulatory shifts relevant to business operations and investment decisions in Nigeria.',
    coverageAreas: 'Political landscape\nPolicy developments\nRegulatory environment\nGovernance trends',
  },
  AEO: {
    productLine: 'Political Intelligence',
    frequency: 'Event-driven',
    summaryTemplate: 'Election & Democratic Governance Monitor — tracking electoral processes, governance transitions and democratic developments.',
    descriptionTemplate: 'This edition of the Election & Democratic Governance Monitor analyses ongoing electoral and democratic governance developments, assessing their implications for the business and investment environment.',
    coverageAreas: 'Electoral processes\nDemocratic governance\nPolitical transitions\nInstitutional developments',
  },
  AIU: {
    productLine: 'Political Intelligence',
    frequency: 'As required',
    summaryTemplate: 'Athena Intelligence Update — focused analysis on a developing situation or event.',
    descriptionTemplate: 'This Athena Intelligence Update provides focused analysis on a specific political, regulatory or security development of immediate relevance to business and investment decisions.',
    coverageAreas: 'Current developments\nSecurity environment\nPolicy impact\nBusiness implications',
  },
  MIN: {
    productLine: 'Political Intelligence',
    frequency: 'Monthly',
    summaryTemplate: 'Monthly Intelligence Note — a concise brief on the key political and security developments of the month.',
    descriptionTemplate: 'This Monthly Intelligence Note summarises the key political, regulatory and security developments of the reporting period, with forward-looking assessments for business and investment planning.',
    coverageAreas: 'Political developments\nSecurity environment\nEconomic policy\nRegulatory changes',
  },
  QIB: {
    productLine: 'Political Intelligence',
    frequency: 'Quarterly',
    summaryTemplate: 'Quarterly Intelligence Brief — a strategic review of the political and economic environment.',
    descriptionTemplate: 'This Quarterly Intelligence Brief provides a strategic review of the political, economic and security environment over the reporting quarter, with an outlook for the period ahead.',
    coverageAreas: 'Quarterly political review\nEconomic environment\nSecurity assessment\nStrategic outlook',
  },
}

export type DerivedMetadata = {
  title: string
  kicker: string
  strapline: string
  series: string
  productLine: string
  frequency: string
  editionCode: string
  editionDate: string | null
  pageCount: number | null
  summary: string
  description: string
  coverageAreas: string
  visibility: string
  slug: string
}

export function derivePublicationMetadata(args: {
  filename: string
  category: PortalCategoryKey
  folderPath?: string | null
  numPages?: number | null
  publicTier?: string | null
}): DerivedMetadata {
  const title = humaniseFilename(args.filename)
  const series = categoryToSeries(args.category)
  const editionDate = parseEditionDate(args.filename)
  const editionCode = generateEditionCode(series, editionDate)
  const visibility = categoryToDefaultVisibility(args.category, args.publicTier)
  const template = series ? SERIES_TEMPLATES[series] : null

  let kicker = ''
  if (editionDate) {
    const [y, m] = editionDate.split('-')
    if (y && m) {
      const mi = parseInt(m, 10) - 1
      const monthName = mi >= 0 && mi < 12
        ? MONTH_NAMES[mi]!.charAt(0).toUpperCase() + MONTH_NAMES[mi]!.slice(1)
        : m
      kicker = `${monthName} ${y}`
    }
  }

  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled'

  return {
    title,
    kicker,
    strapline: '',
    series,
    productLine: template?.productLine ?? '',
    frequency: template?.frequency ?? '',
    editionCode,
    editionDate,
    pageCount: args.numPages ?? null,
    summary: template?.summaryTemplate ?? '',
    description: template?.descriptionTemplate ?? '',
    coverageAreas: template?.coverageAreas ?? '',
    visibility,
    slug,
  }
}

// ---------------------------------------------------------------------------
// Badges and versions
// ---------------------------------------------------------------------------

export type DocumentBadge = 'new' | 'updated' | null

/**
 * Which badge a document has earned, decided from stored timestamps alone.
 *
 * "New" means APRI first saw it after the reader's previous visit. "Updated"
 * means it was already there and its version changed since then. A reader with
 * no previous visit recorded gets neither: on a first sight everything is new,
 * and saying so about every row is noise rather than a signal.
 */
export function documentBadge(args: {
  firstSeenAt: string | Date | null
  updatedAt: string | Date | null
  previousVisit: string | Date | null
}): DocumentBadge {
  if (!args.previousVisit) return null
  const since = new Date(args.previousVisit).getTime()
  if (Number.isNaN(since)) return null

  const firstSeen = args.firstSeenAt ? new Date(args.firstSeenAt).getTime() : NaN
  if (!Number.isNaN(firstSeen) && firstSeen > since) return 'new'

  const updated = args.updatedAt ? new Date(args.updatedAt).getTime() : NaN
  if (!Number.isNaN(updated) && updated > since) return 'updated'

  return null
}

/**
 * A stable fingerprint of a document's current state.
 *
 * Two syncs that see the same unchanged document produce the same key, so a
 * notification goes out once per real version rather than once per run. The
 * page count is part of it because a re-upload that replaces the file is a new
 * version of the same publication, and worth telling a subscriber about.
 */
export function documentVersionKey(args: {
  title: string
  numPages?: number | null
  updatedAt?: string | Date | null
}): string {
  const updated = args.updatedAt ? new Date(args.updatedAt) : null
  const stamp = updated && !Number.isNaN(updated.getTime()) ? updated.toISOString() : ''
  return [args.title.trim(), args.numPages ?? '', stamp].join('|')
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export type SortableDocument = {
  papermarkUpdatedAt: string | null
  papermarkCreatedAt: string | null
  firstSeenAt: string | null
}

/** Newest first, on the most reliable timestamp each document actually has. */
export function newestFirst(a: SortableDocument, b: SortableDocument): number {
  return effectiveDate(b) - effectiveDate(a)
}

function effectiveDate(document: SortableDocument): number {
  for (const value of [
    document.papermarkUpdatedAt,
    document.papermarkCreatedAt,
    document.firstSeenAt,
  ]) {
    if (!value) continue
    const time = new Date(value).getTime()
    if (!Number.isNaN(time)) return time
  }
  return 0
}
