'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin, requireOwner } from '@/lib/dal'
import { getSql } from '@/lib/db'
import { DocumentSchema, fieldErrors, type FormState } from '@/lib/definitions'
import { portalTitleOverrideReady } from '@/lib/portal-title-schema'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STATUSES = ['draft', 'published', 'archived'] as const
type Status = (typeof STATUSES)[number]

function refreshDocumentAdminPaths() {
  revalidatePath('/admin/documents')
  revalidatePath('/admin/datarooms')
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

  if (!UUID.test(id)) return { message: 'Unknown publication.' }
  if (!STATUSES.includes(status as Status)) {
    return { message: 'Unknown status.' }
  }
  const next = status as Status

  const sql = getSql()

  if (next === 'published') {
    const rows = (await sql`
      select visibility, open_link_url, series, edition_date from documents where id = ${id} limit 1
    `) as { visibility: string; open_link_url: string | null; series: string; edition_date: string | null }[]

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

    // Portal order comes from the issue date, never from a later upload or sync.
    if (row.visibility !== 'OPEN' && ['PLM', 'MIN', 'AIU'].includes(row.series) && !row.edition_date) {
      return { message: 'Add the edition date before publishing this subscriber edition.' }
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

  refreshDocumentAdminPaths()
  return { ok: true, message: `Publication set to ${next}.` }
}

export async function deleteDocument(id: string): Promise<FormState> {
  const admin = await requireAdmin()
  if (admin.role !== 'owner') return { message: 'Only an owner can delete publications.' }
  if (!UUID.test(id)) return { message: 'Unknown publication.' }
  const sql = getSql()
  // A record anything still relies on is never deleted: a Data Room document
  // or review slot would lose its portal title, series and ordering, and the
  // cascade would remove access and alert records and orphan its reading
  // history. Archive it instead.
  const [refs] = (await sql`
    select
      exists (select 1 from papermark_dataroom_documents where publication_id = ${id}::uuid) as dataroom,
      exists (select 1 from complimentary_review_items where publication_id = ${id}::uuid) as review,
      exists (select 1 from publication_access where publication_id = ${id}::uuid) as access,
      exists (select 1 from document_views where publication_id = ${id}::uuid) as views,
      exists (select 1 from document_download_events where publication_id = ${id}::uuid) as downloads
  `) as { dataroom: boolean; review: boolean; access: boolean; views: boolean; downloads: boolean }[]
  const uses = [
    refs?.dataroom && 'a Data Room document',
    refs?.review && 'a review slot',
    refs?.access && 'subscriber access records',
    (refs?.views || refs?.downloads) && 'reading history',
  ].filter(Boolean)
  if (uses.length > 0) {
    return { message: `This publication record is used by ${uses.join(', ')}, so it was not deleted. Archive it instead.` }
  }
  // No Papermark API is called, so its original and link remain.
  const rows = await sql`delete from documents where id=${id} returning id`
  if (!rows[0]) return { message: 'That publication no longer exists.' }
  refreshDocumentAdminPaths()
  return { ok:true, message:'Publication deleted from APRI. The Papermark original was not changed.' }
}

/** Save the editable CMS fields for one publication. */
export async function saveDocument(
  id: string | null,
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  await requireAdmin()
  if (id !== null && !UUID.test(id)) return { message: 'Unknown publication.' }

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
  const pageCount = d.pageCount === '' ? null : d.pageCount

  // A public link is only meaningful for OPEN editions. Silently clear it for
  // restricted publications so a stale value from a visibility change cannot
  // leak into the public site.
  const openLinkUrl = d.visibility === 'OPEN' ? (d.openLinkUrl || null) : null

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

  // Whether subscribers see this title instead of the Papermark name. Only an
  // explicit tick sets it; saving the form otherwise leaves it off, so a title
  // sync generated can never become an override by accident.
  let overrideNote = ''
  if (id && formData.has('portalTitleOverrideField')) {
    if (await portalTitleOverrideReady(sql, { fresh: true })) {
      const keep = formData.get('portalTitleOverride') === 'on'
      await sql`update documents set portal_title_override = ${keep} where id = ${id}`
    } else {
      overrideNote = ' The title override is not available until its migration has been run.'
    }
  }

  refreshDocumentAdminPaths()
  revalidatePath('/portal')
  return { ok: true, message: `Saved.${overrideNote}` }
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

// ---------------------------------------------------------------------------
// Release to paid subscribers
// ---------------------------------------------------------------------------

const RELEASE_STATES = ['released', 'withheld', 'undecided'] as const

/**
 * Releases an edition to paid subscribers, withholds it, or returns it to
 * undecided -- separately from its editorial status and from Complimentary
 * Review publication or withdrawal. Only paid (not OPEN) records. The
 * decision, administrator and reason are kept in publication_release_events.
 *
 * Every subscriber served from a Data Room holding the edition is then
 * reconciled: a release issues verified personal links to those the paid
 * periods cover, a withholding withdraws them. No email is sent.
 */
export async function setPaidRelease(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin()
  const id = String(formData.get('publicationId') ?? '')
  const state = String(formData.get('state') ?? '')
  const reason = String(formData.get('reason') ?? '').trim().slice(0, 500)
  if (!UUID.test(id)) return { message: 'Unknown publication.' }
  if (!(RELEASE_STATES as readonly string[]).includes(state)) return { message: 'Unknown release decision.' }
  if (!reason) return { message: 'Record why (for example "Issued to paid subscribers on 1 September").' }
  const sql = getSql()
  const { accessHealthSchemaReady, ACCESS_HEALTH_MIGRATION_PENDING } = await import('@/lib/access-health-schema')
  if (!(await accessHealthSchemaReady(sql))) return { message: ACCESS_HEALTH_MIGRATION_PENDING }

  const rows = (await sql`
    update documents
    set paid_release_state = ${state === 'undecided' ? null : state},
        paid_release_changed_at = now(), paid_release_changed_by = ${admin.id}::uuid,
        paid_release_reason = ${reason}, updated_at = now()
    where id = ${id}::uuid and visibility <> 'OPEN'
    returning id
  `) as { id: string }[]
  if (!rows[0]) return { message: 'Only a paid (not public) publication record can be released to subscribers.' }
  await sql`
    insert into publication_release_events (publication_id, state, reason, administrator_id)
    values (${id}::uuid, ${state}, ${reason}, ${admin.id}::uuid)
  `

  const { reconcileRoomsHoldingPublication } = await import('@/lib/access-release')
  const summary = await reconcileRoomsHoldingPublication(id, 'release')
  refreshDocumentAdminPaths()
  const label = state === 'released' ? 'Released to paid subscribers.' : state === 'withheld' ? 'Withheld from paid subscribers.' : 'Returned to undecided.'
  return { ok: summary.complete, message: `${label} ${summary.message}` }
}
