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
  portalDocumentTitle,
  portalTypeLabel,
  type PortalCategoryKey,
} from "./papermark-dataroom-contract"
import { getDocumentLinkByDocRowId } from "./dataroom-dal"
import { loadSubscriberAccess, type DocumentAccess } from "./access-policy-dal"

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
  displayTitle: string
  category: PortalCategoryKey
  categoryLabel: string
  numPages: number | null
  contentType: string | null
  papermarkCreatedAt: string | null
  papermarkUpdatedAt: string | null
  firstSeenAt: string | null
  badge: "new" | "updated" | null
  summary: string | null
  kicker: string | null
  editionDate: string | null
  series: string | null
  editorialPageCount: number | null
  viewedBySubscriber: boolean
  downloadedBySubscriber: boolean
  /** Opens now ("open", or "preserved" for a link issued earlier), or is still being prepared. */
  delivery: "open" | "preparing" | "preserved"
}

/**
 * A subscriber's Data Room library, or why it cannot be shown.
 *
 *  - ready        documents the access policy lets them read, each open or
 *                 still being prepared;
 *  - no_room      no Data Room is assigned (the legacy library may apply);
 *  - unavailable  access could not be checked: shown as a temporary problem,
 *                 never as an empty library or an ended subscription.
 */
export type SubscriberDataRoomLibrary =
  | {
      state: "ready"
      documents: DataRoomDocument[]
      dataroomId: string
      /** Allowed documents whose personal link is not ready yet. */
      preparing: number
      /** Documents whose release or details an administrator has still to settle. */
      awaitingDetails: number
    }
  | { state: "no_room" }
  | { state: "unavailable"; message: string }

/** One room document, shaped for the portal, from the access policy's record. */
function portalDocument(
  d: DocumentAccess,
  options: { previousVisit: string | null; viewed: Set<string>; downloaded: Set<string> },
): DataRoomDocument {
  const cat = categoriseDataRoomDocument({ title: d.fileTitle, category: d.category, folderPath: d.folderPath })
  return {
    id: d.rowId,
    papermarkDocumentId: d.papermarkDocumentId,
    dataroomDocumentId: null,
    title: d.fileTitle,
    displayTitle: portalDocumentTitle({ syncedName: d.fileTitle, editorialTitle: d.editorialTitle, editorialTitleIsOverride: d.titleOverride }),
    category: cat,
    categoryLabel: portalTypeLabel(cat),
    numPages: d.pageCount ?? d.numPages,
    contentType: d.contentType,
    papermarkCreatedAt: d.papermarkCreatedAt,
    papermarkUpdatedAt: d.papermarkUpdatedAt,
    firstSeenAt: d.firstSeenAt,
    badge: documentBadge({ firstSeenAt: d.firstSeenAt, updatedAt: d.papermarkUpdatedAt, previousVisit: options.previousVisit }),
    summary: d.summary || null,
    kicker: d.kicker || null,
    editionDate: d.editionDate,
    series: d.series || null,
    editorialPageCount: d.pageCount,
    viewedBySubscriber: options.viewed.has(d.papermarkDocumentId) || (d.publicationId !== null && options.viewed.has(d.publicationId)),
    downloadedBySubscriber: options.downloaded.has(d.papermarkDocumentId),
    delivery: d.delivery === "open" || d.delivery === "preserved" ? d.delivery : "preparing",
  }
}

/**
 * A subscriber's Data Room library: every document in their assigned room
 * that the access policy lets them read.
 *
 * The room is the subscriber's assignment, never a room share link: those are
 * retired once exact-document links are verified, and the library keeps
 * working. The subscriber id is the session's, never a URL parameter.
 */
export async function getDataRoomDocumentsForSubscriber(
  subscriberId: string,
  options: { previousVisit?: string | null } = {},
): Promise<SubscriberDataRoomLibrary> {
  const access = await loadSubscriberAccess(subscriberId)
  if (access.state === "unavailable") return { state: "unavailable", message: access.message }
  if (access.state === "not_found" || !access.room) return { state: "no_room" }

  const listed = access.documents.filter((d) => d.delivery !== "hidden")
  let viewed = new Set<string>()
  let downloaded = new Set<string>()
  try {
    const sql = getSql()
    const views = (await sql`
      select distinct coalesce(v.publication_id::text, v.papermark_document_id) as key
      from document_views v where v.subscriber_id = ${subscriberId}::uuid
    `) as { key: string | null }[]
    viewed = new Set(views.map((v) => v.key).filter((k): k is string => Boolean(k)))
    // Downloads are confirmed by Papermark per document, so the icon is shown
    // only for a download of this exact document.
    const downloads = (await sql`
      select distinct de.papermark_document_id as key
      from document_download_events de where de.subscriber_id = ${subscriberId}::uuid
    `) as { key: string | null }[]
    downloaded = new Set(downloads.map((v) => v.key).filter((k): k is string => Boolean(k)))
  } catch {
    // Reading activity is decoration; the library itself does not depend on it.
  }

  const previousVisit = options.previousVisit ?? null
  return {
    state: "ready",
    dataroomId: access.room.dataroomId,
    documents: listed.map((d) => portalDocument(d, { previousVisit, viewed, downloaded })),
    preparing: listed.filter((d) => d.delivery === "preparing").length,
    awaitingDetails: access.documents.filter((d) => d.decision.outcome === "unresolved" && d.delivery === "hidden").length,
  }
}

/**
 * One Data Room document, only if the access policy lets this subscriber read
 * it. Returns their personal link for that exact document when it is ready;
 * a document still being prepared comes back without one, so the page can say
 * so. The viewer embeds the personal link, which targets that one document.
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
  const access = await loadSubscriberAccess(subscriberId)
  if (access.state !== "ok" || !access.room) return null
  const found = access.documents.find((d) => d.rowId === documentRowId)
  if (!found || found.delivery === "hidden") return null

  // The live personal link for this subscriber and this exact document.
  const docLink = found.link ? await getDocumentLinkByDocRowId({ subscriberId, documentRowId }) : null
  const document = portalDocument(found, { previousVisit: null, viewed: new Set(), downloaded: new Set() })
  return {
    document: { ...document, badge: null },
    documentLinkUrl: docLink?.linkUrl ?? null,
    papermarkLinkId: docLink?.papermarkLinkId ?? null,
    // The download setting the link was issued with; never widened here.
    allowDownload: docLink?.allowDownload ?? false,
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
