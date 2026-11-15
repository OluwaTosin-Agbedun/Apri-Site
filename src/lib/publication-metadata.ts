import { LIBRARY_TAG_KINDS, LIBRARY_TAG_KIND_LABELS, type LibraryTagKind } from "./library-search.ts"

/**
 * Publication editorial metadata, controlled tags and protected summaries:
 * the rules, with no database, network or storage (so the editor, the server
 * actions, the portal and the tests share one definition).
 *
 *  - Metadata is what an editor states on the publication record: author or
 *    editor, the period it covers, its information cut-off and its reading
 *    time. Nothing here is computed, estimated or invented; an empty field is
 *    simply not shown.
 *  - Tags come from a controlled vocabulary (subjects, sectors, geography)
 *    maintained in Admin -> Publication Tags.
 *  - A protected summary is drafted by an editor and shown to entitled
 *    subscribers only after an owner approves exactly the saved text.
 *
 * The public description and one-line summary (documents.description and
 * documents.summary) are separate public teasers; nothing here touches them.
 */

export const EDITORIAL_METADATA_MIGRATION = "20261114_publication_editorial_metadata.sql"
export const EDITORIAL_METADATA_PENDING =
  "Author/editor, covered period, information cut-off, reading time, subject/sector/geography tags and protected summaries need migration db/migrations/20261114_publication_editorial_metadata.sql. Until it is applied, nothing here can be saved; everything else on this page, and the subscriber library, works as before."

export const TAG_KINDS = LIBRARY_TAG_KINDS
export type TagKind = LibraryTagKind
export const TAG_KIND_LABELS = LIBRARY_TAG_KIND_LABELS

export const MAX_AUTHOR_EDITOR_LENGTH = 200
export const MAX_READING_MINUTES = 600
export const MAX_TAG_LABEL_LENGTH = 80
export const MAX_TAGS_PER_PUBLICATION = 60
export const MAX_SUMMARY_FIELD_LENGTH = 1500
export const MAX_UNCERTAINTY_LENGTH = 600

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value)

export type FieldErrors = Record<string, string[]>
export type Validation<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors }

// ---------------------------------------------------------------------------
// Text and dates
// ---------------------------------------------------------------------------

/** Control characters other than tab and newline (Postgres refuses NUL; the rest only hide text). */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

/** Multi-line text as an editor typed it: line endings unified, control characters removed, ends trimmed. */
export function cleanMultiline(raw: unknown): string {
  if (typeof raw !== "string") return ""
  return raw.normalize("NFC").replace(/\r\n?/g, "\n").replace(CONTROL, "").trim()
}

/** One line of text: whitespace runs collapsed to one space. */
export function cleanLine(raw: unknown): string {
  return cleanMultiline(raw).replace(/\s+/g, " ")
}

/** A real calendar day written YYYY-MM-DD, in a sensible editorial range. */
export function isValidDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false
  return value >= "1900-01-01" && value <= "2100-12-31"
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

/** "15 September 2026" for 2026-09-15; "" for anything else. Never shifted by a time zone. */
export function formatDay(value: string | null | undefined): string {
  const day = typeof value === "string" ? value.slice(0, 10) : ""
  if (!isValidDay(day)) return ""
  const [y, m, d] = day.split("-").map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

/** "1–30 September 2026", "1 September – 15 October 2026", "1 December 2025 – 15 January 2026", or one day. */
export function coveredPeriodLabel(start: string, end: string): string {
  if (!isValidDay(start) || !isValidDay(end)) return ""
  if (start === end) return formatDay(start)
  const [sy, sm, sd] = start.split("-").map(Number)
  const [ey, em, ed] = end.split("-").map(Number)
  if (sy === ey && sm === em) return `${sd}–${ed} ${MONTHS[em - 1]} ${ey}`
  if (sy === ey) return `${sd} ${MONTHS[sm - 1]} – ${ed} ${MONTHS[em - 1]} ${ey}`
  return `${formatDay(start)} – ${formatDay(end)}`
}

/** "1 minute", "12 minutes". */
export function readingTimeLabel(minutes: number): string {
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`
}

// ---------------------------------------------------------------------------
// Editorial metadata
// ---------------------------------------------------------------------------

export type EditorialMetadata = {
  authorEditor: string | null
  coveredPeriodStart: string | null
  coveredPeriodEnd: string | null
  informationCutoff: string | null
  readingMinutes: number | null
}

export const EMPTY_METADATA: EditorialMetadata = {
  authorEditor: null,
  coveredPeriodStart: null,
  coveredPeriodEnd: null,
  informationCutoff: null,
  readingMinutes: null,
}

/**
 * The metadata fields as submitted by the editor, validated. Every field is
 * optional; an empty one is stored as nothing (null), never as a guess.
 */
export function validateEditorialMetadata(input: {
  authorEditor?: unknown
  coveredPeriodStart?: unknown
  coveredPeriodEnd?: unknown
  informationCutoff?: unknown
  readingMinutes?: unknown
}): Validation<EditorialMetadata> {
  const errors: FieldErrors = {}
  const add = (field: string, message: string) => (errors[field] ??= []).push(message)

  const author = cleanLine(input.authorEditor)
  if (author.length > MAX_AUTHOR_EDITOR_LENGTH) add("authorEditor", `Keep the author/editor to ${MAX_AUTHOR_EDITOR_LENGTH} characters.`)

  const day = (field: string, raw: unknown, name: string): string | null => {
    const value = typeof raw === "string" ? raw.trim() : ""
    if (!value) return null
    if (!isValidDay(value)) {
      add(field, `Enter a real date for the ${name}, or leave it empty.`)
      return null
    }
    return value
  }
  const start = day("coveredPeriodStart", input.coveredPeriodStart, "start of the covered period")
  const end = day("coveredPeriodEnd", input.coveredPeriodEnd, "end of the covered period")
  const cutoff = day("informationCutoff", input.informationCutoff, "information cut-off")
  if (!errors.coveredPeriodStart && !errors.coveredPeriodEnd) {
    if (start && !end) add("coveredPeriodEnd", "Enter the end of the covered period too, or clear its start.")
    if (end && !start) add("coveredPeriodStart", "Enter the start of the covered period too, or clear its end.")
    if (start && end && end < start) add("coveredPeriodEnd", "The covered period must end on or after its start.")
  }

  const rawMinutes = typeof input.readingMinutes === "string" ? input.readingMinutes.trim() : input.readingMinutes == null ? "" : String(input.readingMinutes)
  let minutes: number | null = null
  if (rawMinutes !== "") {
    if (!/^\d{1,4}$/.test(rawMinutes) || Number(rawMinutes) < 1 || Number(rawMinutes) > MAX_READING_MINUTES) {
      add("readingMinutes", `Enter the reading time in whole minutes, from 1 to ${MAX_READING_MINUTES}, or leave it empty.`)
    } else {
      minutes = Number(rawMinutes)
    }
  }

  if (Object.keys(errors).length) return { ok: false, errors }
  return {
    ok: true,
    value: { authorEditor: author || null, coveredPeriodStart: start, coveredPeriodEnd: end, informationCutoff: cutoff, readingMinutes: minutes },
  }
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export function isTagKind(value: unknown): value is TagKind {
  return typeof value === "string" && (TAG_KINDS as readonly string[]).includes(value)
}

/** A tag label as it is stored and shown: one line, single spaces, 1 to 80 characters; null when unusable. */
export function normaliseTagLabel(raw: unknown): string | null {
  const label = cleanLine(raw)
  if (!label || label.length > MAX_TAG_LABEL_LENGTH) return null
  return label
}

/** How labels are compared for uniqueness within a kind (the database index uses lower(label)). */
export function tagLabelKey(label: string): string {
  return label.toLowerCase()
}

/** The submitted tag ids for a publication: unique, well-formed, within the limit; null if any is malformed. */
export function parseTagIds(values: readonly unknown[]): string[] | null {
  const ids = new Set<string>()
  for (const value of values) {
    if (!isUuid(value)) return null
    ids.add(value.toLowerCase())
  }
  if (ids.size > MAX_TAGS_PER_PUBLICATION) return null
  return [...ids]
}

export type TagRecord = { id: string; kind: TagKind; label: string; active: boolean }

/** Tag labels by kind, sorted, from records (retired ones included: they stay on the publications already carrying them). */
export function labelsByKind(tags: readonly Pick<TagRecord, "kind" | "label">[]): Record<TagKind, string[]> {
  const out = { subject: [], sector: [], geography: [] } as Record<TagKind, string[]>
  for (const tag of tags) if (isTagKind(tag.kind)) out[tag.kind].push(tag.label)
  for (const kind of TAG_KINDS) out[kind].sort((a, b) => a.localeCompare(b, "en-GB", { sensitivity: "base" }) || a.localeCompare(b))
  return out
}

// ---------------------------------------------------------------------------
// Protected summaries
// ---------------------------------------------------------------------------

export type SummaryText = {
  whatChanged: string
  whyItMatters: string
  implications: string
  watchNext: string
  /** The date of the source the summary rests on (YYYY-MM-DD), optional. */
  sourceDate: string | null
  /** What is uncertain, optional. */
  uncertainty: string
}

export type SummaryTextKey = Exclude<keyof SummaryText, "sourceDate">

export const SUMMARY_TEXT_FIELDS: readonly { key: SummaryTextKey; label: string; required: boolean; max: number; hint: string }[] = [
  { key: "whatChanged", label: "What changed", required: true, max: MAX_SUMMARY_FIELD_LENGTH, hint: "The decision, development or change this edition reports." },
  { key: "whyItMatters", label: "Why it matters", required: true, max: MAX_SUMMARY_FIELD_LENGTH, hint: "The consequence for the reader's organisation, exposure or decisions." },
  { key: "implications", label: "Implications and relevant risks/scenarios", required: true, max: MAX_SUMMARY_FIELD_LENGTH, hint: "What follows from it: the risks and scenarios the edition sets out." },
  { key: "watchNext", label: "What to watch next", required: true, max: MAX_SUMMARY_FIELD_LENGTH, hint: "The signals, dates or steps that will show where this goes." },
  { key: "uncertainty", label: "Uncertainty", required: false, max: MAX_UNCERTAINTY_LENGTH, hint: "Optional. What is not yet known, or how firm the assessment is." },
]

export const EMPTY_SUMMARY: SummaryText = { whatChanged: "", whyItMatters: "", implications: "", watchNext: "", sourceDate: null, uncertainty: "" }

/** The summary fields as submitted by the editor, cleaned and validated (an incomplete draft is allowed). */
export function validateSummaryInput(input: Partial<Record<keyof SummaryText, unknown>>): Validation<SummaryText> {
  const errors: FieldErrors = {}
  const value = { ...EMPTY_SUMMARY }
  for (const field of SUMMARY_TEXT_FIELDS) {
    const text = cleanMultiline(input[field.key])
    if (text.length > field.max) (errors[field.key] ??= []).push(`Keep “${field.label}” to ${field.max.toLocaleString("en-GB")} characters.`)
    else value[field.key] = text
  }
  const source = typeof input.sourceDate === "string" ? input.sourceDate.trim() : ""
  if (source && !isValidDay(source)) (errors.sourceDate ??= []).push("Enter a real source date, or leave it empty.")
  else value.sourceDate = source || null
  if (Object.keys(errors).length) return { ok: false, errors }
  return { ok: true, value }
}

export function sameSummary(a: SummaryText, b: SummaryText): boolean {
  return (
    a.whatChanged === b.whatChanged &&
    a.whyItMatters === b.whyItMatters &&
    a.implications === b.implications &&
    a.watchNext === b.watchNext &&
    (a.sourceDate ?? null) === (b.sourceDate ?? null) &&
    a.uncertainty === b.uncertainty
  )
}

/** Every required field written: only then can an owner approve it. */
export function isCompleteSummary(s: SummaryText): boolean {
  return SUMMARY_TEXT_FIELDS.every((f) => !f.required || s[f.key].trim() !== "")
}

export function isEmptySummary(s: SummaryText): boolean {
  return SUMMARY_TEXT_FIELDS.every((f) => s[f.key] === "") && !s.sourceDate
}

/**
 * The approved copy stored with a summary, read strictly: exactly the summary
 * fields as strings (source date a real day or null), complete. Anything else
 * is treated as no approval, so a malformed copy can never be shown.
 */
export function readApprovedSummary(raw: unknown): SummaryText | null {
  let value = raw
  if (typeof value === "string") {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const out = { ...EMPTY_SUMMARY }
  for (const field of SUMMARY_TEXT_FIELDS) {
    const text = record[field.key]
    if (typeof text !== "string") return null
    out[field.key] = text
  }
  const source = record.sourceDate
  if (source === null || source === undefined) out.sourceDate = null
  else if (isValidDay(source)) out.sourceDate = source
  else return null
  return isCompleteSummary(out) ? out : null
}

/** The approved summary's words, for the reader's keyword search (the source date is not text). */
export function summarySearchText(summary: SummaryText | null): string {
  if (!summary) return ""
  return SUMMARY_TEXT_FIELDS.map((f) => summary[f.key]).filter(Boolean).join(" ")
}

/**
 * Where a summary stands, for Admin:
 *  - none      nothing written;
 *  - draft     written, not approved (never shown to subscribers);
 *  - approved  an owner approved exactly this text: entitled subscribers see it;
 *  - changed   it was approved, then edited: hidden until an owner approves again.
 */
export type SummaryStatus = "none" | "draft" | "approved" | "changed"

export function summaryStatus(record: { text: SummaryText; approved: SummaryText | null; removedReason: string | null } | null): SummaryStatus {
  if (!record) return "none"
  if (record.approved && sameSummary(record.approved, record.text)) return "approved"
  // Edited after approval (the editor removes the approval as it saves), or an
  // approved copy of other text (the saved text was changed outside the editor):
  // either way subscribers see nothing until an owner approves the current text.
  if (record.removedReason === "edited" || record.approved) return "changed"
  return isEmptySummary(record.text) ? "none" : "draft"
}

// ---------------------------------------------------------------------------
// What a subscriber's card may show
// ---------------------------------------------------------------------------

/**
 * One permitted edition's reader details: the metadata an editor entered,
 * its tag labels and its approved summary. Built only for editions the access
 * policy already lists for the reader (src/lib/publication-metadata-dal.ts);
 * it never holds a draft, an id of anything but the edition, or who approved.
 */
export type ReaderPublicationDetails = {
  authorEditor: string | null
  coveredPeriod: { start: string; end: string } | null
  informationCutoff: string | null
  readingMinutes: number | null
  tags: Record<TagKind, string[]>
  /** The approved summary, only while the approved copy equals the saved text. */
  summary: SummaryText | null
  /** Its words, for keyword search ("" when none). */
  summaryText: string
}

/** Whether any stated metadata or tag exists to show (nothing is invented when none does). */
export function hasReaderFacts(details: ReaderPublicationDetails | null | undefined): boolean {
  if (!details) return false
  return Boolean(
    details.authorEditor || details.coveredPeriod || details.informationCutoff || details.readingMinutes ||
      TAG_KINDS.some((kind) => details.tags[kind].length > 0),
  )
}
