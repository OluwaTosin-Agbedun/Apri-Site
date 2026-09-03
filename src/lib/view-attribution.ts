import 'server-only'
import { getSql } from './db'
import { normaliseEmail, type ReaderType } from './engagement-metrics'

/**
 * The one place that decides which reader and which publication a Papermark
 * event belongs to.
 *
 * Shared by the webhook and the poll so the two collectors can never disagree
 * about who opened what. If they could, a subscriber would look engaged to one
 * and silent to the other, which is exactly the false reading this exists to
 * prevent.
 *
 * The resolution order runs from the most specific evidence to the least, and
 * stops rather than guessing. An unmatched event is kept and surfaced in the
 * admin: a wrong attribution silently corrupts the figures, whereas an
 * unmatched row is a visible provisioning problem someone can fix.
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

/** Which rule matched, in the order the resolver tries them. */
export type AttributionMethod =
  | 'subscriber-document-link'
  | 'dataroom-link'
  | 'review-slot-link'
  | 'publication-access-link'
  | 'verified-email'
  | 'none'

export type Attribution = {
  subscriberId: string | null
  briefingRequestId: string | null
  publicationId: string | null
  readerType: ReaderType
  /** Set for a Complimentary Review reader, else null. */
  slotKey: string | null
  matchedBy: AttributionMethod
  /** Kept for the older callers that read `matchedBy` as a coarse label. */
  viewerEmail: string | null
}

const UNMATCHED: Omit<Attribution, 'publicationId' | 'viewerEmail'> = {
  subscriberId: null,
  briefingRequestId: null,
  readerType: 'unknown',
  slotKey: null,
  matchedBy: 'none',
}

/**
 * Resolves one Papermark event to a reader and a publication.
 *
 * Order, most specific first:
 *
 *  1. `papermark_subscriber_document_links` -- one link, one subscriber, one
 *     document. Identifies both sides exactly.
 *  2. `papermark_dataroom_links` -- one link per subscriber or briefing client
 *     per Data Room.
 *  3. `complimentary_review_items.secure_link_id` -- a fixed review slot. The
 *     reader is a prospect, never a subscriber.
 *  4. legacy `publication_access.papermark_link_id`.
 *  5. the verified viewer address, only where the document and access type make
 *     the match unambiguous.
 *  6. otherwise unmatched, and kept.
 */
export async function attribute(view: IncomingView): Promise<Attribution> {
  const sql = getSql()
  const email = normaliseEmail(view.viewerEmail)
  const linkId = view.papermarkLinkId?.trim() || null

  // Resolved independently: an event can identify its document even when we
  // cannot tell who opened it.
  const documentPublicationId = await publicationFromDocument(view.papermarkDocumentId)

  // 1. Per-subscriber, per-document link.
  if (linkId) {
    const rows = (await sql`
      select dl.subscriber_id, dl.papermark_document_id
      from papermark_subscriber_document_links dl
      where dl.papermark_link_id = ${linkId}
      limit 1
    `) as { subscriber_id: string; papermark_document_id: string | null }[]

    if (rows[0]) {
      const pubId =
        (await publicationFromDocument(rows[0].papermark_document_id)) ??
        documentPublicationId
      return {
        subscriberId: rows[0].subscriber_id,
        briefingRequestId: null,
        publicationId: pubId,
        readerType: 'subscriber',
        slotKey: null,
        matchedBy: 'subscriber-document-link',
        viewerEmail: email,
      }
    }
  }

  // 2. Data Room link, which may belong to a subscriber or a briefing client.
  if (linkId) {
    const rows = (await sql`
      select subscriber_id, briefing_request_id
      from papermark_dataroom_links
      where papermark_link_id = ${linkId}
      limit 1
    `) as { subscriber_id: string | null; briefing_request_id: string | null }[]

    const row = rows[0]
    if (row && (row.subscriber_id || row.briefing_request_id)) {
      return {
        subscriberId: row.subscriber_id,
        briefingRequestId: row.briefing_request_id,
        publicationId: documentPublicationId,
        readerType: row.subscriber_id ? 'subscriber' : 'briefing',
        slotKey: null,
        matchedBy: 'dataroom-link',
        viewerEmail: email,
      }
    }
  }

  // 3. A Complimentary Review slot link.
  //
  // The reader is a prospect: the verified address is retained as their only
  // identity, and no subscriber is created, looked up or implied. Treating a
  // review reader as a subscriber would put an unpaid reader into the paid
  // figures and, worse, into entitlement logic.
  if (linkId) {
    const rows = (await sql`
      select ri.slot_key, ri.publication_id, ri.papermark_document_id
      from complimentary_review_items ri
      where ri.secure_link_id = ${linkId}
      limit 1
    `) as {
      slot_key: string
      publication_id: string | null
      papermark_document_id: string | null
    }[]

    if (rows[0]) {
      return {
        subscriberId: null,
        briefingRequestId: null,
        publicationId: rows[0].publication_id ?? documentPublicationId,
        readerType: 'complimentary_review',
        slotKey: rows[0].slot_key,
        matchedBy: 'review-slot-link',
        viewerEmail: email,
      }
    }
  }

  // 4. Legacy per-publication access link.
  if (linkId) {
    const rows = (await sql`
      select subscriber_id, publication_id
      from publication_access
      where papermark_link_id = ${linkId}
      limit 1
    `) as { subscriber_id: string; publication_id: string | null }[]

    if (rows[0]) {
      return {
        subscriberId: rows[0].subscriber_id,
        briefingRequestId: null,
        publicationId: rows[0].publication_id ?? documentPublicationId,
        readerType: 'subscriber',
        slotKey: null,
        matchedBy: 'publication-access-link',
        viewerEmail: email,
      }
    }
  }

  // 5. The verified address, only where it is unambiguous.
  //
  // Kept deliberately narrow. For a stamped publication an unrecognised link id
  // is a provisioning fault we want to see in the unmatched queue, not
  // something to paper over with an address that may belong to a forwarded
  // copy. So this matches only where the document itself is shared or open, or
  // where no document could be identified at all.
  if (email) {
    const rows = (await sql`
      select s.id
      from subscribers s
      where lower(s.email) = ${email}
        and s.client_type = 'subscriber'
        and (
          ${documentPublicationId}::uuid is null
          or exists (
            select 1 from documents d
            where d.id = ${documentPublicationId}::uuid
              and (d.is_shared_copy = true or d.visibility = 'OPEN')
          )
        )
      limit 1
    `) as { id: string }[]

    if (rows[0]) {
      return {
        subscriberId: rows[0].id,
        briefingRequestId: null,
        publicationId: documentPublicationId,
        readerType: 'subscriber',
        slotKey: null,
        matchedBy: 'verified-email',
        viewerEmail: email,
      }
    }
  }

  // 6. Kept, not discarded, and never guessed.
  //
  // Note what is deliberately absent here: the old resolver wrote an
  // `open_edition_leads` row at this point. That table is retained as history
  // only. A Complimentary Review reader is resolved at step 3 and labelled
  // `complimentary_review`; nothing new is ever labelled "Open Edition".
  return {
    ...UNMATCHED,
    publicationId: documentPublicationId,
    viewerEmail: email,
  }
}

/**
 * Finds the APRI publication behind a Papermark document id.
 *
 * Three tables can carry the mapping, checked in order of directness. A
 * document mapped in any of them is the same publication, so all three are
 * consulted rather than only `documents`, which is what left Data Room and
 * review documents unattributed before.
 */
export async function publicationFromDocument(
  papermarkDocumentId: string | null,
): Promise<string | null> {
  const id = papermarkDocumentId?.trim()
  if (!id) return null

  const sql = getSql()

  const direct = (await sql`
    select id from documents where papermark_document_id = ${id} limit 1
  `) as { id: string }[]
  if (direct[0]) return direct[0].id

  const dataroom = (await sql`
    select publication_id from papermark_dataroom_documents
    where papermark_document_id = ${id} and publication_id is not null
    limit 1
  `) as { publication_id: string }[]
  if (dataroom[0]?.publication_id) return dataroom[0].publication_id

  const review = (await sql`
    select publication_id from complimentary_review_items
    where papermark_document_id = ${id} and publication_id is not null
    limit 1
  `) as { publication_id: string }[]
  if (review[0]?.publication_id) return review[0].publication_id

  return null
}

/**
 * Stores one view, attributing it first.
 *
 * Idempotent on `papermark_view_id`: a webhook retry, or the poll seeing a view
 * the webhook already delivered, updates the existing row rather than adding a
 * second one. `source` only ever moves from 'poll' to 'webhook', never back, so
 * a later poll cannot relabel a row the webhook owned.
 *
 * Every attribution field is written with `coalesce(existing, new)`, so a
 * resolved attribution is never overwritten by a later, weaker one.
 */
export async function recordView(
  view: IncomingView,
): Promise<{ created: boolean; attribution: Attribution }> {
  const attribution = await attribute(view)
  const sql = getSql()
  const viewedAt = safeTimestamp(view.viewedAt)

  const rows = (await sql`
    insert into document_views (
      papermark_view_id, subscriber_id, briefing_request_id, publication_id,
      papermark_link_id, papermark_document_id, viewer_email, reader_type,
      attribution_method, viewed_at, duration_seconds, completion_pct,
      downloaded, source
    ) values (
      ${view.papermarkViewId},
      ${attribution.subscriberId},
      ${attribution.briefingRequestId},
      ${attribution.publicationId},
      ${view.papermarkLinkId},
      ${view.papermarkDocumentId},
      ${attribution.viewerEmail},
      ${attribution.readerType},
      ${attribution.matchedBy},
      coalesce(${viewedAt}::timestamptz, now()),
      ${view.durationSeconds},
      ${view.completionPct},
      ${view.downloaded},
      ${view.source}
    )
    on conflict (papermark_view_id) do update set
      -- Late attribution: a view stored before its link id existed gets
      -- claimed on the next sighting. Never cleared once set.
      subscriber_id         = coalesce(document_views.subscriber_id, excluded.subscriber_id),
      briefing_request_id   = coalesce(document_views.briefing_request_id, excluded.briefing_request_id),
      publication_id        = coalesce(document_views.publication_id, excluded.publication_id),
      papermark_link_id     = coalesce(document_views.papermark_link_id, excluded.papermark_link_id),
      papermark_document_id = coalesce(document_views.papermark_document_id, excluded.papermark_document_id),
      viewer_email          = coalesce(document_views.viewer_email, excluded.viewer_email),
      -- An 'unknown' placeholder may be upgraded; a real classification stands.
      reader_type           = case
                                when document_views.reader_type is null
                                  or document_views.reader_type = 'unknown'
                                then excluded.reader_type
                                else document_views.reader_type
                              end,
      attribution_method    = case
                                when document_views.attribution_method is null
                                  or document_views.attribution_method = 'none'
                                then excluded.attribution_method
                                else document_views.attribution_method
                              end,
      -- Keep the larger reading, since a view can be reported mid-session.
      -- Null stays null: greatest() over nulls must not become zero.
      duration_seconds      = case
                                when document_views.duration_seconds is null then excluded.duration_seconds
                                when excluded.duration_seconds is null then document_views.duration_seconds
                                else greatest(document_views.duration_seconds, excluded.duration_seconds)
                              end,
      completion_pct        = case
                                when document_views.completion_pct is null then excluded.completion_pct
                                when excluded.completion_pct is null then document_views.completion_pct
                                else greatest(document_views.completion_pct, excluded.completion_pct)
                              end,
      downloaded            = document_views.downloaded or excluded.downloaded,
      source                = case
                                when excluded.source = 'webhook' then 'webhook'
                                else document_views.source
                              end
    returning (xmax = 0) as inserted
  `) as { inserted: boolean }[]

  return { created: rows[0]?.inserted ?? false, attribution }
}

/**
 * Records one confirmed download as its own row.
 *
 * Separate from the view's `downloaded` flag because that flag is a boolean and
 * cannot represent a reader downloading the same document repeatedly -- which
 * is the signal that separates a filed briefing from a glanced-at one.
 *
 * Idempotent on `source_event_id`, so the same download delivered by both the
 * webhook and the poll is stored once.
 */
export async function recordDownload(input: {
  sourceEventId: string
  papermarkViewId: string | null
  papermarkLinkId: string | null
  papermarkDocumentId: string | null
  viewerEmail: string | null
  downloadedAt: string | null
  collectionSource: 'webhook' | 'poll'
  attribution?: Attribution
}): Promise<{ created: boolean; attribution: Attribution }> {
  const sql = getSql()

  const attribution =
    input.attribution ??
    (await attribute({
      papermarkViewId: input.papermarkViewId ?? input.sourceEventId,
      papermarkLinkId: input.papermarkLinkId,
      papermarkDocumentId: input.papermarkDocumentId,
      viewerEmail: input.viewerEmail,
      viewedAt: input.downloadedAt,
      durationSeconds: null,
      completionPct: null,
      downloaded: true,
      source: input.collectionSource,
    }))

  const at = safeTimestamp(input.downloadedAt)

  const rows = (await sql`
    insert into document_download_events (
      source_event_id, papermark_view_id, papermark_link_id,
      papermark_document_id, subscriber_id, briefing_request_id,
      publication_id, viewer_email, reader_type, downloaded_at,
      collection_source
    ) values (
      ${input.sourceEventId},
      ${input.papermarkViewId},
      ${input.papermarkLinkId},
      ${input.papermarkDocumentId},
      ${attribution.subscriberId},
      ${attribution.briefingRequestId},
      ${attribution.publicationId},
      ${attribution.viewerEmail},
      ${attribution.readerType},
      coalesce(${at}::timestamptz, now()),
      ${input.collectionSource}
    )
    on conflict (source_event_id) do update set
      -- Only fills gaps. A webhook-recorded download is not relabelled by a
      -- later poll seeing the same event.
      papermark_view_id     = coalesce(document_download_events.papermark_view_id, excluded.papermark_view_id),
      papermark_link_id     = coalesce(document_download_events.papermark_link_id, excluded.papermark_link_id),
      papermark_document_id = coalesce(document_download_events.papermark_document_id, excluded.papermark_document_id),
      subscriber_id         = coalesce(document_download_events.subscriber_id, excluded.subscriber_id),
      briefing_request_id   = coalesce(document_download_events.briefing_request_id, excluded.briefing_request_id),
      publication_id        = coalesce(document_download_events.publication_id, excluded.publication_id),
      viewer_email          = coalesce(document_download_events.viewer_email, excluded.viewer_email),
      reader_type           = case
                                when document_download_events.reader_type = 'unknown'
                                then excluded.reader_type
                                else document_download_events.reader_type
                              end
    returning (xmax = 0) as inserted
  `) as { inserted: boolean }[]

  // The view's boolean flag is kept in step where a view id was supplied, so
  // the two representations agree.
  if (input.papermarkViewId) {
    await sql`
      update document_views set downloaded = true
      where papermark_view_id = ${input.papermarkViewId}
    `
  }

  return { created: rows[0]?.inserted ?? false, attribution }
}

/**
 * Marks a subscriber's last-seen time from their most recent stored view.
 *
 * Derived rather than written at insert time, so a poll importing older views
 * cannot move the marker backwards.
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

/** Rejects an unparseable date rather than letting it become epoch zero. */
function safeTimestamp(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}
