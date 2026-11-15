'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin, requireOwner } from '@/lib/dal'
import { getSql } from '@/lib/db'
import type { FormState } from '@/lib/definitions'
import {
  EDITORIAL_METADATA_PENDING,
  MAX_TAGS_PER_PUBLICATION,
  MAX_TAG_LABEL_LENGTH,
  TAG_KIND_LABELS,
  isTagKind,
  isUuid,
  normaliseTagLabel,
  parseTagIds,
  validateEditorialMetadata,
  type TagKind,
} from '@/lib/publication-metadata'
import { currentDetailsVersion, editorialMetadataReady } from '@/lib/publication-metadata-dal'

/**
 * Publication editorial metadata and the controlled tag vocabulary.
 *
 *  - Any administrator (owner or editor) may set a publication's author/editor,
 *    covered period, information cut-off, reading time and tags, and may add a
 *    tag to the vocabulary.
 *  - Only an owner may rename, retire, restore or delete a tag. A tag carried
 *    by any publication cannot be deleted (the database refuses too): it is
 *    retired, stays on the publications that carry it, and can no longer be
 *    added to others.
 *  - Saving details and tags is refused when they have changed since the
 *    editor's page was rendered (detailsVersion in
 *    src/lib/publication-metadata-dal.ts), so a save never silently removes a
 *    tag or value another editor saved meanwhile. The check runs just before
 *    the write; it is not a lock.
 *
 * Every action authorises itself first (requireAdmin / requireOwner re-read
 * the account and its role from the database), validates its input, uses
 * bound parameters only, and changes nothing else: no edition is published or
 * switched On, no plan, exception, recipient, link or Papermark setting is
 * touched, and nothing is sent. Papermark synchronisation never writes these
 * fields (src/lib/dataroom-dal.ts fills only blank sync-derived columns).
 */

const FAILED = 'That could not be saved. Please try again. Who can read each edition is unchanged.'
const DETAILS_VERSION = /^[0-9a-f]{64}$/
const DETAILS_STALE =
  'These details or tags were changed by someone else after you opened this page. Nothing was saved. Reload the page to see the latest, then make your change again.'

function refresh(publicationId?: unknown) {
  if (isUuid(publicationId)) revalidatePath(`/admin/documents/${publicationId}`)
  revalidatePath('/admin/tags')
  revalidatePath('/portal')
}

const kindName = (kind: TagKind) => TAG_KIND_LABELS[kind].label.toLowerCase()

/** The publication editor's "Reader details and tags" panel. Owners and editors. */
export async function savePublicationDetails(id: string, _prev: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin()
  if (!isUuid(id)) return { message: 'Unknown publication.' }
  const parsed = validateEditorialMetadata({
    authorEditor: form.get('authorEditor'),
    coveredPeriodStart: form.get('coveredPeriodStart'),
    coveredPeriodEnd: form.get('coveredPeriodEnd'),
    informationCutoff: form.get('informationCutoff'),
    readingMinutes: form.get('readingMinutes'),
  })
  if (!parsed.ok) return { errors: parsed.errors, message: 'Check the highlighted fields. Nothing was saved.' }
  const tagIds = parseTagIds(form.getAll('tags'))
  if (!tagIds) return { errors: { tags: [`Choose at most ${MAX_TAGS_PER_PUBLICATION} tags.`] }, message: 'Check the tags. Nothing was saved.' }

  const sql = getSql()
  try {
    if (!(await editorialMetadataReady(sql, { fresh: true }))) return { message: EDITORIAL_METADATA_PENDING }
    // The details and tags the form was rendered with must still be the stored
    // ones: otherwise this save would silently undo another editor's change.
    const seen = form.get('detailsVersion')
    if (typeof seen !== 'string' || !DETAILS_VERSION.test(seen)) return { message: 'Reload the page and try again. Nothing was saved.' }
    const stored = await currentDetailsVersion(sql, id)
    if (stored === null) return { message: 'That publication no longer exists.' }
    if (stored !== seen) return { message: DETAILS_STALE }
    const current = new Set(
      ((await sql`select tag_id from publication_tag_assignments where publication_id = ${id}::uuid`) as { tag_id: string }[]).map((r) => r.tag_id),
    )
    const chosen = tagIds.length
      ? ((await sql`select id, kind, label, active from publication_tags where id = any(${tagIds}::uuid[])`) as { id: string; kind: string; label: string; active: boolean }[])
      : []
    if (chosen.length !== tagIds.length) {
      return { errors: { tags: ['A tag you chose no longer exists.'] }, message: 'A tag you chose no longer exists. Reload the page. Nothing was saved.' }
    }
    // A retired tag stays where it already is, but is never added anew.
    const retired = chosen.filter((t) => !current.has(t.id) && !t.active)
    if (retired.length) {
      const names = retired.map((t) => `“${t.label}”`).join(', ')
      return { errors: { tags: [`${names} ${retired.length === 1 ? 'is' : 'are'} retired and cannot be added.`] }, message: `${names} ${retired.length === 1 ? 'is' : 'are'} retired and cannot be added. Nothing was saved.` }
    }
    const added = chosen.filter((t) => !current.has(t.id)).map((t) => t.id)
    const m = parsed.value
    await sql.transaction([
      sql`
        update documents set
          author_editor = ${m.authorEditor},
          covered_period_start = ${m.coveredPeriodStart}::date,
          covered_period_end = ${m.coveredPeriodEnd}::date,
          information_cutoff = ${m.informationCutoff}::date,
          reading_time_minutes = ${m.readingMinutes}::int,
          updated_at = now()
        where id = ${id}::uuid
      `,
      sql`delete from publication_tag_assignments where publication_id = ${id}::uuid and not (tag_id = any(${tagIds}::uuid[]))`,
      sql`
        insert into publication_tag_assignments (publication_id, tag_id, assigned_by)
        select ${id}::uuid, t.id, ${admin.id}::uuid from publication_tags t
        where t.id = any(${added}::uuid[]) and t.active
        on conflict do nothing
      `,
    ])
  } catch {
    return { message: FAILED }
  }
  refresh(id)
  return { ok: true, message: 'Saved. Subscribers who may already read this edition see these details on its card; nothing else changed.' }
}

/** Adds a subject, sector or geography to the vocabulary. Owners and editors. */
export async function addPublicationTag(_prev: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin()
  const kind = form.get('kind')
  if (!isTagKind(kind)) return { errors: { kind: ['Choose subject, sector or geography.'] }, message: 'Choose subject, sector or geography.' }
  const label = normaliseTagLabel(form.get('label'))
  if (!label) {
    const message = `Enter a ${kindName(kind)} of 1 to ${MAX_TAG_LABEL_LENGTH} characters.`
    return { errors: { label: [message] }, message }
  }
  const sql = getSql()
  try {
    if (!(await editorialMetadataReady(sql, { fresh: true }))) return { message: EDITORIAL_METADATA_PENDING }
    const inserted = (await sql`
      insert into publication_tags (kind, label, created_by, updated_by)
      values (${kind}, ${label}, ${admin.id}::uuid, ${admin.id}::uuid)
      on conflict do nothing
      returning id
    `) as { id: string }[]
    if (!inserted.length) {
      const [existing] = (await sql`
        select label, active from publication_tags where kind = ${kind} and lower(label) = lower(${label}) limit 1
      `) as { label: string; active: boolean }[]
      if (existing && !existing.active) {
        return { message: `“${existing.label}” already exists as a retired ${kindName(kind)}. An owner can restore it in Publication Tags.` }
      }
      return { message: `The ${kindName(kind)} “${existing?.label ?? label}” already exists.` }
    }
  } catch {
    return { message: FAILED }
  }
  refresh(form.get('publicationId'))
  return { ok: true, message: `Added the ${kindName(kind)} “${label}”. It can now be chosen on any publication.` }
}

/** Renames a tag everywhere it is used (labels stay consistent). Owners only. */
export async function renamePublicationTag(_prev: FormState, form: FormData): Promise<FormState> {
  const admin = await requireOwner()
  const id = form.get('id')
  if (!isUuid(id)) return { message: 'Unknown tag.' }
  const label = normaliseTagLabel(form.get('label'))
  if (!label) return { errors: { label: [`Use 1 to ${MAX_TAG_LABEL_LENGTH} characters.`] }, message: `Use 1 to ${MAX_TAG_LABEL_LENGTH} characters. Nothing was changed.` }
  const sql = getSql()
  try {
    if (!(await editorialMetadataReady(sql, { fresh: true }))) return { message: EDITORIAL_METADATA_PENDING }
    const rows = (await sql`
      update publication_tags set label = ${label}, updated_by = ${admin.id}::uuid, updated_at = now()
      where id = ${id}::uuid
      returning kind
    `) as { kind: string }[]
    if (!rows.length) return { message: 'That tag no longer exists.' }
  } catch (error) {
    if ((error as { code?: string })?.code === '23505') return { message: `Another tag of that kind is already called “${label}”. Nothing was changed.` }
    return { message: FAILED }
  }
  refresh()
  return { ok: true, message: `Renamed to “${label}” on every publication that carries it.` }
}

/** Retires a tag (no longer offered; kept where it is) or restores it. Owners only. */
export async function setPublicationTagActive(_prev: FormState, form: FormData): Promise<FormState> {
  const admin = await requireOwner()
  const id = form.get('id')
  const state = form.get('state')
  if (!isUuid(id)) return { message: 'Unknown tag.' }
  if (state !== 'retire' && state !== 'restore') return { message: 'Choose Retire or Restore.' }
  const sql = getSql()
  try {
    if (!(await editorialMetadataReady(sql, { fresh: true }))) return { message: EDITORIAL_METADATA_PENDING }
    const rows = (state === 'retire'
      ? await sql`
          update publication_tags set active = false, retired_by = ${admin.id}::uuid, retired_at = now(),
                 updated_by = ${admin.id}::uuid, updated_at = now()
          where id = ${id}::uuid and active
          returning label`
      : await sql`
          update publication_tags set active = true, retired_by = null, retired_at = null,
                 updated_by = ${admin.id}::uuid, updated_at = now()
          where id = ${id}::uuid and not active
          returning label`) as { label: string }[]
    if (!rows.length) return { message: state === 'retire' ? 'That tag is already retired, or no longer exists.' : 'That tag is already active, or no longer exists.' }
    refresh()
    return {
      ok: true,
      message: state === 'retire'
        ? `Retired “${rows[0].label}”. It stays on the publications that carry it and can no longer be added to others.`
        : `Restored “${rows[0].label}”. It can be chosen again.`,
    }
  } catch {
    return { message: FAILED }
  }
}

/** Deletes a tag no publication carries (a typo, say). A tag in use is retired instead. Owners only. */
export async function deletePublicationTag(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner()
  const id = form.get('id')
  if (!isUuid(id)) return { message: 'Unknown tag.' }
  const sql = getSql()
  const inUse = (count: number) =>
    ({ message: `This tag is carried by ${count} publication${count === 1 ? '' : 's'}, so it was not deleted. Retire it instead.` }) satisfies FormState
  try {
    if (!(await editorialMetadataReady(sql, { fresh: true }))) return { message: EDITORIAL_METADATA_PENDING }
    const rows = (await sql`
      delete from publication_tags t
      where t.id = ${id}::uuid
        and not exists (select 1 from publication_tag_assignments a where a.tag_id = t.id)
      returning t.label
    `) as { label: string }[]
    if (!rows.length) {
      const [used] = (await sql`
        select (select count(*)::int from publication_tag_assignments a where a.tag_id = t.id) as n
        from publication_tags t where t.id = ${id}::uuid
      `) as { n: number | string }[]
      return used ? inUse(Number(used.n)) : { message: 'That tag no longer exists.' }
    }
    refresh()
    return { ok: true, message: `Deleted “${rows[0].label}”. No publication carried it.` }
  } catch (error) {
    // Assigned between the check and the delete: the database refuses (on delete restrict).
    if ((error as { code?: string })?.code === '23503') return inUse(1)
    return { message: FAILED }
  }
}
