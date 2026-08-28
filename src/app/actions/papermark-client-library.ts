"use server"

import { revalidatePath } from "next/cache"
import { requireAdmin } from "@/lib/dal"
import { getSql } from "@/lib/db"
import {
  documentUpdatedAt,
  ensurePrivateDocumentLink,
  listDocumentsInFolder,
  listFoldersInRoot,
  PapermarkError,
  type PapermarkFolder,
} from "@/lib/papermark"
import { summariseSync, type SyncCounts } from "@/lib/papermark-contract"
import type { FormState } from "@/lib/definitions"

export type ClientKind = "subscriber" | "briefing"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function rootFor(kind: ClientKind): string {
  return (kind === "subscriber"
    ? process.env.PAPERMARK_SUBSCRIBERS_FOLDER_ID
    : process.env.PAPERMARK_BRIEFINGS_FOLDER_ID)?.trim() ?? ""
}

export async function getAssignableFolders(kind: ClientKind): Promise<{
  folders: PapermarkFolder[]
  error?: string
}> {
  await requireAdmin()
  try {
    const forbiddenIds = new Set([
      process.env.PAPERMARK_OPEN_FOLDER_ID,
      process.env.PAPERMARK_OPEN_EDITIONS_FOLDER_ID,
      kind === "subscriber" ? process.env.PAPERMARK_BRIEFINGS_FOLDER_ID : process.env.PAPERMARK_SUBSCRIBERS_FOLDER_ID,
    ].filter(Boolean))
    const folders = (await listFoldersInRoot(rootFor(kind))).filter(folder =>
      !forbiddenIds.has(folder.id) && folder.name !== "00 Masters" && folder.name !== "07 Open Editions"
    )
    return { folders }
  } catch (error) {
    return {
      folders: [],
      error: error instanceof PapermarkError
        ? error.message
        : "Papermark folders are temporarily unavailable.",
    }
  }
}

type ClientRow = {
  id: string
  name: string
  email: string
  papermark_folder_id: string | null
  term_end: string | Date | null
}

async function readClient(kind: ClientKind, id: string): Promise<ClientRow | undefined> {
  const sql = getSql()
  // A briefing has no subscription term, so it has no link expiry. Selected as
  // null rather than omitted so both kinds share one row shape.
  const rows = kind === "subscriber"
    ? await sql`select id, coalesce(nullif(full_name,''),name) as name, email,
                       papermark_folder_id, term_end
                from subscribers where id=${id} limit 1`
    : await sql`select id, name, email, papermark_folder_id, null::date as term_end
                from briefing_requests where id=${id} limit 1`
  return rows[0] as ClientRow | undefined
}

/**
 * Saves the selected folder, then rebuilds that client's library from it.
 *
 * One action rather than two, because the two-step version could not be got
 * right by hand: an administrator picked a folder, and the Sync button either
 * refused to run until they had saved it somewhere else, or ran against the
 * folder that had been saved previously. The folder being synced is now always
 * the folder just chosen, because this function writes it before it reads it.
 *
 * Nothing already working is thrown away on a partial failure. Every Papermark
 * link is resolved first, and only once all of them have come back is anything
 * written or deleted -- so an API call that dies halfway leaves the last good
 * library exactly as it was.
 */
export async function saveFolderAndSyncLibrary(
  kind: ClientKind,
  id: string,
  folderId: string,
): Promise<FormState & { counts?: SyncCounts }> {
  await requireAdmin()
  if (!UUID.test(id)) return { message: "Unknown client." }

  const selectedFolderId = folderId.trim()
  if (!selectedFolderId) return { message: "Choose a private Papermark folder first." }

  const sql = getSql()
  const existing = await readClient(kind, id)
  if (!existing) return { message: `That ${kind} record no longer exists.` }

  try {
    // The folder must be a direct child of this kind's configured root. Checked
    // before it is saved, so an id typed or pasted from elsewhere -- including
    // another client's folder -- never reaches the record.
    const { folders: allowed, error: folderError } = await getAssignableFolders(kind)
    if (folderError) return { message: folderError }
    if (!allowed.some((folder) => folder.id === selectedFolderId)) {
      return { message: "That folder is not inside the configured client root folder." }
    }

    // One folder belongs to one client. The database enforces this for active
    // records too; checking here turns a constraint violation into a sentence.
    const clash = await sql`
      select 1 from subscribers
        where papermark_folder_id=${selectedFolderId} and id<>${kind === "subscriber" ? id : null}::uuid
      union all
      select 1 from briefing_requests
        where papermark_folder_id=${selectedFolderId} and id<>${kind === "briefing" ? id : null}::uuid
      limit 1`
    if (clash[0]) {
      return { message: "That folder is already assigned to another client." }
    }

    if (kind === "subscriber") {
      await sql`update subscribers set papermark_folder_id=${selectedFolderId}, updated_at=now() where id=${id}`
    } else {
      await sql`update briefing_requests set papermark_folder_id=${selectedFolderId}, updated_at=now() where id=${id}`
    }

    const documents = await listDocumentsInFolder(selectedFolderId)

    if (documents.length === 0) {
      // Saved, not synced. An empty folder is a normal state on the day a
      // client is set up, so it reports itself rather than reading as a fault,
      // and the library already in place is left alone.
      revalidatePath(`/admin/${kind === "subscriber" ? "subscribers" : "briefings"}/${id}`)
      const counts: SyncCounts = { found: 0, reused: 0, created: 0, synced: 0 }
      return { ok: true, message: summariseSync(counts), counts }
    }

    // Resolve every link before writing anything.
    const resolved: {
      documentId: string
      linkId: string | null
      title: string
      shareUrl: string
      updatedAt: string | null
    }[] = []
    let reused = 0
    let created = 0

    for (const document of documents) {
      const link = await ensurePrivateDocumentLink({
        documentId: document.id,
        email: existing.email,
        name: existing.name,
        expiresAt: existing.term_end,
      })
      if (!link.ok) return { message: link.message }
      if (link.reused) reused++
      else created++
      resolved.push({
        documentId: document.id,
        linkId: link.linkId,
        title: document.name,
        shareUrl: link.url,
        updatedAt: documentUpdatedAt(document),
      })
    }

    // Everything came back. Now it is safe to write.
    for (const row of resolved) {
      // synced_at only moves when something actually changed. Bumping it on
      // every run would relabel the whole library as new after each nightly
      // sync, which is the opposite of what the portal's badges are for.
      if (kind === "subscriber") {
        await sql`insert into papermark_client_documents
          (subscriber_id,papermark_document_id,papermark_link_id,title,share_url,synced_at)
          values (${id},${row.documentId},${row.linkId},${row.title},${row.shareUrl},now())
          on conflict (subscriber_id,papermark_document_id) where subscriber_id is not null
          do update set papermark_link_id=excluded.papermark_link_id,
            title=excluded.title, share_url=excluded.share_url,
            synced_at=case
              when papermark_client_documents.title is distinct from excluded.title
                or papermark_client_documents.share_url is distinct from excluded.share_url
                or papermark_client_documents.papermark_link_id is distinct from excluded.papermark_link_id
              then now() else papermark_client_documents.synced_at end`
      } else {
        await sql`insert into papermark_client_documents
          (briefing_request_id,papermark_document_id,papermark_link_id,title,share_url,synced_at)
          values (${id},${row.documentId},${row.linkId},${row.title},${row.shareUrl},now())
          on conflict (briefing_request_id,papermark_document_id) where briefing_request_id is not null
          do update set papermark_link_id=excluded.papermark_link_id,
            title=excluded.title, share_url=excluded.share_url,
            synced_at=case
              when papermark_client_documents.title is distinct from excluded.title
                or papermark_client_documents.share_url is distinct from excluded.share_url
                or papermark_client_documents.papermark_link_id is distinct from excluded.papermark_link_id
              then now() else papermark_client_documents.synced_at end`
      }
    }

    // Remove stale APRI rows only, and only now that the replacement is in
    // place. Papermark documents and links are never touched.
    const ids = resolved.map((row) => row.documentId)
    if (kind === "subscriber") {
      await sql`delete from papermark_client_documents where subscriber_id=${id}
        and not (papermark_document_id = any(${ids}::text[]))`
    } else {
      await sql`delete from papermark_client_documents where briefing_request_id=${id}
        and not (papermark_document_id = any(${ids}::text[]))`
    }

    revalidatePath(`/admin/${kind === "subscriber" ? "subscribers" : "briefings"}/${id}`)
    revalidatePath("/portal")

    const counts: SyncCounts = {
      found: documents.length,
      reused,
      created,
      synced: resolved.length,
    }
    return { ok: true, message: summariseSync(counts), counts }
  } catch (error) {
    return {
      message: error instanceof PapermarkError
        ? error.message
        : "The library could not be synced. Nothing was changed.",
    }
  }
}
