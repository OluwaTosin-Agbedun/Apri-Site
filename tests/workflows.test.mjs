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
