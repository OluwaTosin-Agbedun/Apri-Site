'use server'

import { revalidatePath } from 'next/cache'
import * as z from 'zod'
import { requireAdmin } from '@/lib/dal'
import { getSql } from '@/lib/db'
import { clearGapAlert } from '@/lib/provisioning'
import { releaseHeldAlert } from '@/lib/alerts'
import { confirmManualRevocation, revokeSubscriberAccess } from '@/lib/revocation'
import { copyId as makeCopyId, type NamedPublication, type NamedSubscriber } from '@/lib/copy-naming'
import type { FormState } from '@/lib/definitions'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The host stamped copies must be served from.
 *
 * A papermark.com/view/... address is refused. Those URLs are tied to
 * Papermark's own domain and change if the document is moved or the account's
 * custom domain is applied later — a link that changes is a link that breaks
 * silently, months after anyone remembers pasting it.
 */
const REQUIRED_HOST = 'docs.athenacentre.org'

const LinkUrl = z
  .string()
  .trim()
  .min(1, { error: 'Paste the link URL.' })
  .max(500)
  .pipe(z.url({ protocol: /^https$/, error: 'Must be an https:// URL.' }))
  .refine(
    (value) => {
      try {
        return new URL(value).hostname.toLowerCase() === REQUIRED_HOST
      } catch {
        return false
      }
    },
    {
      error: `The link must be on ${REQUIRED_HOST}. A papermark.com address will change and break later — set the custom domain on the link in Papermark first.`,
    }
  )

const ProvisionSchema = z.object({
  subscriberId: z.string().regex(UUID, { error: 'Unknown subscriber.' }),
  publicationId: z.string().regex(UUID, { error: 'Unknown publication.' }),
  linkUrl: LinkUrl,
  papermarkLinkId: z.string().trim().min(1, { error: 'Paste the Papermark link ID.' }).max(200),
})

/**
 * Records one subscriber's stamped copy of one publication.
 *
 * The copy id is generated server-side from the two records rather than taken
 * from the form: it is stamped inside the document and must resolve back to
 * exactly one access row, so it cannot be something an operator could mistype.
 */
export async function provisionCopy(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  await requireAdmin()

  const parsed = ProvisionSchema.safeParse({
    subscriberId: formData.get('subscriberId'),
    publicationId: formData.get('publicationId'),
    linkUrl: formData.get('linkUrl'),
    papermarkLinkId: formData.get('papermarkLinkId'),
  })

  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { message: first?.message ?? 'Check the details and try again.' }
  }

  const { subscriberId, publicationId, linkUrl, papermarkLinkId } = parsed.data
  const sql = getSql()

  // Re-read both sides. The form carries ids, so this is what confirms they
  // exist and that the pair is the one the operator was shown.
  const rows = (await sql`
    select coalesce(nullif(s.full_name, ''), s.name) as full_name,
           s.organization, s.seat_no,
           d.series, d.code, d.title, d.edition_date, d.visibility, d.is_shared_copy
    from subscribers s
    cross join documents d
    where s.id = ${subscriberId} and d.id = ${publicationId}
    limit 1
  `) as {
    full_name: string | null
    organization: string
    seat_no: number | null
    series: string
    code: string | null
    title: string
    edition_date: string | Date | null
    visibility: string
    is_shared_copy: boolean
  }[]

  const row = rows[0]
  if (!row) return { message: 'That subscriber or publication no longer exists.' }

  if (row.visibility === 'OPEN') {
    return {
      message:
        'This publication is open to all readers, so it needs no per-subscriber copy.',
    }
  }
  if (row.is_shared_copy) {
    return {
      message:
        'This publication is marked as a shared unstamped copy. Set its shared link on the publication instead.',
    }
  }

  const publication: NamedPublication = {
    series: row.series,
    code: row.code,
    title: row.title,
    editionDate: row.edition_date,
  }
  const subscriber: NamedSubscriber = {
    fullName: row.full_name || '',
    organisation: row.organization,
    seatNo: row.seat_no,
  }

  const copyId = makeCopyId(publication, subscriber)

  try {
    await sql`
      insert into publication_access
        (subscriber_id, publication_id, link_url, papermark_link_id, copy_id, revoke_state)
      values (${subscriberId}, ${publicationId}, ${linkUrl}, ${papermarkLinkId}, ${copyId}, 'live')
      on conflict (subscriber_id, publication_id) do update set
        link_url          = excluded.link_url,
        papermark_link_id = excluded.papermark_link_id,
        copy_id           = coalesce(publication_access.copy_id, excluded.copy_id),
        revoke_state      = 'live',
        revoked_at        = null,
        updated_at        = now()
    `
  } catch {
    return {
      message:
        'Could not save. That Papermark link may already be recorded against another copy.',
    }
  }

  await clearGapAlert(subscriberId, publicationId)

  // The subscriber hears about the edition as soon as it is theirs to open,
  // rather than waiting for someone to remember they were held.
  const released = await releaseHeldAlert(subscriberId, publicationId)

  revalidatePath('/admin/copies')
  revalidatePath('/admin/engagement')
  revalidatePath('/portal')

  return {
    ok: true,
    message: released
      ? `Copy ${copyId} saved, and the held alert has been sent.`
      : `Copy ${copyId} saved.`,
  }
}

/** Withdraws every live link for one subscriber. */
export async function revokeAccessFor(subscriberId: string): Promise<FormState> {
  await requireAdmin()
  if (!UUID.test(subscriberId)) return { message: 'Unknown subscriber.' }

  const summary = await revokeSubscriberAccess(subscriberId)

  revalidatePath('/admin/copies')
  revalidatePath('/admin/subscribers')

  if (summary.attempted === 0) {
    return { ok: true, message: 'No live links to withdraw.' }
  }

  return {
    ok: true,
    message:
      summary.manualRequired === 0
        ? `${summary.revoked} link${summary.revoked === 1 ? '' : 's'} revoked.`
        : `${summary.revoked} revoked; ${summary.manualRequired} need withdrawing by hand.`,
  }
}

/** Marks a manual revocation done once an admin has withdrawn it in Papermark. */
export async function markRevoked(accessId: string): Promise<FormState> {
  await requireAdmin()
  if (!UUID.test(accessId)) return { message: 'Unknown record.' }

  await confirmManualRevocation(accessId)
  revalidatePath('/admin/copies')

  return { ok: true, message: 'Marked as revoked.' }
}
