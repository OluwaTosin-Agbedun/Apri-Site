import "server-only"
import { createHmac, timingSafeEqual } from "node:crypto"
import { getSql } from "./db"

type Sql = ReturnType<typeof getSql>
// Identifiers and predicates are code constants, never form input. Contract,
// access, content, session and audit records are deliberately not selectable.
const BUCKETS = {
  login_attempts: { table:"login_attempts",id:"id",predicate:"created_at < $1",label:"Old sign-in attempt records" },
  subscriber_tokens: { table:"auth_tokens",id:"id",predicate:"expires_at < $1 and (consumed_at is not null or expires_at < now())",label:"Expired subscriber/briefing sign-in tokens" },
  review_tokens: { table:"review_reader_tokens",id:"id",predicate:"expires_at < $1 and (consumed_at is not null or expires_at < now())",label:"Expired complimentary sign-in codes" },
  staff_challenges: { table:"admin_auth_challenges",id:"token_hash",predicate:"expires_at < $1",label:"Expired staff second-factor challenges" },
  applied_email_events: { table:"email_delivery_inbox",id:"event_id",predicate:"applied_at is not null and received_at < $1 and occurred_at < $1",label:"Matched email webhook evidence" },
} as const
export type RetentionBucket = keyof typeof BUCKETS
export const retentionOptions = Object.entries(BUCKETS).map(([key,value])=>({key,label:value.label}))
export function isRetentionBucket(value: unknown): value is RetentionBucket { return typeof value === "string" && Object.hasOwn(BUCKETS,value) }

function key(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length<32) throw new Error("Session security is not configured")
  return secret
}
function mac(payload: string) { return createHmac("sha256",key()).update(`retention-preview:v1:${payload}`).digest("base64url") }
type Preview = { bucket:RetentionBucket;actor:string;days:number;approvedAt:string;cutoff:string;count:number;expires:number }
function decode(token: string, actor: string): Preview | null {
  if (token.length>3000) return null
  const [payload,signature,...extra] = token.split(".")
  if (!payload || !signature || extra.length) return null
  const expected = Buffer.from(mac(payload)); const supplied = Buffer.from(signature)
  if (expected.length!==supplied.length || !timingSafeEqual(expected,supplied)) return null
  try {
    const data = JSON.parse(Buffer.from(payload,"base64url").toString("utf8")) as Preview
    return data.actor===actor && isRetentionBucket(data.bucket) && data.expires>Date.now() && data.expires<=Date.now()+900_000
      && Number.isSafeInteger(data.count) && data.count>=0 && Number.isFinite(Date.parse(data.cutoff)) ? data : null
  } catch { return null }
}

export async function approveRetention(actor:string,bucket:RetentionBucket,days:number,reason:string,sql:Sql=getSql()):Promise<void> {
  if (!isRetentionBucket(bucket) || !Number.isInteger(days) || days<7 || days>3650 || reason.trim().length<10 || reason.length>300) throw new Error("Invalid retention policy")
  await sql`insert into privacy_retention_policies(bucket,days,reason,approved_by) values(${bucket},${days},${reason.trim()},${actor}::uuid)
    on conflict(bucket) do update set days=excluded.days,reason=excluded.reason,approved_by=excluded.approved_by,approved_at=now()`
}

export async function previewRetention(actor:string,bucket:RetentionBucket,sql:Sql=getSql()):Promise<{count:number;cutoff:string;token:string;label:string}|null> {
  if (!isRetentionBucket(bucket)) return null
  const [policy] = await sql`select days,approved_at::text as revision from privacy_retention_policies where bucket=${bucket}`
  if (!policy) return null
  const config = BUCKETS[bucket]
  const cutoff = new Date(Date.now()-Number(policy.days)*86_400_000).toISOString()
  const [row] = await sql.query(`select count(*)::int as n from ${config.table} where ${config.predicate}`,[cutoff])
  // Keep Postgres's full timestamp precision. JS Date truncates microseconds,
  // which would make a valid production preview fail its compare-and-set.
  const data:Preview = {bucket,actor,days:Number(policy.days),approvedAt:String(policy.revision),cutoff,count:Number(row?.n??0),expires:Date.now()+900_000}
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url")
  return {count:data.count,cutoff,token:`${payload}.${mac(payload)}`,label:config.label}
}

/** A password-confirmed owner action calls this with its own signed preview. */
export async function executeRetention(actor:string,token:string,sql:Sql=getSql()):Promise<number|null> {
  const data = decode(token,actor)
  if (!data) return null
  const config = BUCKETS[data.bucket]
  // Serialize same-policy cleanups; the delete statement sees a fresh snapshot
  // after the lock. A second use or a changed policy/count writes nothing.
  const [,rows] = await sql.transaction([
    sql`select bucket from privacy_retention_policies where bucket=${data.bucket} for update`,
    sql.query(`with allowed as (
      select bucket from privacy_retention_policies where bucket=$2 and days=$3 and approved_at=$4::timestamptz
        and (select count(*) from ${config.table} where ${config.predicate})=$5
    ), removed as (
      delete from ${config.table} where ${config.id} in (
        select ${config.id} from ${config.table} where ${config.predicate} and exists(select 1 from allowed)
        order by ${config.id} limit 1000
      ) returning ${config.id}
    ), audit as (
      insert into privacy_cleanup_events(bucket,cutoff,deleted_count,actor_admin_id)
      select $2,$1::timestamptz,(select count(*) from removed),$6::uuid from allowed returning deleted_count
    ) select deleted_count from audit`,[data.cutoff,data.bucket,data.days,data.approvedAt,data.count,actor]),
  ])
  return rows.length ? Number(rows[0]!.deleted_count) : null
}
