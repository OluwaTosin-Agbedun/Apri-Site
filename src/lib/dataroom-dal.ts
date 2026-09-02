import 'server-only'
import { getSql } from './db'
import { PUBLIC_TIERS } from './entitlements'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ---------------------------------------------------------------------------
// Level-to-room mapping
// ---------------------------------------------------------------------------

export type LevelRoomMapping = {
  publicTier: string
  dataroomId: string
  dataroomName: string
  configuredBy: string | null
  configuredByName: string
  lastSyncedAt: string | null
  lastSyncError: string | null
  createdAt: string
}

export async function getLevelRoomMappings(): Promise<LevelRoomMapping[]> {
  const sql = getSql()
  const rows = await sql`
    select public_tier, papermark_dataroom_id, dataroom_name,
           configured_by, configured_by_name,
           last_synced_at, last_sync_error, created_at
    from papermark_level_rooms
    order by created_at
  `
  return (rows as {
    public_tier: string
    papermark_dataroom_id: string
    dataroom_name: string
    configured_by: string | null
    configured_by_name: string
    last_synced_at: string | null
    last_sync_error: string | null
    created_at: string
  }[]).map((r) => ({
    publicTier: r.public_tier,
    dataroomId: r.papermark_dataroom_id,
    dataroomName: r.dataroom_name,
    configuredBy: r.configured_by,
    configuredByName: r.configured_by_name,
    lastSyncedAt: r.last_synced_at,
    lastSyncError: r.last_sync_error,
    createdAt: r.created_at,
  }))
}

export async function setLevelRoomMapping(args: {
  publicTier: string
  dataroomId: string
  dataroomName: string
  adminId: string
  adminName: string
}): Promise<void> {
  const sql = getSql()
  await sql`
    insert into papermark_level_rooms
      (public_tier, papermark_dataroom_id, dataroom_name, configured_by, configured_by_name)
    values
      (${args.publicTier}, ${args.dataroomId}, ${args.dataroomName}, ${args.adminId}::uuid, ${args.adminName})
    on conflict (public_tier) do update set
      papermark_dataroom_id = excluded.papermark_dataroom_id,
      dataroom_name = excluded.dataroom_name,
      configured_by = excluded.configured_by,
      configured_by_name = excluded.configured_by_name,
      updated_at = now()
  `
}

export async function removeLevelRoomMapping(publicTier: string): Promise<boolean> {
  const sql = getSql()
  const rows = await sql`
    delete from papermark_level_rooms where public_tier = ${publicTier} returning 1
  `
  return rows.length > 0
}

export async function getRoomForLevel(publicTier: string): Promise<{
  dataroomId: string
  dataroomName: string
} | null> {
  const sql = getSql()
  const rows = (await sql`
    select papermark_dataroom_id, dataroom_name
    from papermark_level_rooms where public_tier = ${publicTier} limit 1
  `) as { papermark_dataroom_id: string; dataroom_name: string }[]
  const row = rows[0]
  return row ? { dataroomId: row.papermark_dataroom_id, dataroomName: row.dataroom_name } : null
}

export async function getActiveSubscriberIdsForRoom(
  dataroomId: string,
): Promise<string[]> {
  const sql = getSql()
  const rows = (await sql`
    select distinct l.subscriber_id
    from papermark_dataroom_links l
    join subscribers s on s.id = l.subscriber_id
    where l.papermark_dataroom_id = ${dataroomId}
      and l.revoke_state = 'live'
      and l.subscriber_id is not null
      and s.client_type = 'subscriber'
      and lower(s.status) = 'active'
  `) as { subscriber_id: string }[]
  return rows.map((r) => r.subscriber_id)
}

// ---------------------------------------------------------------------------
// Subscriber Data Room assignment
// ---------------------------------------------------------------------------

export async function resolveDataRoom(args: {
  subscriberId?: string
  briefingRequestId?: string
  publicTier?: string
}): Promise<{ dataroomId: string; dataroomName: string; source: 'override' | 'level' | 'briefing' } | null> {
  const sql = getSql()

  if (args.subscriberId) {
    const overrides = (await sql`
      select papermark_dataroom_override from subscribers
      where id = ${args.subscriberId} and papermark_dataroom_override is not null limit 1
    `) as { papermark_dataroom_override: string }[]
    if (overrides[0]) {
      return {
        dataroomId: overrides[0].papermark_dataroom_override,
        dataroomName: '(override)',
        source: 'override',
      }
    }
  }

  if (args.briefingRequestId) {
    const rows = (await sql`
      select papermark_dataroom_id from briefing_requests
      where id = ${args.briefingRequestId} and papermark_dataroom_id is not null limit 1
    `) as { papermark_dataroom_id: string }[]
    if (rows[0]) {
      return {
        dataroomId: rows[0].papermark_dataroom_id,
        dataroomName: '(briefing)',
        source: 'briefing',
      }
    }
  }

  if (args.publicTier) {
    const mapping = await getRoomForLevel(args.publicTier)
    if (mapping) return { ...mapping, source: 'level' }
  }

  return null
}

// ---------------------------------------------------------------------------
// Data Room links
// ---------------------------------------------------------------------------

export type DataRoomLinkRecord = {
  id: string
  subscriberId: string | null
  seatId: string | null
  briefingRequestId: string | null
  dataroomId: string
  papermarkLinkId: string
  linkUrl: string
  assignedName: string
  assignedEmail: string
  watermarkEnabled: boolean
  allowDownload: boolean
  screenshotProtection: boolean
  expiresAt: string | null
  revokeState: string
  revokedAt: string | null
  createdAt: string
  totalViews: number | null
  uniqueViewers: number | null
  lastActivityAt: string | null
}

export async function getDataRoomLink(args: {
  subscriberId?: string
  seatId?: string
  briefingRequestId?: string
  dataroomId: string
}): Promise<DataRoomLinkRecord | null> {
  const sql = getSql()
  let rows: Record<string, unknown>[]

  if (args.subscriberId) {
    rows = await sql`
      select * from papermark_dataroom_links
      where subscriber_id = ${args.subscriberId}::uuid
        and papermark_dataroom_id = ${args.dataroomId}
        and revoke_state = 'live'
      limit 1
    `
  } else if (args.seatId) {
    rows = await sql`
      select * from papermark_dataroom_links
      where seat_id = ${args.seatId}::uuid
        and papermark_dataroom_id = ${args.dataroomId}
        and revoke_state = 'live'
      limit 1
    `
  } else if (args.briefingRequestId) {
    rows = await sql`
      select * from papermark_dataroom_links
      where briefing_request_id = ${args.briefingRequestId}::uuid
        and papermark_dataroom_id = ${args.dataroomId}
        and revoke_state = 'live'
      limit 1
    `
  } else {
    return null
  }

  return rows[0] ? mapLinkRow(rows[0]) : null
}

export async function saveDataRoomLink(args: {
  subscriberId?: string | null
  seatId?: string | null
  briefingRequestId?: string | null
  dataroomId: string
  papermarkLinkId: string
  linkUrl: string
  assignedName: string
  assignedEmail: string
  watermarkEnabled: boolean
  watermarkText: string
  allowDownload: boolean
  screenshotProtection: boolean
  expiresAt: string | null
}): Promise<string> {
  const sql = getSql()
  const rows = (await sql`
    insert into papermark_dataroom_links (
      subscriber_id, seat_id, briefing_request_id,
      papermark_dataroom_id, papermark_link_id, link_url,
      assigned_name, assigned_email,
      watermark_enabled, watermark_text,
      allow_download, screenshot_protection, expires_at
    ) values (
      ${args.subscriberId ?? null}::uuid,
      ${args.seatId ?? null}::uuid,
      ${args.briefingRequestId ?? null}::uuid,
      ${args.dataroomId}, ${args.papermarkLinkId}, ${args.linkUrl},
      ${args.assignedName}, ${args.assignedEmail},
      ${args.watermarkEnabled}, ${args.watermarkText},
      ${args.allowDownload}, ${args.screenshotProtection},
      ${args.expiresAt ? args.expiresAt : null}::timestamptz
    )
    returning id
  `) as { id: string }[]
  return rows[0]!.id
}

export async function markLinkRevoked(linkId: string): Promise<void> {
  const sql = getSql()
  await sql`
    update papermark_dataroom_links
    set revoke_state = 'revoked', revoked_at = now(), updated_at = now()
    where id = ${linkId}::uuid
  `
}

export async function updateLinkAnalytics(args: {
  linkId: string
  totalViews: number
  uniqueViewers: number
  totalDurationSeconds: number
  lastActivityAt?: string | null
}): Promise<void> {
  const sql = getSql()
  await sql`
    update papermark_dataroom_links set
      analytics_checked_at = now(),
      total_views = ${args.totalViews},
      unique_viewers = ${args.uniqueViewers},
      total_duration_seconds = ${args.totalDurationSeconds},
      last_activity_at = ${args.lastActivityAt ?? null}::timestamptz,
      updated_at = now()
    where id = ${args.linkId}::uuid
  `
}

// ---------------------------------------------------------------------------
// Data Room documents (APRI's snapshot)
// ---------------------------------------------------------------------------

export async function syncDataRoomDocuments(
  dataroomId: string,
  documents: {
    documentId: string
    dataroomDocumentId?: string
    title: string
    category: string
    folderId?: string | null
    folderPath?: string | null
    numPages?: number | null
    contentType?: string | null
    createdAt?: string | null
    updatedAt?: string | null
    versionKey: string
  }[],
): Promise<{ added: number; updated: number; removed: number }> {
  const sql = getSql()
  let added = 0
  let updated = 0

  const seenDocIds = new Set<string>()

  for (const doc of documents) {
    seenDocIds.add(doc.documentId)
    const existing = (await sql`
      select id, version_key, is_present from papermark_dataroom_documents
      where papermark_dataroom_id = ${dataroomId}
        and papermark_document_id = ${doc.documentId}
      limit 1
    `) as { id: string; version_key: string; is_present: boolean }[]

    if (existing[0]) {
      const changed = existing[0].version_key !== doc.versionKey || !existing[0].is_present
      if (changed) {
        await sql`
          update papermark_dataroom_documents set
            title = ${doc.title}, category = ${doc.category},
            folder_id = ${doc.folderId ?? null},
            folder_path = ${doc.folderPath ?? null},
            num_pages = ${doc.numPages ?? null},
            content_type = ${doc.contentType ?? null},
            papermark_created_at = ${doc.createdAt ?? null}::timestamptz,
            papermark_updated_at = ${doc.updatedAt ?? null}::timestamptz,
            last_seen_at = now(), is_present = true, removed_at = null,
            version_key = ${doc.versionKey}, updated_at = now(),
            dataroom_document_id = ${doc.dataroomDocumentId ?? null}
          where id = ${existing[0].id}::uuid
        `
        updated++
      } else {
        // Version unchanged — still update folder_path and recalculate category
        // so a Sync corrects OTHER → MIN without a version bump.
        await sql`
          update papermark_dataroom_documents set
            last_seen_at = now(),
            folder_path = coalesce(${doc.folderPath ?? null}, folder_path),
            folder_id = coalesce(${doc.folderId ?? null}, folder_id),
            category = ${doc.category},
            dataroom_document_id = coalesce(${doc.dataroomDocumentId ?? null}, dataroom_document_id)
          where id = ${existing[0].id}::uuid
        `
      }
    } else {
      await sql`
        insert into papermark_dataroom_documents (
          papermark_dataroom_id, papermark_document_id, dataroom_document_id,
          title, category, folder_id, folder_path, num_pages, content_type,
          papermark_created_at, papermark_updated_at, version_key
        ) values (
          ${dataroomId}, ${doc.documentId}, ${doc.dataroomDocumentId ?? null},
          ${doc.title}, ${doc.category}, ${doc.folderId ?? null},
          ${doc.folderPath ?? null},
          ${doc.numPages ?? null}, ${doc.contentType ?? null},
          ${doc.createdAt ?? null}::timestamptz, ${doc.updatedAt ?? null}::timestamptz,
          ${doc.versionKey}
        )
      `
      added++
    }
  }

  const removedRows = await sql`
    update papermark_dataroom_documents
    set is_present = false, removed_at = now(), updated_at = now()
    where papermark_dataroom_id = ${dataroomId}
      and is_present = true
      and papermark_document_id <> all(${[...seenDocIds]})
    returning 1
  `

  return { added, updated, removed: removedRows.length }
}

export async function updateDataRoomSyncState(
  dataroomId: string,
  name: string,
  documentCount: number,
  error: string | null,
): Promise<void> {
  const sql = getSql()
  await sql`
    insert into papermark_datarooms (papermark_dataroom_id, name, document_count, last_synced_at, last_sync_error)
    values (${dataroomId}, ${name}, ${documentCount}, now(), ${error})
    on conflict (papermark_dataroom_id) do update set
      name = excluded.name,
      document_count = excluded.document_count,
      last_synced_at = now(),
      last_sync_error = excluded.last_sync_error,
      updated_at = now()
  `
}

export async function updateLevelRoomSyncState(
  publicTier: string,
  error: string | null,
): Promise<void> {
  const sql = getSql()
  await sql`
    update papermark_level_rooms set
      last_synced_at = now(),
      last_sync_error = ${error},
      updated_at = now()
    where public_tier = ${publicTier}
  `
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export async function recordAssignment(args: {
  subscriberId?: string | null
  seatId?: string | null
  briefingRequestId?: string | null
  previousDataroomId?: string | null
  newDataroomId?: string | null
  previousLinkId?: string | null
  newLinkId?: string | null
  reason: string
  changedById: string
  changedByName: string
}): Promise<void> {
  const sql = getSql()
  await sql`
    insert into papermark_assignment_audit (
      subscriber_id, seat_id, briefing_request_id,
      previous_dataroom_id, new_dataroom_id,
      previous_link_id, new_link_id,
      reason, changed_by, changed_by_name
    ) values (
      ${args.subscriberId ?? null}::uuid,
      ${args.seatId ?? null}::uuid,
      ${args.briefingRequestId ?? null}::uuid,
      ${args.previousDataroomId ?? null},
      ${args.newDataroomId ?? null},
      ${args.previousLinkId ?? null},
      ${args.newLinkId ?? null},
      ${args.reason},
      ${args.changedById}::uuid,
      ${args.changedByName}
    )
  `
}

// ---------------------------------------------------------------------------
// Dashboard stats
// ---------------------------------------------------------------------------

export type DataRoomStats = {
  configuredLevels: number
  totalLevels: number
  subscribersWithRoom: number
  subscribersWithoutRoom: number
  activeLinks: number
  expiringLinks: number
  syncErrors: number
}

export async function getDataRoomStats(): Promise<DataRoomStats> {
  const sql = getSql()
  const [row] = (await sql`
    select
      (select count(*)::int from papermark_level_rooms) as configured_levels,
      ${PUBLIC_TIERS.length}::int as total_levels,
      (select count(*)::int from subscribers
        where client_type='subscriber' and lower(status)='active'
          and (papermark_dataroom_id is not null or papermark_dataroom_override is not null)) as with_room,
      (select count(*)::int from subscribers
        where client_type='subscriber' and lower(status)='active'
          and papermark_dataroom_id is null and papermark_dataroom_override is null) as without_room,
      (select count(*)::int from papermark_dataroom_links where revoke_state='live') as active_links,
      (select count(*)::int from papermark_dataroom_links
        where revoke_state='live' and expires_at is not null
          and expires_at < now() + interval '30 days') as expiring_links,
      (select count(*)::int from papermark_level_rooms where last_sync_error is not null) as sync_errors
  `) as {
    configured_levels: number
    total_levels: number
    with_room: number
    without_room: number
    active_links: number
    expiring_links: number
    sync_errors: number
  }[]

  return {
    configuredLevels: row?.configured_levels ?? 0,
    totalLevels: row?.total_levels ?? 0,
    subscribersWithRoom: row?.with_room ?? 0,
    subscribersWithoutRoom: row?.without_room ?? 0,
    activeLinks: row?.active_links ?? 0,
    expiringLinks: row?.expiring_links ?? 0,
    syncErrors: row?.sync_errors ?? 0,
  }
}

export async function getLinksForRoom(dataroomId: string): Promise<DataRoomLinkRecord[]> {
  const sql = getSql()
  const rows = await sql`
    select * from papermark_dataroom_links
    where papermark_dataroom_id = ${dataroomId}
    order by created_at desc
  `
  return (rows as Record<string, unknown>[]).map(mapLinkRow)
}

// ---------------------------------------------------------------------------
// Subscriber seats
// ---------------------------------------------------------------------------

export type SeatHolder = {
  id: string
  subscriberId: string
  fullName: string
  email: string
  createdAt: string
  hasLink: boolean
}

export async function getSeatsForSubscriber(subscriberId: string): Promise<SeatHolder[]> {
  if (!UUID.test(subscriberId)) return []
  const sql = getSql()
  const rows = (await sql`
    select ss.id, ss.subscriber_id, ss.full_name, ss.email, ss.created_at,
           exists(
             select 1 from papermark_dataroom_links dl
             where dl.seat_id = ss.id and dl.revoke_state = 'live'
           ) as has_link
    from subscriber_seats ss
    where ss.subscriber_id = ${subscriberId}::uuid
    order by ss.created_at
  `) as {
    id: string
    subscriber_id: string
    full_name: string
    email: string
    created_at: string
    has_link: boolean
  }[]
  return rows.map((r) => ({
    id: r.id,
    subscriberId: r.subscriber_id,
    fullName: r.full_name,
    email: r.email,
    createdAt: r.created_at,
    hasLink: r.has_link,
  }))
}

export async function addSeat(args: {
  subscriberId: string
  fullName: string
  email: string
}): Promise<string> {
  const sql = getSql()
  const rows = (await sql`
    insert into subscriber_seats (subscriber_id, full_name, email)
    values (${args.subscriberId}::uuid, ${args.fullName}, ${args.email})
    returning id
  `) as { id: string }[]
  return rows[0]!.id
}

export async function removeSeat(seatId: string): Promise<boolean> {
  if (!UUID.test(seatId)) return false
  const sql = getSql()
  const rows = await sql`delete from subscriber_seats where id = ${seatId}::uuid returning 1`
  return rows.length > 0
}

// ---------------------------------------------------------------------------
// Migration helpers
// ---------------------------------------------------------------------------

export type MigrationCandidate = {
  id: string
  fullName: string
  email: string
  publicTier: string
  status: string
  hasDataRoom: boolean
  hasDataRoomLink: boolean
  dataroomId: string | null
}

export async function getMigrationCandidates(): Promise<MigrationCandidate[]> {
  const sql = getSql()
  const rows = (await sql`
    select s.id, s.full_name, s.email, s.public_tier, s.status,
           (s.papermark_dataroom_id is not null or s.papermark_dataroom_override is not null) as has_dataroom,
           exists(
             select 1 from papermark_dataroom_links dl
             where dl.subscriber_id = s.id and dl.revoke_state = 'live'
           ) as has_dataroom_link,
           coalesce(s.papermark_dataroom_override, s.papermark_dataroom_id) as dataroom_id
    from subscribers s
    where s.client_type = 'subscriber' and lower(s.status) = 'active'
    order by s.full_name
  `) as {
    id: string
    full_name: string
    email: string
    public_tier: string
    status: string
    has_dataroom: boolean
    has_dataroom_link: boolean
    dataroom_id: string | null
  }[]
  return rows.map((r) => ({
    id: r.id,
    fullName: r.full_name,
    email: r.email,
    publicTier: r.public_tier,
    status: r.status,
    hasDataRoom: r.has_dataroom,
    hasDataRoomLink: r.has_dataroom_link,
    dataroomId: r.dataroom_id,
  }))
}

export async function assignDataRoomToSubscriber(
  subscriberId: string,
  dataroomId: string,
): Promise<void> {
  const sql = getSql()
  await sql`
    update subscribers set papermark_dataroom_id = ${dataroomId}, updated_at = now()
    where id = ${subscriberId}::uuid
  `
}

// ---------------------------------------------------------------------------
// Per-document subscriber links
// ---------------------------------------------------------------------------

export type DocumentLinkRecord = {
  id: string
  subscriberId: string
  papermarkDocumentId: string
  papermarkLinkId: string
  linkUrl: string
  assignedName: string
  assignedEmail: string
  allowDownload: boolean
  expiresAt: string | null
  revokeState: string
  createdAt: string
}

export async function getDocumentLink(args: {
  subscriberId: string
  papermarkDocumentId: string
}): Promise<DocumentLinkRecord | null> {
  const sql = getSql()
  const rows = (await sql`
    select id, subscriber_id, papermark_document_id, papermark_link_id,
           link_url, assigned_name, assigned_email, allow_download,
           expires_at, revoke_state, created_at
    from papermark_subscriber_document_links
    where subscriber_id = ${args.subscriberId}::uuid
      and papermark_document_id = ${args.papermarkDocumentId}
      and revoke_state = 'live'
    limit 1
  `) as Record<string, unknown>[]
  return rows[0] ? mapDocLinkRow(rows[0]) : null
}

export async function getDocumentLinkByDocRowId(args: {
  subscriberId: string
  documentRowId: string
}): Promise<DocumentLinkRecord | null> {
  const sql = getSql()
  const rows = (await sql`
    select dl.id, dl.subscriber_id, dl.papermark_document_id, dl.papermark_link_id,
           dl.link_url, dl.assigned_name, dl.assigned_email, dl.allow_download,
           dl.expires_at, dl.revoke_state, dl.created_at
    from papermark_subscriber_document_links dl
    join papermark_dataroom_documents dd
      on dd.papermark_document_id = dl.papermark_document_id
    where dl.subscriber_id = ${args.subscriberId}::uuid
      and dd.id = ${args.documentRowId}::uuid
      and dl.revoke_state = 'live'
    limit 1
  `) as Record<string, unknown>[]
  return rows[0] ? mapDocLinkRow(rows[0]) : null
}

export async function saveDocumentLink(args: {
  subscriberId: string
  papermarkDocumentId: string
  papermarkLinkId: string
  linkUrl: string
  assignedName: string
  assignedEmail: string
  watermarkText: string
  allowDownload: boolean
  screenshotProtection: boolean
  expiresAt: string | null
}): Promise<string> {
  const sql = getSql()
  const rows = (await sql`
    insert into papermark_subscriber_document_links (
      subscriber_id, papermark_document_id, papermark_link_id, link_url,
      assigned_name, assigned_email, watermark_text,
      allow_download, screenshot_protection, expires_at
    ) values (
      ${args.subscriberId}::uuid, ${args.papermarkDocumentId},
      ${args.papermarkLinkId}, ${args.linkUrl},
      ${args.assignedName}, ${args.assignedEmail}, ${args.watermarkText},
      ${args.allowDownload}, ${args.screenshotProtection},
      ${args.expiresAt ? args.expiresAt : null}::timestamptz
    )
    on conflict (subscriber_id, papermark_document_id)
      where revoke_state = 'live' do nothing
    returning id
  `) as { id: string }[]
  return rows[0]?.id ?? ''
}

export async function markDocumentLinkRevoked(linkId: string): Promise<void> {
  const sql = getSql()
  await sql`
    update papermark_subscriber_document_links
    set revoke_state = 'revoked', revoked_at = now(), updated_at = now()
    where id = ${linkId}::uuid
  `
}

export async function getLiveDocumentLinksForSubscriber(
  subscriberId: string,
): Promise<DocumentLinkRecord[]> {
  const sql = getSql()
  const rows = (await sql`
    select id, subscriber_id, papermark_document_id, papermark_link_id,
           link_url, assigned_name, assigned_email, allow_download,
           expires_at, revoke_state, created_at
    from papermark_subscriber_document_links
    where subscriber_id = ${subscriberId}::uuid
      and revoke_state = 'live'
    order by created_at desc
  `) as Record<string, unknown>[]
  return rows.map(mapDocLinkRow)
}

export async function getDocumentsNeedingLinks(args: {
  subscriberId: string
  dataroomId: string
}): Promise<{ papermarkDocumentId: string; title: string }[]> {
  const sql = getSql()
  const rows = (await sql`
    select dd.papermark_document_id, dd.title
    from papermark_dataroom_documents dd
    where dd.papermark_dataroom_id = ${args.dataroomId}
      and dd.is_present = true
      and not exists (
        select 1 from papermark_subscriber_document_links dl
        where dl.subscriber_id = ${args.subscriberId}::uuid
          and dl.papermark_document_id = dd.papermark_document_id
          and dl.revoke_state = 'live'
      )
  `) as { papermark_document_id: string; title: string }[]
  return rows.map((r) => ({
    papermarkDocumentId: r.papermark_document_id,
    title: r.title,
  }))
}

function mapDocLinkRow(r: Record<string, unknown>): DocumentLinkRecord {
  return {
    id: String(r.id ?? ''),
    subscriberId: String(r.subscriber_id ?? ''),
    papermarkDocumentId: String(r.papermark_document_id ?? ''),
    papermarkLinkId: String(r.papermark_link_id ?? ''),
    linkUrl: String(r.link_url ?? ''),
    assignedName: String(r.assigned_name ?? ''),
    assignedEmail: String(r.assigned_email ?? ''),
    allowDownload: r.allow_download === true,
    expiresAt: r.expires_at ? String(r.expires_at) : null,
    revokeState: String(r.revoke_state ?? 'live'),
    createdAt: String(r.created_at ?? ''),
  }
}

// ---------------------------------------------------------------------------
// Synced documents with editorial status (admin)
// ---------------------------------------------------------------------------

export type SyncedDocumentRow = {
  id: string
  papermarkDocumentId: string
  title: string
  folderPath: string | null
  category: string
  numPages: number | null
  publicationId: string | null
  editorialTitle: string | null
  editorialStatus: 'complete' | 'needs_details'
}

export async function getSyncedDocumentsForRoom(
  dataroomId: string,
): Promise<SyncedDocumentRow[]> {
  const sql = getSql()
  const rows = (await sql`
    select dd.id, dd.papermark_document_id, dd.title, dd.folder_path,
           dd.category, dd.num_pages, dd.publication_id,
           d.title as editorial_title, d.summary as editorial_summary
    from papermark_dataroom_documents dd
    left join documents d on d.id = dd.publication_id
    where dd.papermark_dataroom_id = ${dataroomId}
      and dd.is_present = true
    order by dd.folder_path nulls last, dd.title
  `) as {
    id: string
    papermark_document_id: string
    title: string
    folder_path: string | null
    category: string
    num_pages: number | null
    publication_id: string | null
    editorial_title: string | null
    editorial_summary: string | null
  }[]

  return rows.map((r) => ({
    id: r.id,
    papermarkDocumentId: r.papermark_document_id,
    title: r.title,
    folderPath: r.folder_path,
    category: r.category,
    numPages: r.num_pages,
    publicationId: r.publication_id,
    editorialTitle: r.editorial_title,
    editorialStatus: r.publication_id && r.editorial_title && r.editorial_summary
      ? 'complete' as const
      : 'needs_details' as const,
  }))
}

export async function linkPublicationToDocument(
  documentRowId: string,
  publicationId: string,
): Promise<boolean> {
  const sql = getSql()
  const rows = await sql`
    update papermark_dataroom_documents
    set publication_id = ${publicationId}::uuid, updated_at = now()
    where id = ${documentRowId}::uuid
    returning 1
  `
  return rows.length > 0
}

export async function unlinkPublicationFromDocument(
  documentRowId: string,
): Promise<boolean> {
  const sql = getSql()
  const rows = await sql`
    update papermark_dataroom_documents
    set publication_id = null, updated_at = now()
    where id = ${documentRowId}::uuid
    returning 1
  `
  return rows.length > 0
}

export async function autoLinkByPapermarkId(
  dataroomId: string,
): Promise<{ linked: number; alreadyLinked: number; noMatch: number }> {
  const sql = getSql()

  const all = (await sql`
    select dd.id, dd.publication_id, dd.papermark_document_id,
           (select d.id from documents d
            where d.papermark_document_id = dd.papermark_document_id
              and d.papermark_document_id is not null
            limit 1) as match_id
    from papermark_dataroom_documents dd
    where dd.papermark_dataroom_id = ${dataroomId}
      and dd.is_present = true
  `) as { id: string; publication_id: string | null; papermark_document_id: string; match_id: string | null }[]

  let linked = 0
  let alreadyLinked = 0
  let noMatch = 0

  for (const row of all) {
    if (row.publication_id) {
      alreadyLinked++
    } else if (row.match_id) {
      await sql`
        update papermark_dataroom_documents
        set publication_id = ${row.match_id}::uuid, updated_at = now()
        where id = ${row.id}::uuid
      `
      linked++
    } else {
      noMatch++
    }
  }

  return { linked, alreadyLinked, noMatch }
}

// ---------------------------------------------------------------------------
// Create or reuse a publication record for a synced DR document
// ---------------------------------------------------------------------------

export async function createPublicationForSyncedDocument(args: {
  documentRowId: string
  publicTier?: string | null
}): Promise<{ publicationId: string; created: boolean }> {
  const sql = getSql()

  const rows = (await sql`
    select dd.id, dd.papermark_document_id, dd.title, dd.num_pages,
           dd.category, dd.publication_id
    from papermark_dataroom_documents dd
    where dd.id = ${args.documentRowId}::uuid
    limit 1
  `) as {
    id: string
    papermark_document_id: string
    title: string
    num_pages: number | null
    category: string
    publication_id: string | null
  }[]

  const doc = rows[0]
  if (!doc) throw new Error('Synced document not found.')

  if (doc.publication_id) {
    return { publicationId: doc.publication_id, created: false }
  }

  // Check for existing documents record with same Papermark document ID
  const existing = (await sql`
    select id from documents
    where papermark_document_id = ${doc.papermark_document_id}
    limit 1
  `) as { id: string }[]

  if (existing[0]) {
    await sql`
      update papermark_dataroom_documents
      set publication_id = ${existing[0].id}::uuid, updated_at = now()
      where id = ${doc.id}::uuid
    `
    return { publicationId: existing[0].id, created: false }
  }

  const { humaniseFilename, categoryToSeries, categoryToDefaultVisibility } = await import('./papermark-dataroom-contract')
  const displayTitle = humaniseFilename(doc.title)
  const series = categoryToSeries(doc.category as import('./papermark-dataroom-contract').PortalCategoryKey)
  const visibility = categoryToDefaultVisibility(
    doc.category as import('./papermark-dataroom-contract').PortalCategoryKey,
    args.publicTier,
  )
  const slug = displayTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  const inserted = (await sql`
    insert into documents (
      slug, title, kicker, summary, series, visibility, page_count,
      status, is_published, papermark_document_id
    ) values (
      ${slug || 'untitled'}, ${displayTitle}, ${''}, ${''}, ${series},
      ${visibility}, ${doc.num_pages ?? null},
      ${'draft'}, ${false}, ${doc.papermark_document_id}
    )
    returning id
  `) as { id: string }[]

  const pubId = inserted[0]!.id

  await sql`
    update papermark_dataroom_documents
    set publication_id = ${pubId}::uuid, updated_at = now()
    where id = ${doc.id}::uuid
  `

  return { publicationId: pubId, created: true }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Watermark bulk update
// ---------------------------------------------------------------------------

export type LiveLinkForWatermark = {
  table: 'dataroom' | 'document'
  id: string
  papermarkLinkId: string
  assignedName: string
  assignedEmail: string
}

export async function getAllLiveLinksForWatermark(): Promise<LiveLinkForWatermark[]> {
  const sql = getSql()
  const drRows = (await sql`
    select id, papermark_link_id, assigned_name, assigned_email
    from papermark_dataroom_links
    where revoke_state = 'live'
  `) as Record<string, unknown>[]

  const docRows = (await sql`
    select id, papermark_link_id, assigned_name, assigned_email
    from papermark_subscriber_document_links
    where revoke_state = 'live'
  `) as Record<string, unknown>[]

  return [
    ...drRows.map((r) => ({
      table: 'dataroom' as const,
      id: String(r.id),
      papermarkLinkId: String(r.papermark_link_id),
      assignedName: String(r.assigned_name ?? ''),
      assignedEmail: String(r.assigned_email ?? ''),
    })),
    ...docRows.map((r) => ({
      table: 'document' as const,
      id: String(r.id),
      papermarkLinkId: String(r.papermark_link_id),
      assignedName: String(r.assigned_name ?? ''),
      assignedEmail: String(r.assigned_email ?? ''),
    })),
  ]
}

export async function updateLocalWatermarkText(
  table: 'dataroom' | 'document',
  id: string,
  text: string,
): Promise<void> {
  const sql = getSql()
  if (table === 'dataroom') {
    await sql`
      update papermark_dataroom_links
      set watermark_text = ${text}, updated_at = now()
      where id = ${id}::uuid
    `
  } else {
    await sql`
      update papermark_subscriber_document_links
      set watermark_text = ${text}, updated_at = now()
      where id = ${id}::uuid
    `
  }
}

// ---------------------------------------------------------------------------

function mapLinkRow(r: Record<string, unknown>): DataRoomLinkRecord {
  return {
    id: String(r.id ?? ''),
    subscriberId: r.subscriber_id ? String(r.subscriber_id) : null,
    seatId: r.seat_id ? String(r.seat_id) : null,
    briefingRequestId: r.briefing_request_id ? String(r.briefing_request_id) : null,
    dataroomId: String(r.papermark_dataroom_id ?? ''),
    papermarkLinkId: String(r.papermark_link_id ?? ''),
    linkUrl: String(r.link_url ?? ''),
    assignedName: String(r.assigned_name ?? ''),
    assignedEmail: String(r.assigned_email ?? ''),
    watermarkEnabled: r.watermark_enabled === true,
    allowDownload: r.allow_download === true,
    screenshotProtection: r.screenshot_protection === true,
    expiresAt: r.expires_at ? String(r.expires_at) : null,
    revokeState: String(r.revoke_state ?? 'live'),
    revokedAt: r.revoked_at ? String(r.revoked_at) : null,
    createdAt: String(r.created_at ?? ''),
    totalViews: typeof r.total_views === 'number' ? r.total_views : null,
    uniqueViewers: typeof r.unique_viewers === 'number' ? r.unique_viewers : null,
    lastActivityAt: r.last_activity_at ? String(r.last_activity_at) : null,
  }
}
