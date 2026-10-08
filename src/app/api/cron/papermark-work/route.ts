import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import { drainReviewRoomJobs } from "@/lib/review-room-jobs"
import { drainSubscriberAccessJobs } from "@/lib/subscriber-access-reconciliation"
import { papermarkWorkSchemaReady } from "@/lib/papermark-budget"

export const dynamic = "force-dynamic"
export const maxDuration = 60

/** Counts only. No emails, private link addresses or automatic activation. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const header = request.headers.get("authorization") ?? ""
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : ""
  if (!secret) return NextResponse.json({ error: "Worker not configured." }, { status: 503 })
  const a = Buffer.from(secret), b = Buffer.from(supplied)
  if (!supplied || a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: "Not authorised." }, { status: 401 })
  if (!(await papermarkWorkSchemaReady())) return NextResponse.json({ error: "Apply 20261012_papermark_work_queue.sql." }, { status: 503 })
  const deadline = Date.now() + 45_000
  try {
    const review = await drainReviewRoomJobs({ maxJobs: 2, budgetMs: 25_000 })
    const paid = await drainSubscriberAccessJobs({ maxJobs: 1, budgetMs: Math.max(1, deadline - Date.now()) })
    return NextResponse.json({ ok: true, review, paid }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return NextResponse.json({ error: "Worker interrupted. Saved jobs will resume." }, { status: 503 })
  }
}
