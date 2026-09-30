/**
 * Arranging review editions on the Publications page from Admin -> Review
 * Library. Invented data only.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { moveInOrder } from "../src/lib/review-order.ts"
import { createSchemaDatabase, applyMigration } from "./support/test-database.mjs"

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

describe("moving an edition", () => {
  it("swaps it with its neighbour, and never past either end", () => {
    assert.deepEqual(moveInOrder(["a", "b", "c"], "c", "up"), ["a", "c", "b"])
    assert.deepEqual(moveInOrder(["a", "b", "c"], "a", "down"), ["b", "a", "c"])
    assert.deepEqual(moveInOrder(["a", "b", "c"], "a", "up"), ["a", "b", "c"])
    assert.deepEqual(moveInOrder(["a", "b", "c"], "c", "down"), ["a", "b", "c"])
    assert.deepEqual(moveInOrder(["a", "b"], "x", "up"), ["a", "b"], "an unknown edition changes nothing")
  })
})

describe("the order readers see", () => {
  it("the Publications archive and the review library put an owner's order first, then the default", () => {
    const lib = read("src/lib/publications.ts")
    const clauses = lib.match(/order by case e\.series[^\n]*\s*\(to_jsonb\(e\) ->> 'display_position'\)::int asc nulls last,/g) ?? []
    assert.equal(clauses.length, 4, "archive (two) and review library (two) queries")
  })

  it("Admin lists editions in the same order, and only an owner can move one", () => {
    assert.match(read("src/app/admin/review-library/page.tsx"), /\(to_jsonb\(e\) ->> 'display_position'\)::int asc nulls last,\s*e\.is_latest desc, e\.edition_sort_key desc, e\.edition_date desc nulls last, e\.edition_order desc,/)
    const actions = read("src/app/actions/review-admin.ts")
    const fn = actions.slice(actions.indexOf("export async function moveReviewEdition"))
    assert.ok(fn.indexOf("await requireOwner()") < fn.indexOf("getSql()"), "authorised before any read")
    assert.match(fn, /publication_state = 'published'/)
  })

  it("the Publications page no longer carries the archive's old introduction line", () => {
    assert.doesNotMatch(read("src/app/publications/page.tsx"), /Current and earlier editions for authorised Review Library/)
  })

  it("the migration adds the position without changing any edition, and re-runs cleanly", async () => {
    const FILE = "20261006_review_edition_display_order.sql"
    const db = await createSchemaDatabase({ skipMigrations: [FILE] })
    await applyMigration(db, FILE)
    await applyMigration(db, FILE)
    const { rows } = await db.query(`select column_name, is_nullable from information_schema.columns where table_name = 'review_publication_editions' and column_name = 'display_position'`)
    assert.deepEqual(rows, [{ column_name: "display_position", is_nullable: "YES" }])
    await db.close()
  })
})
