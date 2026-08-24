import 'server-only'
import { getSql } from './db'

/**
 * Works out which subscriber and which publication a Papermark view belongs to,
 * and records it.
 *
 * The single owner of that decision, shared by the webhook and the daily poll,
 * so the two collectors can never disagree about who opened what. If they did,
 * a subscriber could look engaged to one and silent to the other, which is
 * exactly the false alarm this feature exists to avoid.
 */

export type IncomingView = {
  /** Papermark's view id. The idempotency key -- required. */
  papermarkViewId: string
  papermarkLinkId: string | null
  papermarkDocumentId: string | null
  viewerEmail: string | null
  viewedAt: string | null
  durationSeconds: number | null
  completionPct: number | null
  downloaded: boolean
  source: 'webhook' | 'poll'
}

export type Attribution = {
  subscriberId: string | null
  publicationId: string | null
  /** Which rule matched, for the admin's unmatched-views diagnostics. */
  matchedBy: 'publication-link' | 'email' | 'none'
}

/**
 * Resolves a view to a subscriber, in the order the brief specifies.
 *
 * Link id first, because a link is minted for one named person and one
 * document, so it identifies both sides exactly. Email second, because a
 * shared or forwarded link still carries the address Papermark verified.
 * Neither matching is a failure rather than a guess: an unattributed row is
 * kept and surfaced in the admin, where a wrong guess would quietly corrupt
 * the engagement figures instead.
 */
export async function attribute(view: IncomingView): Promise<Attribution> {
  const sql = getSql()

  const email = normaliseEmail(view.viewerEmail)
  const linkId = view.papermarkLinkId?.trim() || null

  // Resolved independently of the subscriber: a view can identify its document
  // even when we cannot tell who opened it.
  let publicationId = await publicationFromDocument(view.papermarkDocumentId)

  // 1. The link id, which under stamping resolves both sides on its own.
  //
  // One document and one link per subscriber per publication means the link is
  // the identity: it was created for one person, allow-listed to one address,
  // and never changed. A single join answers both questions, and it answers
  // them more reliably than the viewer's address -- which is self-reported by
  // whoever opened the page.
  if (linkId) {
    const rows = (await sql`
      select subscriber_id, publication_id
      from publication_access
      where papermark_link_id = ${linkId}
      limit 1
    `) as { subscriber_id: string; publication_id: string }[]

    const row = rows[0]
    if (row) {
      return {
        subscriberId: row.subscriber_id,
        // The access row names the edition exactly; the document lookup is only
        // a fallback for a row that predates the column being filled.
        publicationId: row.publication_id ?? publicationId,
        matchedBy: 'publication-link',
      }
    }
  }

  // 2. The verified viewer address, for shared and unstamped links only.
  //
  // A shared link has no per-subscriber row to join on, so the address is the
  // only thing identifying the reader. Kept deliberately narrow: for a stamped
  // publication an unmatched link id is a provisioning problem we want to see
  // in the unmatched queue, not something to paper over by guessing from an
  // address that may belong to a forwarded copy.
  if (email) {
    const rows = (await sql`
      select s.id
      from subscribers s
      where lower(s.email) = ${email}
        and (
          ${publicationId}::uuid is null
          or exists (
            select 1 from documents d
            where d.id = ${publicationId}::uuid
              and (d.is_shared_copy = true or d.visibility = 'OPEN')
          )
        )
      limit 1
    `) as { id: string }[]

    if (rows[0]) {
      return { subscriberId: rows[0].id, publicationId, matchedBy: 'email' }
    }
  }

  // 3. Kept, not discarded. An unmatched view is a signal that a link was
  // pasted in without its id, or that someone outside the list is reading.
  return { subscriberId: null, publicationId, matchedBy: 'none' }
}

async function publicationFromDocument(
  papermarkDocumentId: string | null
): Promise<string | null> {
  const id = papermarkDocumentId?.trim()
  if (!id) return null

  const sql = getSql()
  const rows = (await sql`
    select id from documents where papermark_document_id = ${id} limit 1
  `) as { id: string }[]

  return rows[0]?.id ?? null
}

/**
 * Stores one view, attributing it first.
 *
 * Idempotent on papermark_view_id: a webhook retry, or the daily poll seeing a
 * view the webhook already delivered, updates the existing row instead of
 * adding a second one. `source` is only ever moved from 'poll' to 'webhook',
 * never the reverse, so a later poll cannot relabel a row the webhook owned.
 *
 * Returns whether the row was newly created, which the poller reports.
 */
export async function recordView(
  view: IncomingView
): Promise<{ created: boolean; attribution: Attribution }> {
  const attribution = await attribute(view)
  const sql = getSql()

  const viewedAt = safeTimestamp(view.viewedAt)

  const rows = (await sql`
    insert into document_views (
      papermark_view_id, subscriber_id, publication_id, papermark_link_id,
      viewer_email, viewed_at, duration_seconds, completion_pct,
      downloaded, source
    ) values (
      ${view.papermarkViewId},
      ${attribution.subscriberId},
      ${attribution.publicationId},
      ${view.papermarkLinkId},
      ${normaliseEmail(view.viewerEmail)},
      coalesce(${viewedAt}::timestamptz, now()),
      ${view.durationSeconds},
      ${view.completionPct},
      ${view.downloaded},
      ${view.source}
    )
    on conflict (papermark_view_id) do update set
      -- Late attribution: a view stored before its subscriber's link id was
      -- filled in gets claimed on the next sighting. Never cleared once set.
      subscriber_id     = coalesce(document_views.subscriber_id, excluded.subscriber_id),
      publication_id    = coalesce(document_views.publication_id, excluded.publication_id),
      papermark_link_id = coalesce(document_views.papermark_link_id, excluded.papermark_link_id),
      viewer_email      = coalesce(document_views.viewer_email, excluded.viewer_email),
      -- Keep the larger reading, since a view can be reported mid-session.
      duration_seconds  = greatest(coalesce(document_views.duration_seconds, 0), coalesce(excluded.duration_seconds, 0)),
      completion_pct    = greatest(coalesce(document_views.completion_pct, 0), coalesce(excluded.completion_pct, 0)),
      downloaded        = document_views.downloaded or excluded.downloaded,
      source            = case
                            when excluded.source = 'webhook' then 'webhook'
                            else document_views.source
                          end
    returning (xmax = 0) as inserted
  `) as { inserted: boolean }[]

  return { created: rows[0]?.inserted ?? false, attribution }
}

function normaliseEmail(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim().toLowerCase()
  if (!trimmed || trimmed.length > 254 || !trimmed.includes('@')) return null
  return trimmed
}

/** Rejects an unparseable date rather than letting it become epoch zero. */
function safeTimestamp(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

/**
 * Marks a subscriber's last-seen time from their most recent stored view.
 *
 * Derived rather than written at insert time so that a poll importing older
 * views cannot move the marker backwards.
 */
export async function refreshLastViewed(subscriberId: string): Promise<void> {
  const sql = getSql()
  await sql`
    update subscribers s
    set last_viewed_at = v.latest
    from (
      select max(viewed_at) as latest
      from document_views
      where subscriber_id = ${subscriberId}
    ) v
    where s.id = ${subscriberId}
      and (s.last_viewed_at is null or v.latest > s.last_viewed_at)
  `
}
