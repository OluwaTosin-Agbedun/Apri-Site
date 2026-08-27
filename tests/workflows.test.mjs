import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

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

test("subscriber admin exposes one access level and protects activation status", () => {
  const form = read("src/app/admin/subscribers/[id]/subscriber-form.tsx")
  const action = read("src/app/actions/subscribers.ts")
  assert.match(form, /Subscription access level/)
  assert.doesNotMatch(form, /Access level \(internal\)/)
  assert.doesNotMatch(form, /Tier \(as named publicly\)/)
  assert.doesNotMatch(form, /name="status"/)
  assert.match(action, /levelForPublicTier\(d\.publicTier\)/)
  assert.doesNotMatch(action, /formData\.get\("status"\)/)
})

test("Individual Access is one seat in both request and admin flows", () => {
  const publicForm = read("src/app/access-form.tsx")
  const publicAction = read("src/app/actions/public.ts")
  const adminForm = read("src/app/admin/subscribers/[id]/subscriber-form.tsx")
  assert.match(publicForm, /subscriptionLevel === "Individual Access"/)
  assert.match(publicForm, /name="seats" value="1"/)
  assert.match(
    publicAction,
    /subscriptionLevel === "Individual Access" \? 1 : requestedSeats/,
  )
  assert.match(adminForm, /readOnly=\{isIndividual\}/)
})

test("Papermark sync imports only the Open Editions folder as OPEN", () => {
  const client = read("src/lib/papermark.ts")
  const route = read("src/app/api/admin/papermark/sync/route.ts")
  assert.match(client, /listFolders/)
  assert.match(client, /query\.set\('folderId', folderId\)/)
  assert.match(route, /07 Open Editions/)
  assert.match(route, /listDocuments\(openFolder\.id\)/)
  assert.match(route, /visibility = 'OPEN'/)
})

test("APRI custom Papermark links are accepted and embeddable", () => {
  const embed = read("src/lib/papermark-embed.ts")
  const config = read("next.config.ts")
  const action = read("src/app/actions/subscribers.ts")
  assert.match(embed, /docs\.athenacentre\.org/)
  assert.match(config, /https:\/\/docs\.athenacentre\.org/)
  assert.match(action, /normaliseSecureLink/)
})

test("public publications index reads only published OPEN editions", () => {
  const library = read("src/lib/publications.ts")
  const page = read("src/app/publications/page.tsx")
  assert.match(library, /where is_published = true and visibility = 'OPEN'/)
  assert.match(page, /getOpenPublications/)
  assert.doesNotMatch(page, /getAllPublications/)
})

test("owner deletion removes APRI records without deleting Papermark data", () => {
  const subscribers = read("src/app/actions/subscribers.ts")
  const documents = read("src/app/actions/documents.ts")
  assert.match(subscribers, /deleteSubscriber/)
  assert.match(subscribers, /await requireOwner\(\)/)
  assert.match(subscribers, /delete from subscribers/)
  assert.match(documents, /deleteDocument/)
  assert.match(documents, /delete from documents/)
  assert.doesNotMatch(documents, /revokeLink/)
})

test("briefings remain separate principals with their own link and token", () => {
  const schema = read("db/schema.sql")
  const action = read("src/app/actions/briefings.ts")
  assert.match(schema, /briefing_requests add column if not exists private_link_url/)
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
