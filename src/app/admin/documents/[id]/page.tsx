import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/dal'
import { portalTitleOverrideReady } from '@/lib/portal-title-schema'
import { getSql } from '@/lib/db'
import AdminShell from '@/components/AdminShell'
import DocumentForm, { type DocumentDraft } from './document-form'
import { PaidReleaseForm } from '@/app/admin/subscribers/[id]/access-forms'

export const dynamic = 'force-dynamic'

const BLANK: DocumentDraft = {
  id: null,
  slug: '',
  sectionLabel: '',
  kicker: '',
  title: '',
  strapline: '',
  productLine: '',
  description: '',
  frequency: '',
  audience: '',
  attribution: '',
  coverageAreas: '',
  code: '',
  series: '',
  summary: '',
  editionDate: '',
  // A new publication starts at the most restrictive audience. Widening it is a
  // deliberate act; a default of OPEN would make an accidental publish public.
  visibility: 'L4',
  openLinkUrl: '',
  pageCount: '',
  ctaLabel: 'Access Secure Note',
  ctaMode: 'link',
  papermarkLink: '',
  sortOrder: 0,
  status: 'draft',
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
  cta_mode: string
  coverage_areas: string
  code: string | null
  series: string
  summary: string
  edition_date: string | null
  visibility: string
  open_link_url: string | null
  page_count: number | null
  papermark_link: string
  sort_order: number
  status: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A date column rendered into a value an <input type="date"> accepts. */
function dateInput(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

export default async function EditDocumentPage({
  params,
}: {
  // Next 16: params is a promise.
  params: Promise<{ id: string }>
}) {
  const admin = await requireAdmin()
  const { id } = await params

  if (id === 'new') {
    return (
      <AdminShell
        admin={admin}
        current="/admin/datarooms"
        title="New publication record"
        description="Saved as a draft. It will not appear publicly until you publish it."
      >
        <DocumentForm draft={BLANK} />
      </AdminShell>
    )
  }

  // Reject anything that is not a uuid before it reaches the query.
  if (!UUID.test(id)) notFound()

  const sql = getSql()
  const rows = (await sql`
    select id, slug, section_label, kicker, title, strapline, product_line,
           description, frequency, audience, attribution, cta_label, cta_mode,
           coverage_areas, code, series, summary, edition_date, visibility,
           open_link_url, page_count, papermark_link, sort_order, status
    from documents
    where id = ${id}
    limit 1
  `) as Row[]

  const row = rows[0]
  if (!row) notFound()

  const draft: DocumentDraft = {
    id: row.id,
    slug: row.slug,
    sectionLabel: row.section_label,
    kicker: row.kicker,
    title: row.title,
    strapline: row.strapline,
    productLine: row.product_line,
    description: row.description,
    frequency: row.frequency,
    audience: row.audience,
    attribution: row.attribution,
    coverageAreas: row.coverage_areas,
    code: row.code ?? '',
    series: row.series,
    summary: row.summary,
    editionDate: dateInput(row.edition_date),
    visibility: row.visibility || 'L4',
    openLinkUrl: row.open_link_url ?? '',
    pageCount: row.page_count === null ? '' : String(row.page_count),
    ctaLabel: row.cta_label,
    ctaMode: row.cta_mode,
    papermarkLink: row.papermark_link,
    sortOrder: row.sort_order,
    status: row.status,
    portalTitleOverride: (await portalTitleOverrideReady(sql, { fresh: true }))
      ? ((await sql`select portal_title_override from documents where id = ${id} limit 1`) as { portal_title_override: boolean }[])[0]?.portal_title_override === true
      : null,
  }

  // Release to paid subscribers: separate from editorial status and from
  // Complimentary Review publication. Paid records only.
  const releaseRows = (await sql`
    select to_jsonb(d) ->> 'paid_release_state' as state, to_jsonb(d) ->> 'paid_release_reason' as reason,
           to_jsonb(d) ->> 'paid_release_changed_at' as changed_at,
           (select a.name from admins a where a.id::text = to_jsonb(d) ->> 'paid_release_changed_by') as changed_by
    from documents d where d.id = ${id}::uuid limit 1
  `) as { state: string | null; reason: string | null; changed_at: string | null; changed_by: string | null }[]
  const release = releaseRows[0]
  const explicit = release?.state === 'released' || release?.state === 'withheld' ? release.state : null
  const effective = explicit ?? (row.status === 'published' ? 'released' : row.status === 'archived' ? 'withheld' : null)

  return (
    <AdminShell
      admin={admin}
      current="/admin/datarooms"
      title={row.title || 'Publication record'}
      description={`Status: ${row.status}. Editorial fields here are never overwritten by a Papermark sync.`}
    >
      {row.visibility !== 'OPEN' && (
        <section className="mb-6 border border-border bg-card/30 p-6">
          <h2 className="font-serif text-xl mb-1">Release to paid subscribers</h2>
          <p className="text-sm text-foreground/80">
            {effective === 'released' ? 'Released' : effective === 'withheld' ? 'Withheld' : 'Undecided'}
            {explicit ? '' : effective ? ' (from its editorial status; no explicit decision yet)' : ': issued to no subscriber until released'}
          </p>
          {release?.reason && (
            <p className="text-xs text-muted-foreground mt-1">
              {release.changed_by ?? 'An administrator'}{release.changed_at ? ` on ${new Date(release.changed_at).toLocaleDateString('en-GB')}` : ''}: {release.reason}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-2 mb-4 max-w-3xl">
            A released edition is issued to each subscriber whose paid periods cover its edition date, at or below its
            level, through their own verified link. Releasing never makes it public, and does not depend on the
            Complimentary Review. Withholding withdraws subscribers&rsquo; links to it.
          </p>
          <PaidReleaseForm publicationId={row.id} current={explicit} />
        </section>
      )}
      <DocumentForm draft={draft} />
    </AdminShell>
  )
}
