/**
 * Internal access levels and the single entitlement rule.
 *
 * L1..L4 are private. They are never rendered to a visitor and never appear in
 * public copy -- the /access page keeps its five public tier names, and this
 * module holds the mapping between the two.
 *
 * Not `server-only`: the admin forms are client components that need the level
 * list and the tier names for their dropdowns. Nothing here is a secret.
 */

export const LEVELS = ['L1', 'L2', 'L3', 'L4'] as const
export type Level = (typeof LEVELS)[number]

export const VISIBILITIES = ['OPEN', ...LEVELS] as const
export type Visibility = (typeof VISIBILITIES)[number]

const RANK: Record<Level, number> = { L1: 1, L2: 2, L3: 3, L4: 4 }

/**
 * The five tier names shown publicly, and the internal level each maps to.
 *
 * Individual and Professional Team Access are the same content at the same
 * level; they differ only in how many named seats the organisation buys.
 */
export const PUBLIC_TIERS = [
  { name: 'Individual Access', level: 'L1', defaultSeats: 1 },
  { name: 'Professional Team Access', level: 'L1', defaultSeats: 5 },
  { name: 'Political Monitor', level: 'L2', defaultSeats: 1 },
  { name: 'Executive Intelligence', level: 'L3', defaultSeats: 1 },
  { name: 'Board Briefing', level: 'L4', defaultSeats: 1 },
] as const satisfies readonly {
  name: string
  level: Level
  defaultSeats: number
}[]

export type PublicTierName = (typeof PUBLIC_TIERS)[number]['name']

export const PUBLIC_TIER_NAMES = PUBLIC_TIERS.map((t) => t.name)

/** Internal level for a public tier name, or null if the name is unrecognised. */
export function levelForPublicTier(tierName: string): Level | null {
  return PUBLIC_TIERS.find((t) => t.name === tierName)?.level ?? null
}

/** Default seat count for a public tier name. Unknown names get one seat. */
export function seatsForPublicTier(tierName: string): number {
  return PUBLIC_TIERS.find((t) => t.name === tierName)?.defaultSeats ?? 1
}

export function seatsForSubscriptionRequest(
  tierName: string,
  submitted: FormDataEntryValue | null
): number | null {
  if (tierName === 'Individual Access') return 1
  if (!tierName) return null
  if (typeof submitted !== 'string' || submitted.trim() === '') return null
  const seats = Number(submitted)
  return Number.isInteger(seats) && seats >= 1 && seats <= 500 ? seats : null
}

export function isLevel(value: unknown): value is Level {
  return typeof value === 'string' && (LEVELS as readonly string[]).includes(value)
}

export function isVisibility(value: unknown): value is Visibility {
  return (
    typeof value === 'string' && (VISIBILITIES as readonly string[]).includes(value)
  )
}

/**
 * The entitlement rule, implemented once.
 *
 * A subscriber may read a publication when it is published, is not OPEN, and
 * its minimum level is at or below theirs. OPEN pieces are excluded on purpose:
 * they are public reading and never form part of a paid library, so counting
 * them here would blur what a level actually includes.
 */
export function isEntitled(
  subscriberLevel: Level,
  visibility: Visibility
): boolean {
  if (visibility === 'OPEN') return false
  return RANK[visibility] <= RANK[subscriberLevel]
}

/** Every visibility a level can read, for building a SQL `in (...)` list. */
export function visibilitiesForLevel(level: Level): Level[] {
  return LEVELS.filter((v) => RANK[v] <= RANK[level])
}

// ---------------------------------------------------------------------------
// Admin display labels
//
// The one place that turns an internal level code into words. Every admin
// screen, dropdown and filter reads from here, so a level can never appear as a
// bare "L3" in one place and a name in another.
//
// Admin-only. The public site never shows a level code -- it uses accessBadge
// below, which names the tier a visitor would recognise and nothing else.
// ---------------------------------------------------------------------------

const LEVEL_NAMES: Record<Level, string> = {
  L1: 'Individual Access / Professional Team Access',
  L2: 'Political Monitor',
  L3: 'Executive Intelligence',
  L4: 'Board Intelligence',
}

/**
 * The single public name for a level, for "and above" phrasing.
 *
 * L1 resolves to Individual Access rather than naming both tiers: "Individual
 * Access and above" already includes Professional Team Access, and listing both
 * would read as two separate thresholds to someone deciding what to buy.
 */
const LEVEL_BASE_NAMES: Record<Level, string> = {
  L1: 'Individual Access',
  L2: 'Political Monitor',
  L3: 'Executive Intelligence',
  L4: 'Board Intelligence',
}

/**
 * Maps a stored tier name to its current user-facing display name.
 *
 * The database stores `'Board Briefing'` for L4 subscribers and
 * `papermark_level_rooms` maps that value to a Data Room. Changing the stored
 * value would break existing records and mappings, so the rename is display-only.
 */
const TIER_DISPLAY_OVERRIDES: Record<string, string> = {
  'Board Briefing': 'Board Intelligence',
}

export function tierDisplayName(storedName: string): string {
  return TIER_DISPLAY_OVERRIDES[storedName] ?? storedName
}

export const TIER_DESCRIPTIONS: Record<string, string> = {
  'Individual Access':
    'Core APRI publications for one named reader.',
  'Professional Team Access':
    'The same core access for a small team of individually named readers.',
  'Political Monitor':
    'Organisational access to continuing political and regulatory monitoring, including the Monthly Intelligence Note, Political Landscape Monitor, Quarterly Outlook, Election Watch and relevant intelligence updates.',
  'Executive Intelligence':
    'Full APRI intelligence plus the executive layer, scheduled executive briefings and priority sector-specific intelligence access.',
  'Board Briefing':
    'Full APRI intelligence, priority bespoke analysis, direct engagement with the intelligence team and the annual Board Political & Regulatory Briefing.',
}

/**
 * The two L1 tiers are the same content at the same level; only the number of
 * named seats separates them. Given a seat count we can say which one it is,
 * so a one-seat L1 is not mislabelled as a team.
 */
const L1_SINGLE = 'Individual Access'
const L1_TEAM = 'Professional Team Access'

/**
 * The name for a level, without its code.
 *
 * `seats` disambiguates L1: one seat is Individual Access, more than one is
 * Professional Team Access. Omit it where seats are unknown -- a publication's
 * minimum level, for instance -- and both names are shown.
 */
export function levelName(level: Level, seats?: number | null): string {
  if (level === 'L1' && typeof seats === 'number' && seats > 0) {
    return seats === 1 ? L1_SINGLE : L1_TEAM
  }
  return LEVEL_NAMES[level]
}

/**
 * The admin label: `L1 — Individual Access / Professional Team Access`.
 *
 * The code is kept alongside the name so the label stays unambiguous -- two of
 * the five public tier names share a level, and the code is what the database
 * actually stores.
 */
export function levelLabel(level: Level, seats?: number | null): string {
  return `${level} — ${levelName(level, seats)}`
}

/** Same, but tolerant of an unset or unrecognised value. */
export function levelLabelOrDash(
  level: unknown,
  seats?: number | null
): string {
  return isLevel(level) ? levelLabel(level, seats) : '—'
}

/**
 * A publication's audience, for admin selectors and lists.
 *
 * OPEN is not a level, so it is named plainly rather than forced through the
 * level lookup.
 */
export function visibilityLabel(visibility: Visibility): string {
  return visibility === 'OPEN' ? 'Open — anyone may read it' : levelLabel(visibility)
}

/** Short form for a table badge, where the row is already narrow. */
export function visibilityBadge(visibility: Visibility): string {
  return visibility === 'OPEN' ? 'Open' : `${visibility} — ${levelName(visibility)}`
}

/**
 * The minimum tier a publication requires, named the way a reader would
 * recognise it: "Individual Access and above".
 *
 * This is the form anything a subscriber or visitor can see must use. A board
 * member should never read "L2" on a page -- the codes are ours, not theirs.
 */
export function minimumLevelLabel(visibility: Visibility): string {
  if (visibility === 'OPEN') return 'Open to all readers'
  // Board Intelligence is the top level, so "and above" would name nothing further.
  if (visibility === 'L4') return LEVEL_BASE_NAMES.L4
  return `${LEVEL_BASE_NAMES[visibility]} and above`
}

/**
 * Access badge text for the public publications list. Deliberately names the
 * public tier a reader would recognise, never the internal level code.
 */
export function accessBadge(visibility: Visibility): string {
  if (visibility === 'OPEN') return 'Complimentary Review Copy — verified email required'
  return `Subscriber Access — ${minimumLevelLabel(visibility)}`
}

/**
 * The stored tier name whose level matches a visibility code.
 *
 * Used to build the preselected `/access?level=` link on subscriber-only
 * publication cards. Returns the single-seat tier for a given level so the
 * access page opens at the right entry point.
 */
export function tierNameForVisibility(visibility: Level): string {
  return PUBLIC_TIERS.find((t) => t.level === visibility && t.defaultSeats === 1)?.name ?? LEVEL_BASE_NAMES[visibility]
}

// ---------------------------------------------------------------------------
// Personal / free / disposable email domain blocklist
//
// Used by the subscription form to require a company email for all tiers above
// Individual Access. The set is checked against the domain portion only, after
// lowercasing. Plus-aliases (name+tag@gmail.com) are irrelevant because the
// domain is what matters.
// ---------------------------------------------------------------------------

const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com',
  'outlook.com', 'outlook.co.uk',
  'hotmail.com', 'hotmail.co.uk', 'hotmail.fr', 'hotmail.de', 'hotmail.it',
  'live.com', 'live.co.uk',
  'yahoo.com', 'yahoo.co.uk', 'yahoo.co.in', 'yahoo.ca', 'yahoo.fr', 'yahoo.de', 'yahoo.it', 'yahoo.com.br',
  'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'aol.co.uk',
  'proton.me', 'protonmail.com', 'protonmail.ch', 'pm.me',
  'gmx.com', 'gmx.net', 'gmx.de',
  'mail.com',
  'yandex.com', 'yandex.ru',
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.info', 'guerrillamail.de', 'guerrillamail.net',
  'tempmail.com', 'throwaway.email', 'sharklasers.com',
  'mailnesia.com', 'maildrop.cc', 'yopmail.com', 'yopmail.fr',
  'dispostable.com', 'trashmail.com', 'trashmail.me',
  '10minutemail.com', 'tempail.com', 'temp-mail.org',
  'guerrillamailblock.com', 'grr.la', 'discard.email',
  'mailsac.com', 'mohmal.com',
])

export const WORK_EMAIL_MESSAGE =
  'Please use your official company or organisation email address for this access level.'

export function requiresWorkEmail(tierName: string): boolean {
  return tierName !== 'Individual Access' && (PUBLIC_TIER_NAMES as readonly string[]).includes(tierName)
}

export function isPersonalEmail(email: string): boolean {
  const trimmed = email.trim().toLowerCase()
  const at = trimmed.lastIndexOf('@')
  if (at < 0) return false
  return PERSONAL_EMAIL_DOMAINS.has(trimmed.slice(at + 1))
}

/** Human label for a publication series code. */
export const SERIES = {
  PLM: 'Political Landscape Monitor',
  AEO: 'Election Observatory',
  AIU: 'Athena Intelligence Update',
  MIN: 'Monthly Intelligence Note',
  QIB: 'Quarterly Intelligence Brief',
  BP: 'Board Paper',
} as const

export type SeriesCode = keyof typeof SERIES

export const SERIES_CODES = Object.keys(SERIES) as SeriesCode[]

export function isSeriesCode(value: unknown): value is SeriesCode {
  return typeof value === 'string' && value in SERIES
}

export function seriesLabel(code: string): string {
  return isSeriesCode(code) ? SERIES[code] : code
}
