import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import { reconcileAllDataRooms } from "@/lib/dataroom-notifications"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: "Not configured." }, { status: 503 })
  }
  if (!isAuthorised(request, expected)) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 })
  }

  let paidResult: Record<string, unknown> = {}
  let paidOk = true
  try {
    paidResult = await reconcileAllDataRooms()
  } catch {
    paidOk = false
    paidResult = { error: "Paid reconciliation failed." }
  }

  let reviewResult: Record<string, unknown> = {}
  let reviewOk = true
  try {
    const { backgroundReviewSync } = await import("@/app/actions/review-library")
    const r = await backgroundReviewSync()
    reviewOk = r.ok
    reviewResult = { message: r.message, added: r.added, updated: r.updated }
  } catch {
    reviewOk = false
    reviewResult = { error: "Review sync failed." }
  }

  const ok = paidOk && reviewOk
  return NextResponse.json(
    { ok, paid: { ok: paidOk, ...paidResult }, review: { ok: reviewOk, ...reviewResult } },
    { status: ok ? 200 : 502 },
  )
}

function isAuthorised(request: Request, expected: string): boolean {
  const header = request.headers.get("authorization") ?? ""
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : ""
  const query = new URL(request.url).searchParams.get("secret") ?? ""
  return constantTimeEquals(bearer, expected) || constantTimeEquals(query, expected)
}

function constantTimeEquals(a: string, b: string): boolean {
  if (!a || !b) return false
  const bufA = Buffer.from(a, "utf8")
  const bufB = Buffer.from(b, "utf8")
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
