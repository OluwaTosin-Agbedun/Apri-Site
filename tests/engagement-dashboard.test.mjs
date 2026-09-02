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

test("engagement DAL exports all 14 summary metrics", () => {
  const dal = read("src/lib/client-engagement.ts")
  for (const metric of [
    "activeSubscribers", "signedIn30d", "neverSignedIn",
    "portalVisitors30d", "portalOpens", "viewClicks",
    "papermarkViews", "downloadClicks", "papermarkDownloads",
    "emailsSent", "emailsDelivered", "emailsOpened",
    "emailsClicked", "emailFailures",
  ]) {
    assert.match(dal, new RegExp(metric))
  }
})

test("engagement DAL queries document_views for Papermark-confirmed counts", () => {
  const dal = read("src/lib/client-engagement.ts")
  assert.match(dal, /from document_views/)
  assert.match(dal, /downloaded=true/)
})

test("subscriber engagement rows include level, docs and email metrics", () => {
  const dal = read("src/lib/client-engagement.ts")
  assert.match(dal, /public_tier/)
  assert.match(dal, /docs_viewed/)
  assert.match(dal, /docs_downloaded/)
  assert.match(dal, /emails_sent/)
  assert.match(dal, /email_failures/)
})

test("subscriber timeline returns events ordered by time", () => {
  const dal = read("src/lib/client-engagement.ts")
  assert.match(dal, /getSubscriberTimeline/)
  assert.match(dal, /order by occurred_at desc/)
  assert.match(dal, /limit 200/)
})

test("subscriber detail lookup is scoped to subscriber client_type", () => {
  const dal = read("src/lib/client-engagement.ts")
  assert.match(dal, /getSubscriberForEngagement/)
  assert.match(dal, /client_type='subscriber'/)
})

// ---------------------------------------------------------------------------
// 4. Engagement page has summary cards and subscriber table
// ---------------------------------------------------------------------------

test("engagement page shows 14 summary cards", () => {
  const page = read("src/app/admin/engagement/page.tsx")
  for (const label of [
    "Active subscribers", "Signed in (30d)", "Never signed in",
    "Portal visitors (30d)", "Portal opens", "APRI view clicks",
    "Papermark views", "APRI download clicks", "Papermark downloads",
    "Emails sent", "Emails delivered", "Emails opened",
    "Emails clicked", "Failures",
  ]) {
    assert.match(page, new RegExp(label.replace(/[()]/g, "\\$&")))
  }
})

test("engagement page has all required filters", () => {
  const page = read("src/app/admin/engagement/page.tsx")
  assert.match(page, /name="q"/)
  assert.match(page, /name="level"/)
  assert.match(page, /name="status"/)
  assert.match(page, /name="never"/)
  assert.match(page, /name="failure"/)
  assert.match(page, /name="viewed"/)
  assert.match(page, /name="from"/)
  assert.match(page, /name="to"/)
})

test("engagement page links to subscriber detail", () => {
  const page = read("src/app/admin/engagement/page.tsx")
  assert.match(page, /\/admin\/engagement\/\$\{r\.id\}/)
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

test("download handler resolves links across all three link tables", () => {
  const route = read("src/app/api/papermark/webhook/route.ts")
  assert.match(route, /papermark_subscriber_document_links/)
  assert.match(route, /papermark_dataroom_links/)
  assert.match(route, /publication_access/)
  const subDocPos = route.indexOf("papermark_subscriber_document_links")
  const drPos = route.indexOf("papermark_dataroom_links", subDocPos + 1)
  const pubPos = route.indexOf("publication_access", drPos + 1)
  assert.ok(subDocPos > 0 && drPos > subDocPos && pubPos > drPos,
    "Link tables must be checked in order: subscriber_document_links → dataroom_links → publication_access")
})

test("download handler stores document metadata in engagement event", () => {
  const route = read("src/app/api/papermark/webhook/route.ts")
  assert.match(route, /documentTitle/)
  assert.match(route, /papermarkDocumentId/)
  assert.match(route, /papermarkLinkId/)
  assert.match(route, /metadata.*::jsonb/)
})

test("download handler marks the view as downloaded in document_views", () => {
  const route = read("src/app/api/papermark/webhook/route.ts")
  assert.match(route, /update document_views set downloaded = true/)
  assert.match(route, /papermark_view_id/)
})

test("download handler uses idempotency via webhook event ID", () => {
  const route = read("src/app/api/papermark/webhook/route.ts")
  assert.match(route, /checkIdempotency\(eventId\)/)
  assert.match(route, /markProcessed\(eventId, 'link\.downloaded'\)/)
  assert.match(route, /on conflict \(webhook_event_id\)/)
  assert.match(route, /dl-.*viewId/)
})

test("download handler does not trust email — resolves subscriber from link ID", () => {
  const route = read("src/app/api/papermark/webhook/route.ts")
  const dlStart = route.indexOf("function handleDownloadEvent")
  const dlEnd = route.indexOf("function resolveLink", dlStart)
  const downloadFn = route.slice(dlStart, dlEnd)
  assert.doesNotMatch(downloadFn, /viewerEmail|viewer_email/)
  assert.match(downloadFn, /resolveLink/)
  const resolveFn = route.slice(dlEnd, route.indexOf("function handleLinkEvent"))
  assert.match(resolveFn, /papermark_link_id = \$\{linkId\}/)
})

test("download handler returns early on unknown link (no subscriber, no briefing)", () => {
  const route = read("src/app/api/papermark/webhook/route.ts")
  const resolveFn = route.slice(route.indexOf("async function resolveLink"))
  assert.match(resolveFn, /return null/)
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
