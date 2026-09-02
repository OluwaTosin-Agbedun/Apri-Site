import { requireOwner } from "@/lib/dal"
import { getSql } from "@/lib/db"
import AdminShell from "@/components/AdminShell"
import ReviewLibraryForm from "./review-form"

export const dynamic = "force-dynamic"
export const metadata = { title: "Review Library · APRI" }

export default async function ReviewLibraryPage() {
  const admin = await requireOwner()
  const sql = getSql()

  const enabledRow = (await sql`
    select value from app_settings where key = 'review_library_enabled' limit 1
  `) as { value: string }[]

  const urlRow = (await sql`
    select value from app_settings where key = 'review_library_papermark_url' limit 1
  `) as { value: string }[]

  const enabled = enabledRow[0]?.value === "true"
  const papermarkUrl = urlRow[0]?.value ?? ""

  const items = (await sql`
    select ri.id, ri.publication_id, ri.display_order, ri.is_active,
           ri.publication_type, ri.description, ri.frequency, ri.audience,
           d.title as pub_title, d.series, d.slug
    from complimentary_review_items ri
    join documents d on d.id = ri.publication_id
    order by ri.display_order, ri.created_at
  `) as {
    id: string
    publication_id: string
    display_order: number
    is_active: boolean
    publication_type: string
    description: string
    frequency: string
    audience: string
    pub_title: string
    series: string
    slug: string
  }[]

  const publications = (await sql`
    select id, title, series, slug
    from documents
    where id not in (select publication_id from complimentary_review_items)
    order by title
  `) as { id: string; title: string; series: string; slug: string }[]

  return (
    <AdminShell
      admin={admin}
      current="/admin/review-library"
      title="Complimentary Review Library"
      description="Select publications to include in the complimentary review page for prospective subscribers."
    >
      <ReviewLibraryForm
        enabled={enabled}
        papermarkUrl={papermarkUrl}
        items={items.map((r) => ({
          id: r.id,
          publicationId: r.publication_id,
          displayOrder: r.display_order,
          isActive: r.is_active,
          publicationType: r.publication_type,
          description: r.description,
          frequency: r.frequency,
          audience: r.audience,
          pubTitle: r.pub_title,
          series: r.series,
          slug: r.slug,
        }))}
        availablePublications={publications.map((p) => ({
          id: p.id,
          title: p.title,
          series: p.series,
        }))}
      />
    </AdminShell>
  )
}
