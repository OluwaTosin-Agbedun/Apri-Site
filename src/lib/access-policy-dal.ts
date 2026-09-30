import "server-only"
import { getSql } from "./db"
import { decideAccess, effectiveRelease, type AccessDecision, type PaidRelease, type Period } from "./access-policy"
import { subscriptionStatus, lagosToday, type SubscriptionStatus } from "./subscription-term"
import { editionEntitlementSchemaReady } from "./edition-entitlement-schema"
import { accessHealthSchemaReady } from "./access-health-schema"

/**
 * Loads what the access policy (src/lib/access-policy.ts) decides from, for
 * one subscriber, and returns its decision for every document in their room.
 *
 * The room comes from the subscriber's assignment -- an override, else their
 * level's room, else the room stored on their record -- never from whether an
 * unrestricted room share link exists. Reconciliation retires those links, and
 * the portal must keep working when it has.
 *
 * Every read is scoped to the one subscriber id passed in, which callers take
 * from a verified session or an administrator's action.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** How a document reaches the subscriber, from the decision and any live link. */
export type Delivery =
  /** Allowed, with a live personal link. */
  | "open"
  /** Allowed, but its personal link is not ready yet. */
  | "preparing"
  /** Undecided, with a link issued earlier: kept open, never taken away for missing information. */
  | "preserved"
  /** Not shown: excluded, or undecided without a link. */
  | "hidden"

export type PersonalLinkRow = {
  rowId: string
  papermarkLinkId: string
  linkUrl: string
  allowDownload: boolean
  screenshotProtection: boolean
  expiresAt: string | null
  assignedName: string
  assignedEmail: string
}

export type DocumentAccess = {
  rowId: string
  papermarkDocumentId: string
  fileTitle: string
  folderPath: string | null
  category: string | null
  numPages: number | null
  contentType: string | null
  papermarkCreatedAt: string | null
  papermarkUpdatedAt: string | null
  firstSeenAt: string | null
  publicationId: string | null
  editorialTitle: string | null
  titleOverride: boolean
  kicker: string | null
  summary: string | null
  series: string | null
  editionDate: string | null
  visibility: string | null
  editorialStatus: string | null
  pageCount: number | null
  /** The explicit decision, or null when none has been made. */
  explicitRelease: PaidRelease
  release: PaidRelease
  exception: { decision: "allow" | "block"; reason: string; administrator: string | null; at: string | null } | null
  decision: AccessDecision
  link: PersonalLinkRow | null
  delivery: Delivery
}

export type AccessSubscriber = {
  id: string
  fullName: string
  email: string
  level: string | null
  publicTier: string
  clientType: string
  status: string
  subscription: SubscriptionStatus
}

export type RoomAssignment = {
  dataroomId: string
  source: "override" | "level" | "assigned"
  /** The room stored on the record, when it differs from the one resolved. */
  storedDataroomId: string | null
}

export type ExceptionRecord = { decision: "allow" | "block"; reason: string; administrator: string | null; at: string | null }

export type SubscriberAccess =
  | {
      state: "ok"
      subscriber: AccessSubscriber
      room: RoomAssignment | null
      documents: DocumentAccess[]
      periods: (Period & { id: string; source: string; createdAt: string | null; voidReason: string | null })[]
      /** Individual Allow/Block decisions, by publication id. */
      exceptions: Map<string, ExceptionRecord>
      /** Whether paid-period history and exceptions could be read at all. */
      entitlementSchema: boolean
      healthSchema: boolean
    }
  | { state: "not_found" }
  /** A read failed or a required table is missing: never an empty library. */
  | { state: "unavailable"; message: string }

export type AccessOptions = {
  /**
   * Evaluate a pending seat as it will be once activated -- active, starting
   * on its recorded start or today -- so its library can be prepared and
   * verified before the status changes. Activation only.
   */
  prospective?: boolean
}

type SubscriberRow = {
  id: string
  full_name: string | null
  name: string
  email: string
  level: string | null
  public_tier: string | null
  client_type: string | null
  status: string
  term_start: string | null
  term_end: string | null
  override_room: string | null
  stored_room: string | null
  level_room: string | null
}

export async function loadSubscriberAccess(subscriberId: string, options: AccessOptions = {}): Promise<SubscriberAccess> {
  if (!UUID.test(subscriberId)) return { state: "not_found" }
  let sql: ReturnType<typeof getSql>
  try {
    sql = getSql()
  } catch {
    return { state: "unavailable", message: "Subscriber storage is not configured." }
  }

  try {
    const rows = (await sql`
      select s.id, s.full_name, s.name, s.email, s.level, s.public_tier, s.client_type, s.status,
             to_char(s.term_start, 'YYYY-MM-DD') as term_start,
             to_char(s.term_end, 'YYYY-MM-DD') as term_end,
             s.papermark_dataroom_override as override_room,
             s.papermark_dataroom_id as stored_room,
             (select lr.papermark_dataroom_id from papermark_level_rooms lr where lr.public_tier = s.public_tier limit 1) as level_room
      from subscribers s
      -- Only a subscriber record is owed paid documents; other client records
      -- (briefing clients) never are, whatever their level says.
      where s.id = ${subscriberId}::uuid and s.client_type = 'subscriber'
      limit 1
    `) as SubscriberRow[]
    const row = rows[0]
    if (!row) return { state: "not_found" }

    const today = lagosToday()
    const status = options.prospective && row.status.toLowerCase() !== "active" ? "active" : row.status
    const termStart = options.prospective && !row.term_start ? today : row.term_start
    const subscription = subscriptionStatus({ status, termStart, termEnd: row.term_end }, today)
    const subscriber: AccessSubscriber = {
      id: row.id,
      fullName: row.full_name || row.name || "",
      email: row.email,
      level: row.level,
      publicTier: row.public_tier ?? "",
      clientType: row.client_type ?? "subscriber",
      status: row.status.toLowerCase(),
      subscription,
    }

    const roomId = row.override_room || row.level_room || row.stored_room
    const room: RoomAssignment | null = roomId
      ? {
          dataroomId: roomId,
          source: row.override_room ? "override" : row.level_room ? "level" : "assigned",
          storedDataroomId: row.stored_room && row.stored_room !== roomId ? row.stored_room : null,
        }
      : null

    const entitlementSchema = await editionEntitlementSchemaReady(sql)
    const healthSchema = entitlementSchema && (await accessHealthSchemaReady(sql))

    const periodRows = entitlementSchema
      ? ((await sql`
          select p.id, to_char(p.starts_on, 'YYYY-MM-DD') as starts_on, to_char(p.ends_on, 'YYYY-MM-DD') as ends_on,
                 p.level, p.source, p.created_at,
                 (to_jsonb(p) ->> 'voided_at') is not null as voided,
                 to_jsonb(p) ->> 'void_reason' as void_reason
          from subscriber_subscription_periods p
          where p.subscriber_id = ${subscriberId}::uuid
          order by p.starts_on, p.ends_on
        `) as { id: string; starts_on: string; ends_on: string; level: string; source: string; created_at: string | Date | null; voided: boolean; void_reason: string | null }[])
      : []
    const periods = periodRows.map((p) => ({
      id: p.id,
      startsOn: p.starts_on,
      endsOn: p.ends_on,
      level: p.level,
      voided: p.voided === true,
      source: p.source,
      createdAt: p.created_at ? new Date(p.created_at).toISOString() : null,
      voidReason: p.void_reason,
    }))

    const exceptionRows = entitlementSchema
      ? ((await sql`
          select x.publication_id, x.decision, x.reason, x.updated_at, a.name as administrator
          from subscriber_publication_exceptions x
          left join admins a on a.id = x.administrator_id
          where x.subscriber_id = ${subscriberId}::uuid
        `) as { publication_id: string; decision: "allow" | "block"; reason: string; updated_at: string | Date | null; administrator: string | null }[])
      : []
    const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null)
    const exceptions = new Map<string, ExceptionRecord>(
      exceptionRows.map((x) => [x.publication_id, { decision: x.decision, reason: x.reason, administrator: x.administrator, at: iso(x.updated_at) }]),
    )

    const linkRows = (await sql`
      select id, papermark_document_id, papermark_link_id, link_url, allow_download, screenshot_protection,
             expires_at, assigned_name, assigned_email
      from papermark_subscriber_document_links
      where subscriber_id = ${subscriberId}::uuid and revoke_state = 'live'
    `) as { id: string; papermark_document_id: string; papermark_link_id: string; link_url: string; allow_download: boolean; screenshot_protection: boolean; expires_at: string | Date | null; assigned_name: string; assigned_email: string }[]
    const links = new Map(linkRows.map((l) => [l.papermark_document_id, l]))

    const documentRows = room
      ? ((await sql`
          select dd.id, dd.papermark_document_id, dd.title, dd.folder_path, dd.category, dd.num_pages,
                 dd.content_type, dd.papermark_created_at, dd.papermark_updated_at, dd.first_seen_at,
                 d.id as publication_id, d.title as editorial_title, d.kicker, d.summary, d.series,
                 to_char(d.edition_date, 'YYYY-MM-DD') as edition_date, d.visibility, d.status as editorial_status,
                 d.page_count,
                 to_jsonb(d) ->> 'paid_release_state' as paid_release_state,
                 coalesce((to_jsonb(d) ->> 'portal_title_override')::boolean, false) as title_override
          from papermark_dataroom_documents dd
          left join documents d on d.id = dd.publication_id
          where dd.papermark_dataroom_id = ${room.dataroomId} and dd.is_present = true
          order by d.edition_date desc nulls last, dd.first_seen_at desc nulls last, dd.id
        `) as Record<string, unknown>[])
      : []

    const documents: DocumentAccess[] = documentRows.map((r) => {
      const publicationId = (r.publication_id as string | null) ?? null
      const explicitRelease = r.paid_release_state === "released" || r.paid_release_state === "withheld" ? (r.paid_release_state as PaidRelease) : null
      const editorialStatus = (r.editorial_status as string | null) ?? null
      const x = publicationId ? exceptions.get(publicationId) : undefined
      const decision = decideAccess({
        subscription,
        level: row.level,
        periods,
        periodsKnown: entitlementSchema,
        exception: x?.decision ?? null,
        publication: {
          publicationId,
          editionDate: (r.edition_date as string | null) ?? null,
          visibility: (r.visibility as string | null) ?? null,
          series: (r.series as string | null) ?? null,
          paidRelease: explicitRelease,
          editorialStatus,
        },
      })
      const l = links.get(r.papermark_document_id as string)
      const link: PersonalLinkRow | null = l
        ? {
            rowId: l.id,
            papermarkLinkId: l.papermark_link_id,
            linkUrl: l.link_url,
            allowDownload: l.allow_download === true,
            screenshotProtection: l.screenshot_protection !== false,
            expiresAt: iso(l.expires_at),
            assignedName: l.assigned_name,
            assignedEmail: l.assigned_email,
          }
        : null
      return {
        rowId: r.id as string,
        papermarkDocumentId: r.papermark_document_id as string,
        fileTitle: (r.title as string | null) ?? "",
        folderPath: (r.folder_path as string | null) ?? null,
        category: (r.category as string | null) ?? null,
        numPages: (r.num_pages as number | null) ?? null,
        contentType: (r.content_type as string | null) ?? null,
        papermarkCreatedAt: iso(r.papermark_created_at),
        papermarkUpdatedAt: iso(r.papermark_updated_at),
        firstSeenAt: iso(r.first_seen_at),
        publicationId,
        editorialTitle: (r.editorial_title as string | null) ?? null,
        titleOverride: r.title_override === true,
        kicker: (r.kicker as string | null) ?? null,
        summary: (r.summary as string | null) ?? null,
        series: (r.series as string | null) ?? null,
        editionDate: (r.edition_date as string | null) ?? null,
        visibility: (r.visibility as string | null) ?? null,
        editorialStatus,
        pageCount: (r.page_count as number | null) ?? null,
        explicitRelease,
        release: publicationId ? effectiveRelease({ paidRelease: explicitRelease, editorialStatus }) : null,
        exception: x ?? null,
        decision,
        link,
        delivery: deliveryFor(decision, link),
      }
    })

    return { state: "ok", subscriber, room, documents, periods, exceptions, entitlementSchema, healthSchema }
  } catch {
    return { state: "unavailable", message: "Access could not be checked just now." }
  }
}

export function deliveryFor(decision: AccessDecision, link: PersonalLinkRow | null): Delivery {
  if (decision.outcome === "allowed") return link ? "open" : "preparing"
  if (decision.outcome === "unresolved") return link ? "preserved" : "hidden"
  return "hidden"
}

/** Counts Admin shows for one subscriber, from one snapshot. */
export type AccessCounts = {
  documents: number
  expected: number
  /** Allowed documents with a live personal link row (verification is the reconciliation's record). */
  linked: number
  missing: number
  excluded: number
  /** Excluded documents that still have a live link: owed a revocation. */
  excludedWithLinks: number
  unresolved: number
  preserved: number
}

export function accessCounts(documents: readonly DocumentAccess[]): AccessCounts {
  const c: AccessCounts = { documents: documents.length, expected: 0, linked: 0, missing: 0, excluded: 0, excludedWithLinks: 0, unresolved: 0, preserved: 0 }
  for (const d of documents) {
    if (d.decision.outcome === "allowed") {
      c.expected++
      if (d.link) c.linked++
      else c.missing++
    } else if (d.decision.outcome === "excluded") {
      c.excluded++
      if (d.link) c.excludedWithLinks++
    } else {
      c.unresolved++
      if (d.link) c.preserved++
    }
  }
  return c
}

// ---------------------------------------------------------------------------
// The legacy library: stamped copies for a subscriber with no Data Room
// ---------------------------------------------------------------------------

export type LegacyPublicationAccess = {
  publicationId: string
  slug: string
  code: string | null
  series: string
  title: string
  summary: string
  editionDate: string | null
  visibility: string
  pageCount: number | null
  /** This subscriber's own live copy, or a link the record marks as shared. */
  linkUrl: string | null
  viewedBySubscriber: boolean
  downloadedBySubscriber: boolean
  decision: AccessDecision
  delivery: Delivery
}

/**
 * The same decision for the legacy library, for a subscriber with no Data
 * Room: every paid publication record, each resolved to this subscriber's own
 * live copy -- or a link the record explicitly marks as shared -- and nothing
 * else. There is no fallback to any other link.
 */
export async function loadLegacyPublicationAccess(
  subscriberId: string,
): Promise<{ state: "ok"; items: LegacyPublicationAccess[] } | { state: "not_found" } | { state: "unavailable"; message: string }> {
  const access = await loadSubscriberAccess(subscriberId)
  if (access.state !== "ok") return access
  try {
    const sql = getSql()
    const rows = (await sql`
      select d.id, d.slug, d.code, d.series, d.title, d.summary, d.description,
             to_char(d.edition_date, 'YYYY-MM-DD') as edition_date, d.visibility, d.page_count,
             d.status as editorial_status, d.is_shared_copy, d.papermark_link as shared_link,
             to_jsonb(d) ->> 'paid_release_state' as paid_release_state,
             case when pa.revoke_state = 'live' then pa.link_url else null end as stamped_link,
             exists (select 1 from document_views v where v.subscriber_id = ${subscriberId}::uuid and v.publication_id = d.id) as viewed,
             exists (select 1 from document_download_events de where de.subscriber_id = ${subscriberId}::uuid and de.publication_id = d.id) as downloaded
      from documents d
      left join publication_access pa on pa.publication_id = d.id and pa.subscriber_id = ${subscriberId}::uuid
      where d.visibility <> 'OPEN'
      order by d.edition_date desc nulls last, d.sort_order asc, d.created_at desc
    `) as Record<string, unknown>[]
    const https = (v: unknown): v is string => typeof v === "string" && v.startsWith("https://")
    const items = rows.map((r): LegacyPublicationAccess => {
      const publicationId = r.id as string
      const explicit = r.paid_release_state === "released" || r.paid_release_state === "withheld" ? (r.paid_release_state as PaidRelease) : null
      const decision = decideAccess({
        subscription: access.subscriber.subscription,
        level: access.subscriber.level,
        periods: access.periods,
        periodsKnown: access.entitlementSchema,
        exception: access.exceptions.get(publicationId)?.decision ?? null,
        publication: {
          publicationId,
          editionDate: (r.edition_date as string | null) ?? null,
          visibility: (r.visibility as string | null) ?? null,
          series: (r.series as string | null) ?? null,
          paidRelease: explicit,
          editorialStatus: (r.editorial_status as string | null) ?? null,
        },
      })
      // A stamped copy carries one person's name; a shared link only where the
      // record says so. Anything else is "being prepared", never a fallback.
      const own = https(r.stamped_link) ? r.stamped_link : null
      const linkUrl = own ?? (r.is_shared_copy === true && https(r.shared_link) ? r.shared_link : null)
      const delivery: Delivery =
        decision.outcome === "allowed" ? (linkUrl ? "open" : "preparing") : decision.outcome === "unresolved" && own ? "preserved" : "hidden"
      return {
        publicationId,
        slug: r.slug as string,
        code: (r.code as string | null) ?? null,
        series: (r.series as string) ?? "",
        title: (r.title as string) ?? "",
        summary: ((r.summary as string) || (r.description as string) || "") as string,
        editionDate: (r.edition_date as string | null) ?? null,
        visibility: (r.visibility as string) ?? "L4",
        pageCount: (r.page_count as number | null) ?? null,
        linkUrl: delivery === "hidden" ? null : delivery === "preserved" ? own : linkUrl,
        viewedBySubscriber: r.viewed === true,
        downloadedBySubscriber: r.downloaded === true,
        decision,
        delivery,
      }
    })
    return { state: "ok", items }
  } catch {
    return { state: "unavailable", message: "Access could not be checked just now." }
  }
}

/**
 * Whether the subscriber is served from a Data Room at all (override, level
 * room or stored assignment). Such a subscriber's documents open only through
 * the Data Room library: never through a fallback to another library.
 */
export async function hasAssignedDataRoom(subscriberId: string): Promise<boolean> {
  if (!UUID.test(subscriberId)) return false
  const sql = getSql()
  const rows = (await sql`
    select 1 from subscribers s
    where s.id = ${subscriberId}::uuid
      and (s.papermark_dataroom_override is not null
        or s.papermark_dataroom_id is not null
        or exists (select 1 from papermark_level_rooms lr where lr.public_tier = s.public_tier))
    limit 1
  `) as unknown[]
  return rows.length > 0
}
