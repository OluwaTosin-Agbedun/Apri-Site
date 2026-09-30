import "server-only"
import { randomUUID } from "node:crypto"
import { getSql } from "./db"
import {
  loadSubscriberAccess,
  accessCounts,
  type DocumentAccess,
  type SubscriberAccess,
} from "./access-policy-dal"
import { accessHealthSchemaReady, ACCESS_HEALTH_MIGRATION_PENDING } from "./access-health-schema"
import { describeDecision } from "./access-policy"
import { preparePersonalLinks, type DocumentResult, type RoomDocument, type StoredLink } from "./personal-links"
import {
  createDocumentLink,
  readSubscriberDocumentLink,
  revokeDataRoomLink,
  updateDataRoomLink,
} from "./papermark-datarooms"
import { subscriberWatermarkText, type DocumentLinkSettings } from "./papermark-dataroom-contract"
import { papermarkExpiresAt } from "./papermark-contract"
import { assignDataRoomToSubscriber, markDocumentLinkRevoked, setPersonalLinkExpiry } from "./dataroom-dal"

/**
 * One subscriber's document access, made to match the access policy.
 *
 * The only path that issues, repairs or revokes a subscriber's personal
 * document links: activation, renewal, level changes, Admin repair, the batch
 * script, Data Room sync and the Papermark webhook all come here. It never
 * sends email.
 *
 *  1. The decision comes from the access policy (src/lib/access-policy.ts)
 *     for every document in the subscriber's assigned room.
 *  2. Links to documents the policy confirms are excluded -- ended or
 *     suspended subscription, a Block, a withheld edition, out of level or
 *     paid period, or no longer in their room -- are withdrawn in Papermark,
 *     confirmed gone, then marked revoked.
 *  3. Every allowed document gets a personal link. Stored links are read back
 *     from Papermark and judged on document, expiry, identity and security
 *     settings; new ones are read back before they count.
 *  4. Undecided documents are left exactly as they are: nothing is issued and
 *     nothing already issued is taken away for missing information.
 *  5. An unrestricted room share link is retired only once every allowed
 *     document is verified and nothing is undecided.
 *
 * One run at a time per subscriber: a lease on the reconciliation row. Every
 * change to an input -- periods, exceptions, level, term, release, sync --
 * bumps the row's generation, and a link is recorded only while the
 * generation and lease this run started with still hold, checked in the same
 * statement as the insert. A run overtaken mid-flight withdraws what it minted
 * and starts again from the new decision.
 */

export type ReconcileTrigger =
  | "activation"
  | "admin_repair"
  | "admin_change"
  | "release"
  | "sync"
  | "webhook"
  | "portal"
  | "batch"
  | "level_change"
  | "renewal"
  | "resend"

export type ReconcileOutcome =
  | "ready"
  | "ready_with_unresolved"
  | "no_eligible"
  | "partial"
  | "failed"
  | "not_applicable"
  | "superseded"

export type ReconcileCounts = {
  documents: number
  expected: number
  verified: number
  created: number
  repaired: number
  notReady: number
  excluded: number
  revoked: number
  unresolved: number
  preserved: number
  roomLinksRetired: number
}

export type ReconcileProblem = { title: string; reason: string }

export type ReconcileResult = {
  state: "complete" | "failed" | "busy" | "unavailable" | "not_applicable" | "superseded"
  outcome: ReconcileOutcome | null
  message: string
  counts: ReconcileCounts
  problems: ReconcileProblem[]
}

const EMPTY: ReconcileCounts = {
  documents: 0,
  expected: 0,
  verified: 0,
  created: 0,
  repaired: 0,
  notReady: 0,
  excluded: 0,
  revoked: 0,
  unresolved: 0,
  preserved: 0,
  roomLinksRetired: 0,
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LEASE = "5 minutes"
/** Minutes before an automatic retry, by consecutive failed attempts. */
const BACKOFF_MINUTES = [5, 15, 60, 180, 720]

function result(
  state: ReconcileResult["state"],
  message: string,
  extra: Partial<Omit<ReconcileResult, "state" | "message">> = {},
): ReconcileResult {
  return { state, message, outcome: extra.outcome ?? null, counts: extra.counts ?? { ...EMPTY }, problems: extra.problems ?? [] }
}

// ---------------------------------------------------------------------------
// The reconciliation row
// ---------------------------------------------------------------------------

/** Creates the subscriber's reconciliation row if it does not exist yet. Idempotent. */
export async function ensureReconciliationRow(subscriberId: string): Promise<void> {
  if (!UUID.test(subscriberId)) return
  const sql = getSql()
  await sql`
    insert into subscriber_access_reconciliations (subscriber_id, generation, state, requested_at)
    values (${subscriberId}::uuid, 1, 'pending', now())
    on conflict (subscriber_id) do nothing
  `
}

/**
 * Records that one of the subscriber's access inputs changed. Creates the row
 * if needed and moves the generation on, so a run still working from the
 * previous inputs cannot record its links.
 */
export async function queueSubscriberAccessReconciliation(subscriberId: string, trigger: ReconcileTrigger = "admin_change"): Promise<number> {
  if (!UUID.test(subscriberId)) return 0
  const sql = getSql()
  const rows = (await sql`
    insert into subscriber_access_reconciliations (subscriber_id, generation, state, requested_at)
    values (${subscriberId}::uuid, 1, 'pending', now())
    on conflict (subscriber_id) do update
      set generation = subscriber_access_reconciliations.generation + 1,
          state = 'pending', requested_at = now(), completed_at = null
    returning generation
  `) as { generation: number }[]
  if (await accessHealthSchemaReady(sql)) {
    await sql`
      update subscriber_access_reconciliations set trigger = ${trigger}, next_attempt_at = now(), updated_at = now()
      where subscriber_id = ${subscriberId}::uuid
    `
  }
  return Number(rows[0]?.generation ?? 0)
}

/** Subscribers whose library is this Data Room: by override, by level, or by the room stored on their record. */
export async function subscribersAssignedToRoom(dataroomId: string): Promise<string[]> {
  const sql = getSql()
  const rows = (await sql`
    select s.id
    from subscribers s
    left join papermark_level_rooms lr on lr.public_tier = s.public_tier
    where s.client_type = 'subscriber'
      and coalesce(s.papermark_dataroom_override, lr.papermark_dataroom_id, s.papermark_dataroom_id) = ${dataroomId}
    order by s.id
  `) as { id: string }[]
  return rows.map((r) => r.id)
}

// ---------------------------------------------------------------------------
// Preview: what a run would do, changing nothing
// ---------------------------------------------------------------------------

export type PlanAction = "create" | "verify" | "revoke" | "keep" | "none"

export type PlanItem = {
  rowId: string | null
  title: string
  series: string | null
  editionDate: string | null
  outcome: "allowed" | "excluded" | "unresolved"
  reason: string
  hasLink: boolean
  action: PlanAction
}

export type AccessPlan =
  | {
      state: "ok"
      subscriberId: string
      subscriberName: string
      subscription: string
      dataroomId: string | null
      counts: ReturnType<typeof accessCounts> & { orphanLinks: number; roomLinks: number }
      items: PlanItem[]
      /** Live links to documents no longer in the subscriber's room: withdrawn on apply. */
      orphans: number
      retireRoomLinks: boolean
    }
  | { state: "not_found" }
  | { state: "unavailable"; message: string }

function displayTitle(d: DocumentAccess): string {
  return (d.titleOverride && d.editorialTitle) || d.fileTitle || d.editorialTitle || "Untitled document"
}

function planItem(d: DocumentAccess): PlanItem {
  const action: PlanAction =
    d.decision.outcome === "allowed" ? (d.link ? "verify" : "create") : d.decision.outcome === "excluded" ? (d.link ? "revoke" : "none") : d.link ? "keep" : "none"
  return {
    rowId: d.rowId,
    title: displayTitle(d),
    series: d.series,
    editionDate: d.editionDate,
    outcome: d.decision.outcome,
    reason: describeDecision(d.decision),
    hasLink: d.link !== null,
    action,
  }
}

type LiveLink = { id: string; papermark_document_id: string; papermark_link_id: string }

async function liveLinks(subscriberId: string): Promise<{ documents: LiveLink[]; rooms: { id: string; papermark_link_id: string }[] }> {
  const sql = getSql()
  const documents = (await sql`
    select id, papermark_document_id, papermark_link_id
    from papermark_subscriber_document_links
    where subscriber_id = ${subscriberId}::uuid and revoke_state = 'live'
  `) as LiveLink[]
  const rooms = (await sql`
    select id, papermark_link_id from papermark_dataroom_links
    where subscriber_id = ${subscriberId}::uuid and revoke_state = 'live'
  `) as { id: string; papermark_link_id: string }[]
  return { documents, rooms }
}

/** Links whose document is no longer in the subscriber's room. Never computed from an empty room. */
function orphanLinks(access: Extract<SubscriberAccess, { state: "ok" }>, live: LiveLink[]): LiveLink[] {
  if (access.documents.length === 0) return []
  const inRoom = new Set(access.documents.map((d) => d.papermarkDocumentId))
  return live.filter((l) => !inRoom.has(l.papermark_document_id))
}

export async function planSubscriberAccess(subscriberId: string, options: { prospective?: boolean } = {}): Promise<AccessPlan> {
  const access = await loadSubscriberAccess(subscriberId, { prospective: options.prospective })
  if (access.state !== "ok") return access
  let live: Awaited<ReturnType<typeof liveLinks>>
  try {
    live = await liveLinks(subscriberId)
  } catch {
    return { state: "unavailable", message: "Live links could not be read just now." }
  }
  const counts = accessCounts(access.documents)
  const orphans = access.room ? orphanLinks(access, live.documents).length : 0
  return {
    state: "ok",
    subscriberId,
    subscriberName: access.subscriber.fullName || access.subscriber.email,
    subscription: access.subscriber.subscription.state,
    dataroomId: access.room?.dataroomId ?? null,
    counts: { ...counts, orphanLinks: orphans, roomLinks: live.rooms.length },
    items: access.documents.map(planItem),
    orphans,
    retireRoomLinks: live.rooms.length > 0 && counts.unresolved === 0,
  }
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export type ReconcileOptions = {
  trigger?: ReconcileTrigger
  /** Activation only: prepare a pending seat as it will be once active. */
  prospective?: boolean
  /** @deprecated Use `prospective`. */
  allowPending?: boolean
}

export async function reconcileSubscriberAccess(subscriberId: string, options: ReconcileOptions = {}): Promise<ReconcileResult> {
  if (!UUID.test(subscriberId)) return result("not_applicable", "Unknown subscriber.")
  let sql: ReturnType<typeof getSql>
  try {
    sql = getSql()
  } catch {
    return result("unavailable", "Subscriber storage is not configured.")
  }
  if (!(await accessHealthSchemaReady(sql))) return result("unavailable", ACCESS_HEALTH_MIGRATION_PENDING)

  // A run overtaken by a change starts again from the new decision, twice at most.
  for (let attempt = 0; attempt < 3; attempt++) {
    const run = await runOnce(sql, subscriberId, {
      trigger: options.trigger ?? "admin_repair",
      prospective: options.prospective === true || options.allowPending === true,
    })
    if (run.state !== "superseded") return run
  }
  return result("superseded", "Access changed repeatedly while it was being prepared. Run the repair again.")
}

async function runOnce(
  sql: ReturnType<typeof getSql>,
  subscriberId: string,
  options: { trigger: ReconcileTrigger; prospective: boolean },
): Promise<ReconcileResult> {
  try {
    await ensureReconciliationRow(subscriberId)
  } catch {
    return result("unavailable", "The reconciliation record could not be prepared. Try again shortly.")
  }

  const token = randomUUID()
  const leased = (await sql`
    update subscriber_access_reconciliations
    set lease_token = ${token}::uuid, lease_expires_at = now() + ${LEASE}::interval,
        trigger = ${options.trigger}, updated_at = now()
    where subscriber_id = ${subscriberId}::uuid
      and (lease_token is null or lease_expires_at is null or lease_expires_at < now())
    returning generation, attempts
  `) as { generation: number; attempts: number }[]
  if (!leased[0]) {
    return result("busy", "Access for this subscriber is already being prepared. Try again in a moment.")
  }
  const generation = Number(leased[0].generation)
  const attempts = Number(leased[0].attempts ?? 0)

  const current = async (): Promise<boolean> => {
    const rows = (await sql`
      select 1 from subscriber_access_reconciliations
      where subscriber_id = ${subscriberId}::uuid and generation = ${generation}
        and lease_token = ${token}::uuid and lease_expires_at > now()
    `) as unknown[]
    return rows.length > 0
  }
  const release = async () => {
    await sql`
      update subscriber_access_reconciliations set lease_token = null, lease_expires_at = null
      where subscriber_id = ${subscriberId}::uuid and lease_token = ${token}::uuid
    `
  }

  try {
    const access = await loadSubscriberAccess(subscriberId, { prospective: options.prospective })
    if (access.state === "not_found") {
      return result("not_applicable", "That subscriber no longer exists.")
    }
    if (access.state === "unavailable") {
      // The decision could not be made: nothing is issued, and nothing is revoked.
      return await record(sql, { subscriberId, generation, token, attempts }, result("failed", `${access.message} No access was changed.`, { outcome: "failed" }))
    }
    if (!access.room) {
      return await record(
        sql,
        { subscriberId, generation, token, attempts },
        result("not_applicable", "No Data Room is assigned to this subscriber, so there are no personal document links to prepare.", { outcome: "not_applicable" }),
      )
    }

    // The room the library is served from is the one on the record.
    if (access.room.source !== "assigned" && (access.room.storedDataroomId !== null || !(await storedRoom(sql, subscriberId)))) {
      await assignDataRoomToSubscriber(subscriberId, access.room.dataroomId)
    }

    const counts = { ...EMPTY }
    const problems: ReconcileProblem[] = []
    const tally = accessCounts(access.documents)
    counts.documents = tally.documents
    counts.expected = tally.expected
    counts.excluded = tally.excluded
    counts.unresolved = tally.unresolved
    counts.preserved = tally.preserved

    const live = await liveLinks(subscriberId)

    // 1. Confirmed exclusions, and links to documents no longer in the room.
    const toRevoke: { rowId: string; linkId: string; title: string }[] = [
      ...access.documents
        .filter((d) => d.decision.outcome === "excluded" && d.link)
        .map((d) => ({ rowId: d.link!.rowId, linkId: d.link!.papermarkLinkId, title: displayTitle(d) })),
      ...orphanLinks(access, live.documents).map((l) => ({ rowId: l.id, linkId: l.papermark_link_id, title: "A document no longer in this subscriber's Data Room" })),
    ]
    for (const link of toRevoke) {
      if (!(await current())) return await superseded(release)
      const outcome = await withdrawConfirmed(link.linkId)
      if (outcome.ok) {
        await markDocumentLinkRevoked(link.rowId)
        counts.revoked++
      } else {
        problems.push({ title: link.title, reason: outcome.message })
      }
    }

    // 2. Every allowed document: a verified personal link.
    const allowed = access.documents.filter((d) => d.decision.outcome === "allowed")
    const report = allowed.length === 0 ? null : await prepareAllowed(sql, access, allowed, { subscriberId, generation, token })
    if (report) {
      counts.created = report.created
      counts.repaired = report.repaired
      counts.verified = report.confirmed + report.created + report.repaired
      counts.notReady = report.failed + report.unconfirmed
      for (const r of report.results) {
        if (r.status === "failed" || r.status === "unconfirmed") problems.push({ title: r.document.title, reason: r.reason })
      }
      if (report.fenced) return await superseded(release)
    }

    // 3. The broad room URL goes only when the exact links fully replace it.
    if (counts.notReady === 0 && problems.length === 0 && counts.unresolved === 0) {
      for (const room of live.rooms) {
        if (!(await current())) return await superseded(release)
        const outcome = await withdrawConfirmed(room.papermark_link_id)
        if (!outcome.ok) {
          problems.push({ title: "Unrestricted Data Room link", reason: outcome.message })
          continue
        }
        await sql`update papermark_dataroom_links set revoke_state = 'revoked', revoked_at = now(), updated_at = now() where id = ${room.id}::uuid`
        counts.roomLinksRetired++
      }
    }

    const ready = counts.notReady === 0 && problems.length === 0
    const outcome: ReconcileOutcome = !ready
      ? "partial"
      : counts.expected === 0 && counts.unresolved === 0
        ? "no_eligible"
        : counts.unresolved > 0
          ? "ready_with_unresolved"
          : "ready"
    return await record(
      sql,
      { subscriberId, generation, token, attempts },
      result(ready ? "complete" : "failed", describeOutcome(outcome, counts, problems), { outcome, counts, problems }),
      access.documents,
    )
  } catch {
    try {
      await release()
    } catch {}
    return result("failed", "Access could not be prepared just now. Nothing was sent; try again shortly.", { outcome: "failed" })
  }
}

async function storedRoom(sql: ReturnType<typeof getSql>, subscriberId: string): Promise<string | null> {
  const rows = (await sql`select papermark_dataroom_id from subscribers where id = ${subscriberId}::uuid`) as { papermark_dataroom_id: string | null }[]
  return rows[0]?.papermark_dataroom_id ?? null
}

async function superseded(release: () => Promise<void>): Promise<ReconcileResult> {
  await release()
  return result("superseded", "Access changed while it was being prepared.")
}

/** Withdraws a link in Papermark and confirms it no longer opens. */
async function withdrawConfirmed(linkId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const removed = await revokeDataRoomLink(linkId)
  if (!removed.ok) return { ok: false, message: `Papermark did not withdraw the link (${removed.message}). It stays recorded; retry.` }
  const check = await readSubscriberDocumentLink(linkId)
  if (check.state !== "gone") return { ok: false, message: "Papermark could not confirm the link was withdrawn. It stays recorded; retry." }
  return { ok: true }
}

type Fence = { subscriberId: string; generation: number; token: string }

async function prepareAllowed(
  sql: ReturnType<typeof getSql>,
  access: Extract<SubscriberAccess, { state: "ok" }>,
  allowed: DocumentAccess[],
  fence: Fence,
): Promise<Awaited<ReturnType<typeof preparePersonalLinks>> & { fenced: boolean }> {
  const sub = access.subscriber
  const termEnd = sub.subscription.termEnd
  const minted = new Map<string, DocumentLinkSettings>()
  let fenced = false

  const documents: RoomDocument[] = allowed.map((d) => ({ papermarkDocumentId: d.papermarkDocumentId, title: displayTitle(d) }))
  const stored: StoredLink[] = allowed
    .filter((d) => d.link)
    .map((d) => ({
      rowId: d.link!.rowId,
      papermarkDocumentId: d.papermarkDocumentId,
      papermarkLinkId: d.link!.papermarkLinkId,
      expiresAt: d.link!.expiresAt,
      // Judged against the subscriber as they are now: a watermark naming a
      // previous address is not this subscriber's link.
      issued: { allowDownload: d.link!.allowDownload, screenshotProtection: d.link!.screenshotProtection, email: sub.email },
    }))
  const linkByRow = new Map(allowed.filter((d) => d.link).map((d) => [d.link!.rowId, d.link!]))

  const report = await preparePersonalLinks(
    {
      documents,
      stored,
      create: async (document) => {
        const created = await createDocumentLink({
          documentId: document.papermarkDocumentId,
          assignedName: sub.fullName,
          assignedEmail: sub.email,
          expiresAt: termEnd,
          documentTitle: document.title,
        })
        if (!created.ok) return { ok: false as const, message: created.message }
        minted.set(created.value.linkId, created.value.settings)
        return { ok: true as const, linkId: created.value.linkId, url: created.value.url }
      },
      save: async (document, link) => {
        const settings = minted.get(link.linkId)
        if (!settings) throw new Error("No settings recorded for the minted link.")
        // Recorded only while this run's decision still stands: the same
        // statement checks the generation and the lease.
        const rows = (await sql`
          insert into papermark_subscriber_document_links (
            subscriber_id, papermark_document_id, papermark_link_id, link_url,
            assigned_name, assigned_email, watermark_text,
            allow_download, screenshot_protection, expires_at
          )
          select ${fence.subscriberId}::uuid, ${document.papermarkDocumentId}, ${link.linkId}, ${link.url},
                 ${sub.fullName}, ${sub.email}, ${subscriberWatermarkText(sub.email)},
                 ${settings.allow_download}, ${settings.enable_screenshot_protection},
                 ${settings.expires_at ?? null}::timestamptz
          where exists (
            select 1 from subscriber_access_reconciliations r
            where r.subscriber_id = ${fence.subscriberId}::uuid and r.generation = ${fence.generation}
              and r.lease_token = ${fence.token}::uuid and r.lease_expires_at > now()
          )
          on conflict (subscriber_id, papermark_document_id) where revoke_state = 'live' do nothing
          returning id
        `) as { id: string }[]
        if (!rows[0]) {
          const stillCurrent = (await sql`
            select 1 from subscriber_access_reconciliations r
            where r.subscriber_id = ${fence.subscriberId}::uuid and r.generation = ${fence.generation}
              and r.lease_token = ${fence.token}::uuid
          `) as unknown[]
          // Overtaken: the minted link is withdrawn by the caller and the run restarts.
          if (stillCurrent.length === 0) fenced = true
          return null
        }
        return rows[0].id
      },
      withdraw: async (linkId) => {
        const removed = await revokeDataRoomLink(linkId)
        return removed.ok ? { ok: true as const } : { ok: false as const, message: removed.message }
      },
      retire: (rowId) => markDocumentLinkRevoked(rowId),
      read: (linkId) => readSubscriberDocumentLink(linkId),
      correctExpiry: async (link) => {
        const row = linkByRow.get(link.rowId)
        // The same identity and download setting the link was issued with.
        const updated = await updateDataRoomLink({
          linkId: link.papermarkLinkId,
          assignedName: row?.assignedName || sub.fullName,
          assignedEmail: row?.assignedEmail || sub.email,
          expiresAt: termEnd,
          allowDownload: row?.allowDownload,
        })
        if (!updated.ok) return { ok: false as const, message: updated.message }
        const expiry = papermarkExpiresAt(termEnd)
        await setPersonalLinkExpiry(link.rowId, expiry.ok ? expiry.value : null)
        return { ok: true as const }
      },
    },
    { verify: true, termEndDate: termEnd, confirmCreated: true },
  )
  return { ...report, fenced }
}

type RecordTarget = { subscriberId: string; generation: number; token: string; attempts: number }

/** Stores what the run found -- counts and titles, never a link -- and releases the lease. */
async function record(
  sql: ReturnType<typeof getSql>,
  target: RecordTarget,
  run: ReconcileResult,
  documents: readonly DocumentAccess[] = [],
): Promise<ReconcileResult> {
  const ok = run.state === "complete" || run.state === "not_applicable"
  const attempts = ok ? 0 : target.attempts + 1
  const backoff = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)] ?? 5
  const summary = JSON.stringify({
    problems: run.problems.slice(0, 50),
    documents: documents.slice(0, 200).map((d) => ({
      title: displayTitle(d),
      series: d.series,
      editionDate: d.editionDate,
      outcome: d.decision.outcome,
      reason: d.decision.reason,
    })),
  })
  const rows = (await sql`
    update subscriber_access_reconciliations
    set state = ${run.state === "complete" ? "complete" : run.state === "not_applicable" ? "complete" : "failed"},
        outcome = ${run.outcome},
        detail = ${ok ? null : run.message},
        expected = ${run.counts.expected}, verified = ${run.counts.verified}, missing = ${run.counts.notReady},
        excluded = ${run.counts.excluded}, unresolved = ${run.counts.unresolved}, failed = ${run.problems.length},
        summary = ${summary}::jsonb,
        attempts = ${attempts},
        next_attempt_at = ${ok ? null : `${backoff} minutes`}::interval + now(),
        last_verified_at = case when ${run.outcome !== "failed"}::boolean then now() else last_verified_at end,
        completed_at = case when ${ok}::boolean then now() else null end,
        lease_token = null, lease_expires_at = null, updated_at = now()
    where subscriber_id = ${target.subscriberId}::uuid and generation = ${target.generation}
      and lease_token = ${target.token}::uuid
    returning subscriber_id
  `) as unknown[]
  if (rows.length === 0) {
    // The inputs changed while this run worked: its record is not the truth.
    await sql`
      update subscriber_access_reconciliations set lease_token = null, lease_expires_at = null
      where subscriber_id = ${target.subscriberId}::uuid and lease_token = ${target.token}::uuid
    `
    return result("superseded", "Access changed while it was being prepared.")
  }
  return run
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

function describeOutcome(outcome: ReconcileOutcome, c: ReconcileCounts, problems: ReconcileProblem[]): string {
  const done = [
    c.created ? `${c.created} created` : null,
    c.repaired ? `${c.repaired} repaired` : null,
    c.revoked ? `${c.revoked} withdrawn` : null,
    c.roomLinksRetired ? `${plural(c.roomLinksRetired, "unrestricted room link")} retired` : null,
  ].filter(Boolean)
  const tail = done.length ? ` (${done.join(", ")})` : ""
  const waiting = c.unresolved
    ? ` ${plural(c.unresolved, "document")} ${c.unresolved === 1 ? "awaits" : "await"} a release decision or publication details${c.preserved ? `; ${plural(c.preserved, "link")} issued earlier ${c.preserved === 1 ? "is" : "are"} kept open meanwhile` : ""}.`
    : ""
  switch (outcome) {
    case "ready":
      return `Verified: all ${plural(c.expected, "permitted document")} ${c.expected === 1 ? "has its" : "have their"} personal link${tail}.`
    case "ready_with_unresolved":
      return `Verified ${plural(c.expected, "permitted document")}${tail}.${waiting}`
    case "no_eligible":
      return c.documents === 0
        ? `The Data Room has no documents yet, so no personal links were needed${tail}.`
        : `None of the ${plural(c.documents, "document")} in the Data Room is currently permitted for this subscriber${tail}.`
    default: {
      const shown = problems.slice(0, 3).map((p) => `“${p.title}”: ${p.reason}`).join(" ")
      const more = problems.length > 3 ? ` And ${problems.length - 3} more.` : ""
      return `${c.verified} of ${plural(c.expected, "permitted document")} verified${tail}. Not ready: ${shown}${more}${waiting}`
    }
  }
}

// ---------------------------------------------------------------------------
// What the last run found, for Admin
// ---------------------------------------------------------------------------

export type ReconciliationHealth = {
  state: string
  outcome: string | null
  detail: string | null
  expected: number | null
  verified: number | null
  missing: number | null
  excluded: number | null
  unresolved: number | null
  failed: number | null
  problems: ReconcileProblem[]
  trigger: string | null
  attempts: number
  requestedAt: string | null
  completedAt: string | null
  lastVerifiedAt: string | null
  nextAttemptAt: string | null
  running: boolean
}

export async function loadReconciliationHealth(subscriberIds: readonly string[]): Promise<Map<string, ReconciliationHealth>> {
  const ids = subscriberIds.filter((id) => UUID.test(id))
  if (ids.length === 0) return new Map()
  const sql = getSql()
  const rows = (await sql`
    select subscriber_id, state, detail, requested_at, completed_at, to_jsonb(r) as extra
    from subscriber_access_reconciliations r
    where subscriber_id = any(${ids}::uuid[])
  `) as { subscriber_id: string; state: string; detail: string | null; requested_at: string | Date | null; completed_at: string | Date | null; extra: Record<string, unknown> }[]
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null)
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
  return new Map(
    rows.map((r) => {
      const x = r.extra ?? {}
      const summary = (x.summary ?? null) as { problems?: ReconcileProblem[] } | null
      const leaseExpires = x.lease_expires_at ? Date.parse(String(x.lease_expires_at)) : 0
      return [
        r.subscriber_id,
        {
          state: r.state,
          outcome: (x.outcome as string | null) ?? null,
          detail: r.detail,
          expected: num(x.expected),
          verified: num(x.verified),
          missing: num(x.missing),
          excluded: num(x.excluded),
          unresolved: num(x.unresolved),
          failed: num(x.failed),
          problems: Array.isArray(summary?.problems) ? summary!.problems!.slice(0, 20) : [],
          trigger: (x.trigger as string | null) ?? null,
          attempts: Number(x.attempts ?? 0),
          requestedAt: iso(r.requested_at),
          completedAt: iso(r.completed_at),
          lastVerifiedAt: iso(x.last_verified_at),
          nextAttemptAt: iso(x.next_attempt_at),
          running: Boolean(x.lease_token) && leaseExpires > Date.now(),
        } satisfies ReconciliationHealth,
      ]
    }),
  )
}

/**
 * For the portal: when a current subscriber has permitted documents still
 * being prepared, start a reconciliation in the background -- if none is
 * running and the last one is due for a retry. Never sends email; the
 * subscriber is told to try again shortly.
 */
export async function reconcileIfDue(subscriberId: string): Promise<void> {
  if (!UUID.test(subscriberId)) return
  const sql = getSql()
  if (!(await accessHealthSchemaReady(sql))) return
  const rows = (await sql`
    select 1 from subscriber_access_reconciliations
    where subscriber_id = ${subscriberId}::uuid
      and (lease_token is null or lease_expires_at < now())
      and (next_attempt_at is null or next_attempt_at <= now())
  `) as unknown[]
  const exists = (await sql`select 1 from subscriber_access_reconciliations where subscriber_id = ${subscriberId}::uuid`) as unknown[]
  if (exists.length > 0 && rows.length === 0) return
  await reconcileSubscriberAccess(subscriberId, { trigger: "portal" })
}
