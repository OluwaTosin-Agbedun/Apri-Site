/**
 * The title-override migration against the isolated test database: it applies
 * from a fresh schema, every publication starts with the flag off, and the
 * lookup the portal makes returns only publications explicitly marked.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { sql } from "./helpers.mjs"

test("portal_title_override exists, defaults off and is found only when set", async () => {
  const [column] = await sql`
    select data_type, is_nullable, column_default
    from information_schema.columns
    where table_name = 'documents' and column_name = 'portal_title_override'
  `
  assert.ok(column, "the migration has been applied by the test database loader")
  assert.equal(column.data_type, "boolean")
  assert.equal(column.is_nullable, "NO")
  assert.equal(column.column_default, "false")

  const [kept] = await sql`
    insert into documents (slug, title) values ('override-kept', 'Osun Governorship Briefing') returning id
  `
  const [followed] = await sql`
    insert into documents (slug, title) values ('override-follows', 'Athena Intelligence Update 001 2026 Osun 3') returning id
  `
  const fresh = await sql`select portal_title_override from documents where id = any(${[kept.id, followed.id]}::uuid[])`
  assert.deepEqual(fresh.map((r) => r.portal_title_override), [false, false], "nothing is an override until marked")

  await sql`update documents set portal_title_override = true where id = ${kept.id}`
  const rows = await sql`
    select id from documents
    where portal_title_override = true and id = any(${[kept.id, followed.id]}::uuid[])
  `
  assert.deepEqual(rows.map((r) => r.id), [kept.id])

  await sql`delete from documents where id = any(${[kept.id, followed.id]}::uuid[])`
})
