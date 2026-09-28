import "server-only"
import { getSql } from "./db"
import { isVisibility, type Visibility } from "./entitlements"
import { canProvisionLinks, deserialiseRecipients } from "./review-recipients"
import { editionRecipientsReady } from "./edition-recipients-schema"

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
  ctaMode: "link" | "request"
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
  cta_mode: "link" | "request"
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
    visibility: isVisibility(row.visibility) ? row.visibility : "L4",
    openLinkUrl: row.open_link_url,
    series: row.series,
    code: row.code,
    editionDate: row.edition_date,
    summary: row.summary || row.description,
    sortOrder: row.sort_order,
    isPublished: row.is_published,
  }
}

/**
 * Strip private URLs from publications for public consumption.
 *
 * Non-OPEN publications must never expose papermarkLink (the subscriber Data
 * Room address) or openLinkUrl (meaningless for restricted content). This runs
 * after toPublication so the admin-facing full object is never passed through
 * by accident — public queries always call this.
 */
function toPublicPublication(pub: Publication): Publication {
  if (pub.visibility === "OPEN") return pub
  return { ...pub, papermarkLink: "", openLinkUrl: null }
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
  context: string,
): Promise<Row[]> {
  try {
    return await run()
  } catch (error) {
    // Surfaced in the build and function logs, never to a visitor. No query text
    // or connection string is included.
    console.warn(
      `[publications] ${context} failed; rendering an empty list. ` +
        `The page will retry on the next revalidation.`,
    )
    return []
  }
}

/** Published subscriber-only publications, for the public site. OPEN excluded. */
export async function getPublishedPublications(): Promise<Publication[]> {
  const rows = await publicRead(async () => {
    const sql = getSql()
    return (await sql.query(
      `select ${SELECT_COLUMNS} from documents
       where is_published = true and status = 'published'
         and visibility <> 'OPEN'
       order by sort_order asc, created_at desc`,
    )) as Row[]
  }, "published list")

  return rows.map(toPublication).map(toPublicPublication)
}

/** Published OPEN editions, for the public Publications page. */
export async function getOpenPublications(): Promise<Publication[]> {
  const rows = await publicRead(async () => {
    const sql = getSql()
    return (await sql.query(
      `select ${SELECT_COLUMNS} from documents
       where is_published = true and visibility = 'OPEN'
       order by sort_order asc, created_at desc`,
    )) as Row[]
  }, "open publications list")

  return rows.map(toPublication)
}

/** Single publication by slug, for detail pages. OPEN and subscriber-only. */
export async function getPublicationBySlug(
  slug: string,
): Promise<Publication | null> {
  const rows = await publicRead(async () => {
    const sql = getSql()
    return (await sql.query(
      `select ${SELECT_COLUMNS} from documents
       where slug = $1 and is_published = true and status = 'published'
       limit 1`,
      [slug],
    )) as Row[]
  }, "lookup by slug")

  return rows[0] ? toPublicPublication(toPublication(rows[0])) : null
}

// ---------------------------------------------------------------------------
// Complimentary Review Library (public read)
// ---------------------------------------------------------------------------

export type ReviewCard = {
  id: string
  pubTitle: string
  publicationType: string
  description: string
  frequency: string
  audience: string
  slotKey: "MIN" | "AIU" | "PLM"
  editionDate: string | null
  editionLabel: string
  papermarkDocumentId: string
  isLatest: boolean
}

export type SecureReviewCard = ReviewCard & { secureUrl: string }

export type ReviewLibrary = {
  items: ReviewCard[]
}

/** Public metadata only. This query deliberately never selects a secure URL. */
export async function getPublicReviewLibrary(): Promise<ReviewLibrary | null> {
  try {
    const sql = getSql()

    const enabledRow = (await sql`
      select value from app_settings where key = 'review_library_enabled' limit 1
    `) as { value: string }[]

    if (enabledRow[0]?.value !== "true") return null

    const items = (await sql`
      select distinct on (e.series)
             e.id, e.title as pub_title, e.publication_type, e.description,
             e.frequency, e.audience, e.series as slot_key, e.edition_date, e.edition_label,
             e.papermark_document_id, e.is_latest
      from review_publication_editions e
      where e.publication_state = 'published'
      order by e.series, e.is_latest desc, e.edition_date desc nulls last,
               e.edition_order desc, e.created_at desc, e.id desc
    `) as {
      pub_title: string
      publication_type: string
      description: string
      frequency: string
      audience: string
      slot_key: string
      id: string
      edition_date: string | null
      edition_label: string
      papermark_document_id: string
      is_latest: boolean
    }[]

    if (
      items.length !== 3 ||
      new Set(items.map((item) => item.slot_key)).size !== 3
    )
      return null

    return {
      items: items.map((r) => ({
        id: r.id,
        pubTitle: r.pub_title,
        publicationType: r.publication_type,
        description: r.description,
        frequency: r.frequency,
        audience: r.audience,
        slotKey: r.slot_key as "MIN" | "AIU" | "PLM",
        editionDate: r.edition_date,
        editionLabel: r.edition_label,
        papermarkDocumentId: r.papermark_document_id,
        isLatest: r.is_latest,
      })),
    }
  } catch {
    return null
  }
}

/**
 * The homepage's one-card-per-series selection, with each card's secure URL.
 *
 * Selecting the URL here is deliberate: the public pages link straight to each
 * edition's Papermark document, and that link's own allow list decides who can
 * open it. What this query never selects is anyone's address -- whether an
 * edition has recipients is tested for existence only.
 *
 * The per-series choice is made first and the access check applied to the
 * chosen edition afterwards, so an edition that is not ready hides the review
 * section rather than being silently replaced by an older edition.
 */
export async function getReviewLibrary(): Promise<{
  items: SecureReviewCard[]
} | null> {
  try {
    const sql = getSql()
    const settings = (await sql`
      select key, value from app_settings
      where key in ('review_library_enabled', 'review_approved_recipients')
    `) as { key: string; value: string }[]
    const setting = (key: string) =>
      settings.find((row) => row.key === key)?.value
    if (setting("review_library_enabled") !== "true") return null
    // Only editions not yet adopted still depend on the shared list.
    const sharedConfigured = canProvisionLinks(
      deserialiseRecipients(setting("review_approved_recipients")),
    )

    // Before the per-edition migration has run there is no recipient_mode:
    // every published edition with a secure link is judged by the shared list,
    // which is exactly how the migration classifies it, so readers see the
    // same cards before and after it.
    const perEdition = await editionRecipientsReady(sql)
    const items = (perEdition
      ? await sql`
    select distinct on (e.series)
      e.id, e.title as pub_title, e.publication_type, e.description,
      e.frequency, e.audience, e.series as slot_key, e.secure_link_url,
      e.edition_date, e.edition_label, e.papermark_document_id, e.is_latest,
      case
        when e.recipient_mode = 'shared_legacy' then ${sharedConfigured}::boolean
        else exists (
          select 1 from review_edition_recipients r
          where r.edition_id = e.id and r.revoked_at is null
        )
      end as access_configured
    from review_publication_editions e
    where e.publication_state = 'published'
      and e.secure_link_url <> '' and e.secure_link_verified_at is not null
      and e.secure_link_document_id = e.papermark_document_id
    order by e.series, e.is_latest desc, e.edition_date desc nulls last,
             e.edition_order desc, e.created_at desc, e.id desc
    `
      : await sql`
    select distinct on (e.series)
      e.id, e.title as pub_title, e.publication_type, e.description,
      e.frequency, e.audience, e.series as slot_key, e.secure_link_url,
      e.edition_date, e.edition_label, e.papermark_document_id, e.is_latest,
      (e.secure_link_id is not null and ${sharedConfigured}::boolean) as access_configured
    from review_publication_editions e
    where e.publication_state = 'published'
      and e.secure_link_url <> '' and e.secure_link_verified_at is not null
      and e.secure_link_document_id = e.papermark_document_id
    order by e.series, e.is_latest desc, e.edition_date desc nulls last,
             e.edition_order desc, e.created_at desc, e.id desc
    `) as {
      pub_title: string
      publication_type: string
      description: string
      frequency: string
      audience: string
      slot_key: string
      secure_link_url: string
      id: string
      edition_date: string | null
      edition_label: string
      papermark_document_id: string
      is_latest: boolean
      access_configured: boolean
    }[]
    const requiredSlots = new Set(["MIN", "AIU", "PLM"])
    if (
      items.length !== 3 ||
      new Set(items.map((item) => item.slot_key)).size !== 3 ||
      items.some((item) => !requiredSlots.has(item.slot_key)) ||
      items.some((item) => item.access_configured !== true)
    )
      return null
    return {
      items: items.map((r) => ({
        id: r.id,
        pubTitle: r.pub_title,
        publicationType: r.publication_type,
        description: r.description,
        frequency: r.frequency,
        audience: r.audience,
        slotKey: r.slot_key as ReviewCard["slotKey"],
        secureUrl: r.secure_link_url,
        editionDate: r.edition_date,
        editionLabel: r.edition_label,
        papermarkDocumentId: r.papermark_document_id,
        isLatest: r.is_latest,
      })),
    }
  } catch {
    return null
  }
}

/**
 * Complete verified, published Review archive.
 *
 * Recipient addresses are never selected. Each edition is listed only if its
 * access is configured: its own recipients exist, or -- for an edition not yet
 * adopted -- the shared list it still uses is not empty.
 */
export async function getReviewPublicationArchive(): Promise<SecureReviewCard[]> {
  try {
    const sql = getSql()
    const settings = (await sql`
      select key, value from app_settings
      where key in ('review_library_enabled', 'review_approved_recipients')
    `) as { key: string; value: string }[]
    const setting = (key: string) =>
      settings.find((row) => row.key === key)?.value
    if (setting("review_library_enabled") !== "true") return []
    const sharedConfigured = canProvisionLinks(
      deserialiseRecipients(setting("review_approved_recipients")),
    )

    // Before the migration: the shared-list rule for every linked edition,
    // exactly as the migration will classify them (see getReviewLibrary).
    const perEdition = await editionRecipientsReady(sql)
    const rows = (perEdition
      ? await sql`
      select e.id, e.title as pub_title, e.publication_type, e.description, e.frequency,
             e.audience, e.series as slot_key, e.secure_link_url, e.edition_date, e.edition_label,
             e.papermark_document_id, e.is_latest
      from review_publication_editions e
      where e.publication_state = 'published'
        and e.secure_link_url <> '' and e.secure_link_verified_at is not null
        and e.secure_link_document_id = e.papermark_document_id
        and (
          (e.recipient_mode = 'shared_legacy' and ${sharedConfigured}::boolean)
          or (e.recipient_mode = 'edition' and exists (
            select 1 from review_edition_recipients r
            where r.edition_id = e.id and r.revoked_at is null
          ))
        )
      order by case e.series when 'MIN' then 1 when 'AIU' then 2 else 3 end,
               is_latest desc, edition_sort_key desc, edition_date desc nulls last, edition_order desc,
               created_at desc, id desc
    `
      : await sql`
      select e.id, e.title as pub_title, e.publication_type, e.description, e.frequency,
             e.audience, e.series as slot_key, e.secure_link_url, e.edition_date, e.edition_label,
             e.papermark_document_id, e.is_latest
      from review_publication_editions e
      where e.publication_state = 'published'
        and e.secure_link_url <> '' and e.secure_link_verified_at is not null
        and e.secure_link_document_id = e.papermark_document_id
        and e.secure_link_id is not null and ${sharedConfigured}::boolean
      order by case e.series when 'MIN' then 1 when 'AIU' then 2 else 3 end,
               is_latest desc, edition_sort_key desc, edition_date desc nulls last, edition_order desc,
               created_at desc, id desc
    `) as Array<{
      id: string
      pub_title: string
      publication_type: string
      description: string
      frequency: string
      audience: string
      slot_key: ReviewCard["slotKey"]
      secure_link_url: string
      edition_date: string | null
      edition_label: string
      papermark_document_id: string
      is_latest: boolean
    }>
    return rows.map((r) => ({
      id: r.id,
      pubTitle: r.pub_title,
      publicationType: r.publication_type,
      description: r.description,
      frequency: r.frequency,
      audience: r.audience,
      slotKey: r.slot_key,
      secureUrl: r.secure_link_url,
      editionDate: r.edition_date,
      editionLabel: r.edition_label,
      papermarkDocumentId: r.papermark_document_id,
      isLatest: r.is_latest,
    }))
  } catch {
    return []
  }
}

const PROSPECT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * One verified prospect's Review Library: only the editions granted to them.
 *
 * An edition is listed only if this prospect's own address is an active
 * recipient of it -- or, for an edition not yet adopted, is on the shared list
 * its link was written from. Nothing else is listed, there is no fallback to
 * "everything published", and no other reader's address is selected.
 *
 * The prospect id comes from a signed review session, and is still validated
 * here rather than trusted.
 */
export async function getProspectReviewLibrary(
  prospectId: string,
): Promise<SecureReviewCard[]> {
  if (!PROSPECT_UUID.test(prospectId ?? "")) return []
  try {
    const sql = getSql()
    const settings = (await sql`
      select key, value from app_settings
      where key in ('review_library_enabled', 'review_approved_recipients')
    `) as { key: string; value: string }[]
    const setting = (key: string) =>
      settings.find((row) => row.key === key)?.value
    if (setting("review_library_enabled") !== "true") return []

    const prospects = (await sql`
      select email from review_prospects
      where id = ${prospectId}::uuid and verified_at is not null and access_sent_at is not null
      limit 1
    `) as { email: string }[]
    const email = (prospects[0]?.email ?? "").trim().toLowerCase()
    if (!email) return []
    const onSharedList = deserialiseRecipients(
      setting("review_approved_recipients"),
    ).includes(email)

    // Before the migration: the shared-list rule for every linked edition,
    // exactly as the migration will classify them (see getReviewLibrary).
    const perEdition = await editionRecipientsReady(sql)
    const rows = (perEdition
      ? await sql`
      select e.id, e.title as pub_title, e.publication_type, e.description, e.frequency,
             e.audience, e.series as slot_key, e.secure_link_url, e.edition_date, e.edition_label,
             e.papermark_document_id, e.is_latest
      from review_publication_editions e
      where e.publication_state = 'published'
        and e.secure_link_url <> '' and e.secure_link_verified_at is not null
        and e.secure_link_document_id = e.papermark_document_id
        and (
          (e.recipient_mode = 'edition' and exists (
            select 1 from review_edition_recipients r
            where r.edition_id = e.id and r.revoked_at is null and r.email = ${email}
          ))
          or (e.recipient_mode = 'shared_legacy' and ${onSharedList}::boolean)
        )
      order by case e.series when 'MIN' then 1 when 'AIU' then 2 when 'PLM' then 3 else 4 end,
               e.is_latest desc, e.edition_sort_key desc, e.edition_date desc nulls last,
               e.created_at desc, e.id desc
    `
      : await sql`
      select e.id, e.title as pub_title, e.publication_type, e.description, e.frequency,
             e.audience, e.series as slot_key, e.secure_link_url, e.edition_date, e.edition_label,
             e.papermark_document_id, e.is_latest
      from review_publication_editions e
      where e.publication_state = 'published'
        and e.secure_link_url <> '' and e.secure_link_verified_at is not null
        and e.secure_link_document_id = e.papermark_document_id
        and e.secure_link_id is not null and ${onSharedList}::boolean
      order by case e.series when 'MIN' then 1 when 'AIU' then 2 when 'PLM' then 3 else 4 end,
               e.is_latest desc, e.edition_sort_key desc, e.edition_date desc nulls last,
               e.created_at desc, e.id desc
    `) as Array<{
      id: string
      pub_title: string
      publication_type: string
      description: string
      frequency: string
      audience: string
      slot_key: ReviewCard["slotKey"]
      secure_link_url: string
      edition_date: string | null
      edition_label: string
      papermark_document_id: string
      is_latest: boolean
    }>
    return rows.map((r) => ({
      id: r.id,
      pubTitle: r.pub_title,
      publicationType: r.publication_type,
      description: r.description,
      frequency: r.frequency,
      audience: r.audience,
      slotKey: r.slot_key,
      secureUrl: r.secure_link_url,
      editionDate: r.edition_date,
      editionLabel: r.edition_label,
      papermarkDocumentId: r.papermark_document_id,
      isLatest: r.is_latest,
    }))
  } catch {
    return []
  }
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
       order by sort_order asc, created_at desc`,
    )) as Row[]
  }, "full list")

  return rows.map(toPublication)
}
