import "server-only"
import type { getSql } from "./db"
import { canProvisionLinks } from "./review-recipients"
import { readSharedRecipients } from "./edition-recipients-dal"
import type {
  ApriLinkKind,
  ReplacementCandidate,
  WithdrawableEdition,
  WithdrawalState,
} from "./review-withdrawal"

/**
 * Database access for withdrawing Complimentary Review editions.
 *
 * Every write goes through the SQL functions 20260929 defines, so each step is
 * one transaction. Nothing here writes a recipient, subscriber, Data Room or
 * paid-access row: the paid-access tables are only ever read, to recognise
 * links that must never be revoked.
 */

type Sql = ReturnType<typeof getSql>

export type WithdrawalEditionRow = WithdrawableEdition & {
  title: string
  editionLabel: string
  papermarkFilename: string
  secureLinkUrl: string
  secureLinkVerifiedAt: string | null
  withdrawalRequestedAt: string | null
  withdrawnAt: string | null
  recipientCount: number
}

const label = (series: string | null, editionLabel: string, title: string) =>
  [series, editionLabel || title].filter(Boolean).join(" · ") || "Untitled edition"

export async function loadEditionForWithdrawal(
  sql: Sql,
  editionId: string,
): Promise<WithdrawalEditionRow | null> {
  const rows = (await sql`
    select e.id, e.series, e.title, e.edition_label, e.papermark_filename, e.publication_state,
           e.is_latest, e.complimentary_featured, e.papermark_document_id, e.secure_link_id,
           e.secure_link_url, e.secure_link_verified_at, e.recipient_mode, e.withdrawal_state,
           e.withdrawal_link_id, e.withdrawal_requested_at, e.withdrawn_at,
           (select count(*)::int from review_edition_recipients r
             where r.edition_id = e.id and r.revoked_at is null) as recipient_count
    from review_publication_editions e
    where e.id = ${editionId}::uuid
    limit 1
  `) as Array<{
    id: string
    series: string | null
    title: string
    edition_label: string
    papermark_filename: string
    publication_state: string
    is_latest: boolean
    complimentary_featured: boolean
    papermark_document_id: string
    secure_link_id: string | null
    secure_link_url: string
    secure_link_verified_at: string | null
    recipient_mode: string
    withdrawal_state: string | null
    withdrawal_link_id: string | null
    withdrawal_requested_at: string | null
    withdrawn_at: string | null
    recipient_count: number
  }>
  const r = rows[0]
  if (!r) return null
  return {
    id: r.id,
    series: r.series,
    label: label(r.series, r.edition_label, r.title),
    title: r.title,
    editionLabel: r.edition_label,
    papermarkFilename: r.papermark_filename,
    publicationState: r.publication_state,
    isLatest: r.is_latest === true,
    featured: r.complimentary_featured === true,
    papermarkDocumentId: r.papermark_document_id,
    secureLinkId: r.secure_link_id,
    secureLinkUrl: r.secure_link_url,
    secureLinkVerifiedAt: r.secure_link_verified_at,
    recipientMode: r.recipient_mode === "shared_legacy" ? "shared_legacy" : "edition",
    withdrawalState:
      r.withdrawal_state === "revoking" || r.withdrawal_state === "revoked"
        ? (r.withdrawal_state as WithdrawalState)
        : null,
    withdrawalLinkId: r.withdrawal_link_id,
    withdrawalRequestedAt: r.withdrawal_requested_at,
    withdrawnAt: r.withdrawn_at,
    recipientCount: Number(r.recipient_count ?? 0),
  }
}

/**
 * The editions that could be offered instead: published, same series, with a
 * verified link to their exact document, and someone able to open them.
 */
export async function loadReplacementCandidates(
  sql: Sql,
  edition: Pick<WithdrawableEdition, "id" | "series">,
): Promise<ReplacementCandidate[]> {
  if (!edition.series) return []
  const sharedConfigured = canProvisionLinks(await readSharedRecipients(sql))
  const rows = (await sql`
    select e.id, e.series, e.title, e.edition_label
    from review_publication_editions e
    where e.series = ${edition.series}
      and e.id <> ${edition.id}::uuid
      and e.publication_state = 'published'
      and e.secure_link_id is not null and e.secure_link_url <> ''
      and e.secure_link_verified_at is not null
      and e.secure_link_document_id = e.papermark_document_id
      and (
        (e.recipient_mode = 'shared_legacy' and ${sharedConfigured}::boolean)
        or (e.recipient_mode = 'edition' and exists (
          select 1 from review_edition_recipients r
          where r.edition_id = e.id and r.revoked_at is null
        ))
      )
    order by e.edition_sort_key desc, e.edition_date desc nulls last,
             e.edition_order desc, e.id desc
  `) as Array<{ id: string; series: string | null; title: string; edition_label: string }>
  return rows.map((r) => ({ id: r.id, label: label(r.series, r.edition_label, r.title) }))
}

export async function beginWithdrawal(
  sql: Sql,
  args: { editionId: string; linkId: string; replacementId: string | null; adminId: string },
): Promise<string> {
  const rows = (await sql`
    select begin_review_edition_withdrawal(
      ${args.editionId}::uuid, ${args.linkId}, ${args.replacementId}::uuid, ${args.adminId}::uuid
    ) as result
  `) as { result: string }[]
  return rows[0]?.result ?? ""
}

export async function completeWithdrawal(
  sql: Sql,
  args: { editionId: string; linkId: string; adminId: string },
): Promise<string> {
  const rows = (await sql`
    select complete_review_edition_withdrawal(
      ${args.editionId}::uuid, ${args.linkId}, ${args.adminId}::uuid
    ) as result
  `) as { result: string }[]
  return rows[0]?.result ?? ""
}

/** Appends why Papermark did not confirm a revocation. No address is recorded. */
export async function recordWithdrawalUnconfirmed(
  sql: Sql,
  args: { editionId: string; reason: string; adminId: string },
): Promise<void> {
  await sql`
    insert into review_edition_events (edition_id, event_type, detail, actor_admin_id)
    values (${args.editionId}::uuid, 'withdrawal_unconfirmed', ${args.reason.slice(0, 500)}, ${args.adminId}::uuid)
  `
}

export async function featureEdition(
  sql: Sql,
  args: { editionId: string; adminId: string },
): Promise<string> {
  const rows = (await sql`
    select feature_review_publication_edition(${args.editionId}::uuid, ${args.adminId}::uuid) as result
  `) as { result: string }[]
  return rows[0]?.result ?? ""
}

/**
 * Returns a completed withdrawal to draft so it can be offered again.
 *
 * Only after Papermark confirmed the old link gone, and only while no link is
 * on record: the edition then needs its recipients and a new, verified link
 * before it can be published. An edition still on the shared list switches to
 * its own list, which starts empty.
 */
export async function reofferEdition(
  sql: Sql,
  args: { editionId: string; adminId: string },
): Promise<boolean> {
  const rows = (await sql`
    with ed as (
      update review_publication_editions set
        publication_state = 'draft',
        withdrawal_state  = null,
        recipient_mode    = 'edition',
        reoffered_at      = now(),
        reoffered_by      = ${args.adminId}::uuid,
        updated_at        = now()
      where id = ${args.editionId}::uuid
        and publication_state = 'withdrawn'
        and withdrawal_state = 'revoked'
        and secure_link_id is null
      returning id
    )
    insert into review_edition_events (edition_id, event_type, detail, actor_admin_id)
    select ed.id, 'reoffered',
           'Returned to draft to be offered again; needs recipients and a new verified link',
           ${args.adminId}::uuid
    from ed
    returning edition_id
  `) as { edition_id: string }[]
  return rows.length === 1
}

export type EditionEvent = {
  editionId: string
  eventType: string
  detail: string
  createdAt: string
}

/** Each edition's most recent history, for the owner's Admin page. */
export async function loadEditionEvents(sql: Sql): Promise<Map<string, EditionEvent[]>> {
  const rows = (await sql`
    select edition_id, event_type, detail, created_at
    from (
      select edition_id, event_type, detail, created_at,
             row_number() over (partition by edition_id order by created_at desc, id desc) as n
      from review_edition_events
    ) latest
    where n <= 8
    order by edition_id, created_at desc
  `) as Array<{ edition_id: string; event_type: string; detail: string; created_at: string }>
  const byEdition = new Map<string, EditionEvent[]>()
  for (const r of rows) {
    const list = byEdition.get(r.edition_id) ?? []
    list.push({ editionId: r.edition_id, eventType: r.event_type, detail: r.detail, createdAt: String(r.created_at) })
    byEdition.set(r.edition_id, list)
  }
  return byEdition
}

// ---------------------------------------------------------------------------
// Recognising APRI's own links
// ---------------------------------------------------------------------------

/** Every table that records a Papermark link APRI manages, and what it is. */
const LINK_ID_SOURCES: ReadonlyArray<{ kind: ApriLinkKind; table: string }> = [
  { kind: "paid_subscriber", table: "publication_access" },
  { kind: "paid_subscriber", table: "papermark_client_documents" },
  { kind: "paid_subscriber", table: "papermark_dataroom_links" },
  { kind: "paid_subscriber", table: "papermark_subscriber_document_links" },
]

async function idsIn(sql: Sql, table: string, ids: string[]): Promise<string[]> {
  // The table name comes only from the fixed list above; the ids are
  // parameters. Each table is read separately, so one that is missing in an
  // older database is skipped rather than failing the whole check.
  let rows: { id: string }[] = []
  switch (table) {
    case "publication_access":
      rows = (await sql`select distinct papermark_link_id as id from publication_access where papermark_link_id = any(${ids}::text[])`) as { id: string }[]
      break
    case "papermark_client_documents":
      rows = (await sql`select distinct papermark_link_id as id from papermark_client_documents where papermark_link_id = any(${ids}::text[])`) as { id: string }[]
      break
    case "papermark_dataroom_links":
      rows = (await sql`select distinct papermark_link_id as id from papermark_dataroom_links where papermark_link_id = any(${ids}::text[])`) as { id: string }[]
      break
    case "papermark_subscriber_document_links":
      rows = (await sql`select distinct papermark_link_id as id from papermark_subscriber_document_links where papermark_link_id = any(${ids}::text[])`) as { id: string }[]
      break
  }
  return rows.map((r) => r.id)
}

/**
 * Which of these Papermark links APRI manages, and as what.
 *
 * Returns what could be read and whether every source was readable, so a
 * missing table is reported as an incomplete check rather than as "unmanaged".
 */
export async function classifyPapermarkLinks(
  sql: Sql,
  ids: readonly string[],
  urls: readonly string[],
): Promise<{
  knownIds: Map<string, ApriLinkKind>
  knownUrls: Map<string, ApriLinkKind>
  complete: boolean
}> {
  const knownIds = new Map<string, ApriLinkKind>()
  const knownUrls = new Map<string, ApriLinkKind>()
  let complete = true
  const idList = [...new Set(ids.filter(Boolean))]
  const urlList = [...new Set(urls.filter(Boolean))]

  if (idList.length) {
    for (const source of LINK_ID_SOURCES) {
      try {
        for (const id of await idsIn(sql, source.table, idList)) knownIds.set(id, source.kind)
      } catch {
        complete = false
      }
    }
    try {
      const rows = (await sql`
        select secure_link_id as id from review_publication_editions where secure_link_id = any(${idList}::text[])
        union
        select withdrawal_link_id from review_publication_editions where withdrawal_link_id = any(${idList}::text[])
        union
        select secure_link_id from complimentary_review_items where secure_link_id = any(${idList}::text[])
      `) as { id: string }[]
      for (const r of rows) if (r.id && !knownIds.has(r.id)) knownIds.set(r.id, "complimentary")
    } catch {
      complete = false
    }
  }

  if (urlList.length) {
    try {
      const rows = (await sql`
        select link_url as url from papermark_dataroom_links where link_url = any(${urlList}::text[])
        union
        select link_url from papermark_subscriber_document_links where link_url = any(${urlList}::text[])
        union
        select library_link_url from subscribers where library_link_url = any(${urlList}::text[])
      `) as { url: string }[]
      for (const r of rows) if (r.url) knownUrls.set(r.url, "paid_subscriber")
    } catch {
      complete = false
    }
    try {
      const rows = (await sql`
        select private_link_url as url from briefing_requests where private_link_url = any(${urlList}::text[])
      `) as { url: string }[]
      for (const r of rows) if (r.url && !knownUrls.has(r.url)) knownUrls.set(r.url, "briefing")
    } catch {
      complete = false
    }
  }

  return { knownIds, knownUrls, complete }
}

/**
 * Whether APRI records this link as anyone's paid access.
 *
 * "unknown" when any paid-access table could not be read: that cannot prove the
 * link is not someone's paid access, so the caller refuses to revoke it.
 */
export async function paidAccessCheck(
  sql: Sql,
  linkId: string,
): Promise<"paid" | "not_paid" | "unknown"> {
  for (const source of LINK_ID_SOURCES) {
    try {
      if ((await idsIn(sql, source.table, [linkId])).includes(linkId)) return "paid"
    } catch {
      return "unknown"
    }
  }
  return "not_paid"
}
