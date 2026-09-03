import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

// ---------------------------------------------------------------------------
// 1. Collapsible admin sidebar
// ---------------------------------------------------------------------------

test("admin sidebar is a client component with open/close state", () => {
  const sidebar = read("src/components/AdminSidebar.tsx")
  assert.match(sidebar, /"use client"/)
  assert.match(sidebar, /useState/)
  assert.match(sidebar, /setOpen\(true\)/)
  assert.match(sidebar, /setOpen\(false\)/)
  assert.match(sidebar, /Open menu/)
  assert.match(sidebar, /Close menu/)
  assert.match(sidebar, /lg:relative/)
  assert.match(sidebar, /-translate-x-full/)
})

test("AdminShell delegates sidebar to the client component", () => {
  const shell = read("src/components/AdminShell.tsx")
  assert.match(shell, /AdminSidebar/)
  assert.match(shell, /import AdminSidebar/)
  assert.doesNotMatch(shell, /"use client"/)
})

// ---------------------------------------------------------------------------
// 2. Dashboard migration extends event type constraint
// ---------------------------------------------------------------------------

test("engagement dashboard migration adds document_downloaded and publication_notification_sent", () => {
  const migration = read("db/migrations/20260828_engagement_dashboard.sql")
  assert.match(migration, /document_downloaded/)
  assert.match(migration, /publication_notification_sent/)
  assert.match(migration, /drop constraint if exists/)
  assert.match(migration, /add constraint/)
  assert.doesNotMatch(migration, /drop table|truncate/i)
})

// ---------------------------------------------------------------------------
// 3. Engagement DAL has comprehensive metrics
// ---------------------------------------------------------------------------

/**
 * Phase 6 replaced the summary shape these tests were written against.
 *
 * The old `EngagementSummary` mixed lifetime totals with 30-day figures in one
 * object and counted `portal_opened` as a document view. The replacement takes
 * an explicit window and counts distinct Papermark ids, so the assertions below
 * check the new guarantees rather than the old field names.
 */
test("engagement analytics exports the windowed overview metrics", () => {
  const dal = read("src/lib/engagement-analytics.ts")
  for (const field of [
    "activeSubscribers",
    "uniquePaidReaders",
    "uniqueProspectReaders",
    "viewSessions",
    "downloadEvents",
    "uniqueDownloaders",
    "accessClicks",
    "dormantSubscribers",
    "unmatchedViews",
  ]) {
    assert.match(dal, new RegExp(field), `${field} must be reported`)
  }
})

test("engagement analytics counts distinct Papermark ids, not rows", () => {
  const dal = read("src/lib/engagement-analytics.ts")
  assert.match(dal, /count\(distinct dv\.papermark_view_id\)/)
  assert.match(dal, /count\(distinct de\.source_event_id\)/)
  // The old row-count formula must not return.
  assert.doesNotMatch(dal, /count\(\*\)::int from document_views\) as papermark_views/)
})

test("engagement analytics never counts portal_opened as a view", () => {
  assert.doesNotMatch(read("src/lib/engagement-analytics.ts"), /portal_opened/)
})

test("engagement analytics applies one window to every figure", () => {
  const dal = read("src/lib/engagement-analytics.ts")
  assert.match(dal, /window: DateWindow/)
  const lower = (dal.match(/>= \$\{fromIso\}::timestamptz/g) ?? []).length
  assert.ok(lower >= 8, "figures must be windowed")
})

test("subscriber activity requires an explicit window", () => {
  const dal = read("src/lib/client-engagement.ts")
  assert.match(dal, /getSubscriberActivity/)
  assert.match(dal, /windowDays: number/)
})

test("engagement page has four sections and a period selector", () => {
  const page = read("src/app/admin/engagement/page.tsx")
  for (const tab of ["Overview", "Publications", "Readers", "Diagnostics"]) {
    assert.match(page, new RegExp(`label: "${tab}"`))
  }
  assert.match(page, /WINDOW_PRESETS/)
  assert.match(page, /name="window" value="custom"/)
})

test("engagement page filters readers by type", () => {
  const client = read("src/app/admin/engagement/engagement-client.tsx")
  assert.match(client, /function ReaderTypeFilter/)
  assert.match(client, /complimentary_review/)
})

test("engagement page links to subscriber detail", () => {
  const page = read("src/app/admin/engagement/page.tsx")
  // The Readers tab links a reader who holds a subscriber record; a
  // Complimentary Review reader has none and is correctly not linked.
  assert.match(page, /\/admin\/engagement\/\$\{r\.subscriberId\}/)
  assert.match(page, /r\.subscriberId \? \(/)
})

test("engagement page shows subscriber-only metrics, no briefing", () => {
  const page = read("src/app/admin/engagement/page.tsx")
  assert.match(page, /Active subscribers/)
  assert.doesNotMatch(page, /Active briefing clients/)
  assert.doesNotMatch(page, />Briefing</)
})

// ---------------------------------------------------------------------------
// 5. Subscriber detail page
// ---------------------------------------------------------------------------

test("subscriber engagement detail page awaits params and validates UUID", () => {
  const page = read("src/app/admin/engagement/[id]/page.tsx")
  assert.match(page, /const \{ id \} = await params/)
  assert.match(page, /UUID\.test\(id\)/)
  assert.match(page, /notFound\(\)/)
  assert.match(page, /getSubscriberForEngagement/)
  assert.match(page, /getSubscriberTimeline/)
})

test("subscriber detail shows activity timeline table", () => {
  const page = read("src/app/admin/engagement/[id]/page.tsx")
  assert.match(page, /Activity timeline/)
  assert.match(page, /EVENT_LABELS/)
  assert.match(page, /signin_completed/)
  assert.match(page, /publication_notification_sent/)
  assert.match(page, /Back to engagement/)
})

// ---------------------------------------------------------------------------
// 6. Publication notification service — baseline and dedup guards
// ---------------------------------------------------------------------------

test("follow-up migration adds notification_eligible and baselines existing rows", () => {
  const migration = read("db/migrations/20260829_notification_safety_baseline.sql")
  assert.match(migration, /add column notification_eligible boolean not null default true/)
  assert.match(migration, /update papermark_dataroom_documents set notification_eligible = false/)
})

test("follow-up migration is idempotent via column-existence check", () => {
  const migration = read("db/migrations/20260829_notification_safety_baseline.sql")
  assert.match(migration, /select exists/)
  assert.match(migration, /information_schema\.columns/)
  assert.match(migration, /if not col_exists then/)
  assert.doesNotMatch(migration, /drop table|drop column|truncate/i)
})

test("notification query requires notification_eligible = true", () => {
  const service = read("src/lib/dataroom-notifications.ts")
  assert.match(service, /notification_eligible = true/)
})

test("notification query has a time window (first_seen_at within 1 hour)", () => {
  const service = read("src/lib/dataroom-notifications.ts")
  assert.match(service, /first_seen_at > now\(\) - interval '1 hour'/)
})

test("notification query has no broken document-level not-exists filter", () => {
  const service = read("src/lib/dataroom-notifications.ts")
  assert.doesNotMatch(service, /not exists\s*\(\s*select 1 from papermark_document_notifications/)
})

test("insert-before-send: notification record is claimed before email", () => {
  const service = read("src/lib/dataroom-notifications.ts")
  const claimedPos = service.indexOf("returning id")
  const sendPos = service.indexOf("await sendEditionAlert")
  assert.ok(claimedPos > 0, "returning id not found")
  assert.ok(sendPos > 0, "sendEditionAlert not found")
  assert.ok(claimedPos < sendPos, "notification record must be inserted before email is sent")
  assert.match(service, /claimed\.length === 0/)
})

test("notification dedup uses the unique index on (subscriber, document, version)", () => {
  const service = read("src/lib/dataroom-notifications.ts")
  assert.match(service, /on conflict \(subscriber_id, dataroom_document_id, version_key\)/)
  assert.match(service, /do nothing/)
})

test("notification service checks level-room mapping", () => {
  const service = read("src/lib/dataroom-notifications.ts")
  assert.match(service, /papermark_level_rooms/)
  assert.match(service, /public_tier/)
  assert.match(service, /papermark_dataroom_override/)
})

test("reconciliation sweeps all mapped rooms", () => {
  const service = read("src/lib/dataroom-notifications.ts")
  assert.match(service, /reconcileAllDataRooms/)
  assert.match(service, /select papermark_dataroom_id from papermark_level_rooms/)
})

// ---------------------------------------------------------------------------
// 7. Papermark webhook triggers notifications on document.created
// ---------------------------------------------------------------------------

test("Papermark webhook triggers notification pipeline on document.created", () => {
  const route = read("src/app/api/papermark/webhook/route.ts")
  assert.match(route, /notifyNewDataRoomDocuments/)
  assert.match(route, /import.*dataroom-notifications/)
  assert.match(route, /\/created\/i\.test\(eventType\)/)
})

// ---------------------------------------------------------------------------
// 8. Resend webhook tracks notification emails
// ---------------------------------------------------------------------------

test("principalForResendEmail finds both signin and notification emails", () => {
  const dal = read("src/lib/client-engagement.ts")
  assert.match(dal, /signin_email_sent.*publication_notification_sent|publication_notification_sent.*signin_email_sent/)
})

// ---------------------------------------------------------------------------
// 9. Cron reconciliation route
// ---------------------------------------------------------------------------

test("dataroom-sync cron is protected by CRON_SECRET", () => {
  const route = read("src/app/api/cron/dataroom-sync/route.ts")
  assert.match(route, /CRON_SECRET/)
  assert.match(route, /status: 401/)
  assert.match(route, /timingSafeEqual/)
  assert.match(route, /reconcileAllDataRooms/)
})

test("vercel.json schedules dataroom-sync daily at 04:00 UTC", () => {
  const config = JSON.parse(read("vercel.json"))
  const sync = config.crons.find((c) => c.path === "/api/cron/dataroom-sync")
  assert.ok(sync, "dataroom-sync cron entry missing")
  assert.equal(sync.schedule, "0 4 * * *")
})

// ---------------------------------------------------------------------------
// 10. Security: no secrets in client code
// ---------------------------------------------------------------------------

test("engagement pages do not expose credentials", () => {
  for (const path of [
    "src/app/admin/engagement/page.tsx",
    "src/app/admin/engagement/[id]/page.tsx",
    "src/components/AdminSidebar.tsx",
  ]) {
    const source = read(path)
    assert.doesNotMatch(source, /PAPERMARK_API_TOKEN|PAPERMARK_WEBHOOK_SECRET|RESEND_API_KEY|CRON_SECRET/)
  }
})

test("notification service is server-only", () => {
  const service = read("src/lib/dataroom-notifications.ts")
  assert.match(service, /^import "server-only"/m)
})

// ---------------------------------------------------------------------------
// 11. Download webhook: link.downloaded event handling
// ---------------------------------------------------------------------------

test("webhook handler dispatches link.downloaded events", () => {
  const route = read("src/app/api/papermark/webhook/route.ts")
  assert.match(route, /link\.downloaded/i)
  assert.match(route, /handleDownloadEvent/)
})

test("download handler resolves links through the canonical resolver", () => {
  // Phase 6 moved resolution out of the route so the webhook and the poll
  // cannot disagree. The resolver covers four link tables, adding the
  // Complimentary Review slot link the route never checked.
  const route = read("src/app/api/papermark/webhook/route.ts")
  assert.match(route, /attribute/)
  assert.match(route, /from '@\/lib\/view-attribution'/)
  assert.doesNotMatch(route, /async function resolveLink/)

  const resolver = read("src/lib/view-attribution.ts")
  const order = [
    "papermark_subscriber_document_links",
    "papermark_dataroom_links",
    "complimentary_review_items",
    "publication_access",
  ]
  let last = -1
  for (const table of order) {
    const at = resolver.indexOf(table)
    assert.ok(at > last, `${table} must be checked in order`)
    last = at
  }
})

test("download handler still records the subscriber engagement event", () => {
  const route = read("src/app/api/papermark/webhook/route.ts")
  assert.match(route, /insert into client_engagement_events/)
  assert.match(route, /'document_downloaded'/)
  assert.match(route, /papermarkDocumentId/)
})

test("download handler records one row per confirmed download", () => {
  // A boolean on the view cannot represent a reader downloading four times,
  // which is why document_download_events exists.
  const route = read("src/app/api/papermark/webhook/route.ts")
  assert.match(route, /recordDownload/)
  const resolver = read("src/lib/view-attribution.ts")
  assert.match(resolver, /insert into document_download_events/)
})

test("download handler marks the view as downloaded in document_views", () => {
  // Now performed inside recordDownload, so the poll does it identically.
  const resolver = read("src/lib/view-attribution.ts")
  assert.match(resolver, /update document_views set downloaded = true/)
  assert.match(resolver, /if \(input\.papermarkViewId\)/)
})

test("download handler is idempotent on the source event id", () => {
  const resolver = read("src/lib/view-attribution.ts")
  assert.match(resolver, /on conflict \(source_event_id\) do update set/)
  const route = read("src/app/api/papermark/webhook/route.ts")
  // The view id keys it when present, else the webhook event id.
  assert.match(route, /viewId \? `view:\$\{viewId\}` : eventId \? `event:\$\{eventId\}` : null/)
  assert.match(route, /on conflict \(webhook_event_id\)/)
})

test("download handler prefers link ids over the viewer email", () => {
  // The email is passed to the resolver but is only its last resort, after
  // four link tables, and only for a shared or open document.
  const resolver = read("src/lib/view-attribution.ts")
  const emailAt = resolver.indexOf("lower(s.email)")
  for (const table of [
    "papermark_subscriber_document_links",
    "papermark_dataroom_links",
    "complimentary_review_items",
    "publication_access",
  ]) {
    assert.ok(resolver.indexOf(table) < emailAt, `${table} must be tried before the email`)
  }
  assert.match(resolver, /is_shared_copy = true or d\.visibility = 'OPEN'/)
})

test("download handler retains an unattributable download", () => {
  // Phase 6 keeps the row rather than returning early, so an unmatched
  // download is visible in the diagnostics instead of silently lost.
  const route = read("src/app/api/papermark/webhook/route.ts")
  assert.doesNotMatch(route, /if \(!resolved\) return/)
  const resolver = read("src/lib/view-attribution.ts")
  assert.match(resolver, /reader_type\b/)
  assert.match(resolver, /'unknown'/)
})

// ---------------------------------------------------------------------------
// 10. Security: no secrets in client code
// ---------------------------------------------------------------------------

test("engagement pages do not expose credentials", () => {
  for (const path of [
    "src/app/admin/engagement/page.tsx",
    "src/app/admin/engagement/[id]/page.tsx",
    "src/components/AdminSidebar.tsx",
  ]) {
    const source = read(path)
    assert.doesNotMatch(source, /PAPERMARK_API_TOKEN|PAPERMARK_WEBHOOK_SECRET|RESEND_API_KEY|CRON_SECRET/)
  }
})

test("notification service is server-only", () => {
  const service = read("src/lib/dataroom-notifications.ts")
  assert.match(service, /^import "server-only"/m)
})

// ---------------------------------------------------------------------------
// 11. Download webhook: link.downloaded event handling
// ---------------------------------------------------------------------------

test("webhook handler dispatches link.downloaded events", () => {
  const route = read("src/app/api/papermark/webhook/route.ts")
  assert.match(route, /link\.downloaded/i)
  assert.match(route, /handleDownloadEvent/)
})

test("download handler resolves links through the canonical resolver", () => {
  // Phase 6 moved resolution out of the route so the webhook and the poll
  // cannot disagree. The resolver covers four link tables, adding the
  // Complimentary Review slot link the route never checked.
  const route = read("src/app/api/papermark/webhook/route.ts")
  assert.match(route, /attribute/)
  assert.match(route, /from '@\/lib\/view-attribution'/)
  assert.doesNotMatch(route, /async function resolveLink/)

  const resolver = read("src/lib/view-attribution.ts")
  const order = [
    "papermark_subscriber_document_links",
    "papermark_dataroom_links",
    "complimentary_review_items",
    "publication_access",
  ]
  let last = -1
  for (const table of order) {
    const at = resolver.indexOf(table)
    assert.ok(at > last, `${table} must be checked in order`)
    last = at
  }
})

test("webhook signature verification uses timingSafeEqual", () => {
  const route = read("src/app/api/papermark/webhook/route.ts")
  assert.match(route, /timingSafeEqual/)
  assert.match(route, /createHmac\('sha256'/)
  assert.match(route, /status: 401/)
})

test("existing view and document events are preserved alongside download handler", () => {
  const route = read("src/app/api/papermark/webhook/route.ts")
  assert.match(route, /handleViewEvents/)
  assert.match(route, /handleDocumentEvent/)
  assert.match(route, /handleLinkEvent/)
  assert.match(route, /handleDownloadEvent/)
})

// ---------------------------------------------------------------------------
// 12. Download dedup: portal no longer records a duplicate click event
// ---------------------------------------------------------------------------

test("portal download route does not record a separate engagement event", () => {
  const route = read("src/app/portal/document/[id]/download/route.ts")
  assert.doesNotMatch(route, /recordClientEvent/)
  assert.doesNotMatch(route, /document_downloaded/)
})

// ---------------------------------------------------------------------------
// 13. Admin engagement timeline shows document context from metadata
// ---------------------------------------------------------------------------

test("subscriber timeline query returns metadata column", () => {
  const dal = read("src/lib/client-engagement.ts")
  const timelineFn = dal.slice(dal.indexOf("getSubscriberTimeline"))
  assert.match(timelineFn, /select.*metadata/)
  assert.match(dal, /metadata: /)
})

test("engagement detail page shows document title from metadata", () => {
  const page = read("src/app/admin/engagement/[id]/page.tsx")
  assert.match(page, /documentTitle/)
  assert.match(page, /detailText/)
  assert.match(page, /entry\.metadata/)
})
