import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/dal'
import { portalTitleOverrideReady } from '@/lib/portal-title-schema'
import { getSql } from '@/lib/db'
import AdminShell from '@/components/AdminShell'
import DocumentForm, { type DocumentDraft, type SeriesOption } from './document-form'
import { getPublicationCatalogue, type PublicationCatalogue } from '@/lib/publication-catalogue-dal'
import { seriesChoices } from '@/lib/publication-catalogue'
import { EditionAvailabilityForm } from '@/app/admin/subscribers/[id]/access-forms'
import { publicationPlansReady } from '@/lib/access-policy-dal'
import { SUBSCRIPTION_CATALOGUE } from '@/lib/subscription-catalogue'
import PublicationDetailsForm from './publication-details-form'
import SummaryForm from './summary-form'
import { loadEditorPanel } from '@/lib/publication-metadata-dal'
import { EDITORIAL_METADATA_PENDING, EMPTY_METADATA, EMPTY_SUMMARY, formatDay } from '@/lib/publication-metadata'
import type { StoredSummary } from '@/lib/publication-summaries'
import PublicationWorkflowPanel from '@/components/PublicationWorkflowPanel'

/** Who did what to a protected summary, for the editor (Admin only). */
function summaryNotes(summary: StoredSummary | null): string[] {
  if (!summary) return []
  const on = (at: string | null) => (at ? ` on ${formatDay(at.slice(0, 10))}` : '')
  const notes: string[] = []
  if (summary.status === 'approved') notes.push(`Approved by ${summary.approvedBy ?? 'an owner'}${on(summary.approvedAt)}.`)
  if (summary.updatedAt) notes.push(`Last saved by ${summary.updatedBy ?? 'an administrator'}${on(summary.updatedAt)}.`)
  if (summary.status !== 'approved' && summary.removedReason === 'edited') {
    notes.push(`The approval was removed when ${summary.removedBy ?? 'an administrator'} changed the text${on(summary.removedAt)}. Subscribers do not see it until an owner approves it again.`)
  }
  if (summary.status !== 'approved' && summary.removedReason === 'withdrawn') {
    notes.push(`The approval was withdrawn by ${summary.removedBy ?? 'an owner'}${on(summary.removedAt)}.`)
  }
  return notes
}

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

/** The series an editor may choose, from the owner's publication catalogue (see seriesChoices). */
function seriesOptions(catalogue: PublicationCatalogue, current: string): SeriesOption[] {
  return seriesChoices(catalogue.categories, current, { migrated: catalogue.migrated })
}

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
  const catalogue = await getPublicationCatalogue()

  if (id === 'new') {
    return (
      <AdminShell
        admin={admin}
        current="/admin/datarooms"
        title="New publication record"
        description="Saved as a draft. It will not appear publicly until you publish it."
      >
        <DocumentForm draft={BLANK} seriesOptions={seriesOptions(catalogue, '')} />
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

  // Who gets this edition: its plans and On/Off. Separate from editorial
  // status and from Complimentary Review publication. Paid records only.
  const releaseRows = (await sql`
    select to_jsonb(d) ->> 'paid_release_state' as state, to_jsonb(d) ->> 'paid_release_reason' as reason,
           to_jsonb(d) ->> 'paid_release_changed_at' as changed_at,
           (select a.name from admins a where a.id::text = to_jsonb(d) ->> 'paid_release_changed_by') as changed_by
    from documents d where d.id = ${id}::uuid limit 1
  `) as { state: string | null; reason: string | null; changed_at: string | null; changed_by: string | null }[]
  const release = releaseRows[0]
  const explicit = release?.state === 'released' || release?.state === 'withheld' ? release.state : null
  const effective = explicit ?? (row.status === 'published' ? 'released' : row.status === 'archived' ? 'withheld' : null)
  const plansReady = await publicationPlansReady(sql)
  const ticked = plansReady
    ? ((await sql`select public_tier from publication_plans where publication_id = ${id}::uuid`) as { public_tier: string }[]).map((r) => r.public_tier)
    : []
  const receiving = (await sql`
    select count(distinct dl.subscriber_id)::int as n
    from papermark_subscriber_document_links dl
    join papermark_dataroom_documents dd on dd.papermark_document_id = dl.papermark_document_id
    where dd.publication_id = ${id}::uuid and dl.revoke_state = 'live'
  `) as { n: number }[]
  const planChoices = SUBSCRIPTION_CATALOGUE.map((o) => ({ value: o.storedName, label: o.name }))

  // Reader details, tags and the protected summary (migration 20261114_publication_editorial_metadata).
  // A read failure leaves the panels disabled rather than breaking the editor.
  const panel = await loadEditorPanel(sql, row.id).catch(() => null)

  return (
    <AdminShell
      admin={admin}
      current="/admin/datarooms"
      title={row.title || 'Publication record'}
      description={`Status: ${row.status}. Editorial fields here are never overwritten by a Papermark sync.`}
    >
      <PublicationWorkflowPanel kind="paid" id={row.id} owner={admin.role==='owner'} />
      {row.visibility !== 'OPEN' && (
        <section className="mb-6 border border-border bg-card/30 p-6">
          <h2 className="font-serif text-xl mb-1">Who gets this edition</h2>
          <p className="text-sm text-foreground/80">
            {effective === 'released' ? 'On for subscribers' : effective === 'withheld' ? 'Off for subscribers' : 'Not switched on yet'}
            {` · ${ticked.length ? ticked.map((t) => planChoices.find((c) => c.value === t)?.label ?? t).join(", ") : "no plan ticked"}`}
            {` · ${receiving[0]?.n ?? 0} subscriber${receiving[0]?.n === 1 ? "" : "s"} currently have it`}
          </p>
          {release?.reason && (
            <p className="text-xs text-muted-foreground mt-1">
              {release.changed_by ?? 'An administrator'}{release.changed_at ? ` on ${new Date(release.changed_at).toLocaleDateString('en-GB')}` : ''}: {release.reason}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-2 mb-4 max-w-3xl">
            A subscriber sees this edition when it is On, ticked for their plan and dated within their term. Each gets
            their own watermarked link; turning it On never makes it public, and does not depend on the Complimentary
            Review. Turning it Off, or unticking a plan, removes it from those subscribers. To give or hide it for one
            person, use their subscriber page.
          </p>
          {!plansReady ? (
            <p className="text-sm text-red-700">Plan ticks are not available until db/migrations/20261005_publication_plans.sql is applied.</p>
          ) : (
            <EditionAvailabilityForm publicationId={row.id} plans={planChoices} current={ticked} state={explicit} />
          )}
        </section>
      )}
      <DocumentForm draft={draft} seriesOptions={seriesOptions(catalogue, draft.series)} />
      <PublicationDetailsForm
        id={row.id}
        ready={panel?.ready === true}
        metadata={panel?.metadata ?? EMPTY_METADATA}
        tags={panel?.tags ?? []}
        assigned={panel?.assigned ?? []}
        detailsVersion={panel?.detailsVersion ?? ''}
        pendingMessage={panel ? EDITORIAL_METADATA_PENDING : 'These details could not be loaded just now. Reload the page to try again.'}
        publicEdition={row.visibility === 'OPEN'}
      />
      <SummaryForm
        id={row.id}
        saved={panel?.summary?.text ?? EMPTY_SUMMARY}
        revision={panel?.summary?.revision ?? 0}
        history={{ status: panel?.summary?.status ?? 'none', notes: summaryNotes(panel?.summary ?? null) }}
        ready={panel?.ready === true}
        canApprove={admin.role === 'owner'}
        pendingMessage={panel ? EDITORIAL_METADATA_PENDING : 'The summary could not be loaded just now. Reload the page to try again.'}
        publicEdition={row.visibility === 'OPEN'}
      />
    </AdminShell>
  )
}
