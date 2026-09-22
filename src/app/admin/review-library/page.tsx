import { requireOwner } from "@/lib/dal"
import { getSql } from "@/lib/db"
import AdminShell from "@/components/AdminShell"
import { ApprovedRecipientsSection } from "./recipients-form"
import ReviewLibraryForm from "./review-form"

export const dynamic = "force-dynamic"
export const metadata = { title: "Review Library · APRI" }

export default async function ReviewLibraryPage() {
  const admin = await requireOwner()
  const sql = getSql()

  const enabledRow = (await sql`
    select value from app_settings where key = 'review_library_enabled' limit 1
  `) as { value: string }[]

  const drIdRow = (await sql`
    select value from app_settings where key = 'review_library_papermark_dataroom_id' limit 1
  `) as { value: string }[]

  const lastSyncRow = (await sql`
    select value from app_settings where key = 'review_library_last_sync_at' limit 1
  `) as { value: string }[]

  const lastSyncResultRow = (await sql`
    select value from app_settings where key = 'review_library_last_sync_result' limit 1
  `) as { value: string }[]

  const enabled = enabledRow[0]?.value === "true"
  const dataroomId = drIdRow[0]?.value ?? ""

  // Read server-side. The list is handed to the form so the owner can edit what
  // they typed; it is never fetched by client JavaScript and never rendered on a
  // public page.
  const recipientsRow = (await sql`
    select value from app_settings where key = 'review_approved_recipients' limit 1
  `) as { value: string }[]
  const approvedRecipients = (recipientsRow[0]?.value ?? "")
    .split(/[\n\r,;\t]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0)
  const lastSyncAt = lastSyncRow[0]?.value ?? ""
  const lastSyncResult = lastSyncResultRow[0]?.value ?? ""

  const editions = (await sql`
    select e.id, e.series, e.title, e.edition_label, e.edition_sort_key,
           e.papermark_filename, e.num_pages, e.papermark_document_id,
           e.papermark_dataroom_id, e.last_synced_at, e.publication_type,
           e.description, e.frequency, e.audience, e.secure_link_url,
           e.secure_link_id, e.secure_link_document_id,
           e.secure_link_verified_at, e.publication_state, e.is_latest,
           e.owner_edited_fields,
           case when c.id is null then 'Imported' else c.sync_status end as mapping_status
    from review_publication_editions e
    left join review_sync_candidates c on c.id = e.sync_candidate_id
       or (e.sync_candidate_id is null and c.papermark_document_id = e.papermark_document_id)
    order by case e.series when 'MIN' then 1 when 'AIU' then 2 when 'PLM' then 3 else 4 end,
             e.is_latest desc, e.edition_sort_key desc, e.created_at desc, e.id desc
  `) as Array<{
    id: string
    series: string | null
    title: string
    edition_label: string
    edition_sort_key: string
    papermark_filename: string
    num_pages: number | null
    papermark_document_id: string
    papermark_dataroom_id: string | null
    last_synced_at: string | null
    publication_type: string
    description: string
    frequency: string
    audience: string
    secure_link_url: string
    secure_link_id: string | null
    secure_link_document_id: string | null
    secure_link_verified_at: string | null
    publication_state: string
    is_latest: boolean
    owner_edited_fields: string[]
    mapping_status: string
  }>

  return (
    <AdminShell
      admin={admin}
      current="/admin/review-library"
      title="Complimentary Review Library"
      description="Manage current and historical editions in the versioned Review Library."
    >
      <div className="mb-8">
        <ApprovedRecipientsSection
          emails={approvedRecipients}
          slotsWithLinks={editions.filter((r) => r.secure_link_id).length}
        />
      </div>

      <ReviewLibraryForm
        enabled={enabled}
        dataroomId={dataroomId}
        lastSyncAt={lastSyncAt}
        lastSyncResult={lastSyncResult}
        editions={editions.map((e) => ({
          id: e.id,
          series: e.series,
          title: e.title,
          editionLabel: e.edition_label,
          editionSortKey: e.edition_sort_key,
          papermarkFilename: e.papermark_filename,
          numPages: e.num_pages,
          papermarkDocumentId: e.papermark_document_id,
          papermarkDataroomId: e.papermark_dataroom_id,
          lastSyncedAt: e.last_synced_at,
          publicationType: e.publication_type,
          description: e.description,
          frequency: e.frequency,
          audience: e.audience,
          secureLinkUrl: e.secure_link_url,
          secureLinkId: e.secure_link_id,
          secureLinkDocumentId: e.secure_link_document_id,
          secureLinkVerifiedAt: e.secure_link_verified_at,
          publicationState: e.publication_state,
          isLatest: e.is_latest,
          ownerEditedFields: e.owner_edited_fields ?? [],
          mappingStatus: e.mapping_status,
        }))}
      />
    </AdminShell>
  )
}
