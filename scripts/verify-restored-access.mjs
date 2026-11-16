#!/usr/bin/env node
/** Read-only comparison of frozen source/restored branches. Never prints rows. */
import { neon } from "@neondatabase/serverless"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"

export const TABLES=["admins","app_settings","documents","subscribers","subscriber_subscription_periods","subscriber_publication_exceptions",
  "publication_plans","review_publication_editions","review_edition_recipients","review_reader_rooms",
  "papermark_subscriber_document_links","admin_security","admin_security_policy","auth_tokens","subscriber_sessions",
  "review_reader_sessions","review_reader_tokens","admin_auth_challenges","review_subscription_requests","review_prospects"]

export async function accessSnapshot(sql) {
  const inventory=await sql.query("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")
  const found=new Set(inventory.map(r=>r.table_name))
  const missing=TABLES.filter(t=>!found.has(t))
  if(missing.length)throw new Error("Required access tables are missing")
  // All table names come from the fixed list. Hashes/counts are integrity
  // comparisons, not authentication. No row content or digest is printed.
  const results=await sql.transaction([sql`set local statement_timeout='15s'`,sql`set local timezone='UTC'`,...TABLES.map(table=>sql.query(`select count(*)::text as count,
    md5(coalesce(string_agg(row_hash,'' order by row_hash),'')) as fingerprint from
    (select md5(to_jsonb(t)::text) as row_hash from ${table} t) r`))],{readOnly:true,isolationLevel:"RepeatableRead"})
  return Object.fromEntries(TABLES.map((table,i)=>[table,results[i+2][0]]))
}
export function compareSnapshots(source,restored) {
  return TABLES.map(table=>({table,sourceCount:source[table]?.count??null,restoredCount:restored[table]?.count??null,
    matches:Boolean(source[table]&&restored[table]&&source[table].count===restored[table].count&&source[table].fingerprint===restored[table].fingerprint)}))
}
async function main() {
  const source=process.env.RECOVERY_SOURCE_DATABASE_URL;const restored=process.env.RECOVERY_RESTORED_DATABASE_URL
  if(!source||!restored)throw new Error("Set RECOVERY_SOURCE_DATABASE_URL and RECOVERY_RESTORED_DATABASE_URL with read-only credentials")
  if(source===restored)throw new Error("Source and restored database must be different frozen branches")
  const [a,b]=await Promise.all([accessSnapshot(neon(source)),accessSnapshot(neon(restored))])
  const results=compareSnapshots(a,b)
  for(const row of results)console.log(`${row.matches?"MATCH":"MISMATCH"} ${row.table}: source ${row.sourceCount}, restored ${row.restoredCount}`)
  console.log("Database records only. This does not prove Papermark permissions, email, PDF files or recovery time. Keep restored sends/workers disabled.")
  if(results.some(r=>!r.matches))process.exitCode=1
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{
  // A driver error can contain connection strings or source values.
  console.error("Recovery comparison failed. Check the two read-only connections and required schema privately; no database details were logged.")
  process.exitCode=1
})
