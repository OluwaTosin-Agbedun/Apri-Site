import { requireOwner } from "@/lib/dal"
import { getSql } from "@/lib/db"
import AdminShell from "@/components/AdminShell"
import { deserialiseRecipients } from "@/lib/review-recipients"
import {
  isRecipientMode,
  recipientListHash,
  recipientStatus,
} from "@/lib/edition-recipients"
import { loadActiveRecipientsByEdition } from "@/lib/edition-recipients-dal"
import { editionRecipientsReady } from "@/lib/edition-recipients-schema"
import { ApprovedRecipientsSection } from "./recipients-form"
import ReviewLibraryForm from "./review-form"

export const dynamic = "force-dynamic"
export const metadata = { title: "Review Library · APRI" }

export default async function ReviewLibraryPage() {
  const admin = await requireOwner()
  const sql = getSql()

  // Everything on this page reads per-edition access, so until its migration
  // has run the page says so rather than failing. The public review pages keep
  // working as before in the meantime.
  if (!(await editionRecipientsReady(sql, { fresh: true }))) {
    return (
      <AdminShell
        admin={admin}
        current="/admin/review-library"
        title="Complimentary Review Library"
        description="Waiting for the per-edition access database migration."
      >
        <section className="border border-amber-300 bg-amber-50 p-6 text-sm leading-relaxed max-w-2xl">
          <h3 className="font-serif text-lg mb-2">Database migration required</h3>
          <p className="mb-2">
            This version manages each edition&apos;s approved emails separately, which needs the
            migration <code>db/migrations/20260928_review_edition_recipients.sql</code> to be run
            on the database first.
          </p>
          <p>
            Until then the public review pages keep working exactly as before, and nothing can be
            changed here. This page switches over by itself once the migration has run.
          </p>
        </section>
      </AdminShell>
    )
  }

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
  // Re-validated on read, like every other reader of this setting.
  const approvedRecipients = deserialiseRecipients(recipientsRow[0]?.value ?? "")
  const lastSyncAt = lastSyncRow[0]?.value ?? ""
  const lastSyncResult = lastSyncResultRow[0]?.value ?? ""

  const editions = (await sql`
    select e.id, e.series, e.title, e.edition_label, e.edition_sort_key,
           e.papermark_filename, e.num_pages, e.papermark_document_id,
           e.papermark_dataroom_id, e.last_synced_at, e.publication_type,
           e.description, e.frequency, e.audience, e.secure_link_url,
           e.secure_link_id, e.secure_link_document_id,
           e.secure_link_verified_at, e.publication_state, e.is_latest,
           e.owner_edited_fields, e.recipient_mode, e.recipients_verified_hash,
           e.recipients_verified_at, e.recipients_adopted_at,
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
    recipient_mode: string
    recipients_verified_hash: string | null
    recipients_verified_at: string | null
    recipients_adopted_at: string | null
    mapping_status: string
  }>

  // Owner-only: each edition's own recipients, for its panel.
  const recipientsByEdition = await loadActiveRecipientsByEdition(sql)
  const legacyEditionCount = editions.filter(
    (e) => e.recipient_mode === "shared_legacy" && e.publication_state === "published",
  ).length

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
          legacyEditionCount={legacyEditionCount}
        />
      </div>

      <ReviewLibraryForm
        enabled={enabled}
        dataroomId={dataroomId}
        lastSyncAt={lastSyncAt}
        lastSyncResult={lastSyncResult}
        addressBook={approvedRecipients}
        editions={editions.map((e) => {
          const mode = isRecipientMode(e.recipient_mode) ? e.recipient_mode : "edition"
          const recipients = recipientsByEdition.get(e.id) ?? []
          const hasLink = Boolean(e.secure_link_id)
          return ({
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
          access: {
            mode,
            recipients,
            status: recipientStatus({
              mode,
              recipientCount: recipients.length,
              hasLink,
              currentHash: recipientListHash(recipients),
              verifiedHash: e.recipients_verified_hash,
            }),
            verifiedAt: e.recipients_verified_at,
            adoptedAt: e.recipients_adopted_at,
          },
        })
        })}
      />
    </AdminShell>
  )
}
