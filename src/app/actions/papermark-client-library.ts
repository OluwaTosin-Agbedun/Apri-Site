"use server"

import { revalidatePath } from "next/cache"
import { requireAdmin } from "@/lib/dal"
import { getSql } from "@/lib/db"
import {
  ensurePrivateDocumentLink,
  listDocumentsInFolder,
  listFoldersInRoot,
  PapermarkError,
  type PapermarkFolder,
} from "@/lib/papermark"
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

export async function syncClientLibrary(kind: ClientKind, id: string): Promise<FormState> {
  await requireAdmin()
  if (!UUID.test(id)) return { message: "Unknown client." }
  const sql = getSql()
  const rows = kind === "subscriber"
    ? await sql`select id,coalesce(full_name,name) as name,email,papermark_folder_id from subscribers where id=${id} limit 1`
    : await sql`select id,name,email,papermark_folder_id from briefing_requests where id=${id} limit 1`
  const client = rows[0] as { id:string; name:string; email:string; papermark_folder_id:string|null } | undefined
  if (!client) return { message: `That ${kind} record no longer exists.` }
  if (!client.papermark_folder_id) return { message: "Select and save a private Papermark folder first." }

  try {
    const { folders: allowed, error: folderError } = await getAssignableFolders(kind)
    if (folderError) return { message: folderError }
    if (!allowed.some((folder) => folder.id === client.papermark_folder_id)) {
      return { message: "The selected folder is not inside the configured client root folder." }
    }
    const documents = await listDocumentsInFolder(client.papermark_folder_id)
    if (documents.length === 0) return { message: "The selected Papermark folder is empty." }

    for (const document of documents) {
      const link = await ensurePrivateDocumentLink({
        documentId: document.id,
        email: client.email,
        name: client.name,
      })
      if (!link.ok) return { message: link.message }
      if (kind === "subscriber") {
        await sql`insert into papermark_client_documents
          (subscriber_id,papermark_document_id,papermark_link_id,title,share_url,synced_at)
          values (${id},${document.id},${link.linkId},${document.name},${link.url},now())
          on conflict (subscriber_id,papermark_document_id) where subscriber_id is not null
          do update set papermark_link_id=excluded.papermark_link_id,title=excluded.title,
            share_url=excluded.share_url,synced_at=now()`
      } else {
        await sql`insert into papermark_client_documents
          (briefing_request_id,papermark_document_id,papermark_link_id,title,share_url,synced_at)
          values (${id},${document.id},${link.linkId},${document.name},${link.url},now())
          on conflict (briefing_request_id,papermark_document_id) where briefing_request_id is not null
          do update set papermark_link_id=excluded.papermark_link_id,title=excluded.title,
            share_url=excluded.share_url,synced_at=now()`
      }
    }
    // Remove stale APRI rows only; Papermark documents and links are untouched.
    const ids = documents.map((document) => document.id)
    if (kind === "subscriber") {
      await sql`delete from papermark_client_documents where subscriber_id=${id}
        and not (papermark_document_id = any(${ids}::text[]))`
    } else {
      await sql`delete from papermark_client_documents where briefing_request_id=${id}
        and not (papermark_document_id = any(${ids}::text[]))`
    }
    revalidatePath(`/admin/${kind === "subscriber" ? "subscribers" : "briefings"}/${id}`)
    revalidatePath("/portal")
    return { ok:true, message:`Synced ${documents.length} document${documents.length === 1 ? "" : "s"}.` }
  } catch (error) {
    return { message: error instanceof PapermarkError
      ? error.message
      : "The library could not be synced. Check the migration and Papermark API scopes." }
  }
}
