"use server"

import { after } from "next/server"
import { revalidatePath } from "next/cache"
import { requireOwner } from "@/lib/dal"
import { getSql } from "@/lib/db"
import type { FormState } from "@/lib/definitions"
import { normaliseReaderEmail, readerHasEditions } from "@/lib/review-reader"
import {
  readerRoomsSchemaReady,
  prepareReaderRooms,
  reconcileAllReaderRooms,
} from "@/lib/review-reader-rooms"

const PROOF_CHECKS = [
  "one_code",
  "all_assigned_open",
  "no_other_or_withdrawn",
  "no_download",
  "removal_hides",
  "new_edition_appears",
] as const

async function ready(): Promise<FormState | null> {
  if (!(await readerRoomsSchemaReady())) return { message: "Apply 20261009_review_reader_rooms.sql first." }
  return null
}

/**
 * Prepares (or repairs) personal rooms for up to five named approved readers
 * -- the controlled test, or a single reader's repair. Each result is what
 * Papermark confirmed by read-back.
 */
export async function prepareRoomsFor(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireOwner()
  const blocked = await ready()
  if (blocked) return blocked
  const emails = [...new Set(String(formData.get("emails") ?? "").split(/[\s,;]+/).map(normaliseReaderEmail).filter((e): e is string => Boolean(e)))]
  if (emails.length === 0) return { message: "Enter one or more approved reader addresses." }
  if (emails.length > 5) return { message: "Prepare at most five readers at a time here; use Prepare all approved readers for the rollout." }
  const approved: string[] = []
  const skipped: string[] = []
  for (const e of emails) ((await readerHasEditions(e)) ? approved : skipped).push(e)
  const results = await prepareReaderRooms(approved)
  revalidatePath("/admin/review-library")
  const lines = results.map((r) => `${r.email}: ${r.message}`)
  if (skipped.length) lines.push(`Not approved for any published edition, so no room: ${skipped.join(", ")}`)
  return { ok: results.every((r) => r.state === "ready") && skipped.length === 0, message: lines.join(" · ") }
}

/** Re-checks every existing room against Papermark, after the response. */
export async function checkAllRooms(_prev: FormState): Promise<FormState> {
  await requireOwner()
  const blocked = await ready()
  if (blocked) return blocked
  after(async () => {
    try {
      await reconcileAllReaderRooms()
    } catch {}
  })
  return { ok: true, message: "Checking every reader room with Papermark now (about a second per call). Refresh this page in a minute or two." }
}

/** The rollout: rooms for every approved reader who has none ready yet, after the response. */
export async function prepareAllApprovedRooms(_prev: FormState): Promise<FormState> {
  await requireOwner()
  const blocked = await ready()
  if (blocked) return blocked
  const rows = (await getSql()`
    select distinct r.email from review_edition_recipients r
    join review_publication_editions e on e.id = r.edition_id
    where r.revoked_at is null and e.publication_state = 'published'
      and not exists (select 1 from review_reader_rooms m where m.email = r.email and m.state = 'ready')
    order by r.email
  `) as { email: string }[]
  const emails = rows.map((r) => r.email)
  if (emails.length === 0) return { ok: true, message: "Every approved reader already has a ready room." }
  after(async () => {
    try {
      await prepareReaderRooms(emails)
    } catch {}
  })
  return { ok: true, message: `Preparing rooms for ${emails.length} approved reader${emails.length === 1 ? "" : "s"} now. Papermark allows about 50 calls a minute, so allow a few minutes, then refresh; run it again for any not yet ready.` }
}

/**
 * Records that the controlled two-reader Papermark test passed. Required
 * before the public cards can open personal rooms.
 */
export async function recordRoomsProof(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireOwner()
  const blocked = await ready()
  if (blocked) return blocked
  const a = normaliseReaderEmail(formData.get("readerA"))
  const b = normaliseReaderEmail(formData.get("readerB"))
  if (!a || !b || a === b) return { message: "Enter the two different test reader addresses." }
  const missing = PROOF_CHECKS.filter((c) => formData.get(c) !== "on")
  if (missing.length) return { message: "Every check must have been seen to pass before the rooms can be used." }
  const rooms = (await getSql()`
    select email, verified_visible from review_reader_rooms where email in (${a}, ${b}) and state = 'ready'
  `) as { email: string; verified_visible: string | null }[]
  if (rooms.length !== 2) return { message: "Both test readers need a ready room, confirmed by Papermark." }
  if (rooms[0]!.verified_visible === rooms[1]!.verified_visible) {
    return { message: "The two test readers must be assigned different sets of editions." }
  }
  const proof = { at: new Date().toISOString(), by: admin.id, readers: 2, checks: [...PROOF_CHECKS] }
  await getSql()`
    insert into app_settings (key, value) values ('review_rooms_proof', ${JSON.stringify(proof)})
    on conflict (key) do update set value = excluded.value
  `
  revalidatePath("/admin/review-library")
  return { ok: true, message: "Recorded. Personal Papermark rooms can now be chosen for the public cards." }
}

/** Withdraws the proof and, if the cards were using rooms, puts them back on Papermark links. */
export async function withdrawRoomsProof(_prev: FormState): Promise<FormState> {
  await requireOwner()
  const sql = getSql()
  await sql`delete from app_settings where key = 'review_rooms_proof'`
  await sql`update app_settings set value = 'papermark' where key = 'review_entry_mode' and value = 'rooms'`
  revalidatePath("/")
  revalidatePath("/publications")
  revalidatePath("/admin/review-library")
  return { ok: true, message: "Withdrawn. The public cards link straight to Papermark again; existing rooms are untouched." }
}
