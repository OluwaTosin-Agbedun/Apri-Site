import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import {
  papermarkEmbedUrl,
  subscriberLibraryEmbedUrl,
} from "../src/lib/papermark-embed.ts"
import { seatsForSubscriptionRequest } from "../src/lib/entitlements.ts"
import { portalVerificationUrl } from "../src/lib/app-url.ts"

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("subscriber activation requires level, term and a unique library link", () => {
  const source = read("src/app/actions/subscribers.ts")
  assert.match(source, /isLevel\(row\.level\)/)
  assert.match(source, /!row\.term_end/)
  assert.match(source, /!row\.library_link_url/)
  assert.match(source, /issueToken\(id\)/)
  assert.match(source, /already assigned to another client/)
})

test("subscriber deletion is admin-gated and cannot delete briefing clients", () => {
  const source = read("src/app/actions/subscribers.ts")
  assert.match(source, /export async function deleteSubscriber/)
  assert.match(source, /await requireAdmin\(\)/)
  assert.match(source, /delete from subscribers/)
  assert.match(source, /client_type = 'subscriber'/)
  assert.match(source, /lower\(email\).*confirmationEmail/)
  const controls = read("src/app/admin/subscribers/seat-actions.tsx")
  assert.match(controls, /window\.prompt/)
  assert.match(controls, /confirmation !== email/)
})

test("Individual Access needs no seat field and always stores one seat", () => {
  assert.equal(seatsForSubscriptionRequest("Individual Access", null), 1)
  assert.equal(seatsForSubscriptionRequest("Individual Access", "99"), 1)
})

test("multi-seat access requires and preserves a valid seat count", () => {
  assert.equal(seatsForSubscriptionRequest("Professional Team Access", null), null)
  assert.equal(seatsForSubscriptionRequest("Professional Team Access", "8"), 8)
})

test("subscriber form orders access level before conditional seats and resets Individual", () => {
  const source = read("src/app/access-form.tsx")
  assert.ok(source.indexOf("Subscription access level") < source.indexOf("How many people need access?"))
  assert.match(source, /subscriptionLevel !== 'Individual Access'/)
  assert.match(source, /if \(value === 'Individual Access' \|\| !value\) setSeats\(''\)/)
})

test("portal emails use only the APRI production callback", () => {
  const url = portalVerificationUrl("safe-test-token")
  assert.equal(url, "https://apri.athenacentre.org/portal/verify?token=safe-test-token")
  assert.doesNotMatch(url, /localhost|vercel\.app/)
})

test("briefing detail awaits params and queries briefing_requests with migration fallback", () => {
  const source = read("src/app/admin/briefings/[id]/page.tsx")
  assert.match(source, /const \{ id \} = await params/)
  assert.match(source, /from briefing_requests where id=\$\{id\}/)
  assert.doesNotMatch(source, /from subscribers/)
  assert.match(source, /information_schema\.columns/)
})

test("briefing activation and resend use briefing-only tokens", () => {
  const actions = read("src/app/actions/briefings.ts")
  const magic = read("src/lib/magic-link.ts")
  assert.match(actions, /update briefing_requests set status='Active'/)
  assert.match(actions, /issueBriefingToken\(id\)/)
  assert.match(actions, /resendBriefingSignInLink/)
  assert.match(magic, /createSubscriberSession\(principal\.id, "briefing"\)/)
  assert.match(magic, /consumed_at is null and expires_at>now\(\)/)
})

test("Papermark sync is pinned to 07 Open Editions and creates private-safe OPEN drafts", () => {
  const source = read("src/app/api/admin/papermark/sync/route.ts")
  assert.match(source, /PAPERMARK_OPEN_EDITIONS_FOLDER_ID/)
  assert.match(source, /listDocumentsInFolder\(folderId\)/)
  assert.match(source, /'draft', false, 'OPEN'/)
})

test("briefings remain separate principals with their own link and token", () => {
  const schema = read("db/schema.sql")
  const action = read("src/app/actions/briefings.ts")
  assert.match(
    schema,
    /briefing_requests add column if not exists private_link_url/,
  )
  assert.match(schema, /briefing_request_id uuid/)
  assert.match(action, /issueBriefingToken\(id\)/)
  assert.doesNotMatch(action, /insert into subscribers/i)
  assert.match(action, /already assigned to another client/)
  assert.doesNotMatch(schema, /subscribers_private_library_link_key/)
})

test("both public request types send requester and manager messages", () => {
  const source = read("src/app/actions/public.ts")
  assert.match(source, /sendAccessRequestConfirmation/)
  assert.match(source, /sendAccessRequestNotification/)
  assert.match(source, /sendBriefingConfirmation/)
  assert.match(source, /sendBriefingNotification/)
})

const active = {
  authenticatedSubscriberId: "subscriber-a",
  subscriberId: "subscriber-a",
  status: "active",
  termEnd: "2030-12-31",
  libraryLinkUrl: "https://www.papermark.com/view/private-a",
  now: new Date("2030-01-01T12:00:00Z"),
}

test("an active subscriber receives their embedded private library URL", () => {
  assert.equal(
    subscriberLibraryEmbedUrl(active),
    "https://www.papermark.com/view/private-a?embed=1",
  )
})

test("unauthenticated, inactive and expired subscribers cannot render a library", () => {
  assert.equal(subscriberLibraryEmbedUrl({ ...active, authenticatedSubscriberId: null }), null)
  assert.equal(subscriberLibraryEmbedUrl({ ...active, status: "pending" }), null)
  assert.equal(
    subscriberLibraryEmbedUrl({ ...active, termEnd: "2029-12-31" }),
    null,
  )
})

test("a subscriber cannot render another subscriber's private library", () => {
  assert.equal(
    subscriberLibraryEmbedUrl({ ...active, authenticatedSubscriberId: "subscriber-b" }),
    null,
  )
})

test("unsafe, unrelated and Masters URLs are rejected", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,bad",
    "not a url",
    "https://example.com/view/private-a",
    "https://evil.papermark.com/view/private-a",
    "https://www.papermark.com/00-masters/private-a",
  ]) {
    assert.equal(papermarkEmbedUrl(url), null, url)
  }
})

test("configured HTTPS Papermark custom domains are allowed without a shared fallback", () => {
  assert.equal(
    papermarkEmbedUrl(
      "https://library.apri.example/client/private-a?email=required",
      "library.apri.example",
    ),
    "https://library.apri.example/client/private-a?email=required&embed=1",
  )
  assert.equal(subscriberLibraryEmbedUrl({ ...active, libraryLinkUrl: null }), null)
})
