/** Current platform identity. Historical titles, identifiers and records stay intact. */
export const BRAND_NAME = "Athena Political & Regulatory Advisory"
export const BRAND_SHORT_NAME = "APRA"

/**
 * Present current platform wording in saved promotional descriptions without
 * rewriting their source records. Never apply this to publication titles,
 * approved protected summaries, URLs, agreements or audit history.
 */
export function currentBrandCopy(text: string): string {
  return text
    .replace(/Athena\s+Political\s+(?:&(?:amp;)?|and)\s+Regulatory\s+Intelligence/gi, BRAND_NAME)
    .replace(/(^|[^A-Za-z0-9_@/])APRI(?![A-Za-z0-9_@]|\.[A-Za-z0-9]|-(?:MIN|AIU|PLM|AEO|QIB|OTHER|BP)-\d)/gi, `$1${BRAND_SHORT_NAME}`)
}
