import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8")

test("client-folder migration is additive, nullable, idempotent and principal scoped", async () => {
  const sql = await read("db/migrations/20260828_papermark_client_folders.sql")
  assert.match(sql, /subscribers add column if not exists papermark_folder_id text/)
  assert.match(sql, /briefing_requests add column if not exists papermark_folder_id text/)
  assert.match(sql, /create table if not exists papermark_client_documents/)
  assert.match(sql, /papermark_client_documents_one_principal/)
  assert.match(sql, /subscribers_active_papermark_folder_key/)
  assert.match(sql, /briefing_active_papermark_folder_key/)
  assert.doesNotMatch(sql, /drop table|drop column|truncate/i)
  assert.doesNotMatch(sql, /papermark_folder_id text not null/i)
})

test("folder discovery is server-only, rooted and excludes protected/cross-client folders", async () => {
  const papermark = await read("src/lib/papermark.ts")
  const actions = await read("src/app/actions/papermark-client-library.ts")
  assert.match(papermark, /import 'server-only'/)
  assert.match(papermark, /\/v1\/folders\?parent_id=/)
  assert.match(actions, /PAPERMARK_SUBSCRIBERS_FOLDER_ID/)
  assert.match(actions, /PAPERMARK_BRIEFINGS_FOLDER_ID/)
  assert.match(actions, /00 Masters/)
  assert.match(actions, /07 Open Editions/)
})

test("sync fetches the exact selected folder and reuses exact-email protected links", async () => {
  const papermark = await read("src/lib/papermark.ts")
  const actions = await read("src/app/actions/papermark-client-library.ts")
  assert.match(actions, /listDocumentsInFolder\(client\.papermark_folder_id\)/)
  assert.match(actions, /ensurePrivateDocumentLink/)
  assert.match(papermark, /allow\.length === 1/)
  assert.match(papermark, /allow\[0\]\?\.toLowerCase\(\) === args\.email\.toLowerCase\(\)/)
  assert.match(actions, /on conflict \(subscriber_id,papermark_document_id\)/)
  assert.match(actions, /on conflict \(briefing_request_id,papermark_document_id\)/)
})

test("portal documents are selected only by the authenticated principal id", async () => {
  const library = await read("src/lib/papermark-client-library.ts")
  assert.match(library, /where subscriber_id=\$\{principal\.id\}/)
  assert.match(library, /where briefing_request_id=\$\{principal\.id\}/)
  assert.doesNotMatch(library, /where email=/)
})
