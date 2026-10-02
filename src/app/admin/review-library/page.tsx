import EditionOrder from "./edition-order"
import EntryModeForm from "./entry-mode-form"
import { reviewEntryMode, reviewReaderSchemaReady, reviewRoomsProof } from "@/lib/review-reader"
import ReaderRoomsPanel from "./reader-rooms-panel"
import { readerRoomsSchemaReady, listReaderRooms } from "@/lib/review-reader-rooms"
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
import { editionRecipientsReady, editionWithdrawalReady } from "@/lib/edition-recipients-schema"
import { loadEditionEvents, type EditionEvent } from "@/lib/review-withdrawal-dal"
import { ApprovedRecipientsSection } from "./recipients-form"
import ReviewLibraryForm from "./review-form"
import ApprovedReadersPanel from "./approved-readers-panel"
import RoomsStatus from "./rooms-status"
import { recentReviewEmailAttempts, attemptStatus, maskEmail } from "@/lib/review-email-attempts"

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
             (to_jsonb(e) ->> 'display_position')::int asc nulls last,
             e.is_latest desc, e.edition_sort_key desc, e.edition_date desc nulls last, e.edition_order desc,
             e.created_at desc, e.id desc
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

  // What each edition offers and whether it is withdrawn -- only once the
  // withdrawal migration has run; until then its panel says so instead.
  const withdrawalReady = await editionWithdrawalReady(sql, { fresh: true })
  const withdrawalRows = withdrawalReady
    ? ((await sql`
        select id, complimentary_featured, withdrawal_state, withdrawal_link_id,
               withdrawal_requested_at, withdrawn_at
        from review_publication_editions
      `) as Array<{
        id: string
        complimentary_featured: boolean
        withdrawal_state: string | null
        withdrawal_link_id: string | null
        withdrawal_requested_at: string | null
        withdrawn_at: string | null
      }>)
    : []
  const withdrawalById = new Map(withdrawalRows.map((w) => [w.id, w]))
  const eventsByEdition: Map<string, EditionEvent[]> = withdrawalReady
    ? await loadEditionEvents(sql)
    : new Map()
  const legacyEditionCount = editions.filter(
    (e) => e.recipient_mode === "shared_legacy" && e.publication_state === "published",
  ).length

  const editionProps: React.ComponentProps<typeof ReviewLibraryForm>["editions"] = editions.map((e) => {
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
    withdrawal: (() => {
      const w = withdrawalById.get(e.id)
      return {
        ready: withdrawalReady,
        offered: w?.complimentary_featured === true,
        state:
          w?.withdrawal_state === "revoking" || w?.withdrawal_state === "revoked"
            ? w.withdrawal_state
            : null,
        linkId: w?.withdrawal_link_id ?? null,
        requestedAt: w?.withdrawal_requested_at ? String(w.withdrawal_requested_at) : null,
        withdrawnAt: w?.withdrawn_at ? String(w.withdrawn_at) : null,
        events: (eventsByEdition.get(e.id) ?? []).map((ev) => ({
          eventType: ev.eventType,
          detail: ev.detail,
          createdAt: ev.createdAt,
        })),
      }
    })(),
  })
  })

  const effectiveMode = await reviewEntryMode()
  const readerSchema = await reviewReaderSchemaReady()
  const roomsSchema = await readerRoomsSchemaReady()
  const proof = await reviewRoomsProof()
  const rooms = await roomsForOwner()
  const attempts = await recentReviewEmailAttempts(20)
  const MODE_TEXT = {
    papermark: "each edition's own Papermark link (Papermark asks for a code per edition)",
    library: "the APRI Review Library (an APRI sign-in email, then a Papermark code per edition)",
    rooms: "each approved reader's personal Papermark room (one Papermark code)",
  } as const

  return (
    <AdminShell
      admin={admin}
      current="/admin/review-library"
      title="Complimentary Review Library"
      description="Publish MIN, AIU and PLM editions, choose who may read each one, and see what every reader can open."
    >
      {effectiveMode !== "rooms" || !proof ? (
        <div className="mb-8 border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900" role="status">
          <p>
            <strong>One setup task:</strong>{" "}one-code personal rooms are not active yet. Run the two-reader Papermark test in
            Advanced &rarr; Personal rooms, then switch the cards there. Until then, review cards lead to {MODE_TEXT[effectiveMode]}.
          </p>
          {effectiveMode === "library" && (
            <p className="mt-2">
              That route sends an APRI sign-in email before Papermark&rsquo;s code. To avoid the APRI email until rooms are
              proven, choose &ldquo;Each edition&rsquo;s own Papermark link&rdquo; in Advanced.
            </p>
          )}
        </div>
      ) : (
        <p className="mb-8 text-sm text-foreground/80">
          Review cards open each approved reader&rsquo;s personal Papermark room: Papermark emails one code, which opens all their
          editions on that browser for about a day.
        </p>
      )}

      <ReviewLibraryForm
        part="editions"
        enabled={enabled}
        dataroomId={dataroomId}
        lastSyncAt={lastSyncAt}
        lastSyncResult={lastSyncResult}
        addressBook={approvedRecipients}
        editions={editionProps}
      />

      <div className="mt-10">
        <EditionOrder
          groups={(["MIN", "AIU", "PLM"] as const).map((series) => ({
            series,
            label: { MIN: "Monthly Intelligence Notes", AIU: "Athena Intelligence Updates", PLM: "Political Landscape Monitors" }[series],
            editions: editions
              .filter((e) => e.series === series && e.publication_state === "published")
              .map((e) => ({ id: e.id, title: e.title, label: e.edition_label })),
          }))}
        />
      </div>

      <ApprovedReadersPanel />

      <RoomsStatus rooms={rooms} />

      <details className="mb-10 border border-border p-5 sm:p-6">
        <summary className="cursor-pointer font-medium">Advanced / Diagnostics</summary>
        <div className="mt-6 space-y-10">
          <section>
            <h3 className="text-xs font-medium uppercase tracking-wider text-accent mb-3">Where public review cards lead</h3>
            <EntryModeForm
              key={effectiveMode}
              mode={effectiveMode}
              ready={readerSchema}
              roomsReady={roomsSchema && Boolean(proof)}
            />
          </section>

          <ReaderRoomsPanel schemaReady={roomsSchema} proof={proof} rooms={rooms} />

          <section>
            <h3 className="text-xs font-medium uppercase tracking-wider text-accent mb-3">Review email delivery</h3>
            <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
              What the email provider said about each APRI review email. &ldquo;Accepted&rdquo; is not delivery: an email shows
              as delivered only when the provider reports it. Papermark&rsquo;s own verification codes are sent by Papermark
              and do not appear here.
            </p>
            {attempts.length === 0 ? (
              <p className="text-xs text-muted-foreground">No review emails recorded yet (or migration 20261010 is not applied).</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">When</th>
                      <th className="py-2 pr-3 font-medium">Email</th>
                      <th className="py-2 pr-3 font-medium">To</th>
                      <th className="py-2 font-medium">Provider status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attempts.map((a) => (
                      <tr key={a.id} className="border-t border-border align-top">
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {new Date(a.createdAt).toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" })}
                        </td>
                        <td className="py-2 pr-3">{a.kind.replace(/_/g, " ")}</td>
                        <td className="py-2 pr-3">{maskEmail(a.email)}</td>
                        <td className="py-2">{attemptStatus(a)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div>
            <ApprovedRecipientsSection emails={approvedRecipients} legacyEditionCount={legacyEditionCount} />
          </div>

          <ReviewLibraryForm
            part="setup"
            enabled={enabled}
            dataroomId={dataroomId}
            lastSyncAt={lastSyncAt}
            lastSyncResult={lastSyncResult}
            addressBook={approvedRecipients}
            editions={[]}
          />
        </div>
      </details>
    </AdminShell>
  )
}

/** Reader rooms with their links: this page is owner-only, and a room link still needs the reader's Papermark code. */
async function roomsForOwner() {
  const rooms = await listReaderRooms()
  if (rooms.length === 0) return []
  const links = (await getSql()`select email, link_url from review_reader_rooms`) as { email: string; link_url: string | null }[]
  const byEmail = new Map(links.map((l) => [l.email, l.link_url]))
  return rooms.map((r) => ({ ...r, linkUrl: byEmail.get(r.email) ?? null }))
}
