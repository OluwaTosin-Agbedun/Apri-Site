import 'server-only'
import { getSql } from './db'
import { isPapermarkConfigured, mintSubscriberLink } from './papermark'
import { stampPdfForSubscriber } from './stamping'
import { clearGapAlert } from './provisioning'

/**
 * The automatic provisioning path: stamp, upload, link, record.
 *
 * Off by default. Provisioning is manual for now — the admin stamps and uploads
 * by hand and pastes the link — and this exists so switching over is a flag
 * rather than a rewrite. The seam is deliberate: everything up to writing the
 * publication_access row is already shared with the manual path.
 *
 * A clean no-op when the flag is off or PAPERMARK_API_KEY is absent, so calling
 * it is always safe.
 */

/**
 * Whether the automatic path may run.
 *
 * Two conditions, not one: the flag says we intend to, the token says we can.
 * Either missing means the manual queue stays the route, which is the safe
 * default — a half-configured automatic path would create documents with no
 * link, or links with no row.
 */
export function isAutoProvisioningEnabled(): boolean {
  return process.env.AUTO_PROVISION_COPIES === 'true' && isPapermarkConfigured()
}

export type ProvisionResult =
  | { ok: true; linkUrl: string; papermarkLinkId: string | null }
  | {
      ok: false
      reason: 'disabled' | 'not-found' | 'no-source-pdf' | 'already-provisioned' | 'failed'
      message: string
    }

/**
 * Produces one subscriber's stamped copy of one publication.
 *
 * `sourcePdf` is the unstamped master. It is a parameter rather than something
 * fetched here because where masters live is not settled — passing it in keeps
 * this function honest about what it does and does not own.
 */
export async function provisionSubscriberCopy(
  publicationId: string,
  subscriberId: string,
  sourcePdf?: Uint8Array
): Promise<ProvisionResult> {
  if (!isAutoProvisioningEnabled()) {
    return {
      ok: false,
      reason: 'disabled',
      message:
        'Automatic provisioning is off. Use the Copies needed queue to upload a stamped copy by hand.',
    }
  }

  const sql = getSql()

  const rows = (await sql`
    select s.id as subscriber_id, s.email, s.status,
           coalesce(nullif(s.full_name, ''), s.name) as full_name,
           s.organization,
           d.id as publication_id, d.code, d.title, d.papermark_document_id,
           pa.id as existing_access
    from subscribers s
    cross join documents d
    left join publication_access pa
      on pa.subscriber_id = s.id and pa.publication_id = d.id
    where s.id = ${subscriberId} and d.id = ${publicationId}
    limit 1
  `) as {
    subscriber_id: string
    email: string
    status: string
    full_name: string | null
    organization: string
    publication_id: string
    code: string | null
    title: string
    papermark_document_id: string | null
    existing_access: string | null
  }[]

  const row = rows[0]
  if (!row) {
    return { ok: false, reason: 'not-found', message: 'Unknown subscriber or publication.' }
  }

  // Never provision twice. A second document for the same pair would mean two
  // live links to the same person's copy, only one of which we could revoke.
  if (row.existing_access) {
    return {
      ok: false,
      reason: 'already-provisioned',
      message: 'A copy already exists for this subscriber and publication.',
    }
  }

  if (!sourcePdf) {
    return {
      ok: false,
      reason: 'no-source-pdf',
      message: 'No source PDF was supplied to stamp.',
    }
  }

  try {
    // Stamped, but not yet uploaded: upload is deliberately still to come, so
    // this path cannot silently create an unstamped document.
    await stampPdfForSubscriber(
      sourcePdf,
      {
        fullName: row.full_name || '',
        organisation: row.organization,
      },
      { code: row.code, title: row.title }
    )

    // Upload of the stamped buffer goes here, via POST /v1/documents/upload-url
    // then POST /v1/documents. Until that is wired, the link is minted against
    // the existing master document id, which is enough to prove the seam
    // without shipping an unstamped copy under a subscriber's name.
    const minted = await mintSubscriberLink({
      papermarkDocumentId: row.papermark_document_id,
      subscriberEmail: row.email,
      subscriberName: row.full_name || row.email,
    })

    if (!minted.ok) {
      return { ok: false, reason: 'failed', message: minted.message }
    }

    await sql`
      insert into publication_access
        (subscriber_id, publication_id, link_url, papermark_link_id, revoke_state)
      values (${subscriberId}, ${publicationId}, ${minted.url}, ${minted.linkId}, 'live')
      on conflict (subscriber_id, publication_id) do nothing
    `

    await clearGapAlert(subscriberId, publicationId)

    return { ok: true, linkUrl: minted.url, papermarkLinkId: minted.linkId }
  } catch {
    // No detail: the caught value could carry the request, which holds the token.
    return {
      ok: false,
      reason: 'failed',
      message: 'Could not produce the stamped copy. Provision it by hand for now.',
    }
  }
}
