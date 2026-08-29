import "server-only"
import { getSql } from "./db"
import {
  classifySyncedDocument,
  isNewSince,
  sectionTypeLabel,
  type LibrarySection,
} from "./papermark-contract"
import {
  categoriseDataRoomDocument,
  documentBadge,
  portalTypeLabel,
  type PortalCategoryKey,
} from "./papermark-dataroom-contract"
import { getDocumentLinkByDocRowId } from "./dataroom-dal"

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

// ---------------------------------------------------------------------------
// Data Room documents — the new pipeline
// ---------------------------------------------------------------------------

export type DataRoomDocument = {
  id: string
  papermarkDocumentId: string
  dataroomDocumentId: string | null
  title: string
  category: PortalCategoryKey
  categoryLabel: string
  numPages: number | null
  contentType: string | null
  papermarkCreatedAt: string | null
  papermarkUpdatedAt: string | null
  firstSeenAt: string | null
  badge: "new" | "updated" | null
}

export type SubscriberDataRoomContext = {
  documents: DataRoomDocument[]
  linkUrl: string
  linkId: string
  dataroomId: string
  allowDownload: boolean
}

/**
 * Load Data Room documents for a subscriber who has an active DR link.
 *
 * The query is scoped to the subscriber's own DR link record — never by email,
 * URL parameter or client-provided Data Room ID. Returns null when no active
 * DR link exists (the caller should fall back to the legacy pipeline).
 */
export async function getDataRoomDocumentsForSubscriber(
  subscriberId: string,
  options: { previousVisit?: string | null } = {},
): Promise<SubscriberDataRoomContext | null> {
  const sql = getSql()

  const links = (await sql`
    select id, papermark_link_id, link_url, papermark_dataroom_id, allow_download
    from papermark_dataroom_links
    where subscriber_id = ${subscriberId}::uuid
      and revoke_state = 'live'
    order by created_at desc
    limit 1
  `) as {
    id: string
    papermark_link_id: string
    link_url: string
    papermark_dataroom_id: string
    allow_download: boolean
  }[]

  const link = links[0]
  if (!link) return null

  const rows = (await sql`
    select id, papermark_document_id, dataroom_document_id,
           title, category, folder_path, num_pages, content_type,
           papermark_created_at, papermark_updated_at, first_seen_at
    from papermark_dataroom_documents
    where papermark_dataroom_id = ${link.papermark_dataroom_id}
      and is_present = true
    order by papermark_updated_at desc nulls last,
             papermark_created_at desc nulls last,
             title
  `) as {
    id: string
    papermark_document_id: string
    dataroom_document_id: string | null
    title: string
    category: string | null
    folder_path: string | null
    num_pages: number | null
    content_type: string | null
    papermark_created_at: string | null
    papermark_updated_at: string | null
    first_seen_at: string | null
  }[]

  const previousVisit = options.previousVisit ?? null

  const documents: DataRoomDocument[] = rows.map((row) => {
    const cat = categoriseDataRoomDocument({
      title: row.title,
      category: row.category,
      folderPath: row.folder_path,
    })
    return {
      id: row.id,
      papermarkDocumentId: row.papermark_document_id,
      dataroomDocumentId: row.dataroom_document_id,
      title: row.title,
      category: cat,
      categoryLabel: portalTypeLabel(cat),
      numPages: row.num_pages,
      contentType: row.content_type,
      papermarkCreatedAt: row.papermark_created_at
        ? new Date(row.papermark_created_at).toISOString() : null,
      papermarkUpdatedAt: row.papermark_updated_at
        ? new Date(row.papermark_updated_at).toISOString() : null,
      firstSeenAt: row.first_seen_at
        ? new Date(row.first_seen_at).toISOString() : null,
      badge: documentBadge({
        firstSeenAt: row.first_seen_at,
        updatedAt: row.papermark_updated_at,
        previousVisit,
      }),
    }
  })

  return {
    documents,
    linkUrl: link.link_url,
    linkId: link.papermark_link_id,
    dataroomId: link.papermark_dataroom_id,
    allowDownload: link.allow_download,
  }
}

/**
 * One Data Room document, but only if it belongs to this subscriber's room.
 *
 * Returns the per-document personal link URL when one exists. The viewer uses
 * this URL directly — it targets the specific document and produces a working
 * Papermark embed, unlike the old ?documentId= construction on the Data Room
 * link which is not a documented Papermark mechanism.
 */
export async function getDataRoomDocumentForSubscriber(
  subscriberId: string,
  documentRowId: string,
): Promise<{
  document: DataRoomDocument
  documentLinkUrl: string | null
  papermarkLinkId: string | null
  allowDownload: boolean
} | null> {
  if (!documentRowId || documentRowId.length > 200) return null
  const sql = getSql()

  const links = (await sql`
    select papermark_link_id, link_url, papermark_dataroom_id, allow_download
    from papermark_dataroom_links
    where subscriber_id = ${subscriberId}::uuid
      and revoke_state = 'live'
    order by created_at desc
    limit 1
  `) as {
    papermark_link_id: string
    link_url: string
    papermark_dataroom_id: string
    allow_download: boolean
  }[]

  const link = links[0]
  if (!link) return null

  const rows = (await sql`
    select id, papermark_document_id, dataroom_document_id,
           title, category, folder_path, num_pages, content_type,
           papermark_created_at, papermark_updated_at, first_seen_at
    from papermark_dataroom_documents
    where id = ${documentRowId}::uuid
      and papermark_dataroom_id = ${link.papermark_dataroom_id}
      and is_present = true
    limit 1
  `) as {
    id: string
    papermark_document_id: string
    dataroom_document_id: string | null
    title: string
    category: string | null
    folder_path: string | null
    num_pages: number | null
    content_type: string | null
    papermark_created_at: string | null
    papermark_updated_at: string | null
    first_seen_at: string | null
  }[]

  const row = rows[0]
  if (!row) return null

  const docLink = await getDocumentLinkByDocRowId({
    subscriberId,
    documentRowId,
  })

  const cat = categoriseDataRoomDocument({
    title: row.title,
    category: row.category,
    folderPath: row.folder_path,
  })
  return {
    document: {
      id: row.id,
      papermarkDocumentId: row.papermark_document_id,
      dataroomDocumentId: row.dataroom_document_id,
      title: row.title,
      category: cat,
      categoryLabel: portalTypeLabel(cat),
      numPages: row.num_pages,
      contentType: row.content_type,
      papermarkCreatedAt: row.papermark_created_at
        ? new Date(row.papermark_created_at).toISOString() : null,
      papermarkUpdatedAt: row.papermark_updated_at
        ? new Date(row.papermark_updated_at).toISOString() : null,
      firstSeenAt: row.first_seen_at
        ? new Date(row.first_seen_at).toISOString() : null,
      badge: null,
    },
    documentLinkUrl: docLink?.linkUrl ?? null,
    papermarkLinkId: docLink?.papermarkLinkId ?? null,
    allowDownload: docLink?.allowDownload ?? link.allow_download,
  }
}

/** Group Data Room documents by portal category. */
export function groupDataRoomByCategory(
  documents: DataRoomDocument[],
): Record<PortalCategoryKey, DataRoomDocument[]> {
  const grouped: Record<PortalCategoryKey, DataRoomDocument[]> = {
    PLM: [], AEO: [], AIU: [], MIN: [], QIB: [], OTHER: [],
  }
  for (const doc of documents) grouped[doc.category].push(doc)
  return grouped
}

/**
 * Reads only rows bound to the authenticated principal's exact database id.
 *
 * There is no lookup by document id alone anywhere in this module. A subscriber
 * and their documents are always queried together, so no query exists that
 * could return another client's row given a document id from a URL.
 */
export async function getSyncedClientDocuments(
  principal: { type: "subscriber"; id: string; papermarkFolderId: string | null },
  options: { previousVisit?: string | null } = {},
): Promise<SyncedClientDocument[]> {
  if (!principal.papermarkFolderId) return []
  const sql = getSql()

  const rows = await sql`select papermark_document_id as id, title, share_url, synced_at
                from papermark_client_documents
                where subscriber_id=${principal.id}
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
  principal: { type: "subscriber"; id: string },
  papermarkDocumentId: string,
): Promise<SyncedClientDocument | null> {
  const documentId = papermarkDocumentId.trim()
  if (!documentId || documentId.length > 200) return null

  const sql = getSql()
  const rows = await sql`select papermark_document_id as id, title, share_url, synced_at
                from papermark_client_documents
                where subscriber_id=${principal.id} and papermark_document_id=${documentId}
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
  principal: { type: "subscriber"; id: string },
): Promise<string | null> {
  const sql = getSql()

  const rows = (await sql`
    select max(occurred_at) as previous_visit
    from client_engagement_events
    where subscriber_id = ${principal.id}
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
