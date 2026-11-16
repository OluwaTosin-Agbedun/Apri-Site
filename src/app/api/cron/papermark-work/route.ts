import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import { drainReviewRoomJobs } from "@/lib/review-room-jobs"
import { drainSubscriberAccessJobs } from "@/lib/subscriber-access-reconciliation"
import { papermarkWorkSchemaReady } from "@/lib/papermark-budget"
import {drainVersionRetirements} from '@/lib/publication-corrections'

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
    const versions = await drainVersionRetirements({ maxJobs: 1, deadline: Math.min(deadline,Date.now()+8000) })
    const review = await drainReviewRoomJobs({ maxJobs: 2, budgetMs: Math.max(1,Math.min(25_000,deadline-Date.now())) })
    const paid = await drainSubscriberAccessJobs({ maxJobs: 1, budgetMs: Math.max(1, deadline - Date.now()) })
    return NextResponse.json({ ok: true, review, paid, versions }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return NextResponse.json({ error: "Worker interrupted. Saved jobs will resume." }, { status: 503 })
  }
}
