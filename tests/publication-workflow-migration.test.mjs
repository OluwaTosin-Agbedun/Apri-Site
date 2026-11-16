import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createSchemaDatabase,applyMigration} from './support/test-database.mjs'
const migration='20261115_stage3_publishing_workflow.sql'
const rollback=readFileSync(new URL('../db/rollback/20261115_stage3_publishing_workflow.rollback.sql',import.meta.url),'utf8')
test('workflow upgrade is additive and idempotent, changes no customer or release, and used history cannot be rolled back destructively',async()=>{
  const db=await createSchemaDatabase()
  try{
    await db.exec(rollback);await db.exec(rollback)
    const [seat]=(await db.query("insert into subscribers(email,status,level,term_start,term_end) values('workflow-migration@example.invalid','active','L1','2026-01-01','2099-12-31') returning id")).rows
    const [pub]=(await db.query("insert into documents(slug,title,status,is_published,paid_release_state) values('workflow-migration','Existing edition','draft',false,'released') returning id")).rows
    const before=(await db.query('select row_to_json(s)::text as value from subscribers s where id=$1',[seat.id])).rows[0].value
    await applyMigration(db,migration);await applyMigration(db,migration)
    assert.equal((await db.query('select row_to_json(s)::text as value from subscribers s where id=$1',[seat.id])).rows[0].value,before)
    assert.equal((await db.query('select count(*)::int as n from publication_workflows')).rows[0].n,0)
    assert.equal((await db.query('select paid_release_state from documents where id=$1',[pub.id])).rows[0].paid_release_state,'released')
    await db.query('insert into publication_workflows(document_id) values($1)',[pub.id])
    await assert.rejects(db.exec(rollback),/Retain its immutable history/);await db.exec('rollback')
    assert.equal((await db.query('select count(*)::int as n from publication_workflows')).rows[0].n,1)
  }finally{await db.close()}
})
test('fresh schema carries the exact Stage 3 migration',()=>{
  const schema=readFileSync(new URL('../db/schema.sql',import.meta.url),'utf8').split('-- Stage 3: editorial review and version history\n')[1]
  assert.equal(schema.trim(),readFileSync(new URL('../db/migrations/'+migration,import.meta.url),'utf8').trim())
})
