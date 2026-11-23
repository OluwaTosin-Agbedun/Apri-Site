/** Current platform identity. Historical titles, identifiers and records stay intact. */
export const BRAND_NAME = "Athena Strategic Advisory"
/** Compatibility export: the public identity has no acronym. */
export const BRAND_SHORT_NAME = BRAND_NAME
export const BRAND_DESCRIPTOR = "Political & Regulatory Intelligence"

/**
 * Present current platform wording in saved promotional descriptions without
 * rewriting their source records. Never apply this to publication titles,
 * approved protected summaries, URLs, agreements or audit history.
 */
export function currentBrandCopy(text: string): string {
  return text
    .replace(/\s*Although public-facing, it should appear here as part of the broader monthly intelligence bouquet available to (?:APRA|APRI|Athena Strategic Advisory) readers\./gi, "")
    .replace(/Athena\s+Political\s+(?:&(?:amp;)?|and)\s+Regulatory\s+(?:Advisory|Intelligence)(?:\s*\((?:APRA|APRI)\))?/gi, BRAND_NAME)
    .replace(/(^|[^A-Za-z0-9_@/])(?:APRA|APRI)(?![A-Za-z0-9_@]|\.[A-Za-z0-9]|-(?:MIN|AIU|PLM|AEO|QIB|OTHER|BP)-\d)/gi, `$1${BRAND_NAME}`)
    .trim()
}
