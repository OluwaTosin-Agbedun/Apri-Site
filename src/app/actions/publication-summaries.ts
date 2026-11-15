'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin, type CurrentAdmin } from '@/lib/dal'
import { getSql } from '@/lib/db'
import type { FormState } from '@/lib/definitions'
import {
  EDITORIAL_METADATA_PENDING,
  isCompleteSummary,
  isEmptySummary,
  isUuid,
  sameSummary,
  validateSummaryInput,
  type SummaryText,
} from '@/lib/publication-metadata'
import { editorialMetadataReady } from '@/lib/publication-metadata-dal'
import {
  approveSummaryRevision,
  readStoredSummary,
  saveSummaryText,
  withdrawSummaryApproval,
  type StoredSummary,
} from '@/lib/publication-summaries'

/**
 * Protected summaries, written in the publication editor: What changed, Why
 * it matters, Implications and relevant risks/scenarios, What to watch next,
 * and optionally a source date and an uncertainty note.
 *
 *  - Any administrator may save a draft. Drafts are never shown to readers.
 *  - Only an owner may approve (the role is re-read from the database by
 *    requireAdmin, never taken from the cookie), only a complete summary,
 *    only the saved text, and only by the explicit Approve button. Text
 *    changed in the form must be saved first, so re-approving edited text is
 *    always a separate, second action.
 *  - Saving text that differs from the approved text removes the approval in
 *    the same statement.
 *  - Every write is a compare-and-set on the revision the editor was shown
 *    (src/lib/publication-summaries.ts): if anyone saved, approved or
 *    withdrew in the meantime, nothing is written and the editor is asked to
 *    reload. Two simultaneous edits or approvals cannot both succeed, and
 *    nobody approves text they did not see.
 *  - Nothing else changes: no edition is published or switched On, no plan,
 *    exception, recipient, link or Papermark setting is touched, and nothing
 *    is sent.
 *
 * The single exported action authorises itself before reading anything; draft,
 * approve and withdraw are internal functions, not separate endpoints.
 */

const REVISION = /^\d{1,15}$/
const STALE =
  'This summary was changed by someone else after you opened it. Nothing was saved. Reload the page to see the latest text.'
const FAILED = 'The summary could not be saved. Please try again. Who can read this edition is unchanged.'

type Loaded =
  | { ok: true; sql: ReturnType<typeof getSql>; revision: number; stored: StoredSummary | null }
  | { ok: false; state: FormState }

/** Validates the id and revision, checks the migration, and reads the summary the editor was shown. */
async function load(id: unknown, form: FormData): Promise<Loaded> {
  if (!isUuid(id)) return { ok: false, state: { message: 'Unknown publication.' } }
  const raw = form.get('revision')
  if (typeof raw !== 'string' || !REVISION.test(raw)) return { ok: false, state: { message: 'Reload the page and try again.' } }
  const revision = Number(raw)
  try {
    const sql = getSql()
    if (!(await editorialMetadataReady(sql, { fresh: true }))) return { ok: false, state: { message: EDITORIAL_METADATA_PENDING } }
    const exists = (await sql`select 1 from documents where id = ${id}::uuid limit 1`) as unknown[]
    if (!exists.length) return { ok: false, state: { message: 'That publication no longer exists.' } }
    const stored = await readStoredSummary(sql, id)
    if ((stored?.revision ?? 0) !== revision) return { ok: false, state: { message: STALE } }
    return { ok: true, sql, revision, stored }
  } catch {
    return { ok: false, state: { message: FAILED } }
  }
}

function submitted(form: FormData): { ok: true; text: SummaryText } | { ok: false; state: FormState } {
  const result = validateSummaryInput({
    whatChanged: form.get('whatChanged'),
    whyItMatters: form.get('whyItMatters'),
    implications: form.get('implications'),
    watchNext: form.get('watchNext'),
    sourceDate: form.get('sourceDate'),
    uncertainty: form.get('uncertainty'),
  })
  if (!result.ok) return { ok: false, state: { errors: result.errors, message: `${Object.values(result.errors).flat().join(' ')} Nothing was saved.` } }
  return { ok: true, text: result.value }
}

function finish(result: 'saved' | 'stale', id: string, message: string): FormState {
  if (result === 'stale') return { message: STALE }
  revalidatePath(`/admin/documents/${id}`)
  revalidatePath('/portal')
  return { ok: true, message }
}

const isOwner = (admin: CurrentAdmin) => admin.role === 'owner'

/** Saves the text as a draft. Changing approved text removes the approval. */
async function saveDraft(admin: CurrentAdmin, id: string, form: FormData): Promise<FormState> {
  const loaded = await load(id, form)
  if (!loaded.ok) return loaded.state
  const input = submitted(form)
  if (!input.ok) return input.state
  const { stored } = loaded
  if (stored ? sameSummary(input.text, stored.text) : isEmptySummary(input.text)) return { ok: true, message: 'No changes to save.' }
  const invalidates = stored?.approved != null
  try {
    const result = await saveSummaryText(loaded.sql, { publicationId: id, revision: loaded.revision, text: input.text, adminId: admin.id, invalidates })
    return finish(
      result,
      id,
      invalidates
        ? 'Draft saved. Because the approved text changed, subscribers no longer see this summary until an owner approves it again.'
        : 'Draft saved. It is not shown to subscribers until an owner approves it.',
    )
  } catch {
    return { message: FAILED }
  }
}

/**
 * Approves the saved text, exactly as saved. Owners only; every required
 * field written. Text changed in the form is refused until it has been saved
 * as a draft, so an approval never writes text and always covers what the
 * editor last stored, at the revision this owner was shown.
 */
async function approve(admin: CurrentAdmin, id: string, form: FormData): Promise<FormState> {
  // Refused before anything is read or written.
  if (!isOwner(admin)) return { message: 'Only an owner can approve a summary for subscribers. Your draft can be saved for an owner to review.' }
  const loaded = await load(id, form)
  if (!loaded.ok) return loaded.state
  const input = submitted(form)
  if (!input.ok) return input.state
  const { stored } = loaded
  if (!stored || !sameSummary(input.text, stored.text)) return { message: 'Save the change as a draft first, then approve it. Nothing was approved.' }
  if (!isCompleteSummary(stored.text)) {
    return { message: 'Write What changed, Why it matters, Implications and relevant risks/scenarios, and What to watch next before approving. Nothing was approved.' }
  }
  if (stored.status === 'approved') return { ok: true, message: 'This text is already approved.' }
  try {
    const result = await approveSummaryRevision(loaded.sql, { publicationId: id, revision: loaded.revision, adminId: admin.id })
    return finish(
      result,
      id,
      'Approved. Subscribers who may already read this edition now see this summary. Its publication, paid access and recipients are unchanged.',
    )
  } catch {
    return { message: FAILED }
  }
}

/** Takes an approved summary down without changing its text. Owners only. */
async function withdraw(admin: CurrentAdmin, id: string, form: FormData): Promise<FormState> {
  if (!isOwner(admin)) return { message: 'Only an owner can withdraw an approval.' }
  const loaded = await load(id, form)
  if (!loaded.ok) return loaded.state
  if (!loaded.stored?.approved) return { ok: true, message: 'This summary is not approved, so subscribers do not see it.' }
  try {
    const result = await withdrawSummaryApproval(loaded.sql, { publicationId: id, revision: loaded.revision, adminId: admin.id })
    return finish(result, id, 'Approval withdrawn. Subscribers no longer see this summary. The text is kept as a draft.')
  } catch {
    return { message: FAILED }
  }
}

/**
 * The editor's single form action. The administrator is read from the signed
 * session and the database first; the button pressed (intent) then says which
 * of the three is meant. Anything else is refused.
 */
export async function submitPublicationSummary(id: string, _prev: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin()
  const intent = form.get('intent')
  if (intent === 'draft') return saveDraft(admin, id, form)
  if (intent === 'approve') return approve(admin, id, form)
  if (intent === 'withdraw') return withdraw(admin, id, form)
  return { message: 'Choose Save draft or Approve.' }
}
