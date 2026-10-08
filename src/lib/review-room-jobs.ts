import "server-only"
import { randomUUID } from "node:crypto"
import { after } from "next/server"
import { getSql } from "./db"
import { papermarkWorkSchemaReady } from "./papermark-budget"

export type RoomJob = {
  email: string; generation: number; state: "pending" | "running" | "complete" | "attention"
  create_room: boolean; attempts: number; lease_token: string | null
  next_attempt_at: string | Date; last_error: string | null
}
/** Changed inputs supersede a running job; duplicate Repair clicks do not. */
export async function queueReviewRooms(emails: readonly string[], options: { create?: boolean; changed?: boolean; priority?: number } = {}): Promise<number> {
  if (!(await papermarkWorkSchemaReady())) return 0
  const sql = getSql()
  const unique = [...new Set(emails.map((e) => e.trim().toLowerCase()))].filter((e) => e.includes("@"))
  for (const email of unique) {
    await sql`
      insert into review_reader_room_jobs (email, create_room, priority)
      values (${email}, ${options.create === true}, ${options.priority ?? 1})
      on conflict (email) do update set
        generation = review_reader_room_jobs.generation + case when ${options.changed === true} or review_reader_room_jobs.state in ('complete', 'attention') then 1 else 0 end,
        state = case when ${options.changed === true} or review_reader_room_jobs.state in ('complete', 'attention') then 'pending' else review_reader_room_jobs.state end,
        create_room = review_reader_room_jobs.create_room or excluded.create_room,
        priority = least(review_reader_room_jobs.priority, excluded.priority),
        attempts = case when ${options.changed === true} or review_reader_room_jobs.state in ('complete', 'attention') then 0 else review_reader_room_jobs.attempts end,
        next_attempt_at = case when ${options.changed === true} or review_reader_room_jobs.state in ('complete', 'attention') then now() else review_reader_room_jobs.next_attempt_at end,
        requested_at = now(), updated_at = now()
    `
  }
  return unique.length
}
/** Records a temporary delay without resetting a worker's lease or generation. */
export async function deferReviewRoom(email: string, retryAt: number, message: string): Promise<void> {
  if (!(await papermarkWorkSchemaReady())) return
  await getSql()`insert into review_reader_room_jobs (email, next_attempt_at, last_error, create_room)
    values (${email}, ${new Date(retryAt).toISOString()}::timestamptz, ${message.slice(0, 500)}, true)
    on conflict (email) do update set
      state = case when review_reader_room_jobs.state = 'running' then 'running' else 'pending' end,
      next_attempt_at = greatest(review_reader_room_jobs.next_attempt_at, excluded.next_attempt_at),
      last_error = excluded.last_error, updated_at = now()`
}
export async function readerRoomJob(email: string): Promise<RoomJob | null> {
  if (!(await papermarkWorkSchemaReady())) return null
  const [row] = await getSql()`select * from review_reader_room_jobs where email = ${email}`
  return (row as RoomJob | undefined) ?? null
}
export async function listRoomJobs(): Promise<RoomJob[]> {
  if (!(await papermarkWorkSchemaReady())) return []
  return await getSql()`select email, generation, state, create_room, attempts, lease_token, next_attempt_at, last_error from review_reader_room_jobs` as RoomJob[]
}

/** Bounded, restartable work. A killed invocation leaves a reclaimable lease. */
export async function drainReviewRoomJobs(options: { maxJobs?: number; budgetMs?: number; email?: string } = {}) {
  const summary = { processed: 0, ready: 0, waiting: 0, attention: 0 }
  if (!(await papermarkWorkSchemaReady())) return summary
  const sql = getSql()
  const deadline = Date.now() + Math.min(options.budgetMs ?? 35_000, 45_000)
  for (let i = 0; i < (options.maxJobs ?? 2) && Date.now() < deadline; i++) {
    const token = randomUUID()
    const [job] = await sql`
      with candidate as (
        select email from review_reader_room_jobs
        where state in ('pending', 'running') and next_attempt_at <= now()
          and (${options.email ?? null}::text is null or email = ${options.email ?? null})
          and (lease_token is null or lease_until < now())
        order by priority, next_attempt_at, email for update skip locked limit 1
      )
      update review_reader_room_jobs j set state = 'running', lease_token = ${token}::uuid,
        lease_until = now() + interval '3 minutes', updated_at = now()
      from candidate c where j.email = c.email
      returning j.*
    ` as RoomJob[]
    if (!job) break
    const generation = Number(job.generation)
    let state: "pending" | "complete" | "attention" = "pending"
    let message: string | null = null
    let retryAt = Date.now() + 30_000
    let transient = false
    try {
      const { reconcileReaderRoom } = await import("./review-reader-rooms")
      const r = await reconcileReaderRoom(job.email, { create: job.create_room, job: { generation, token }, deadline })
      summary.processed++
      message = r.message
      if (r.state === "ready" && !r.retryAt || (r.state === "closed" && r.message.includes("No editions are assigned")) || r.state === "none") {
        state = "complete"; summary.ready++
      } else if (r.retryAt || r.state === "updating") {
        transient = true; retryAt = r.retryAt ?? retryAt; summary.waiting++
      } else {
        state = "attention"
        if (state === "attention") summary.attention++
      }
    } catch {
      // An invocation failure remains visible and retryable, never reported ready.
      transient = true; summary.waiting++; message = "The worker was interrupted. Retry scheduled."
    }
    const attempts = state === "complete" ? 0 : Number(job.attempts) + 1
    // Small stable jitter prevents a batch's retries stampeding the token.
    const jitter = [...job.email].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 1000
    const backoff = transient ? Math.min(60_000, 5000 * 2 ** Math.min(attempts - 1, 4)) : Math.min(900_000, 60_000 * 2 ** Math.min(attempts - 1, 4))
    await sql`update review_reader_room_jobs set
      state = case when generation = ${generation} then ${state} else 'pending' end,
      completed_generation = case when generation = ${generation} and ${state} = 'complete' then ${generation} else completed_generation end,
      attempts = case when generation = ${generation} then ${attempts} else 0 end,
      next_attempt_at = case when generation = ${generation} then ${new Date(Math.max(retryAt, Date.now() + backoff) + jitter).toISOString()}::timestamptz else now() end,
      last_error = case when generation = ${generation} and ${state} <> 'complete' then ${message?.slice(0, 500) ?? null} else null end,
      lease_token = null, lease_until = null, updated_at = now()
      where email = ${job.email} and lease_token = ${token}::uuid`
    if (transient && retryAt > Date.now() + 2200) break
  }
  return summary
}
/** This is only a quick start; the saved jobs outlive after() and process death. */
export function kickReviewRoomWorker(email?: string): void {
  try { after(async () => { await drainReviewRoomJobs({ email }).catch(() => {}) }) } catch {}
}
