import "server-only"
import { createHash } from "node:crypto"
import { getSql } from "./db"

/** One atomic clock per token, shared by every Vercel instance and API caller. */
export class PapermarkBudgetWait extends Error {
  readonly retryAt: number
  constructor(retryAt: number) {
    super("Papermark is busy. An automatic retry is scheduled.")
    this.retryAt = retryAt
  }
}
let schema: { ready: boolean; at: number } | null = null
export async function papermarkWorkSchemaReady(): Promise<boolean> {
  if (schema && Date.now() - schema.at < (schema.ready ? 300_000 : 10_000)) return schema.ready
  try {
    const [r] = await getSql()`select to_regclass('public.papermark_api_budgets') is not null and to_regclass('public.review_reader_room_jobs') is not null as ok`
    schema = { ready: r?.ok === true, at: Date.now() }
  } catch (error) {
    // A failed database check is not proof that the migration is absent.
    // Stop provider calls rather than falling back to uncoordinated instances.
    throw error
  }
  return schema.ready
}
export function resetPapermarkWorkSchemaCache() { schema = null }

// A compatibility bridge before the migration; only the database coordinates
// different instances. Tests may accelerate a loopback stand-in, never a real host.
const local = new Map<string, number>()
const key = (token: string) => createHash("sha256").update(token).digest("hex")
const isAnalytics = (path: string) => path.startsWith("/v1/analytics/") || path.includes("/views")
export function papermarkCallInterval(analytics = false): number {
  const configured = Number(analytics ? process.env.PAPERMARK_ANALYTICS_CALLS_PER_MINUTE : process.env.PAPERMARK_CALLS_PER_MINUTE)
  const accelerated = process.env.APRI_TEST_DATABASE_URL && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(process.env.PAPERMARK_API_BASE ?? "")
  const limit = accelerated ? Math.max(1, configured || 100000) : Math.max(1, Math.min(analytics ? 10 : 45, configured || (analytics ? 10 : 45)))
  return Math.ceil(60_000 / limit)
}
async function claim(bucket: string, interval: number): Promise<number | null> {
  if (!(await papermarkWorkSchemaReady())) {
    const until = local.get(bucket) ?? 0
    if (until > Date.now()) return until
    local.set(bucket, Date.now() + interval)
    return null
  }
  const sql = getSql()
  await sql`insert into papermark_api_budgets (bucket) values (${bucket}) on conflict (bucket) do nothing`
  const granted = await sql`
    update papermark_api_budgets set next_slot_at = clock_timestamp() + (${interval}::int * interval '1 millisecond'), updated_at = now()
    where bucket = ${bucket} and next_slot_at <= clock_timestamp() and cooldown_until <= clock_timestamp()
    returning bucket
  `
  if (granted.length) return null
  const [r] = await sql`select greatest(next_slot_at, cooldown_until) as retry_at from papermark_api_budgets where bucket = ${bucket}`
  return r ? new Date(r.retry_at).getTime() : Date.now() + interval
}
/** Small waits only; a provider cooldown is persisted and returned to the queue. */
export async function waitPapermarkBudget(token: string, path: string, maxWaitMs = 2200): Promise<void> {
  const started = Date.now()
  const buckets = isAnalytics(path) ? [`${key(token)}:analytics`, `${key(token)}:all`] : [`${key(token)}:all`]
  for (const bucket of buckets) {
    for (;;) {
      const retryAt = await claim(bucket, papermarkCallInterval(bucket.endsWith(":analytics")))
      if (retryAt === null) break
      const delay = Math.max(5, retryAt - Date.now() + 15)
      if (Date.now() + delay - started > maxWaitMs) throw new PapermarkBudgetWait(retryAt)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
}
/** Retry-After seconds/date and Papermark's epoch X-RateLimit-Reset. */
export function papermarkResetAt(headers: Headers, now = Date.now()): number {
  const reset = Number(headers.get("x-ratelimit-reset"))
  const retry = headers.get("retry-after")
  const seconds = retry === null ? NaN : Number(retry)
  const date = retry === null ? NaN : Date.parse(retry)
  const hints = [
    Number.isFinite(reset) && reset > now / 1000 ? reset * 1000 : 0,
    Number.isFinite(seconds) && seconds >= 0 ? now + seconds * 1000 : Number.isFinite(date) && date >= now ? date : 0,
  ].filter((at) => at >= now)
  return Math.max(now + 1000, hints.length ? Math.max(...hints) : now + 60_000) + 250
}
export async function observePapermarkResponse(token: string, path: string, response: Response): Promise<number | null> {
  if (response.status !== 429 && response.headers.get("x-ratelimit-remaining") !== "0") return null
  const until = papermarkResetAt(response.headers)
  // A 429 on analytics cools its stricter bucket. Every request still spends
  // the shared token budget; other endpoints remain usable for security work.
  const bucket = `${key(token)}:${isAnalytics(path) ? "analytics" : "all"}`
  if (await papermarkWorkSchemaReady()) {
    await getSql()`insert into papermark_api_budgets (bucket, cooldown_until) values (${bucket}, ${new Date(until).toISOString()}::timestamptz)
      on conflict (bucket) do update set cooldown_until = greatest(papermark_api_budgets.cooldown_until, excluded.cooldown_until), updated_at = now()`
  } else local.set(bucket, Math.max(local.get(bucket) ?? 0, until))
  return until
}
