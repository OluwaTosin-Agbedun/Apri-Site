'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/dal'
import { getSql } from '@/lib/db'
import { DocumentSchema, fieldErrors, type FormState } from '@/lib/definitions'

const STATUSES = ['draft', 'published', 'archived'] as const
type Status = (typeof STATUSES)[number]

function refresh() {
  revalidatePath('/admin/documents')
  revalidatePath('/admin')
  revalidatePath('/') // Public page updates with no commit and no redeploy.
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
    // Refuse to publish something with no destination: a live card whose
    // button goes nowhere is worse than an unpublished one.
    const rows = (await sql`
      select papermark_link, cta_mode from documents where id = ${id} limit 1
    `) as { papermark_link: string; cta_mode: string }[]

    const row = rows[0]
    if (!row) return { message: 'That publication no longer exists.' }
    if (row.cta_mode === 'link' && !row.papermark_link) {
      return {
        message:
          'Add a secure link before publishing, or set the button to "Request Access".',
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
    ctaLabel: formData.get('ctaLabel') || 'Access Secure Note',
    ctaMode: formData.get('ctaMode') || 'link',
    papermarkLink: formData.get('papermarkLink') ?? '',
    sortOrder: formData.get('sortOrder') ?? 0,
    isPublished: false,
  })

  if (!parsed.success) return { errors: fieldErrors(parsed.error) }
  const d = parsed.data
  const sql = getSql()

  try {
    if (id) {
      await sql`
        update documents set
          slug = ${d.slug}, section_label = ${d.sectionLabel}, kicker = ${d.kicker},
          title = ${d.title}, strapline = ${d.strapline}, product_line = ${d.productLine},
          description = ${d.description}, frequency = ${d.frequency},
          audience = ${d.audience}, attribution = ${d.attribution},
          cta_label = ${d.ctaLabel}, cta_mode = ${d.ctaMode},
          papermark_link = ${d.papermarkLink}, sort_order = ${d.sortOrder},
          updated_at = now()
        where id = ${id}
      `
    } else {
      await sql`
        insert into documents (
          slug, section_label, kicker, title, strapline, product_line,
          description, frequency, audience, attribution, cta_label, cta_mode,
          papermark_link, sort_order, status, is_published
        ) values (
          ${d.slug}, ${d.sectionLabel}, ${d.kicker}, ${d.title}, ${d.strapline},
          ${d.productLine}, ${d.description}, ${d.frequency}, ${d.audience},
          ${d.attribution}, ${d.ctaLabel}, ${d.ctaMode}, ${d.papermarkLink},
          ${d.sortOrder}, 'draft', false
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
