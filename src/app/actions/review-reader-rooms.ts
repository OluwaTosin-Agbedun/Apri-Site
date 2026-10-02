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

async function ready(): Promise<FormState | null> {
  if (!(await readerRoomsSchemaReady())) return { message: "Apply 20261009_review_reader_rooms.sql first." }
  return null
}

/**
 * Prepares (or repairs) personal access for up to five named approved
 * readers. Each result is what
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
