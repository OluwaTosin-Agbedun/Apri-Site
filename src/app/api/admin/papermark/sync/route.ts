import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getCurrentAdmin } from '@/lib/dal'
import { getSql } from '@/lib/db'
import {
  PapermarkError,
  listDocuments,
  listLinks,
  resolveShareUrl,
} from '@/lib/papermark'

export const dynamic = 'force-dynamic'

type Outcome = 'new' | 'updated' | 'unchanged' | 'missing-link'

type Item = {
  papermarkDocumentId: string
  title: string
  outcome: Outcome
  papermarkUrl: string | null
}

function slugify(input: string, fallback: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
  return slug || fallback
}

/**
 * POST /api/admin/papermark/sync
 *
 * Pulls documents and their share links from Papermark and upserts them into
 * the `documents` table, keyed on papermark_document_id. Idempotent: pressing
 * the button repeatedly cannot create duplicates, because the unique partial
 * index on papermark_document_id turns a repeat insert into an update.
 *
 * Newly discovered documents land as status='draft' and are therefore invisible
 * on the public site until an administrator publishes them.
 */
export async function POST() {
  // Authorisation first, before any Papermark call or database write.
  const admin = await getCurrentAdmin()
  if (!admin) {
    return NextResponse.json({ error: 'Not authorised.' }, { status: 401 })
  }

  let documents
  try {
    documents = await listDocuments()
  } catch (error) {
    const message =
      error instanceof PapermarkError
        ? error.message
        : 'Unexpected error contacting Papermark.'
    // Deliberately no stack trace or token echoed back to the client.
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
      // First live, non-archived link wins.
      for (const link of links) {
        shareUrl = resolveShareUrl(link)
        if (shareUrl) break
      }
    } catch {
      shareUrl = null
    }

    const title = (doc.name ?? '').trim() || 'Untitled document'

    const existing = (await sql`
      select id, title, papermark_link, status
      from documents
      where papermark_document_id = ${doc.id}
      limit 1
    `) as { id: string; title: string; papermark_link: string; status: string }[]

    const row = existing[0]

    if (!row) {
      // Insert as draft. Never published automatically.
      await sql`
        insert into documents (
          slug, title, papermark_document_id, papermark_link,
          status, is_published, cta_label, cta_mode, synced_at
        ) values (
          ${slugify(title, doc.id)}, ${title}, ${doc.id}, ${shareUrl ?? ''},
          'draft', false, 'Access Secure Note', 'link', now()
        )
        on conflict (papermark_document_id) where papermark_document_id is not null
        do nothing
      `
      created++
      const outcome: Outcome = shareUrl ? 'new' : 'missing-link'
      if (!shareUrl) missingLink++
      items.push({ papermarkDocumentId: doc.id, title, outcome, papermarkUrl: shareUrl })
      continue
    }

    // Only the Papermark-owned fields are refreshed. Editorial fields an
    // administrator has written (description, audience, frequency, order) are
    // never overwritten by a sync.
    const linkChanged = shareUrl !== null && shareUrl !== row.papermark_link
    const titleChanged = title !== row.title

    if (linkChanged || titleChanged) {
      await sql`
        update documents
        set title = ${title},
            papermark_link = ${shareUrl ?? row.papermark_link},
            synced_at = now(),
            updated_at = now()
        where id = ${row.id}
      `
      updated++
      items.push({
        papermarkDocumentId: doc.id,
        title,
        outcome: 'updated',
        papermarkUrl: shareUrl ?? row.papermark_link,
      })
      continue
    }

    if (!shareUrl && !row.papermark_link) {
      missingLink++
      items.push({
        papermarkDocumentId: doc.id,
        title,
        outcome: 'missing-link',
        papermarkUrl: null,
      })
      continue
    }

    await sql`update documents set synced_at = now() where id = ${row.id}`
    unchanged++
    items.push({
      papermarkDocumentId: doc.id,
      title,
      outcome: 'unchanged',
      papermarkUrl: row.papermark_link,
    })
  }

  revalidatePath('/admin/documents')
  revalidatePath('/admin')
  revalidatePath('/')

  return NextResponse.json({
    ok: true,
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
