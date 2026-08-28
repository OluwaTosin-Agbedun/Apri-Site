import "server-only"
import { getSql } from "./db"

export type SyncedClientDocument = { id:string; title:string; shareUrl:string }

/** Reads only rows bound to the authenticated principal's exact database id. */
export async function getSyncedClientDocuments(
  principal: { type:"subscriber"|"briefing"; id:string; papermarkFolderId:string|null }
): Promise<SyncedClientDocument[]> {
  if (!principal.papermarkFolderId) return []
  const sql = getSql()
  const rows = principal.type === "subscriber"
    ? await sql`select papermark_document_id as id,title,share_url from papermark_client_documents where subscriber_id=${principal.id} order by title`
    : await sql`select papermark_document_id as id,title,share_url from papermark_client_documents where briefing_request_id=${principal.id} order by title`
  return (rows as {id:string;title:string;share_url:string}[]).map(row=>({id:row.id,title:row.title,shareUrl:row.share_url}))
}
