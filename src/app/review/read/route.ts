import { NextResponse, after } from "next/server"
import { verifyRoomEntry, setRoomHint, readRoomHint } from "@/lib/review-room-entry"
import { currentReviewReader, recordReaderEvent, reviewEntryMode } from "@/lib/review-reader"
import { readyRoomLink, prepareReaderRooms, reconcileReaderRoom } from "@/lib/review-reader-rooms"

export const dynamic = "force-dynamic"

/**
 * GET /review/read[?t=entry-token]
 *
 * The reading entry path: sends an approved reader to their personal
 * Papermark room, where Papermark performs the email check (one code, then
 * its 23-hour session on that browser covers every edition assigned to them).
 * APRI asks for no code of its own here. The room link is handed out only
 * while APRI has confirmed with Papermark that it shows exactly the reader's
 * assigned editions, with downloads off.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const token = url.searchParams.get("t")
  let email: string | null = null
  if (token) {
    email = await verifyRoomEntry(token)
    if (email) await setRoomHint(email)
  }
  email ??= (await readRoomHint()) ?? (await currentReviewReader())?.email ?? null
  if (!email) return noStore(NextResponse.redirect(new URL("/review/read/request", request.url), 303))

  let room = await readyRoomLink(email)
  if (!room && (await reviewEntryMode()) === "rooms") {
    // First visit after the rollout: build and confirm the room now.
    await prepareReaderRooms([email])
    room = await readyRoomLink(email)
  }
  if (!room) return noStore(NextResponse.redirect(new URL("/review/read/request?unavailable=1", request.url), 303))

  // A periodic re-check after the response, so a missed change is caught.
  if (!room.verifiedAt || Date.now() - new Date(room.verifiedAt).getTime() > 6 * 3600_000) {
    after(async () => {
      try {
        await reconcileReaderRoom(email!)
      } catch {}
    })
  }
  await recordReaderEvent(email, "library_opened")
  return noStore(NextResponse.redirect(room.url, 303))
}

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store")
  response.headers.set("Referrer-Policy", "no-referrer")
  return response
}
