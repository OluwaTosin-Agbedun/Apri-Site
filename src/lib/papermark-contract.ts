/**
 * The parts of the Papermark contract that are pure functions.
 *
 * Kept out of `papermark.ts` because that module is `server-only` and therefore
 * cannot be imported by a test. Everything here is decided without a network
 * call, which is precisely the part that was getting the request rejected: a
 * date in the wrong shape, a query parameter under the wrong name, an error
 * body thrown away and replaced with a status code.
 *
 * Field and parameter names below are taken from Papermark's published OpenAPI
 * document at https://docs.papermark.com/docs/openapi.json.
 */

/**
 * The query parameter that filters documents to one folder.
 *
 * This is the root cause of the 422 this module exists to prevent. Papermark
 * spells the folder filter on `GET /v1/documents` in camelCase, while the
 * folder listing on `GET /v1/folders` spells its parent filter in snake_case.
 * The two are genuinely inconsistent, and sending `folder_id` to the documents
 * endpoint fails input validation -- which reads as "your folder is wrong" when
 * the folder was never the problem.
 */
export const DOCUMENTS_FOLDER_PARAM = 'folderId'

/** The parent filter on `GET /v1/folders`, which really is snake_case. */
export const FOLDERS_PARENT_PARAM = 'parent_id'

// ---------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------

export type ExpiryResult =
  | { ok: true; value: string | null }
  | { ok: false; reason: string }

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Turns a subscription term end into the `expires_at` Papermark accepts.
 *
 * The schema declares `expires_at` as a nullable `date-time`. A subscriber's
 * term end is stored as a PostgreSQL `date`, so it arrives as `2026-12-31` --
 * a date, not a date-time -- and Papermark answers `422 fieldErrors:
 * { expires_at: ["Invalid datetime"] }`.
 *
 * A term that ends on the 31st includes the whole of the 31st, so the date is
 * converted to the last instant of that calendar day rather than to midnight,
 * which would cut the final day off the subscription. UTC is used deliberately:
 * the whole system stores and compares term dates in UTC, and picking the
 * server's local zone here would make an expiry drift by a day depending on
 * where the function happened to run.
 *
 * `null` is returned for no expiry, which the schema permits explicitly. What
 * is never returned is `undefined`, an empty string or an `Invalid Date`.
 */
export function papermarkExpiresAt(
  value: string | Date | null | undefined
): ExpiryResult {
  if (value === null || value === undefined) return { ok: true, value: null }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return { ok: false, reason: 'The term end is not a real date.' }
    }
    return { ok: true, value: value.toISOString() }
  }

  const trimmed = value.trim()
  if (!trimmed) return { ok: true, value: null }

  if (DATE_ONLY.test(trimmed)) {
    const endOfDay = new Date(`${trimmed}T23:59:59.999Z`)
    if (Number.isNaN(endOfDay.getTime())) {
      return { ok: false, reason: `The term end ${trimmed} is not a real date.` }
    }
    return { ok: true, value: endOfDay.toISOString() }
  }

  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, reason: 'The term end could not be read as a date.' }
  }
  return { ok: true, value: parsed.toISOString() }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type PapermarkFailure = {
  status: number
  /** Papermark's own error code, when it sends one. */
  code: string | null
  /** A sentence safe to show an administrator. */
  message: string
  /** Field name to explanation, straight from Papermark, nothing else. */
  fieldErrors: Record<string, string[]>
}

/** Field names we are willing to repeat back. Anything else is summarised. */
const SAFE_FIELD = /^[a-z][a-z0-9_]{0,40}$/i

/** Explanations are short and structural; anything long or link-like is dropped. */
function safeExplanation(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 160) return null
  if (/https?:\/\/|bearer |authorization|token|api[_-]?key/i.test(trimmed)) return null
  return trimmed
}

function readFieldErrors(details: unknown): Record<string, string[]> {
  if (!details || typeof details !== 'object') return {}
  const raw = (details as Record<string, unknown>).fieldErrors
  if (!raw || typeof raw !== 'object') return {}

  const out: Record<string, string[]> = {}
  for (const [field, messages] of Object.entries(raw as Record<string, unknown>)) {
    if (!SAFE_FIELD.test(field)) continue
    const list = (Array.isArray(messages) ? messages : [messages])
      .map(safeExplanation)
      .filter((m): m is string => m !== null)
    if (list.length > 0) out[field] = list
  }
  return out
}

/**
 * Reads a Papermark error body into something an administrator can act on.
 *
 * Two rules govern what comes out of here. Nothing from the request is echoed
 * -- the request carries the bearer token and the subscriber's address, and
 * Papermark's own message sometimes quotes what it was sent. And a validation
 * failure is explained by field, because "Papermark returned 422" told the
 * administrator only that something was wrong somewhere, which is how a
 * camelCase query parameter went unnoticed while a valid folder took the blame.
 *
 * A missing permission is reported as 403 and never folded into 422: the two
 * have entirely different fixes, one on the token and one in the request.
 */
export function describePapermarkFailure(
  status: number,
  body: unknown
): PapermarkFailure {
  const envelope =
    body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const error =
    envelope.error && typeof envelope.error === 'object'
      ? (envelope.error as Record<string, unknown>)
      : {}

  const code = typeof error.code === 'string' && SAFE_FIELD.test(error.code)
    ? error.code
    : null
  const fieldErrors = readFieldErrors(error.details)

  if (status === 401) {
    return {
      status,
      code,
      message: 'Papermark rejected the API token. Check PAPERMARK_API_TOKEN is current.',
      fieldErrors,
    }
  }

  if (status === 403) {
    return {
      status,
      code,
      message:
        'The Papermark API token is valid but is not permitted to do this. Check it has read access to folders and documents and write access to links.',
      fieldErrors,
    }
  }

  if (status === 404) {
    return {
      status,
      code,
      message: 'Papermark has no record of that folder, document or link.',
      fieldErrors,
    }
  }

  if (status === 429) {
    return {
      status,
      code,
      message: 'Papermark is rate-limiting this account. Wait a moment and sync again.',
      fieldErrors,
    }
  }

  if (status === 400 || status === 422) {
    const fields = Object.keys(fieldErrors)

    if (fields.includes('expires_at')) {
      return {
        status,
        code,
        message:
          'Papermark rejected the link expiry date. The subscriber term end must be converted to a complete date and time.',
        fieldErrors,
      }
    }

    if (fields.length > 0) {
      const named = fields
        .map((field) => `${field} (${fieldErrors[field]!.join('; ')})`)
        .join(', ')
      return {
        status,
        code,
        message: `Papermark rejected this request: ${named}.`,
        fieldErrors,
      }
    }

    return {
      status,
      code,
      message:
        'Papermark rejected this request as invalid but named no field. Check the folder is still in the configured client root.',
      fieldErrors,
    }
  }

  return {
    status,
    code,
    message: `Papermark returned ${status}. Try again, or check the Papermark status page.`,
    fieldErrors,
  }
}

// ---------------------------------------------------------------------------
// Classifying a synced document
// ---------------------------------------------------------------------------

export type LibrarySection = 'PLM' | 'AEO' | 'AIU' | 'MIN' | 'QIB' | 'OTHER'

export const LIBRARY_SECTIONS: LibrarySection[] = ['PLM', 'AEO', 'AIU', 'MIN', 'QIB', 'OTHER']

/**
 * Which portal section a synced Papermark document belongs in.
 *
 * Papermark stores a file name and nothing else we control, so the series has
 * to be read from it. The match is anchored and requires the separator -- a
 * document called `MIN-2026-03 Nigeria Outlook` is a Monthly Intelligence Note,
 * while `ADMIN-notes` is not, which an unanchored substring search would get
 * wrong. Anything unrecognised falls through to OTHER rather than being hidden,
 * because a document nobody can classify is still a document the subscriber
 * paid for.
 */
export function classifySyncedDocument(title: string): LibrarySection {
  const value = title.trim().toUpperCase()
  if (/^PLM[-_\s]/.test(value)) return 'PLM'
  if (/^AEO[-_\s]/.test(value)) return 'AEO'
  if (/^AIU[-_\s]/.test(value)) return 'AIU'
  if (/^MIN[-_\s]/.test(value)) return 'MIN'
  if (/^QIB[-_\s]/.test(value)) return 'QIB'
  return 'OTHER'
}

/** The words a subscriber sees for a section. */
export const SECTION_LABELS: Record<LibrarySection, string> = {
  PLM: 'Political Landscape Monitor',
  AEO: 'Election & Democratic Governance Monitor',
  AIU: 'Athena Intelligence Updates',
  MIN: 'Monthly Intelligence Notes',
  QIB: 'Quarterly Intelligence Briefs',
  OTHER: 'Other Assigned Publications',
}

/** The type shown on one card. */
export function sectionTypeLabel(section: LibrarySection): string {
  switch (section) {
    case 'PLM': return 'Political Landscape Monitor'
    case 'AEO': return 'Election & Democratic Governance Monitor'
    case 'AIU': return 'Athena Intelligence Update'
    case 'MIN': return 'Monthly Intelligence Note'
    case 'QIB': return 'Quarterly Intelligence Brief'
    default: return 'Publication'
  }
}

// ---------------------------------------------------------------------------
// What counts as new
// ---------------------------------------------------------------------------

/**
 * Whether a document has changed since the subscriber's previous visit.
 *
 * `changedAt` is the sync timestamp, which the sync only moves when a document
 * actually appears or its title or link changes -- so a nightly sync of an
 * unchanged folder does not relabel the whole library.
 *
 * `previousVisit` is deliberately not "the last time they opened the portal":
 * that would be the visit currently being rendered, and every badge would
 * vanish on the first refresh. It is the last visit before the current session,
 * so a badge survives reading the page twice.
 *
 * With no previous visit recorded, nothing is marked. A subscriber's first
 * sight of their library is all new, and saying so about every row is noise.
 */
export function isNewSince(
  changedAt: string | Date | null,
  previousVisit: string | Date | null
): boolean {
  if (!changedAt || !previousVisit) return false
  const changed = new Date(changedAt).getTime()
  const visited = new Date(previousVisit).getTime()
  if (Number.isNaN(changed) || Number.isNaN(visited)) return false
  return changed > visited
}

// ---------------------------------------------------------------------------
// Reporting a sync
// ---------------------------------------------------------------------------

export type SyncCounts = {
  found: number
  reused: number
  created: number
  synced: number
}

/** One sentence an administrator can check against what they expected. */
export function summariseSync(counts: SyncCounts): string {
  if (counts.found === 0) {
    return 'That folder has no documents in it yet. Nothing was changed, and the library already in place is untouched.'
  }
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  return [
    `${plural(counts.found, 'document')} found`,
    `${plural(counts.reused, 'existing link')} reused`,
    `${plural(counts.created, 'new link')} created`,
    `${plural(counts.synced, 'document')} synchronised`,
  ].join(', ') + '.'
}
