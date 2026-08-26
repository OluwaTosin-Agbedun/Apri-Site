import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import {
  papermarkEmbedUrl,
  subscriberLibraryEmbedUrl,
} from "../src/lib/papermark-embed.ts"

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
