import 'server-only'
import { getSql } from './db'
import { isVisibility, type Visibility } from './entitlements'

export { PUBLICATION_SECTIONS, type PublicationSection } from "./sections"

export type Publication = {
  id: string
  slug: string
  section: string
  kicker: string
  title: string
  strapline: string
  productLine: string
  description: string
  frequency: string
  audience: string
  attribution: string
  ctaLabel: string
  ctaMode: 'link' | 'request'
  papermarkLink: string
  coverageAreas: string
  visibility: Visibility
  openLinkUrl: string | null
  series: string
  code: string | null
  editionDate: string | null
  summary: string
  sortOrder: number
  isPublished: boolean
}

type Row = {
  id: string
  slug: string
  section_label: string
  kicker: string
  title: string
  strapline: string
  product_line: string
  description: string
  frequency: string
  audience: string
  attribution: string
  cta_label: string
  cta_mode: 'link' | 'request'
  papermark_link: string
  coverage_areas: string
  visibility: string
  open_link_url: string | null
  series: string
  code: string | null
  edition_date: string | null
  summary: string
  sort_order: number
  is_published: boolean
}

function toPublication(row: Row): Publication {
  return {
    id: row.id,
    slug: row.slug,
    section: row.section_label,
    kicker: row.kicker,
    title: row.title,
    strapline: row.strapline,
    productLine: row.product_line,
    description: row.description,
    frequency: row.frequency,
    audience: row.audience,
    attribution: row.attribution,
    ctaLabel: row.cta_label,
    ctaMode: row.cta_mode,
    papermarkLink: row.papermark_link,
    coverageAreas: row.coverage_areas,
    // An unrecognised value falls back to the most restrictive setting. A
    // publication must never become public because its visibility was mangled.
    visibility: isVisibility(row.visibility) ? row.visibility : 'L4',
    openLinkUrl: row.open_link_url,
    series: row.series,
    code: row.code,
    editionDate: row.edition_date,
    summary: row.summary || row.description,
    sortOrder: row.sort_order,
    isPublished: row.is_published,
  }
}

const SELECT_COLUMNS = `
  id, slug, section_label, kicker, title, strapline, product_line,
  description, frequency, audience, attribution, cta_label, cta_mode,
  papermark_link, coverage_areas, visibility, open_link_url,
  series, code, edition_date, summary, sort_order, is_published
`

/**
 * Reads for the public pages, which are prerendered.
 *
 * Those pages are cached rather than rendered per visitor, so this query runs
 * during the build. That means an unreachable database no longer produces a slow
 * page -- it fails the whole deployment, which is a far worse outcome and one
 * that a transient Neon hiccup could cause.
 *
 * So a public read degrades to an empty result instead of throwing. The page
 * already has an empty state, revalidation retries within five minutes, and no
 * redeploy is needed to recover. A misconfiguration is still loud everywhere it
 * matters: the admin pages and the actions below throw as before, so nobody can
 * mistake a broken database for a site with no publications.
 */
async function publicRead(
  run: () => Promise<Row[]>,
  context: string
): Promise<Row[]> {
  try {
    return await run()
  } catch (error) {
    // Surfaced in the build and function logs, never to a visitor. No query text
    // or connection string is included.
    console.warn(
      `[publications] ${context} failed; rendering an empty list. ` +
        `The page will retry on the next revalidation.`
    )
    return []
  }
}

/** Published publications, for the public site. */
export async function getPublishedPublications(): Promise<Publication[]> {
  const rows = await publicRead(async () => {
    const sql = getSql()
    return (await sql.query(
      `select ${SELECT_COLUMNS} from documents
       where is_published = true
       order by sort_order asc, created_at desc`
    )) as Row[]
  }, 'published list')

  return rows.map(toPublication)
}

/** Single publication by slug, for detail pages. */
export async function getPublicationBySlug(slug: string): Promise<Publication | null> {
  const rows = await publicRead(async () => {
    const sql = getSql()
    return (await sql.query(
      `select ${SELECT_COLUMNS} from documents where slug = $1 limit 1`,
      [slug]
    )) as Row[]
  }, 'lookup by slug')

  return rows[0] ? toPublication(rows[0]) : null
}

/**
 * Everything, published or not.
 *
 * Used by the public publications index and by the CMS list. Degrades the same
 * way for the same reason -- the index is prerendered too.
 */
export async function getAllPublications(): Promise<Publication[]> {
  const rows = await publicRead(async () => {
    const sql = getSql()
    return (await sql.query(
      `select ${SELECT_COLUMNS} from documents
       order by sort_order asc, created_at desc`
    )) as Row[]
  }, 'full list')

  return rows.map(toPublication)
}
