import "server-only"
import { createHash, randomUUID } from "node:crypto"
import { after } from "next/server"
import { getSql } from "./db"
import { papermarkRequest, PapermarkError, isPapermarkConfigured, papermarkRetryAt } from "./papermark"
import { getReviewLibraryForEmail } from "./publications"
import { papermarkWorkSchemaReady } from "./papermark-budget"
import { queueReviewRooms, deferReviewRoom, readerRoomJob, listRoomJobs, kickReviewRoomWorker } from "./review-room-jobs"
import { roomLease, guardRoomWork, RoomWorkDeferred } from "./review-room-lease"
import {
  permissionPlan,
  comparePermissions,
  visibleSetKey,
  roomLinkSettings,
  roomLinkProblem,
  closesAt,
  closedAt,
  roomDocumentUrl,
  type ReadPermission,
  type ReadLink,
} from "./reader-room-policy"

/**
 * Personal Papermark Data Room access for approved Complimentary Review
 * readers: one viewer group per reader (only their approved email), explicit
 * view and download permission for each published edition assigned to them,
 * and one email-authenticated group link created only after the permissions
 * have been read back and match. Papermark then performs the reader's email
 * check once for all of their editions, for its own session of 23 hours on
 * that browser.
 *
 * Nothing here runs at deploy time: a reader's room exists only once an owner
 * prepares it, and only existing rooms are reconciled when Admin changes
 * recipients, publishes or withdraws.
 *
 * Security rule: access is reported revoked only when Papermark confirms it.
 * If a removal cannot be confirmed, the reader's link is closed (its expiry
 * set in the past, URL kept for repair) until a later reconcile succeeds.
 */

export type RoomState = "ready" | "updating" | "closed" | "failed"
export type RoomResult = {
  email: string
  state: RoomState | "none"
  message: string
  visible: number
  hidden: number
  retryAt?: number
}

type RoomRow = {
  email: string
  papermark_dataroom_id: string
  papermark_group_id: string | null
  papermark_link_id: string | null
  link_url: string | null
  state: RoomState
  verified_visible: string | null
  verified_at: string | null
  last_error: string | null
  uncertain_creation?: string | null
  verified_editions?: string | null
  lease_until?: string | null
  link_open_until?: string | Date | null
  room_documents?: Record<string, string> | null
}

type Page<T> = { data?: T[]; next_cursor?: string | null } | T[]

// ---------------------------------------------------------------------------
// Papermark calls, paced under the documented 60 requests a minute.
// ---------------------------------------------------------------------------

async function paced<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  await guardRoomWork()
  const response = await papermarkRequest<T>(path, options)
  // Mutations with returned IDs are recorded by the caller before any next
  // call. Every subsequent write/call is fenced against stale work.
  return response
}

async function listAll<T>(path: string): Promise<T[]> {
  const out: T[] = []
  let cursor: string | null = null
  for (let i = 0; i < 50; i++) {
    const sep = path.includes("?") ? "&" : "?"
    const page: Page<T> = await paced<Page<T>>(`${path}${sep}limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)
    if (Array.isArray(page)) return [...out, ...page]
    out.push(...(page.data ?? []))
    cursor = page.next_cursor ?? null
    if (!cursor) return out
  }
  throw new PapermarkError("Papermark returned more pages than expected.")
}

const enc = encodeURIComponent

// ---------------------------------------------------------------------------
// Schema, configuration and the room itself
// ---------------------------------------------------------------------------

let ready: { value: boolean; at: number } | null = null
export async function readerRoomsSchemaReady(): Promise<boolean> {
  if (ready && Date.now() - ready.at < (ready.value ? 300_000 : 60_000)) return ready.value
  try {
    const [row] = (await getSql()`select to_regclass('public.review_reader_rooms') is not null and to_regclass('public.review_reader_room_events') is not null as ok`) as { ok: boolean }[]
    ready = { value: row?.ok === true, at: Date.now() }
  } catch {
    ready = { value: false, at: Date.now() }
  }
  return ready.value
}
export function resetReaderRoomsSchemaCache() {
  ready = null
  routing = null
  openWindow = null
}

/**
 * Whether 20261010 added the routing columns (verified_editions, lease_until).
 * A reader is sent to a room only while its read-back shows their current
 * editions, and one reconcile per reader runs at a time. Without the columns
 * there is no such proof, so no reader is sent to any room.
 */
let routing: { value: boolean; at: number } | null = null
async function routingColumnsReady(): Promise<boolean> {
  if (routing && Date.now() - routing.at < (routing.value ? 300_000 : 60_000)) return routing.value
  try {
    const [row] = (await getSql()`
      select count(*)::int = 2 as ok from information_schema.columns
      where table_schema = 'public' and table_name = 'review_reader_rooms' and column_name in ('verified_editions', 'lease_until')
    `) as { ok: boolean }[]
    routing = { value: row?.ok === true, at: Date.now() }
  } catch {
    routing = { value: false, at: Date.now() }
  }
  return routing.value
}

/**
 * Whether 20261011 added the open-window columns (link_open_until,
 * room_documents). Only then is a reader's link code-free -- and so open only
 * while they hold an APRI session. Without them the library keeps sending
 * readers to each edition's own Papermark link and no room link is changed.
 */
let openWindow: { value: boolean; at: number } | null = null
export async function openWindowReady(): Promise<boolean> {
  if (openWindow && Date.now() - openWindow.at < (openWindow.value ? 300_000 : 60_000)) return openWindow.value
  try {
    const [row] = (await getSql()`
      select count(*)::int = 2 as ok from information_schema.columns
      where table_schema = 'public' and table_name = 'review_reader_rooms' and column_name in ('link_open_until', 'room_documents')
    `) as { ok: boolean }[]
    openWindow = { value: row?.ok === true, at: Date.now() }
  } catch {
    openWindow = { value: false, at: Date.now() }
  }
  return openWindow.value
}

async function saveWindow(email: string, until: string | null, documents?: Record<string, string>) {
  if (!(await openWindowReady())) return
  await guardRoomWork()
  const owner = await papermarkWorkSchemaReady() ? roomLease.getStore()?.token ?? null : null
  const sql = getSql()
  if (documents) {
    await sql`update review_reader_rooms set link_open_until = ${until}::timestamptz, room_documents = ${JSON.stringify(documents)}::jsonb where email = ${email} and (${owner}::text is null or to_jsonb(review_reader_rooms)->>'lease_owner' = ${owner})`
  } else {
    await sql`update review_reader_rooms set link_open_until = ${until}::timestamptz where email = ${email} and (${owner}::text is null or to_jsonb(review_reader_rooms)->>'lease_owner' = ${owner})`
  }
}

/** The set of review editions a room shows, as stored and compared. */
export function editionSetKey(editionIds: readonly string[]): string {
  return [...new Set(editionIds)].sort().join(",")
}

/** Old view-only proofs cannot be reused as proof of download permissions. */
export function roomPolicyKey(editionIds: readonly string[]): string {
  return `review-downloads:v1:${editionSetKey(editionIds)}`
}

/** One reconcile per reader at a time: a short lease, taken atomically. */
async function takeLease(email: string): Promise<string | null> {
  const token = randomUUID()
  if (!(await routingColumnsReady())) return token
  const rows = await (await papermarkWorkSchemaReady()
    ? getSql()`update review_reader_rooms set lease_until = now() + interval '3 minutes', lease_owner = ${token}::uuid
        where email = ${email} and (lease_until is null or lease_until < now()) returning email`
    : getSql()`update review_reader_rooms set lease_until = now() + interval '3 minutes'
        where email = ${email} and (lease_until is null or lease_until < now()) returning email`)
  return rows.length ? token : null
}
async function dropLease(email: string, token: string): Promise<void> {
  if (!(await routingColumnsReady())) return
  try {
    if (await papermarkWorkSchemaReady()) await getSql()`update review_reader_rooms set lease_until = null, lease_owner = null where email = ${email} and lease_owner = ${token}::uuid`
    else await getSql()`update review_reader_rooms set lease_until = null where email = ${email}`
  } catch {}
}

/**
 * The Review Data Room: the one room every published review edition lives in.
 * More than one (or none) is refused rather than guessed.
 */
export async function reviewRoomId(): Promise<string | null> {
  const rows = (await getSql()`
    select distinct papermark_dataroom_id as id from review_publication_editions
    where publication_state = 'published' and papermark_dataroom_id is not null and papermark_dataroom_id <> ''
  `) as { id: string }[]
  return rows.length === 1 ? rows[0]!.id : null
}

type RoomDocument = { id: string; document_id: string; document_name?: string }

/** Every document in the room -- withdrawn and unassigned ones included -- keyed by Papermark document id. */
async function roomDocuments(roomId: string): Promise<RoomDocument[]> {
  return listAll<RoomDocument>(`/v1/datarooms/${enc(roomId)}/documents`)
}

const groupName = (email: string) => `APRI review reader ${createHash("sha256").update(email).digest("hex").slice(0, 12)}`

async function event(email: string, type: string, detail?: string) {
  try {
    await getSql()`insert into review_reader_room_events (email, event_type, detail) values (${email}, ${type}, ${detail?.slice(0, 500) ?? null})`
  } catch {}
}

async function save(email: string, patch: Partial<RoomRow>) {
  await guardRoomWork()
  const owner = await papermarkWorkSchemaReady() ? roomLease.getStore()?.token ?? null : null
  const sql = getSql()
  await sql`
    update review_reader_rooms set
      papermark_group_id = coalesce(${patch.papermark_group_id ?? null}, papermark_group_id),
      papermark_link_id = case when ${patch.papermark_link_id === undefined} then papermark_link_id else ${patch.papermark_link_id ?? null} end,
      link_url = case when ${patch.link_url === undefined} then link_url else ${patch.link_url ?? null} end,
      state = coalesce(${patch.state ?? null}, state),
      verified_visible = case when ${patch.verified_visible === undefined} then verified_visible else ${patch.verified_visible ?? null} end,
      verified_at = case when ${patch.verified_at === undefined} then verified_at else ${patch.verified_at ?? null}::timestamptz end,
      last_error = case when ${patch.last_error === undefined} then last_error else ${patch.last_error ?? null} end,
      updated_at = now()
    where email = ${email} and (${owner}::text is null or to_jsonb(review_reader_rooms)->>'lease_owner' = ${owner})
  `
}

/** Persist intent before POST so a crash cannot cause an untracked duplicate. */
async function beginRoomCreation(email: string, kind: "group" | "link") {
  if (!(await papermarkWorkSchemaReady())) return
  await guardRoomWork()
  const owner = roomLease.getStore()?.token ?? null
  const rows = await getSql()`update review_reader_rooms set uncertain_creation = ${`Awaiting ${kind} creation result`}
    where email = ${email} and lease_owner = ${owner}::uuid returning email`
  if (!rows.length) throw new RoomWorkDeferred(Date.now() + 5000)
}
async function recordCreatedRoomObject(email: string, kind: "group" | "link", id: string, url?: string) {
  if (!(await papermarkWorkSchemaReady())) {
    await save(email, kind === "group" ? { papermark_group_id: id } : { papermark_link_id: id, link_url: url ?? null })
    return
  }
  // Record the returned ID even when a newer input generation arrived during
  // POST; it remains unverified. Its current lease owner must still match.
  const owner = roomLease.getStore()?.token ?? null
  const rows = await getSql()`update review_reader_rooms set
    papermark_group_id = case when ${kind} = 'group' then ${id} else papermark_group_id end,
    papermark_link_id = case when ${kind} = 'link' then ${id} else papermark_link_id end,
    link_url = case when ${kind} = 'link' then ${url ?? null} else link_url end,
    uncertain_creation = null
    where email = ${email} and lease_owner = ${owner}::uuid returning email`
  if (!rows.length) throw new RoomWorkDeferred(Date.now() + 5000)
}

/**
 * Closes a reader's link so nothing more can be opened through it: its expiry
 * is set in the past (Papermark refuses an expired link) and read back. If
 * that cannot be confirmed the link is deleted; if that fails too, the room is
 * marked failed with an instruction to remove the link by hand.
 */
async function closeLink(row: RoomRow, reason: string): Promise<RoomResult> {
  if (!row.papermark_link_id) {
    await save(row.email, { state: "closed", last_error: reason })
    return { email: row.email, state: "closed", message: reason, visible: 0, hidden: 0 }
  }
  let retryAt: number | null = null
  try {
    await paced(`/v1/links/${enc(row.papermark_link_id!)}`, { method: "PATCH", body: { expires_at: closedAt() } })
    const back = await paced<ReadLink>(`/v1/links/${enc(row.papermark_link_id!)}`)
    if (back.expires_at && new Date(back.expires_at) <= new Date()) {
      await save(row.email, { state: "closed", last_error: reason })
      await saveWindow(row.email, null)
      await event(row.email, "link_closed", reason)
      return { email: row.email, state: "closed", message: `Link closed until repaired: ${reason}`, visible: 0, hidden: 0 }
    }
  } catch (error) { retryAt = error instanceof RoomWorkDeferred ? error.retryAt : papermarkRetryAt(error) }
  try {
    await paced(`/v1/links/${enc(row.papermark_link_id!)}`, { method: "DELETE" })
    let gone = false
    try { await paced(`/v1/links/${enc(row.papermark_link_id!)}`) } catch (error) {
      gone = error instanceof PapermarkError && error.failure?.status === 404
      if (!gone) throw error
    }
    if (!gone) throw new PapermarkError("Papermark still reports the link after deletion.")
    await save(row.email, { state: "closed", papermark_link_id: null, link_url: null, last_error: reason })
    await saveWindow(row.email, null)
    await event(row.email, "link_closed", `deleted: ${reason}`)
    return { email: row.email, state: "closed", message: `Link removed until repaired: ${reason}`, visible: 0, hidden: 0 }
  } catch (error) {
    retryAt = (error instanceof RoomWorkDeferred ? error.retryAt : papermarkRetryAt(error)) ?? retryAt
    const message = `${reason} The reader's link could NOT be closed: remove link ${row.papermark_link_id} in Papermark now.`
    await save(row.email, { state: "failed", last_error: message })
    await event(row.email, "link_close_failed", message)
    if (retryAt) await deferReviewRoom(row.email, retryAt, message)
    return { email: row.email, state: "failed", message, visible: 0, hidden: 0, ...(retryAt ? { retryAt } : {}) }
  }
}

/**
 * Brings one reader's room into line with their current assignments and
 * reports only what Papermark confirmed. `create` makes the room if the
 * reader has none (Admin's "Prepare"); otherwise a reader without a room is
 * left alone.
 */
export async function reconcileReaderRoom(rawEmail: string, options: { create?: boolean; docs?: RoomDocument[]; job?: { generation: number; token: string }; deadline?: number } = {}): Promise<RoomResult> {
  const email = rawEmail.trim().toLowerCase()
  const sql = getSql()
  // A reader about to get a room has a row (and so a lease) first.
  if (options.create && (await readerRoomsSchemaReady())) {
    const roomId = await reviewRoomId()
    const assigned = await getReviewLibraryForEmail(email)
    if (roomId && assigned.length > 0) {
      await sql`insert into review_reader_rooms (email, papermark_dataroom_id, state) values (${email}, ${roomId}, 'updating') on conflict (email) do nothing`
    }
  }
  const [exists] = (await readerRoomsSchemaReady())
    ? ((await sql`select 1 from review_reader_rooms where email = ${email}`) as unknown[])
    : []
  const token = exists ? await takeLease(email) : randomUUID()
  if (!token) return { email, state: "updating", message: "Another update for this reader is already running; it will finish shortly.", visible: 0, hidden: 0, retryAt: Date.now() + 5000 }
  try {
    return await roomLease.run({ email, token, job: options.job, deadline: options.deadline }, () => reconcileLeased(email, options))
  } finally {
    if (exists) await dropLease(email, token)
  }
}

async function reconcileLeased(email: string, options: { create?: boolean; docs?: RoomDocument[] }): Promise<RoomResult> {
  const none = (message: string): RoomResult => ({ email, state: "none", message, visible: 0, hidden: 0 })
  if (!(await readerRoomsSchemaReady())) return none("Apply 20261009_review_reader_rooms.sql first.")
  if (!isPapermarkConfigured()) return none("Papermark is not configured.")
  const sql = getSql()
  let [row] = (await sql`select * from review_reader_rooms where email = ${email}`) as RoomRow[]
  if (!row && !options.create) return none("This reader has no personal room.")

  const roomId = await reviewRoomId()
  if (!roomId) return row ? closeLink(row, "The Review Data Room could not be identified (published editions are in none, or more than one, room).") : none("The Review Data Room could not be identified.")
  if (row && row.papermark_dataroom_id !== roomId) return closeLink(row, "The Review Data Room changed; this room must be rebuilt.")

  const baseline = row ? { ...row } : null
  let intendedEditions: string[] | null = null
  let intendedVisible: string[] | null = null
  try {
    // What the reader should see: the published editions assigned to them,
    // by the same rule as the APRI library. Everything else in the room is
    // hidden -- withdrawn, unassigned and newly added documents alike.
    const editions = await getReviewLibraryForEmail(email)
    intendedEditions = editions.map((e) => e.id)
    const docs = options.docs ?? (await roomDocuments(roomId))
    const byDocument = new Map(docs.map((d) => [d.document_id, d.id]))
    const visible = editions.map((e) => byDocument.get(e.papermarkDocumentId)).filter((id): id is string => Boolean(id))
    const notInRoom = editions.filter((e) => !byDocument.has(e.papermarkDocumentId)).map((e) => e.pubTitle)
    const hidden = docs.length - visible.length
    intendedVisible = visible

    if (!row) {
      if (visible.length === 0) return none("No published edition in the Review Data Room is assigned to this address.")
      await sql`insert into review_reader_rooms (email, papermark_dataroom_id, state) values (${email}, ${roomId}, 'updating') on conflict (email) do nothing`
      ;[row] = (await sql`select * from review_reader_rooms where email = ${email}`) as RoomRow[]
    }
    if (notInRoom.length > 0) {
      const message = `Assigned PDF missing from the Review Data Room: ${notInRoom.join("; ").slice(0, 300)}. Correct the room contents before repairing again.`
      await save(email, { state: "failed", last_error: message })
      return { email, state: "failed", message, visible: 0, hidden }
    }
    // An unchanged verified room stays usable during a maintenance check.
    if (!(baseline?.state === "ready" && baseline.verified_editions === roomPolicyKey(intendedEditions))) await save(email, { state: "updating" })
    if (row?.uncertain_creation) return { email, state: "failed", message: "A previous creation timed out without returning its ID. Inspect Papermark before creating another object.", visible: 0, hidden }

    // 1. The group: this reader's only, admitting no domain and not everyone.
    let groupId = row!.papermark_group_id
    if (!groupId) {
      await beginRoomCreation(email, "group")
      const created = await paced<{ id: string }>(`/v1/datarooms/${enc(roomId)}/groups`, {
        method: "POST",
        body: { name: groupName(email), allow_all: false, domains: [] },
      })
      if (!created.id) throw new PapermarkError("Papermark created a group without returning its ID.", undefined, { mutationUnknown: true })
      groupId = created.id
      await recordCreatedRoomObject(email, "group", groupId)
      await event(email, "group_created")
    }
    const group = await paced<{ id: string; allow_all: boolean; domains: string[]; dataroom_id: string }>(`/v1/datarooms/${enc(roomId)}/groups/${enc(groupId)}`)
    if (group.allow_all !== false || (group.domains ?? []).length > 0 || group.dataroom_id !== roomId) {
      return closeLink({ ...row!, papermark_group_id: groupId }, "The reader's Papermark group admits more than this reader.")
    }

    // 2. Its one member: exactly this email.
    const members = await listAll<{ id: string; email: string }>(`/v1/datarooms/${enc(roomId)}/groups/${enc(groupId)}/members`)
    for (const m of members.filter((m) => m.email.trim().toLowerCase() !== email)) {
      await paced(`/v1/datarooms/${enc(roomId)}/groups/${enc(groupId)}/members/${enc(m.id)}`, { method: "DELETE" })
    }
    if (!members.some((m) => m.email.trim().toLowerCase() === email)) {
      await paced(`/v1/datarooms/${enc(roomId)}/groups/${enc(groupId)}/members`, { method: "POST", body: { emails: [email] } })
    }
    const membershipChanged = members.length !== 1 || members[0]?.email.trim().toLowerCase() !== email
    const confirmedMembers = membershipChanged ? await listAll<{ email: string }>(`/v1/datarooms/${enc(roomId)}/groups/${enc(groupId)}/members`) : members
    if (confirmedMembers.length !== 1 || confirmedMembers[0]!.email.trim().toLowerCase() !== email) {
      return closeLink({ ...row!, papermark_group_id: groupId }, "Papermark did not confirm that this reader is the group's only member.")
    }

    // 3. A row for every room document, then read back.
    const plan = permissionPlan(docs.map((d) => d.id), visible)
    let actual = await listAll<ReadPermission>(`/v1/datarooms/${enc(roomId)}/groups/${enc(groupId)}/permissions`)
    if (actual.some((p) => p.item_type !== "dataroom_document" && (p.can_view || p.can_download))) {
      return closeLink(row!, "Papermark reports a broad folder permission outside the assigned editions. Remove that grant before repairing.")
    }
    const old = new Map(actual.map((p) => [p.item_id, p]))
    const changes = plan.filter((p) => {
      const previous = old.get(p.item_id)
      return !previous || previous.can_view !== p.can_view || previous.can_download !== p.can_download
    })
    // Explicitly clear stale/folder grants as well as withdrawn documents.
    const planned = new Set(plan.map((p) => p.item_id))
    for (const p of actual) if (!planned.has(p.item_id) && (p.can_view || p.can_download)) {
      changes.push({ item_id: p.item_id, item_type: "dataroom_document", can_view: false, can_download: false })
    }
    for (let i = 0; i < changes.length; i += 1000) {
      await paced(`/v1/datarooms/${enc(roomId)}/groups/${enc(groupId)}/permissions`, { method: "PUT", body: { permissions: changes.slice(i, i + 1000) } })
    }
    if (changes.length) actual = await listAll<ReadPermission>(`/v1/datarooms/${enc(roomId)}/groups/${enc(groupId)}/permissions`)
    const check = comparePermissions(actual, visible)
    if (check.overExposed.length > 0) {
      await event(email, "permissions_unconfirmed", `over-exposed ${check.overExposed.length}, unexpected downloads ${check.unexpectedDownloads.length}`)
      return closeLink({ ...row!, papermark_group_id: groupId }, "Papermark did not confirm that unassigned or withdrawn editions cannot be viewed or downloaded.")
    }
    if (check.missing.length > 0) {
      await event(email, "permissions_unconfirmed", `missing ${check.missing.length}`)
      await save(email, { state: "failed", last_error: "Papermark did not confirm every assigned edition as visible. Nothing extra is exposed; try again." })
      return { email, state: "failed", message: "Some assigned editions are not visible yet; nothing extra is exposed. Try again.", visible: visible.length - check.missing.length, hidden }
    }
    if (check.missingDownloads.length > 0) {
      await event(email, "permissions_unconfirmed", `missing downloads ${check.missingDownloads.length}`)
      await save(email, { state: "failed", last_error: "Papermark did not confirm downloads for every assigned edition. Please retry the repair." })
      return { email, state: "failed", message: "Download permissions are not confirmed yet. Please retry the repair.", visible: visible.length, hidden }
    }
    await event(email, "permissions_confirmed", `${visible.length} visible, ${hidden} hidden`)

    if (visible.length === 0) {
      return closeLink({ ...row!, papermark_group_id: groupId }, "No editions are assigned to this reader now.")
    }

    // 4. The one link -- only now, after the permissions are confirmed.
    // Code-free (APRI-verified) once 20261011 is applied: open only until the
    // end of the reader's latest APRI session, closed while they have none.
    const codeFree = await openWindowReady()
    const { readerAccessUntil } = await import("./review-reader")
    const openUntil = codeFree ? await readerAccessUntil(email) : null
    const isClosed = (l: ReadLink) => Boolean(l.expires_at && new Date(l.expires_at) <= new Date())
    const windowConfirmed = (l: ReadLink) => (openUntil ? closesAt(l, openUntil) : isClosed(l))
    const expected = { roomId, groupId, email, codeFree }
    let linkId = row!.papermark_link_id
    let url = row!.link_url
    if (linkId) {
      let link: ReadLink
      try { link = await paced<ReadLink>(`/v1/links/${enc(linkId)}`) } catch (error) {
        if (!(error instanceof PapermarkError && error.failure?.status === 404)) throw error
        await save(email, { papermark_link_id: null, link_url: null, state: "updating", last_error: "Papermark confirmed the old link is gone. A replacement is queued." })
        await deferReviewRoom(email, Date.now() + 5000, "Replacing a confirmed missing link.")
        return { email, state: "updating", message: "The old link is gone. A replacement is queued.", visible: 0, hidden, retryAt: Date.now() + 5000 }
      }
      const problem = roomLinkProblem(link, expected, new Date(), { allowClosed: true, ignoreGate: codeFree, allowViewOnly: true })
      if (problem) return closeLink({ ...row!, papermark_group_id: groupId }, problem)
      if (link.allow_download !== true) {
        // Upgrade in place only after exact permissions, membership and the
        // other protections were confirmed. Preserve the URL and session.
        await paced(`/v1/links/${enc(linkId)}`, { method: "PATCH", body: { allow_download: true } })
        link = await paced<ReadLink>(`/v1/links/${enc(linkId)}`)
        const upgraded = roomLinkProblem(link, expected, new Date(), { allowClosed: true, ignoreGate: codeFree })
        if (upgraded) return closeLink({ ...row!, papermark_group_id: groupId }, upgraded)
        await event(email, "downloads_enabled", `${visible.length} assigned editions`)
      }
      if (codeFree) {
        if (!(link.email_authenticated === false && windowConfirmed(link))) {
          await paced(`/v1/links/${enc(linkId)}`, {
            method: "PATCH",
            body: { email_protected: true, email_authenticated: false, expires_at: openUntil ?? closedAt() },
          })
          link = await paced<ReadLink>(`/v1/links/${enc(linkId)}`)
        }
        const after = roomLinkProblem(link, expected, new Date(), { allowClosed: true })
        if (after) return closeLink({ ...row!, papermark_group_id: groupId }, after)
        if (!windowConfirmed(link)) return closeLink({ ...row!, papermark_group_id: groupId }, "Papermark did not confirm when the reader's link closes.")
      } else if (isClosed(link)) {
        await paced(`/v1/links/${enc(linkId)}`, { method: "PATCH", body: { expires_at: null } })
        link = await paced<ReadLink>(`/v1/links/${enc(linkId)}`)
        const reopened = roomLinkProblem(link, expected)
        if (reopened) return closeLink({ ...row!, papermark_group_id: groupId }, reopened)
        await event(email, "link_reopened")
      }
      url = link.url ?? url
    } else {
      await beginRoomCreation(email, "link")
      const created = await paced<ReadLink>("/v1/links", {
        method: "POST",
        body: roomLinkSettings({
          roomId,
          groupId,
          email,
          customDomain: process.env.PAPERMARK_CUSTOM_DOMAIN,
          openUntil: codeFree ? (openUntil ?? closedAt()) : null,
        }),
      })
      if (!created.id) throw new PapermarkError("Papermark created a link with no id.", undefined, { mutationUnknown: true })
      await recordCreatedRoomObject(email, "link", created.id, created.url ?? undefined)
      const back = await paced<ReadLink>(`/v1/links/${enc(created.id)}`)
      const problem =
        roomLinkProblem(back, expected, new Date(), { allowClosed: codeFree }) ??
        (codeFree && !windowConfirmed(back) ? "Papermark did not confirm when the reader's link closes." : null)
      if (problem) {
        try {
          await paced(`/v1/links/${enc(created.id)}`, { method: "DELETE" })
        } catch {
          await save(email, { state: "failed", last_error: `${problem} The new link ${created.id} could not be deleted: remove it in Papermark.` })
          return { email, state: "failed", message: `${problem} Remove link ${created.id} in Papermark.`, visible: 0, hidden }
        }
        await save(email, { state: "failed", papermark_link_id: null, link_url: null, last_error: `${problem} The new link was deleted.` })
        return { email, state: "failed", message: `${problem} The new link was deleted.`, visible: 0, hidden }
      }
      linkId = created.id
      url = back.url!
      await event(email, "link_created")
    }
    const latestEditions = await getReviewLibraryForEmail(email)
    if (roomPolicyKey(latestEditions.map((e) => e.id)) !== roomPolicyKey(intendedEditions)) throw new RoomWorkDeferred(Date.now() + 5000)
    await guardRoomWork()
    await event(email, "link_confirmed")
    await save(email, {
      papermark_link_id: linkId,
      link_url: url,
      state: "ready",
      verified_visible: visibleSetKey(visible),
      verified_at: new Date().toISOString(),
      last_error: notInRoom.length ? `Assigned but not in the Review Data Room: ${notInRoom.join("; ").slice(0, 300)}` : null,
    })
    const shownEditions = editions.filter((e) => byDocument.has(e.papermarkDocumentId))
    if (await routingColumnsReady()) {
      await guardRoomWork()
      const owner = await papermarkWorkSchemaReady() ? roomLease.getStore()?.token ?? null : null
      await sql`update review_reader_rooms set verified_editions = ${roomPolicyKey(shownEditions.map((e) => e.id))} where email = ${email}
        and (${owner}::text is null or to_jsonb(review_reader_rooms)->>'lease_owner' = ${owner})`
    }
    if (codeFree) {
      await saveWindow(email, openUntil, Object.fromEntries(shownEditions.map((e) => [e.id, byDocument.get(e.papermarkDocumentId)!])))
    }
    return { email, state: "ready", message: `Ready: ${visible.length} edition${visible.length === 1 ? "" : "s"} readable and downloadable, ${hidden} hidden.`, visible: visible.length, hidden }
  } catch (error) {
    const retryAt = error instanceof RoomWorkDeferred ? error.retryAt : papermarkRetryAt(error)
    const message = error instanceof Error ? error.message : "Papermark could not be reached."
    const [current] = (await sql`select * from review_reader_rooms where email = ${email}`) as RoomRow[]
    const latest = await getReviewLibraryForEmail(email)
    const expected = roomPolicyKey(latest.map((e) => e.id))
    const previousIds = (baseline?.verified_editions ?? "").replace(/^review-downloads:v1:/, "").split(",").filter(Boolean)
    const removal = intendedVisible
      ? (baseline?.verified_visible ?? "").split(",").filter(Boolean).some((id) => !intendedVisible!.includes(id))
      : previousIds.some((id) => !latest.some((e) => e.id === id))
    if (current?.uncertain_creation && error instanceof PapermarkError && !error.mutationUnknown && await papermarkWorkSchemaReady()) {
      const owner = roomLease.getStore()?.token ?? null
      await sql`update review_reader_rooms set uncertain_creation = null where email = ${email} and lease_owner = ${owner}::uuid`
    }
    if (retryAt) await deferReviewRoom(email, retryAt, message)
    // A superseded/expired worker must never clear or overwrite a newer lease.
    if (error instanceof RoomWorkDeferred) return { email, state: "updating", message, visible: 0, hidden: 0, retryAt: retryAt ?? undefined }
    if (error instanceof PapermarkError && error.mutationUnknown && current && await papermarkWorkSchemaReady()) {
      const owner = roomLease.getStore()?.token ?? null
      await sql`update review_reader_rooms set uncertain_creation = 'Inspect the last Papermark POST before retrying', state = 'failed', last_error = 'Creation outcome unknown; inspect Papermark before retrying.'
        where email = ${email} and lease_owner = ${owner}::uuid`
      return { email, state: "failed", message: "Creation outcome unknown; inspect Papermark before retrying.", visible: 0, hidden: 0 }
    }
    if (current?.papermark_link_id && removal && current.state !== "closed") return closeLink(current, `${message} A removal could not be confirmed.`)
    const retained = Boolean(retryAt && baseline?.state === "ready" && baseline.verified_editions === expected && current?.state !== "closed")
    if (current) await save(email, { state: retained ? "ready" : retryAt ? "updating" : "failed", last_error: message })
    await event(email, "failed", message)
    return { email, state: retained ? "ready" : retryAt ? "updating" : "failed", message, visible: retained ? (baseline?.verified_visible ?? "").split(",").filter(Boolean).length : 0, hidden: 0, ...(retryAt ? { retryAt } : {}) }

  }
}

/** Every reader who has a room and could be affected by a change to this edition. */
export async function reconcileReadersForEdition(editionId: string, options: { create?: boolean } = {}): Promise<RoomResult[]> {
  if (!(await readerRoomsSchemaReady())) return []
  const sql = getSql()
  // An edition still judged by the shared list has no recipient rows: every
  // room may be affected.
  const [mode] = (await sql`select recipient_mode from review_publication_editions where id = ${editionId}::uuid`) as { recipient_mode: string }[]
  if (mode?.recipient_mode === "shared_legacy") return reconcileAllReaderRooms()
  const rows = (await sql`
    select distinct r.email from review_reader_rooms r
    join review_edition_recipients x on x.email = r.email
    where x.edition_id = ${editionId}::uuid
  `) as { email: string }[]
  const emails = rows.map((r) => r.email)
  if (options.create) {
    // Rooms in use: a reader newly assigned this edition gets their room now.
    const fresh = (await sql`
      select distinct x.email from review_edition_recipients x
      where x.edition_id = ${editionId}::uuid and x.revoked_at is null
        and not exists (select 1 from review_reader_rooms r where r.email = x.email)
    `) as { email: string }[]
    return [...(await reconcileMany(emails)), ...(await reconcileMany(fresh.map((r) => r.email), true))]
  }
  return reconcileMany(emails)
}

/** Specific readers (an Admin recipient change), if they have rooms. */
export async function reconcileReaders(emails: readonly string[]): Promise<RoomResult[]> {
  if (!(await readerRoomsSchemaReady()) || emails.length === 0) return []
  const rows = (await getSql()`select email from review_reader_rooms where email = any(${[...new Set(emails.map((e) => e.trim().toLowerCase()))]})`) as { email: string }[]
  return reconcileMany(rows.map((r) => r.email))
}

/** Every existing room (Admin "Check all", the daily job). */
export async function reconcileAllReaderRooms(): Promise<RoomResult[]> {
  if (!(await readerRoomsSchemaReady())) return []
  const rows = (await getSql()`select email from review_reader_rooms order by updated_at asc`) as { email: string }[]
  return reconcileMany(rows.map((r) => r.email))
}

async function reconcileMany(emails: string[], create = false): Promise<RoomResult[]> {
  if (emails.length === 0) return []
  const roomId = await reviewRoomId()
  let docs: RoomDocument[] | undefined
  try {
    docs = roomId ? await roomDocuments(roomId) : undefined
  } catch (error) {
    const retryAt = papermarkRetryAt(error)
    if (retryAt) {
      for (const email of emails) await deferReviewRoom(email, retryAt, "Papermark room listing delayed. Retry scheduled.")
      return emails.map((email) => ({ email, state: "updating" as const, message: "Papermark is busy. Retry scheduled.", visible: 0, hidden: 0, retryAt }))
    }
    throw error
  }
  const out: RoomResult[] = []
  for (const email of emails) {
    // One reader's failure never stops the others being brought into line.
    try {
      out.push(await reconcileReaderRoom(email, { create, docs }))
    } catch (error) {
      out.push({ email, state: "failed", message: error instanceof Error ? error.message.slice(0, 200) : "Unexpected failure.", visible: 0, hidden: 0 })
    }
  }
  return out
}

/** Admin's "Prepare": creates (or repairs) rooms for the given readers. */
export async function prepareReaderRooms(emails: readonly string[]): Promise<RoomResult[]> {
  return reconcileMany([...new Set(emails.map((e) => e.trim().toLowerCase()))], true)
}

/** The reader's personal room link, only while it is confirmed ready. Never shown on a public page. */
export async function readyRoomLink(email: string): Promise<{ url: string; verifiedAt: string | null } | null> {
  if (!(await readerRoomsSchemaReady())) return null
  const [row] = (await getSql()`select link_url, verified_at from review_reader_rooms where email = ${email.trim().toLowerCase()} and state = 'ready' and link_url is not null`) as { link_url: string; verified_at: string | null }[]
  return row ? { url: row.link_url, verifiedAt: row.verified_at } : null
}

export type RoomStatus = { email: string; state: RoomState; visible: number; verifiedAt: string | null; lastError: string | null; jobState?: string; nextRetryAt?: string | null }

/** For Admin: every room and what was last confirmed. No link URL. */
export async function listReaderRooms(): Promise<RoomStatus[]> {
  if (!(await readerRoomsSchemaReady())) return []
  const rows = (await getSql()`select email, state, verified_visible, verified_at, last_error from review_reader_rooms order by email`) as {
    email: string; state: RoomState; verified_visible: string | null; verified_at: string | Date | null; last_error: string | null
  }[]
  const jobs = new Map((await listRoomJobs()).map((j) => [j.email, j]))
  return rows.map((r) => ({
    email: r.email,
    state: r.state,
    jobState: jobs.get(r.email)?.state,
    nextRetryAt: jobs.get(r.email) && ["pending", "running"].includes(jobs.get(r.email)!.state) ? new Date(jobs.get(r.email)!.next_attempt_at).toISOString() : null,
    visible: (r.verified_visible ?? "").split(",").filter(Boolean).length,
    verifiedAt: r.verified_at ? new Date(r.verified_at).toISOString() : null,
    lastError: r.last_error,
  }))
}

/**
 * Called by every Admin action that can change what a reader may see
 * (recipients, publishing, withdrawal, re-offer, the shared list). Runs after
 * the response, so Admin never waits on Papermark; only readers who already
 * have a room are touched.
 */
export async function scheduleRoomReconcile(target: { editionId: string } | { prospectId: string } | "all"): Promise<void> {
  if (!(await readerRoomsSchemaReady())) return
  const { reviewEntryMode } = await import("./review-reader")
  const create = (await reviewEntryMode()) === "library" && (await openWindowReady())
  const sql = getSql()
  let emails: string[] = []
  if (target === "all") {
    const existing = await sql`select email from review_reader_rooms`
    const assigned = create ? await sql`select distinct r.email from review_edition_recipients r join review_publication_editions e on e.id = r.edition_id where r.revoked_at is null and e.publication_state = 'published'` : []
    emails = [...existing, ...assigned].map((r) => r.email)
  } else if ("editionId" in target) {
    const [edition] = await sql`select recipient_mode from review_publication_editions where id = ${target.editionId}::uuid`
    if (edition?.recipient_mode === "shared_legacy") return scheduleRoomReconcile("all")
    emails = (await sql`select distinct x.email from review_edition_recipients x where x.edition_id = ${target.editionId}::uuid and
      (${create} or exists (select 1 from review_reader_rooms r where r.email = x.email))`).map((r) => r.email)
  } else {
    emails = (await sql`select lower(btrim(email)) as email from review_prospects where id = ${target.prospectId}::uuid`).map((r) => r.email)
  }
  if (await papermarkWorkSchemaReady()) {
    await queueReviewRooms(emails, { create, changed: true, priority: 0 })
    kickReviewRoomWorker()
  } else {
    try { after(async () => { if (create) await prepareReaderRooms(emails); else await reconcileReaders(emails) }) } catch {}
  }
}

export type RoomEntry =
  | { kind: "ready"; url: string; verifiedAt: string | null }
  | { kind: "not_approved" }
  | { kind: "preparing" }
  | { kind: "unavailable"; reason: string }

/**
 * Decides, at the moment a reader opens access, where they may go. Approval
 * is re-read (the same rule as the library: published, exact verified link,
 * this edition's own recipients). A room is handed out only while it is
 * confirmed ready AND shows exactly the editions assigned now; otherwise it
 * is reconciled with Papermark first. A reader who is no longer approved, or
 * whose room cannot be confirmed, is not sent to it.
 */
export async function roomEntryFor(rawEmail: string, options: { allowCreate: boolean }): Promise<RoomEntry> {
  const email = rawEmail.trim().toLowerCase()
  const editions = await getReviewLibraryForEmail(email)
  if (editions.length === 0) return { kind: "not_approved" }
  if (!(await readerRoomsSchemaReady())) return { kind: "unavailable", reason: "rooms_not_installed" }
  if (!(await routingColumnsReady())) return { kind: "unavailable", reason: "rooms_not_installed" }
  const current = async () => {
    const columns = await routingColumnsReady()
    const [row] = (columns
      ? await getSql()`select state, link_url, verified_at, verified_editions, lease_until from review_reader_rooms where email = ${email}`
      : await getSql()`select state, link_url, verified_at, null::text as verified_editions, null::timestamptz as lease_until from review_reader_rooms where email = ${email}`) as {
      state: RoomState; link_url: string | null; verified_at: string | Date | null; verified_editions: string | null; lease_until: string | Date | null
    }[]
    return { row, columns }
  }
  const expected = roomPolicyKey(editions.map((e) => e.id))
  // Ready only with proof: the room's last read-back must equal the editions
  // assigned now. Without the verification columns there is no such proof, so
  // no room is ever "ready" -- a stale room cannot be reached that way.
  const usable = (row: Awaited<ReturnType<typeof current>>["row"], columns: boolean) =>
    Boolean(columns && row && row.state === "ready" && row.link_url && row.verified_editions === expected)

  let { row, columns } = await current()
  if (usable(row, columns)) {
    return { kind: "ready", url: row!.link_url!, verifiedAt: row!.verified_at ? new Date(row!.verified_at).toISOString() : null }
  }
  if (row?.lease_until && new Date(row.lease_until) > new Date()) return { kind: "preparing" }
  if (!row && !options.allowCreate) return { kind: "unavailable", reason: "no_room" }
  const pending = await readerRoomJob(email)
  if (pending?.state === "attention") return { kind: "unavailable", reason: "needs_repair" }
  if (pending && ["pending", "running"].includes(pending.state)) { kickReviewRoomWorker(email); return { kind: "preparing" } }
  if (await papermarkWorkSchemaReady()) {
    await queueReviewRooms([email], { create: options.allowCreate })
    kickReviewRoomWorker(email)
    return { kind: "preparing" }
  }

  const result = await reconcileReaderRoom(email, { create: options.allowCreate })
  ;({ row, columns } = await current())
  if (usable(row, columns)) {
    return { kind: "ready", url: row!.link_url!, verifiedAt: row!.verified_at ? new Date(row!.verified_at).toISOString() : null }
  }
  if (result.state === "updating") return { kind: "preparing" }
  return { kind: "unavailable", reason: result.state === "none" ? "no_room" : "needs_repair" }
}

// ---------------------------------------------------------------------------
// The APRI-verified library: one APRI code, then each edition opens directly
// ---------------------------------------------------------------------------

export type ReaderDocument =
  /** Go here: this one edition, inside the reader's own code-free link. */
  | { kind: "open"; url: string }
  /** Not (or no longer) assigned to this reader, or not published. */
  | { kind: "not_assigned" }
  /** Another update for this reader is running; it finishes within minutes. */
  | { kind: "preparing" }
  /** Papermark could not confirm the reader's access; Admin shows Repair. */
  | { kind: "unavailable"; reason: string }
  /** 20261011 is not applied: use the edition's own Papermark link. */
  | { kind: "legacy" }

/**
 * Where one approved, APRI-verified reader goes to read one edition, decided
 * at the moment they press Read:
 *
 *  1. approval is re-read (published, exact verified link, this edition's own
 *     recipients) -- a removed reader or a withdrawn edition stops here;
 *  2. their room is brought into line with Papermark if what it last
 *     confirmed differs from what is assigned now;
 *  3. their link is opened until the end of their latest APRI session (one
 *     Papermark call, at most once per session; read back);
 *  4. the address of that one PDF in their room, which Papermark opens
 *     without asking again while its own room session (23 hours) lasts.
 *
 * `sessionUntil` is when the APRI session in this browser ends.
 */
export async function readerDocumentFor(rawEmail: string, editionId: string, sessionUntil: string): Promise<ReaderDocument> {
  const email = rawEmail.trim().toLowerCase()
  if (!(await readerRoomsSchemaReady()) || !(await routingColumnsReady()) || !(await openWindowReady())) return { kind: "legacy" }
  const assigned = await getReviewLibraryForEmail(email)
  if (!assigned.some((e) => e.id === editionId)) return { kind: "not_assigned" }

  const entry = await roomEntryFor(email, { allowCreate: true })
  if (entry.kind === "not_approved") return { kind: "not_assigned" }
  if (entry.kind === "preparing") return { kind: "preparing" }
  if (entry.kind === "unavailable") return { kind: "unavailable", reason: entry.reason }

  let row = await windowRow(email)
  if (!row?.room_documents?.[editionId]) {
    // A room confirmed before 20261011 has no document map yet: one
    // reconcile records it.
    const result = await reconcileReaderRoom(email)
    if (result.state === "updating") return { kind: "preparing" }
    row = await windowRow(email)
    if (!row || row.state !== "ready") return { kind: "unavailable", reason: "needs_repair" }
    if (!row.room_documents?.[editionId]) return { kind: "unavailable", reason: "not_in_room" }
  }

  const { readerAccessUntil } = await import("./review-reader")
  const latest = await readerAccessUntil(email)
  const until = latest && latest > sessionUntil ? latest : sessionUntil
  const openUntil = row.link_open_until ? new Date(row.link_open_until).toISOString() : null
  if (!openUntil || new Date(openUntil).getTime() < new Date(until).getTime() - 60_000) {
    const opened = await openRoomWindow(email, until)
    if (opened !== "open") return opened === "busy" ? { kind: "preparing" } : { kind: "unavailable", reason: "needs_repair" }
    row = await windowRow(email)
  }
  const url = row?.link_url ? roomDocumentUrl(row.link_url, row.room_documents![editionId]!) : null
  return url ? { kind: "open", url } : { kind: "unavailable", reason: "needs_repair" }
}

async function windowRow(email: string) {
  const [row] = (await getSql()`
    select state, link_url, papermark_link_id, papermark_group_id, papermark_dataroom_id, link_open_until, room_documents
    from review_reader_rooms where email = ${email}
  `) as {
    state: RoomState; link_url: string | null; papermark_link_id: string | null; papermark_group_id: string | null
    papermark_dataroom_id: string; link_open_until: string | Date | null; room_documents: Record<string, string> | null
  }[]
  return row
}

/**
 * Opens (or extends) a ready reader's code-free link until `until`, the end of
 * their latest APRI session, and confirms it from Papermark's read-back. Every
 * other restriction on the link is checked first; anything wrong closes it.
 */
async function openRoomWindow(email: string, until: string): Promise<"open" | "busy" | "failed"> {
  const token = await takeLease(email)
  if (!token) return "busy"
  try {
    return await roomLease.run({ email, token }, async () => {
    const row = await windowRow(email)
    if (!row || row.state !== "ready" || !row.papermark_link_id || !row.papermark_group_id) return "failed"
    const expected = { roomId: row.papermark_dataroom_id, groupId: row.papermark_group_id, email, codeFree: true }
    const full = (await getSql()`select * from review_reader_rooms where email = ${email}`) as RoomRow[]
    try {
      const before = await paced<ReadLink>(`/v1/links/${enc(row.papermark_link_id!)}`)
      const problem = roomLinkProblem(before, expected, new Date(), { allowClosed: true, ignoreGate: true })
      if (problem) {
        await closeLink(full[0]!, problem)
        return "failed"
      }
      await paced(`/v1/links/${enc(row.papermark_link_id!)}`, {
        method: "PATCH",
        body: { email_protected: true, email_authenticated: false, expires_at: until },
      })
      const back = await paced<ReadLink>(`/v1/links/${enc(row.papermark_link_id!)}`)
      const after = roomLinkProblem(back, expected) ?? (closesAt(back, until) ? null : "Papermark did not confirm when the reader's link closes.")
      if (after) {
        await closeLink(full[0]!, after)
        return "failed"
      }
      await saveWindow(email, until)
      if (back.url && back.url !== row.link_url) await save(email, { link_url: back.url })
      await event(email, "link_opened", `until ${until}`)
      return "open"
    } catch (error) {
      const retryAt = error instanceof RoomWorkDeferred ? error.retryAt : papermarkRetryAt(error)
      if (error instanceof RoomWorkDeferred) { await deferReviewRoom(email, error.retryAt, error.message); return "busy" }
      const message = error instanceof Error ? error.message : "Papermark could not be reached."
      await save(email, { last_error: message })
      if (retryAt) { await deferReviewRoom(email, retryAt, message); kickReviewRoomWorker(email); return "busy" }
      return "failed"
    }
    })
  } finally {
    await dropLease(email, token)
  }
}

/**
 * After a sign-out: the reader's link closes when their last APRI session has
 * ended, or is shortened to their remaining latest session. Confirmed from
 * Papermark's read-back; if the close cannot be confirmed the link is closed
 * the hard way (or the room is marked for repair).
 */
export async function narrowRoomWindow(rawEmail: string): Promise<void> {
  const email = rawEmail.trim().toLowerCase()
  if (!(await readerRoomsSchemaReady()) || !(await openWindowReady())) return
  const row = await windowRow(email)
  if (!row?.papermark_link_id || !row.link_open_until) return
  const { readerAccessUntil } = await import("./review-reader")
  const until = await readerAccessUntil(email)
  const current = new Date(row.link_open_until).getTime()
  if (current <= Date.now()) return
  if (until && current <= new Date(until).getTime() + 60_000) return
  const token = await takeLease(email)
  if (!token) { await queueReviewRooms([email], { changed: true, priority: 0 }); return }
  try {
    return await roomLease.run({ email, token }, async () => {
    try {
      const target = until ?? closedAt()
      await paced(`/v1/links/${enc(row.papermark_link_id!)}`, { method: "PATCH", body: { expires_at: target } })
      const back = await paced<ReadLink>(`/v1/links/${enc(row.papermark_link_id!)}`)
      const ok = until ? closesAt(back, until) : Boolean(back.expires_at && new Date(back.expires_at) <= new Date())
      if (ok) {
        await saveWindow(email, until)
        await event(email, until ? "link_shortened" : "link_closed_idle")
        return
      }
    } catch {}
    const [full] = (await getSql()`select * from review_reader_rooms where email = ${email}`) as RoomRow[]
    if (full) await closeLink(full, "The reader signed out and Papermark did not confirm their link closed.")
    })
  } finally {
    await dropLease(email, token)
  }
}

/** Runs narrowRoomWindow after the response, so signing out never waits on Papermark. */
export async function scheduleRoomWindowNarrowing(email: string): Promise<void> {
  if (await papermarkWorkSchemaReady()) { await queueReviewRooms([email], { changed: true, priority: 0 }); kickReviewRoomWorker(); return }
  try { after(async () => { await narrowRoomWindow(email).catch(() => {}) }) } catch {}
}
