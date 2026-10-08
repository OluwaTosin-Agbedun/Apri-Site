import "server-only"
import { AsyncLocalStorage } from "node:async_hooks"
import { getSql } from "./db"
import { papermarkWorkSchemaReady } from "./papermark-budget"

export class RoomWorkDeferred extends Error {
  readonly retryAt: number
  constructor(retryAt: number, message = "Access changed or the worker paused. Retry scheduled.") { super(message); this.retryAt = retryAt }
}
export type RoomLease = { email: string; token: string; job?: { generation: number; token: string }; deadline?: number }
export const roomLease = new AsyncLocalStorage<RoomLease>()
/** Renew and fence before every provider call, and before saving a result. */
export async function guardRoomWork(): Promise<void> {
  const current = roomLease.getStore()
  if (!current || !(await papermarkWorkSchemaReady())) return
  if (current.deadline && Date.now() >= current.deadline) throw new RoomWorkDeferred(Date.now() + 5000, "Worker time slice completed. Retry scheduled.")
  const rows = await getSql()`update review_reader_rooms set lease_until = now() + interval '3 minutes'
    where email = ${current.email} and lease_owner = ${current.token}::uuid and lease_until > now()
      and (${!current.job} or exists (select 1 from review_reader_room_jobs j where j.email = ${current.email}
        and j.generation = ${current.job?.generation ?? 0} and j.lease_token = ${current.job?.token ?? null}::uuid))
    returning email`
  if (!rows.length) throw new RoomWorkDeferred(Date.now() + 5000)
  if (current.job) await getSql()`update review_reader_room_jobs set lease_until = now() + interval '3 minutes'
    where email = ${current.email} and lease_token = ${current.job.token}::uuid and generation = ${current.job.generation}`
}
