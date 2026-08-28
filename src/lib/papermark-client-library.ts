import "server-only"
import { getSql } from "./db"
import {
  classifySyncedDocument,
  isNewSince,
  sectionTypeLabel,
  type LibrarySection,
} from "./papermark-contract"

export type SyncedClientDocument = {
  id: string
  title: string
  shareUrl: string
  /** When this document last appeared or changed for this client. */
  changedAt: string | null
  section: LibrarySection
  typeLabel: string
  isNew: boolean
}

/**
 * Reads only rows bound to the authenticated principal's exact database id.
 *
 * There is no lookup by document id alone anywhere in this module. A subscriber
 * and their documents are always queried together, so no query exists that
 * could return another client's row given a document id from a URL.
 */
export async function getSyncedClientDocuments(
  principal: { type: "subscriber" | "briefing"; id: string; papermarkFolderId: string | null },
  options: { previousVisit?: string | null } = {},
): Promise<SyncedClientDocument[]> {
  if (!principal.papermarkFolderId) return []
  const sql = getSql()

  const rows = principal.type === "subscriber"
    ? await sql`select papermark_document_id as id, title, share_url, synced_at
                from papermark_client_documents
                where subscriber_id=${principal.id}
                order by synced_at desc, title`
    : await sql`select papermark_document_id as id, title, share_url, synced_at
                from papermark_client_documents
                where briefing_request_id=${principal.id}
                order by synced_at desc, title`

  return (rows as { id: string; title: string; share_url: string; synced_at: string | Date }[])
    .map((row) => {
      const section = classifySyncedDocument(row.title)
      const changedAt = row.synced_at ? new Date(row.synced_at).toISOString() : null
      return {
        id: row.id,
        title: row.title,
        shareUrl: row.share_url,
        changedAt,
        section,
        typeLabel: sectionTypeLabel(section),
        isNew: isNewSince(changedAt, options.previousVisit ?? null),
      }
    })
}

/**
 * One document, but only if it belongs to this exact principal.
 *
 * The id in the URL is a Papermark document id, which is not a secret and could
 * be guessed or copied from another client. It is therefore never enough on its
 * own: the principal's own database id is part of the where clause, so a
 * subscriber asking for a document assigned to somebody else gets nothing back
 * rather than somebody else's link.
 */
export async function getSyncedClientDocument(
  principal: { type: "subscriber" | "briefing"; id: string },
  papermarkDocumentId: string,
): Promise<SyncedClientDocument | null> {
  const documentId = papermarkDocumentId.trim()
  if (!documentId || documentId.length > 200) return null

  const sql = getSql()
  const rows = principal.type === "subscriber"
    ? await sql`select papermark_document_id as id, title, share_url, synced_at
                from papermark_client_documents
                where subscriber_id=${principal.id} and papermark_document_id=${documentId}
                limit 1`
    : await sql`select papermark_document_id as id, title, share_url, synced_at
                from papermark_client_documents
                where briefing_request_id=${principal.id} and papermark_document_id=${documentId}
                limit 1`

  const row = rows[0] as
    | { id: string; title: string; share_url: string; synced_at: string | Date }
    | undefined
  if (!row) return null

  const section = classifySyncedDocument(row.title)
  return {
    id: row.id,
    title: row.title,
    shareUrl: row.share_url,
    changedAt: row.synced_at ? new Date(row.synced_at).toISOString() : null,
    section,
    typeLabel: sectionTypeLabel(section),
    isNew: false,
  }
}

/**
 * When this client last opened the portal, before the visit being rendered.
 *
 * Deliberately not `max(occurred_at)`: the current visit is recorded on the
 * same render, so the most recent event is this one, and every "new since your
 * last visit" badge would disappear the moment the page was refreshed. Visits
 * inside the last half hour are excluded, which matches the window the event
 * recorder itself de-duplicates over -- so reading the page three times in a
 * sitting gives the same answer three times.
 */
export async function getPreviousPortalVisit(
  principal: { type: "subscriber" | "briefing"; id: string },
): Promise<string | null> {
  const sql = getSql()
  const subscriberId = principal.type === "subscriber" ? principal.id : null
  const briefingId = principal.type === "briefing" ? principal.id : null

  const rows = (await sql`
    select max(occurred_at) as previous_visit
    from client_engagement_events
    where subscriber_id is not distinct from ${subscriberId}::uuid
      and briefing_request_id is not distinct from ${briefingId}::uuid
      and event_type='portal_opened'
      and occurred_at < now() - interval '30 minutes'
  `) as { previous_visit: string | Date | null }[]

  const value = rows[0]?.previous_visit
  return value ? new Date(value).toISOString() : null
}

/** Groups documents into the portal's sections, keeping the order given. */
export function groupBySection(
  documents: SyncedClientDocument[],
): Record<LibrarySection, SyncedClientDocument[]> {
  const grouped: Record<LibrarySection, SyncedClientDocument[]> = {
    PLM: [],
    AEO: [],
    AIU: [],
    MIN: [],
    QIB: [],
    OTHER: [],
  }
  for (const document of documents) grouped[document.section].push(document)
  return grouped
}
