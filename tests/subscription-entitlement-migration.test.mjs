import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import {createSchemaDatabase,applyMigration} from "./support/test-database.mjs"

const migration=fs.readFileSync("db/migrations/20261003_subscription_edition_entitlements.sql","utf8")
test("edition entitlement migration is additive and rerunnable",()=>{assert.doesNotMatch(migration,/^\s*(drop|truncate|delete\s+from)\b/im);assert.equal((migration.match(/create table if not exists/g)||[]).length,3);assert.match(migration,/on conflict do nothing/)})
test("backfill trusts only complete agreed dates and known levels",()=>{assert.match(migration,/term_start is not null and term_end is not null/);assert.match(migration,/level in \('L1','L2','L3','L4'\)/);assert.doesNotMatch(migration,/created_at.*starts_on|payment.*starts_on/i)})
test("exceptions are per subscriber and publication with accountable reasons",()=>{assert.match(migration,/primary key \(subscriber_id, publication_id\)/);assert.match(migration,/administrator_id uuid not null/);assert.match(migration,/length\(trim\(reason\)\) > 0/)})
test("migration reruns on a fresh schema and backfills only the complete existing term",async()=>{
  const db=await createSchemaDatabase()
  try{
    await db.query(`insert into subscribers(id,name,email,client_type,public_tier,level,seats,term_start,term_end,status) values
      ('11111111-1111-4111-8111-111111111111','Complete','complete@migration.test','subscriber','Professional Team Access','L1',7,'2026-01-01','2026-12-31','active'),
      ('22222222-2222-4222-8222-222222222222','Unknown','unknown@migration.test','subscriber','Professional Team Access','L1',8,null,'2026-12-31','active')`)
    await applyMigration(db,"20261003_subscription_edition_entitlements.sql")
    await applyMigration(db,"20261003_subscription_edition_entitlements.sql")
    const {rows}=await db.query(`select subscriber_id,starts_on,ends_on from subscriber_subscription_periods order by subscriber_id`)
    assert.equal(rows.length,1);assert.equal(rows[0].subscriber_id,"11111111-1111-4111-8111-111111111111")
    const legacy=(await db.query(`select seats from subscribers order by id`)).rows
    assert.deepEqual(legacy.map((r)=>r.seats),[7,8],"legacy Professional seats are not reduced")
  }finally{await db.close()}
})
