import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(
  new URL("../db/migrations/20260826_briefing_portal.sql", import.meta.url),
  "utf8",
)

test("briefing migration is rerunnable and contains no destructive data statements", () => {
  assert.match(migration, /add column if not exists private_link_url/)
  assert.match(migration, /add column if not exists briefing_request_id/)
  assert.match(migration, /create index if not exists auth_tokens_briefing_idx/)
  assert.doesNotMatch(migration, /\b(delete|truncate)\s+from\b/i)
  assert.doesNotMatch(migration, /drop\s+(table|column)\b/i)
})

test("briefing migration repairs and validates both token constraints", () => {
  assert.match(migration, /drop constraint if exists auth_tokens_briefing_request_id_fkey/)
  assert.match(migration, /foreign key \(briefing_request_id\)[\s\S]*on delete cascade not valid/)
  assert.match(migration, /validate constraint auth_tokens_briefing_request_id_fkey/)
  assert.match(migration, /drop constraint if exists auth_tokens_one_principal_check/)
  assert.match(migration, /validate constraint auth_tokens_one_principal_check/)
})
