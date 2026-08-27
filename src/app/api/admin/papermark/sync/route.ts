import { NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { getCurrentAdmin } from "@/lib/dal"
import { getSql } from "@/lib/db"
import {
  PapermarkError,
  listDocuments,
  listFolders,
  listLinks,
  resolveShareUrl,
} from "@/lib/papermark"

export const dynamic = "force-dynamic"

const OPEN_FOLDER_NAME = "07 Open Editions"

type Outcome = "new" | "updated" | "unchanged" | "missing-link"

type Item = {
  papermarkDocumentId: string
  title: string
  outcome: Outcome
  papermarkUrl: string | null
}

function slugify(input: string, fallback: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
  return slug || fallback
}

export async function POST() {
  const admin = await getCurrentAdmin()
  if (!admin) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 })
  }

  let documents
  try {
    const folders = await listFolders()
    const openFolder = folders.find(
      (folder) =>
        folder.name.trim().toLowerCase() === OPEN_FOLDER_NAME.toLowerCase(),
    )
    if (!openFolder) {
      throw new PapermarkError(
        `Papermark folder "${OPEN_FOLDER_NAME}" was not found. Create it or restore that exact name before fetching.`,
      )
    }
    documents = await listDocuments(openFolder.id)
  } catch (error) {
    const message =
      error instanceof PapermarkError
        ? error.message
        : "Unexpected error contacting Papermark."
    return NextResponse.json({ error: message }, { status: 502 })
  }

  const sql = getSql()
  const items: Item[] = []
  let created = 0
  let updated = 0
  let unchanged = 0
  let missingLink = 0

  for (const doc of documents) {
    if (!doc?.id) continue

    let shareUrl: string | null = null
    try {
      const links = await listLinks(doc.id)
      for (const link of links) {
        shareUrl = resolveShareUrl(link)
        if (shareUrl) break
      }
    } catch {
      shareUrl = null
    }

    const title = (doc.name ?? "").trim() || "Untitled document"

    const existing = (await sql`
      select id, title, papermark_link, open_link_url, visibility
      from documents
      where papermark_document_id = ${doc.id}
      limit 1
    `) as {
      id: string
      title: string
      papermark_link: string
      open_link_url: string | null
      visibility: string
    }[]

    const row = existing[0]

    if (!row) {
      await sql`
        insert into documents (
          slug, title, papermark_document_id, papermark_link,
          status, is_published, cta_label, cta_mode, synced_at,
          visibility, open_link_url
        ) values (
          ${slugify(title, doc.id)}, ${title}, ${doc.id}, ${shareUrl ?? ""},
          'draft', false, 'Read now', 'link', now(),
          'OPEN', ${shareUrl}
        )
        on conflict (papermark_document_id)
          where papermark_document_id is not null
        do nothing
      `
      created++
      const outcome: Outcome = shareUrl ? "new" : "missing-link"
      if (!shareUrl) missingLink++
      items.push({
        papermarkDocumentId: doc.id,
        title,
        outcome,
        papermarkUrl: shareUrl,
      })
      continue
    }

    const linkChanged =
      shareUrl !== null &&
      (shareUrl !== row.papermark_link || shareUrl !== row.open_link_url)
    const titleChanged = title !== row.title
    const laneChanged = row.visibility !== "OPEN"

    if (linkChanged || titleChanged || laneChanged) {
      await sql`
        update documents
        set title = ${title},
            papermark_link = coalesce(${shareUrl}, papermark_link),
            open_link_url = coalesce(${shareUrl}, open_link_url),
            visibility = 'OPEN',
            synced_at = now(),
            updated_at = now()
        where id = ${row.id}
      `
      updated++
      items.push({
        papermarkDocumentId: doc.id,
        title,
        outcome: "updated",
        papermarkUrl: shareUrl ?? row.open_link_url ?? row.papermark_link,
      })
      continue
    }

    if (!shareUrl && !row.open_link_url) {
      missingLink++
      items.push({
        papermarkDocumentId: doc.id,
        title,
        outcome: "missing-link",
        papermarkUrl: null,
      })
      continue
    }

    await sql`update documents set synced_at = now() where id = ${row.id}`
    unchanged++
    items.push({
      papermarkDocumentId: doc.id,
      title,
      outcome: "unchanged",
      papermarkUrl: row.open_link_url ?? row.papermark_link,
    })
  }

  revalidatePath("/admin/documents")
  revalidatePath("/admin")
  revalidatePath("/")
  revalidatePath("/publications")

  return NextResponse.json({
    ok: true,
    folder: OPEN_FOLDER_NAME,
    summary: {
      fetched: documents.length,
      new: created,
      updated,
      unchanged,
      missingLink,
    },
    items,
  })
}
