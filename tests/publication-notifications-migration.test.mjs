import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import {
  createSchemaDatabase,
  applyMigration,
} from "./support/test-database.mjs"
const file = "20261115_stage5_publication_notifications.sql"
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
const rollback = read(`db/rollback/${file.replace(".sql", ".rollback.sql")}`)
test("publication notice schema is additive, repeatable and disabled on both fresh and upgraded databases", async () => {
  const db = await createSchemaDatabase()
  try {
    const [owner] = (
      await db.query(
        "insert into admins(email,name,password_hash,role) values('migration@example.invalid','Owner','x','owner') returning id",
      )
    ).rows
    const [pub] = (
      await db.query(
        "insert into documents(slug,title,series,visibility,status,paid_release_state) values('migration-alert','Existing title','MIN','L1','published','released') returning id",
      )
    ).rows
    const before = (
      await db.query("select to_jsonb(d) as row from documents d where id=$1", [
        pub.id,
      ])
    ).rows[0].row
    assert.equal(
      (await db.query("select enabled from publication_notice_settings"))
        .rows[0].enabled,
      false,
    )
    await db.exec(rollback)
    await db.exec(rollback)
    assert.equal(
      (
        await db.query(
          "select to_regclass('public.publication_notice_settings') as name",
        )
      ).rows[0].name,
      null,
    )
    await applyMigration(db, file)
    await applyMigration(db, file)
    assert.deepEqual(
      (
        await db.query(
          "select to_jsonb(d) as row from documents d where id=$1",
          [pub.id],
        )
      ).rows[0].row,
      before,
    )
    assert.equal(
      (
        await db.query(
          "select count(*)::int as n from publication_notice_events",
        )
      ).rows[0].n,
      0,
    )
    assert.equal(
      (
        await db.query(
          "select enabled,baseline_at from publication_notice_settings",
        )
      ).rows[0].enabled,
      false,
    )
    await db.query(
      "update publication_notice_settings set enabled=true,baseline_at=now(),approved_by=$1",
      [owner.id],
    )
    await assert.rejects(db.exec(rollback), /alerts have been used/)
    await db.exec("rollback")
    assert.equal(
      (await db.query("select enabled from publication_notice_settings"))
        .rows[0].enabled,
      true,
    )
  } finally {
    await db.close()
  }
})
test("the fresh schema contains the exact notification migration", () => {
  const schema = read("db/schema.sql").split(
    "-- Stage 5: publication notice outbox\n",
  )[1]?.split("-- Stage 3: editorial review and version history\n")[0]
  assert.equal(schema?.trim(), read(`db/migrations/${file}`).trim())
})
