/**
 * The rules for one approved Complimentary Review reader's personal Papermark
 * Data Room access -- pure, so they can be tested without Papermark.
 *
 * Model (Papermark "viewer groups"):
 *  - one group per reader, whose only member is that reader's approved email
 *    (no domains, never "allow all");
 *  - an explicit permission row for EVERY document in the Review Data Room:
 *    view for the published editions assigned to that reader, nothing for
 *    every other document -- withdrawn, unassigned or newly added -- and
 *    download never;
 *  - one email-authenticated group link, created only once those permissions
 *    have been read back and match exactly.
 *
 * Papermark refuses a group-link viewer any document with no permission row
 * (it answers "Unauthorized access"), and lists only documents whose row
 * allows viewing; so a new group exposes nothing until rows are written.
 */
import { PROSPECT_WATERMARK_TEXT, prospectWatermarkConfig, type WatermarkConfig } from "./papermark-dataroom-contract"

export type RoomPermissionEntry = {
  item_id: string
  item_type: "dataroom_document"
  can_view: boolean
  can_download: false
}

/** Every document in the room gets a row: view only where assigned, download nowhere. */
export function permissionPlan(roomDocumentIds: readonly string[], visibleIds: readonly string[]): RoomPermissionEntry[] {
  const visible = new Set(visibleIds)
  return [...new Set(roomDocumentIds)].sort().map((id) => ({
    item_id: id,
    item_type: "dataroom_document" as const,
    can_view: visible.has(id),
    can_download: false as const,
  }))
}

export type ReadPermission = { item_id: string; item_type: string; can_view: boolean; can_download: boolean }

/**
 * Compares what Papermark reports with what was intended. `overExposed` lists
 * documents the reader can see or download but should not -- a removal that
 * did not take effect. `missing` lists assigned documents not yet visible.
 */
export function comparePermissions(
  actual: readonly ReadPermission[],
  visibleIds: readonly string[],
): { exact: boolean; overExposed: string[]; missing: string[]; downloadable: string[] } {
  const visible = new Set(visibleIds)
  const docs = actual.filter((p) => p.item_type === "dataroom_document")
  const shown = new Set(docs.filter((p) => p.can_view || p.can_download).map((p) => p.item_id))
  const overExposed = [...shown].filter((id) => !visible.has(id)).sort()
  const missing = [...visible].filter((id) => !shown.has(id)).sort()
  const downloadable = docs.filter((p) => p.can_download).map((p) => p.item_id).sort()
  return { exact: overExposed.length === 0 && missing.length === 0 && downloadable.length === 0, overExposed, missing, downloadable }
}

/** A stable fingerprint of a visible set, to record what was verified. */
export function visibleSetKey(visibleIds: readonly string[]): string {
  return [...new Set(visibleIds)].sort().join(",")
}

export type RoomLinkSettings = {
  dataroom_id: string
  audience_type: "group"
  group_id: string
  name: string
  expires_at: null
  email_protected: true
  email_authenticated: true
  allow_download: false
  allow_list: string[]
  deny_list: string[]
  enable_watermark: true
  watermark_config: WatermarkConfig
  enable_screenshot_protection: true
  enable_agreement: false
  show_banner: false
  domain?: string
}

/** The one link for a reader's group: verified email, watermark, screenshot protection, no downloads. */
export function roomLinkSettings(args: { roomId: string; groupId: string; email: string; customDomain?: string | null }): RoomLinkSettings {
  const settings: RoomLinkSettings = {
    dataroom_id: args.roomId,
    audience_type: "group",
    group_id: args.groupId,
    name: "APRI Complimentary Review Library — personal reader link",
    expires_at: null,
    email_protected: true,
    email_authenticated: true,
    allow_download: false,
    // The group's single member already forms the allow list; it is repeated
    // on the link as a second, independent restriction.
    allow_list: [args.email],
    deny_list: [],
    enable_watermark: true,
    watermark_config: prospectWatermarkConfig(),
    enable_screenshot_protection: true,
    enable_agreement: false,
    show_banner: false,
  }
  const domain = (args.customDomain ?? "").trim()
  if (domain) settings.domain = domain
  return settings
}

export type ReadLink = {
  id?: string
  url?: string | null
  audience_type?: string | null
  group_id?: string | null
  dataroom_id?: string | null
  document_id?: string | null
  expires_at?: string | null
  email_protected?: boolean
  email_authenticated?: boolean
  allow_download?: boolean
  allow_list?: string[] | null
  enable_watermark?: boolean
  watermark_config?: { text?: string; opacity?: number; font_size?: number } | null
  enable_screenshot_protection?: boolean
}

/** What is wrong with a reader's room link as Papermark reports it, or null when it matches exactly. */
export function roomLinkProblem(
  link: ReadLink,
  expected: { roomId: string; groupId: string; email: string },
  now = new Date(),
  options: { allowClosed?: boolean } = {},
): string | null {
  if (link.audience_type !== "group" || link.group_id !== expected.groupId) return "The link is not limited to this reader's group."
  if (link.dataroom_id !== expected.roomId || link.document_id) return "The link does not target the Review Data Room."
  const allow = (link.allow_list ?? []).map((e) => e.trim().toLowerCase())
  if (allow.length !== 1 || allow[0] !== expected.email) return "The link's allow list is not exactly this reader."
  if (link.email_protected !== true || link.email_authenticated !== true) return "Verified-email protection is not on."
  if (link.allow_download !== false) return "Downloads are not disabled."
  if (link.enable_watermark !== true) return "The personalised watermark is off."
  const wm = link.watermark_config
  if (wm?.text !== PROSPECT_WATERMARK_TEXT || wm.opacity !== 0.15 || wm.font_size !== 18) return "The watermark does not match the approved Complimentary Review watermark."
  if (link.enable_screenshot_protection !== true) return "Screenshot protection is off."
  if (!options.allowClosed && link.expires_at && new Date(link.expires_at) <= now) return "The link is closed."
  if (!link.url || !link.url.startsWith("https://")) return "The link has no https address."
  return null
}

/** The past moment a link is closed with: Papermark refuses an expired link, and the URL is kept for repair. */
export function closedAt(now = new Date()): string {
  return new Date(now.getTime() - 60_000).toISOString()
}
