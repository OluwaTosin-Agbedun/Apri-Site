/**
 * The Data Room contract: everything decidable without a network call.
 *
 * Separate from the API client so tests can import it — that module is
 * `server-only`. Field names and value ranges below come from Papermark's
 * published OpenAPI document at https://docs.papermark.com/docs/openapi.json.
 */

// ---------------------------------------------------------------------------
// Watermark
// ---------------------------------------------------------------------------

/**
 * The watermark that says who a copy was issued to.
 *
 * Papermark's email verification is switched off on these links, so the viewer
 * never states who they are and the `{{email}}` token would interpolate to
 * nothing. The identity is therefore written into the text at the moment the
 * link is created, and that link is only ever given to that one person — which
 * is precisely why a link is never reused between people.
 *
 * The tokens Papermark does fill in per view are kept alongside it, so a page
 * that leaks carries when it was opened and from where, as well as by whom.
 */
export function watermarkText(assignedName: string, assignedEmail: string): string {
  const name = assignedName.trim() || 'Unnamed recipient'
  const email = assignedEmail.trim()
  return `APRI CONFIDENTIAL — Assigned to: ${name} — ${email} — {{date}} {{time}} — {{ipAddress}}`
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
 * Tiled, centred, at 45 degrees, in a grey that reads without hiding the words
 * underneath. All seven fields are sent: the schema requires every one of them,
 * so an omission is a 422 rather than a default.
 */
export function watermarkConfig(
  assignedName: string,
  assignedEmail: string
): WatermarkConfig {
  return {
    text: watermarkText(assignedName, assignedEmail),
    is_tiled: true,
    position: 'middle-center',
    rotation: 45,
    color: '#6B7280',
    font_size: 20,
    opacity: 0.18,
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
    watermark_config: watermarkConfig(args.assignedName, args.assignedEmail),
    enable_screenshot_protection: true,
    allow_download: args.allowDownload !== false,
    enable_agreement: false,
    show_banner: false,
  }
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
  { key: 'PLM', label: 'Political Landscape Monitor', codes: ['PLM'] },
  { key: 'AEO', label: 'Election & Democratic Governance Monitor', codes: ['AEO'] },
  { key: 'AIU', label: 'Athena Intelligence Updates', codes: ['AIU'] },
  { key: 'MIN', label: 'Monthly Intelligence Notes', codes: ['MIN'] },
  { key: 'QIB', label: 'Quarterly Intelligence Briefs', codes: ['QIB'] },
  { key: 'OTHER', label: 'Other Assigned Publications', codes: [] },
] as const satisfies readonly { key: string; label: string; codes: readonly string[] }[]

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

/** A series code at the very start of a name, separator required. */
function leadingCode(value: string): string | null {
  const match = value.trim().toUpperCase().match(/^([A-Z]{3})[-_\s]/)
  return match ? match[1]! : null
}

export function categoriseDataRoomDocument(args: {
  title: string
  category?: string | null
}): PortalCategoryKey {
  // The folder an editor filed it in comes first: that is a decision, and a
  // file name is only a habit.
  const folder = (args.category ?? '').trim().toUpperCase()
  if (folder) {
    for (const category of PORTAL_CATEGORIES) {
      for (const code of category.codes) {
        if (folder.includes(code)) return category.key
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
