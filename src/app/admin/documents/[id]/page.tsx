import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/dal'
import { getSql } from '@/lib/db'
import AdminShell from '@/components/AdminShell'
import DocumentForm, { type DocumentDraft } from './document-form'

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
        current="/admin/documents"
        title="New Publication"
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
  }

  return (
    <AdminShell
      admin={admin}
      current="/admin/documents"
      title={row.title || 'Publication'}
      description={`Status: ${row.status}. Editorial fields here are never overwritten by a Papermark sync.`}
    >
      <DocumentForm draft={draft} />
    </AdminShell>
  )
}
