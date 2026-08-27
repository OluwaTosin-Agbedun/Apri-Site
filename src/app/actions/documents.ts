'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin, requireOwner } from '@/lib/dal'
import { getSql } from '@/lib/db'
import { DocumentSchema, fieldErrors, type FormState } from '@/lib/definitions'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STATUSES = ['draft', 'published', 'archived'] as const
type Status = (typeof STATUSES)[number]
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function refresh() {
  revalidatePath('/admin/documents')
  revalidatePath('/admin')

  // The public pages are cached rather than rendered per visitor, so every
  // surface that shows a publication has to be named here. A missed path means
  // an editor publishes something and cannot see it, and concludes the CMS is
  // broken.
  revalidatePath('/')
  revalidatePath('/publications')
  revalidatePath('/publications/[slug]', 'page')
}

/**
 * Move a publication through its lifecycle.
 *
 * The status is validated against a literal whitelist rather than trusted from
 * the form, and `is_published` is derived here on the server so the public page
 * and the CMS can never disagree about what is live.
 */
export async function setDocumentStatus(
  id: string,
  status: string
): Promise<FormState> {
  await requireAdmin()

  if (!STATUSES.includes(status as Status)) {
    return { message: 'Unknown status.' }
  }
  const next = status as Status

  const sql = getSql()

  if (next === 'published') {
    const rows = (await sql`
      select visibility, open_link_url from documents where id = ${id} limit 1
    `) as { visibility: string; open_link_url: string | null }[]

    const row = rows[0]
    if (!row) return { message: 'That publication no longer exists.' }

    // An OPEN edition is read straight from the public page, so it needs its
    // own email-gated link. Publishing one without it would put a live card on
    // the site whose button goes nowhere.
    //
    // A paid edition needs no check here: subscribers reach it through the link
    // on their own record, so it is publishable before any link exists and the
    // portal shows "access being prepared" until one is set.
    if (row.visibility === 'OPEN' && !row.open_link_url) {
      return {
        message:
          'An open edition needs its public link before publishing. Add one, or set the audience to a subscriber level.',
      }
    }

    await sql`
      update documents
      set status = 'published',
          is_published = true,
          published_at = coalesce(published_at, now()),
          updated_at = now()
      where id = ${id}
    `
  } else {
    await sql`
      update documents
      set status = ${next},
          is_published = false,
          updated_at = now()
      where id = ${id}
    `
  }

  refresh()
  return { ok: true, message: `Publication set to ${next}.` }
}

export async function deleteDocument(id: string): Promise<FormState> {
  const admin = await requireAdmin()
  if (admin.role !== 'owner') return { message: 'Only an owner can delete publications.' }
  if (!UUID.test(id)) return { message: 'Unknown publication.' }
  const sql = getSql()
  // Database foreign keys remove APRI-only access, copy, view and alert
  // associations. No Papermark API is called, so its original and link remain.
  const rows = await sql`delete from documents where id=${id} returning id`
  if (!rows[0]) return { message: 'That publication no longer exists.' }
  refresh()
  return { ok:true, message:'Publication deleted from APRI. The Papermark original was not changed.' }
}

/** Save the editable CMS fields for one publication. */
export async function saveDocument(
  id: string | null,
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  await requireAdmin()

  const parsed = DocumentSchema.safeParse({
    slug: formData.get('slug'),
    sectionLabel: formData.get('sectionLabel') ?? '',
    kicker: formData.get('kicker') ?? '',
    title: formData.get('title'),
    strapline: formData.get('strapline') ?? '',
    productLine: formData.get('productLine') ?? '',
    description: formData.get('description') ?? '',
    frequency: formData.get('frequency') ?? '',
    audience: formData.get('audience') ?? '',
    attribution: formData.get('attribution') ?? '',
    coverageAreas: formData.get('coverageAreas') ?? '',
    code: formData.get('code') ?? '',
    series: formData.get('series') ?? '',
    summary: formData.get('summary') ?? '',
    editionDate: formData.get('editionDate') ?? '',
    visibility: formData.get('visibility') || 'L4',
    openLinkUrl: formData.get('openLinkUrl') ?? '',
    pageCount: formData.get('pageCount') ?? '',
    ctaLabel: formData.get('ctaLabel') || 'Access Secure Note',
    ctaMode: formData.get('ctaMode') || 'link',
    papermarkLink: formData.get('papermarkLink') ?? '',
    sortOrder: formData.get('sortOrder') ?? 0,
    isPublished: false,
  })

  if (!parsed.success) return { errors: fieldErrors(parsed.error) }
  const d = parsed.data
  const sql = getSql()

  // Empty strings become NULL so that the unique index on `code` does not treat
  // several un-coded drafts as duplicates of one another.
  const code = d.code || null
  const editionDate = d.editionDate || null
  const openLinkUrl = d.openLinkUrl || null
  const pageCount = d.pageCount === '' ? null : d.pageCount

  try {
    if (id) {
      await sql`
        update documents set
          slug = ${d.slug}, section_label = ${d.sectionLabel}, kicker = ${d.kicker},
          title = ${d.title}, strapline = ${d.strapline}, product_line = ${d.productLine},
          description = ${d.description}, frequency = ${d.frequency},
          audience = ${d.audience}, attribution = ${d.attribution},
          coverage_areas = ${d.coverageAreas},
          code = ${code}, series = ${d.series}, summary = ${d.summary},
          edition_date = ${editionDate}::date, visibility = ${d.visibility},
          open_link_url = ${openLinkUrl}, page_count = ${pageCount},
          cta_label = ${d.ctaLabel}, cta_mode = ${d.ctaMode},
          papermark_link = ${d.papermarkLink}, sort_order = ${d.sortOrder},
          updated_at = now()
        where id = ${id}
      `
    } else {
      await sql`
        insert into documents (
          slug, section_label, kicker, title, strapline, product_line,
          description, frequency, audience, attribution, coverage_areas,
          code, series, summary, edition_date, visibility, open_link_url,
          page_count, cta_label, cta_mode, papermark_link, sort_order,
          status, is_published
        ) values (
          ${d.slug}, ${d.sectionLabel}, ${d.kicker}, ${d.title}, ${d.strapline},
          ${d.productLine}, ${d.description}, ${d.frequency}, ${d.audience},
          ${d.attribution}, ${d.coverageAreas},
          ${code}, ${d.series}, ${d.summary}, ${editionDate}::date,
          ${d.visibility}, ${openLinkUrl}, ${pageCount},
          ${d.ctaLabel}, ${d.ctaMode}, ${d.papermarkLink}, ${d.sortOrder},
          'draft', false
        )
      `
    }
  } catch {
    return { message: 'That web address (slug) is already in use.' }
  }

  refresh()
  return { ok: true, message: 'Saved.' }
}

/** Auto-sync toggle. Ships disabled; stored for future scheduled use. */
export async function setAutoSync(enabled: boolean): Promise<FormState> {
  await requireAdmin()
  const sql = getSql()
  await sql`
    insert into app_settings (key, value)
    values ('papermark_auto_sync', ${enabled ? 'true' : 'false'})
    on conflict (key) do update set value = excluded.value
  `
  revalidatePath('/admin/documents')
  return { ok: true, message: `Auto-sync ${enabled ? 'enabled' : 'disabled'}.` }
}
