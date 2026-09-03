import { requireOwner } from "@/lib/dal"
import { getSql } from "@/lib/db"
import AdminShell from "@/components/AdminShell"
import { ApprovedRecipientsSection } from "./recipients-form"
import { approvedTitleForSlot } from "@/lib/review-prefill"
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
  const approvedRecipients = (recipientsRow[0]?.value ?? '')
    .split(/[\n\r,;\t]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0)
  const lastSyncAt = lastSyncRow[0]?.value ?? ""
  const lastSyncResult = lastSyncResultRow[0]?.value ?? ""

  const slots = (await sql`
    select ri.id, ri.publication_id, ri.slot_key, ri.display_order, ri.is_active,
           ri.publication_type, ri.description, ri.frequency, ri.audience,
           ri.secure_link_url, ri.secure_link_id,
           ri.secure_link_document_id, ri.secure_link_verified_at,
           ri.papermark_document_id, ri.papermark_dataroom_id,
           ri.last_synced_at, ri.owner_edited_fields,
           ri.pending_papermark_document_id, ri.pending_clean_title,
           ri.pending_version_key, ri.pending_detected_at,
           ri.pending_secure_link_id, ri.pending_secure_link_url,
           ri.pending_secure_link_document_id, ri.pending_secure_link_verified_at,
           d.title as pub_title, d.series, d.slug
    from complimentary_review_items ri
    join documents d on d.id = ri.publication_id
    where ri.slot_key in ('MIN', 'AIU', 'PLM')
    order by ri.display_order, ri.created_at
  `) as {
    id: string
    publication_id: string
    slot_key: string
    display_order: number
    is_active: boolean
    publication_type: string
    description: string
    frequency: string
    audience: string
    secure_link_url: string
    secure_link_id: string | null
    secure_link_document_id: string | null
    secure_link_verified_at: string | null
    papermark_document_id: string | null
    papermark_dataroom_id: string | null
    last_synced_at: string | null
    owner_edited_fields: string[]
    pending_papermark_document_id: string | null
    pending_clean_title: string | null
    pending_version_key: string | null
    pending_detected_at: string | null
    pending_secure_link_id: string | null
    pending_secure_link_url: string | null
    pending_secure_link_document_id: string | null
    pending_secure_link_verified_at: string | null
    pub_title: string
    series: string
    slug: string
  }[]

  const candidates = (await sql`
    select id, papermark_document_id, raw_filename, clean_title,
           detected_series, detected_edition_date, sync_status,
           num_pages, first_seen_at, last_seen_at, is_present
    from review_sync_candidates
    where sync_status in ('pending', 'approved')
    order by detected_series, first_seen_at desc
  `) as {
    id: string
    papermark_document_id: string
    raw_filename: string
    clean_title: string
    detected_series: string
    detected_edition_date: string | null
    sync_status: string
    num_pages: number | null
    first_seen_at: string
    last_seen_at: string
    is_present: boolean
  }[]

  return (
    <AdminShell
      admin={admin}
      current="/admin/review-library"
      title="Complimentary Review Library"
      description="Manage the three fixed review publications shown to prospective subscribers."
    >
      <div className="mb-8">
        <ApprovedRecipientsSection
          emails={approvedRecipients}
          slotsWithLinks={slots.filter((r) => r.secure_link_id).length}
        />
      </div>

      <ReviewLibraryForm
        enabled={enabled}
        dataroomId={dataroomId}
        lastSyncAt={lastSyncAt}
        lastSyncResult={lastSyncResult}
        slots={slots.map((r) => ({
          id: r.id,
          publicationId: r.publication_id,
          slotKey: r.slot_key,
          displayOrder: r.display_order,
          isActive: r.is_active,
          publicationType: r.publication_type,
          description: r.description,
          frequency: r.frequency,
          audience: r.audience,
          secureLinkUrl: r.secure_link_url,
          secureLinkId: r.secure_link_id,
          secureLinkDocumentId: r.secure_link_document_id,
          secureLinkVerifiedAt: r.secure_link_verified_at,
          papermarkDocumentId: r.papermark_document_id,
          papermarkDataroomId: r.papermark_dataroom_id,
          lastSyncedAt: r.last_synced_at,
          ownerEditedFields: r.owner_edited_fields ?? [],
          pendingDocumentId: r.pending_papermark_document_id,
          pendingCleanTitle: r.pending_clean_title,
          pendingVersionKey: r.pending_version_key,
          pendingDetectedAt: r.pending_detected_at,
          pendingSecureLinkId: r.pending_secure_link_id,
          pendingSecureLinkUrl: r.pending_secure_link_url,
          pendingSecureLinkDocumentId: r.pending_secure_link_document_id,
          pendingSecureLinkVerifiedAt: r.pending_secure_link_verified_at,
          pubTitle: r.pub_title,
          series: r.series,
          slug: r.slug,
          approvedTitle: approvedTitleForSlot(r.slot_key),
        }))}
        candidates={candidates.map((c) => ({
          id: c.id,
          papermarkDocumentId: c.papermark_document_id,
          rawFilename: c.raw_filename,
          cleanTitle: c.clean_title,
          detectedSeries: c.detected_series,
          detectedEditionDate: c.detected_edition_date,
          syncStatus: c.sync_status,
          numPages: c.num_pages,
          firstSeenAt: c.first_seen_at,
          lastSeenAt: c.last_seen_at,
          isPresent: c.is_present,
        }))}
      />
    </AdminShell>
  )
}
