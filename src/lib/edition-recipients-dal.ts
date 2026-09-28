import "server-only"
import { getSql } from "./db"
import { deserialiseRecipients } from "./review-recipients"
import {
  expectedRecipientsFor,
  isRecipientMode,
  normaliseEmail,
  type RecipientMode,
} from "./edition-recipients"

/**
 * Database reads for per-edition Complimentary Review recipients.
 *
 * Kept in one place so that every check -- link preparation, publishing, the
 * prospect library and sending review access -- reads an edition's recipients
 * the same way. Nothing here writes; the only writer of
 * review_edition_recipients is src/app/actions/review-edition-access.ts.
 *
 * Recipient addresses leave this module only to owner-only server code. The
 * public queries in publications.ts never select them; they test for
 * existence instead.
 */

type Sql = ReturnType<typeof getSql>

export type EditionAccessRow = {
  id: string
  series: string | null
  title: string
  editionLabel: string
  publicationState: string
  papermarkDocumentId: string
  secureLinkId: string | null
  secureLinkUrl: string
  secureLinkDocumentId: string | null
  secureLinkVerifiedAt: string | null
  recipientMode: RecipientMode
  recipientsVerifiedHash: string | null
  recipientsVerifiedAt: string | null
}

/** The shared APRI list, re-validated on read. Owner-only callers. */
export async function readSharedRecipients(sql: Sql): Promise<string[]> {
  const rows = (await sql`
    select value from app_settings where key = 'review_approved_recipients' limit 1
  `) as { value: string }[]
  return deserialiseRecipients(rows[0]?.value ?? "")
}

export async function loadEditionForAccess(
  sql: Sql,
  editionId: string,
): Promise<EditionAccessRow | null> {
  const rows = (await sql`
    select id, series, title, edition_label, publication_state, papermark_document_id,
           secure_link_id, secure_link_url, secure_link_document_id, secure_link_verified_at,
           recipient_mode, recipients_verified_hash, recipients_verified_at
    from review_publication_editions
    where id = ${editionId}::uuid
    limit 1
  `) as Array<{
    id: string
    series: string | null
    title: string
    edition_label: string
    publication_state: string
    papermark_document_id: string
    secure_link_id: string | null
    secure_link_url: string
    secure_link_document_id: string | null
    secure_link_verified_at: string | null
    recipient_mode: string
    recipients_verified_hash: string | null
    recipients_verified_at: string | null
  }>
  const r = rows[0]
  if (!r) return null
  // An unrecognised mode is treated as the fail-closed one: its own (possibly
  // empty) list, never the shared list.
  const mode: RecipientMode = isRecipientMode(r.recipient_mode) ? r.recipient_mode : "edition"
  return {
    id: r.id,
    series: r.series,
    title: r.title,
    editionLabel: r.edition_label,
    publicationState: r.publication_state,
    papermarkDocumentId: r.papermark_document_id,
    secureLinkId: r.secure_link_id,
    secureLinkUrl: r.secure_link_url,
    secureLinkDocumentId: r.secure_link_document_id,
    secureLinkVerifiedAt: r.secure_link_verified_at,
    recipientMode: mode,
    recipientsVerifiedHash: r.recipients_verified_hash,
    recipientsVerifiedAt: r.recipients_verified_at,
  }
}

/** One edition's active recipients, normalised and sorted. */
export async function loadActiveRecipients(sql: Sql, editionId: string): Promise<string[]> {
  const rows = (await sql`
    select email from review_edition_recipients
    where edition_id = ${editionId}::uuid and revoked_at is null
    order by email
  `) as { email: string }[]
  return rows.map((r) => normaliseEmail(r.email)).filter(Boolean)
}

/** Every edition's active recipients, for the owner-only Admin page. */
export async function loadActiveRecipientsByEdition(sql: Sql): Promise<Map<string, string[]>> {
  const rows = (await sql`
    select edition_id, email from review_edition_recipients
    where revoked_at is null
    order by edition_id, email
  `) as { edition_id: string; email: string }[]
  const byEdition = new Map<string, string[]>()
  for (const row of rows) {
    const list = byEdition.get(row.edition_id) ?? []
    list.push(normaliseEmail(row.email))
    byEdition.set(row.edition_id, list)
  }
  return byEdition
}

/**
 * The list one edition must be checked against, by its mode.
 *
 * A shared_legacy edition is still judged by the shared list until it is
 * adopted; an edition-mode edition by its own rows only.
 */
export async function expectedRecipientsForEdition(
  sql: Sql,
  edition: Pick<EditionAccessRow, "id" | "recipientMode">,
): Promise<string[]> {
  const [editionRecipients, sharedRecipients] = await Promise.all([
    edition.recipientMode === "edition" ? loadActiveRecipients(sql, edition.id) : Promise.resolve([]),
    edition.recipientMode === "shared_legacy" ? readSharedRecipients(sql) : Promise.resolve([]),
  ])
  return expectedRecipientsFor({
    mode: edition.recipientMode,
    editionRecipients,
    sharedRecipients,
  })
}

export type GrantedEdition = {
  id: string
  series: string | null
  title: string
  editionLabel: string
  secureLinkId: string
  papermarkDocumentId: string
  recipientMode: RecipientMode
}

/**
 * The published, verified editions one prospect has been granted.
 *
 * An edition-mode edition counts only if this exact address is an active
 * recipient of it. A shared_legacy edition counts if the address is on the
 * shared list, because that is still what its live link was written from.
 * Anything not granted is simply absent -- there is no fallback to "all".
 */
export async function grantedEditionsForProspect(
  sql: Sql,
  prospectEmail: string,
): Promise<GrantedEdition[]> {
  const email = normaliseEmail(prospectEmail)
  if (!email) return []
  const shared = await readSharedRecipients(sql)
  const onSharedList = shared.includes(email)

  const rows = (await sql`
    select e.id, e.series, e.title, e.edition_label, e.secure_link_id,
           e.papermark_document_id, e.recipient_mode
    from review_publication_editions e
    where e.publication_state = 'published'
      and e.secure_link_id is not null
      and e.secure_link_url <> ''
      and e.secure_link_verified_at is not null
      and e.secure_link_document_id = e.papermark_document_id
      and (
        (e.recipient_mode = 'edition' and exists (
          select 1 from review_edition_recipients r
          where r.edition_id = e.id and r.revoked_at is null and r.email = ${email}
        ))
        or (e.recipient_mode = 'shared_legacy' and ${onSharedList}::boolean)
      )
    order by case e.series when 'MIN' then 1 when 'AIU' then 2 when 'PLM' then 3 else 4 end,
             e.is_latest desc, e.edition_sort_key desc, e.created_at desc, e.id desc
  `) as Array<{
    id: string
    series: string | null
    title: string
    edition_label: string
    secure_link_id: string
    papermark_document_id: string
    recipient_mode: string
  }>

  return rows.map((r) => ({
    id: r.id,
    series: r.series,
    title: r.title,
    editionLabel: r.edition_label,
    secureLinkId: r.secure_link_id,
    papermarkDocumentId: r.papermark_document_id,
    recipientMode: isRecipientMode(r.recipient_mode) ? r.recipient_mode : "edition",
  }))
}
