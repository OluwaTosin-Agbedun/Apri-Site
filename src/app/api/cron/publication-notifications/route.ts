import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import { drainPublicationNotices } from "@/lib/publication-notifications"
export const dynamic = "force-dynamic"
export const maxDuration = 60
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret)
    return NextResponse.json({ error: "Worker not configured." }, {
      status: 503,
    })
  const header = request.headers.get("authorization") ?? ""
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : ""
  const a = Buffer.from(secret),
    b = Buffer.from(supplied)
  if (!supplied || a.length !== b.length || !timingSafeEqual(a, b))
    return NextResponse.json({ error: "Not authorised." }, { status: 401 })
  try {
    const result = await drainPublicationNotices()
    return NextResponse.json(result, {
      status: result.ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    })
  } catch {
    return NextResponse.json(
      { error: "Notification processing interrupted. Saved work will resume." },
      { status: 503 },
    )
  }
}
