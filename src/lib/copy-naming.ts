/**
 * Names for documents, links, files and copies — generated, never typed.
 *
 * An operator provisioning a copy by hand is one keystroke away from sending
 * someone a document with another subscriber's name on it. Every name here is
 * derived from the same two records, so the four fields on the provisioning
 * form agree with each other by construction and can be pasted rather than
 * retyped.
 *
 * Not `server-only`: the provisioning form is a client component and needs
 * these to render the copy-ready fields. Nothing here is secret — it is the
 * subscriber's own name and the publication's code.
 */

export type NamedPublication = {
  series: string
  code: string | null
  title: string
  editionDate: string | Date | null
}

export type NamedSubscriber = {
  fullName: string
  organisation: string
  /** Stable short number, so a corrected name never changes an issued copy id. */
  seatNo: number | null
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function parts(date: string | Date | null): { year: string; month: string; monthName: string } | null {
  if (!date) return null
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return null
  return {
    year: String(d.getUTCFullYear()),
    month: String(d.getUTCMonth() + 1).padStart(2, '0'),
    monthName: MONTHS[d.getUTCMonth()] ?? '',
  }
}

/**
 * The canonical short code for an edition: `MIN-2026-08`.
 *
 * Generated from series and edition date rather than read from the stored
 * `code` column, so it is identical everywhere and cannot be mistyped. Falls
 * back to the stored code, then to the series alone, so a publication missing
 * an edition date still gets a usable identifier.
 */
export function editionCode(publication: NamedPublication): string {
  const p = parts(publication.editionDate)
  if (publication.series && p) return `${publication.series}-${p.year}-${p.month}`
  if (publication.code) return publication.code.replace(/^APRI-/i, '')
  return publication.series || 'EDITION'
}

/** `Monthly Intelligence Note — August 2026 · MIN-2026-08` */
export function documentDisplayName(
  publication: NamedPublication,
  seriesName?: string
): string {
  const p = parts(publication.editionDate)
  const name = seriesName || publication.title
  const period = p ? `${p.monthName} ${p.year}` : ''

  return [period ? `${name} — ${period}` : name, editionCode(publication)]
    .filter(Boolean)
    .join(' · ')
}

/** `MIN-2026-08 · Adaeze Okonkwo · Zenith Bank` — the Papermark link name. */
export function linkOperatorName(
  publication: NamedPublication,
  subscriber: NamedSubscriber
): string {
  return [editionCode(publication), subscriber.fullName, subscriber.organisation]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' · ')
}

/** `MIN-2026-08-Adaeze-Okonkwo.pdf` — safe for any filesystem or upload form. */
export function stampedFileName(
  publication: NamedPublication,
  subscriber: NamedSubscriber
): string {
  const slug = (value: string) =>
    value
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')

  const name = slug(subscriber.fullName || 'subscriber')
  return `${editionCode(publication)}-${name}.pdf`
}

/**
 * Initials for the copy id. Two letters where possible, so `AO-014` reads as a
 * person rather than a serial number.
 */
function initials(fullName: string): string {
  const words = fullName
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}]/gu, ''))
    .filter(Boolean)

  if (words.length === 0) return 'XX'
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase()
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase()
}

/**
 * `MIN-2026-08/AO-014` — the code stamped into the footer.
 *
 * Built from the seat number rather than the name, so correcting a spelling
 * does not change a code already printed inside issued documents. Unique in the
 * database, so a copy found somewhere it should not be resolves back to exactly
 * one access row.
 */
export function copyId(
  publication: NamedPublication,
  subscriber: NamedSubscriber
): string {
  const seat = subscriber.seatNo === null || subscriber.seatNo === undefined
    ? '000'
    : String(subscriber.seatNo).padStart(3, '0')

  return `${editionCode(publication)}/${initials(subscriber.fullName)}-${seat}`
}

/** All four names at once, for the provisioning form. */
export function copyNames(
  publication: NamedPublication,
  subscriber: NamedSubscriber,
  seriesName?: string
): {
  documentName: string
  linkName: string
  fileName: string
  copyId: string
} {
  return {
    documentName: documentDisplayName(publication, seriesName),
    linkName: linkOperatorName(publication, subscriber),
    fileName: stampedFileName(publication, subscriber),
    copyId: copyId(publication, subscriber),
  }
}
