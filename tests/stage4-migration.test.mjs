import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createSchemaDatabase,applyMigration } from "./support/test-database.mjs"
const migration="20261115_stage4_operations_security.sql"
const rollback=readFileSync(new URL("../db/rollback/20261115_stage4_operations_security.rollback.sql",import.meta.url),"utf8")
test("Stage 4 upgrade/reruns preserve customers, default to no emails/deletion and rollback refuses used security/evidence",async()=>{
  const db=await createSchemaDatabase()
  try{
    await db.exec(rollback)
    await db.exec(rollback)
    const [admin]=(await db.query("insert into admins(email,name,password_hash,role) values('migration-owner@example.invalid','Owner','not-a-real-hash','owner') returning id")).rows
    const [seat]=(await db.query("insert into subscribers(email,status,level,public_tier) values('migration-reader@example.invalid','active','L1','Individual Access') returning id")).rows
    const before=(await db.query("select row_to_json(s)::text as value from subscribers s where id=$1",[seat.id])).rows[0].value
    await applyMigration(db,migration);await applyMigration(db,migration)
    assert.equal((await db.query("select row_to_json(s)::text as value from subscribers s where id=$1",[seat.id])).rows[0].value,before)
    assert.equal((await db.query("select require_mfa from admin_security_policy")).rows[0].require_mfa,false)
    assert.equal((await db.query("select alerts_email_enabled from operations_settings")).rows[0].alerts_email_enabled,false)
    assert.equal((await db.query("select count(*)::int as n from privacy_retention_policies")).rows[0].n,0)
    await db.query("insert into admin_security(admin_id,session_version) values($1,1)",[admin.id])
    await assert.rejects(db.exec(rollback),/Refusing Stage 4 rollback/);await db.exec("rollback")
    assert.equal((await db.query("select session_version::int as n from admin_security")).rows[0].n,1)
    await db.query("delete from admin_security")
    await db.query("insert into email_delivery_inbox(event_id,provider_message_id,event_type,occurred_at) values('example-event','example-message','email.delivered',now())")
    await assert.rejects(db.exec(rollback),/Refusing Stage 4 rollback/);await db.exec("rollback")
    await db.query("delete from email_delivery_inbox")
    await db.query("update operations_settings set updated_by=$1 where singleton=true",[admin.id])
    await assert.rejects(db.exec(rollback),/operational settings/);await db.exec("rollback")
    await db.query("update operations_settings set updated_by=null where singleton=true")
    await db.exec(rollback);await db.exec(rollback)
    assert.equal((await db.query("select to_regclass('public.admin_security') as name")).rows[0].name,null)
    assert.equal((await db.query("select row_to_json(s)::text as value from subscribers s where id=$1",[seat.id])).rows[0].value,before)
  }finally{await db.close()}
})
