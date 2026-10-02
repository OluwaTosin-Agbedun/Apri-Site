import { NextResponse, after } from "next/server"
import { readRoomHint, clearRoomHint } from "@/lib/review-room-entry"
import { currentReviewReader, recordReaderEvent, reviewEntryMode } from "@/lib/review-reader"
import { roomEntryFor, reconcileReaderRoom } from "@/lib/review-reader-rooms"
import { enforceReviewRateLimit } from "@/lib/review-security"

export const dynamic = "force-dynamic"

/**
 * GET /review/read -- the reading entry path.
 *
 * Sends an approved reader to their personal Papermark room, where Papermark
 * performs the only email check: one code to that address, then Papermark's
 * session on that browser (about 23 hours) opens every edition assigned to
 * them. APRI sends no email and asks for no code here.
 *
 * Every visit re-checks approval (published edition, exact verified link,
 * this edition's own recipients) and hands out the room only while it is
 * confirmed to show exactly the editions assigned now; otherwise the room is
 * reconciled with Papermark first, or the reader is told it is being prepared.
 */
export async function GET(request: Request) {
  const to = (path: string) => noStore(NextResponse.redirect(new URL(path, request.url), 303))
  try {
    await enforceReviewRateLimit("review_read_open", 60)
  } catch {
    return to("/review/read/request?busy=1")
  }
  // A signed-in Review Library reader comes first; the routing cookie only
  // remembers which room this browser goes to.
  const session = await currentReviewReader()
  const hinted = session ? null : await readRoomHint()
  const email = session?.email ?? hinted
  if (!email) return to("/review/read/request")

  const entry = await roomEntryFor(email, { allowCreate: (await reviewEntryMode()) === "rooms" })
  if (entry.kind === "not_approved") {
    if (hinted) await clearRoomHint()
    return to("/review/read/request?not_approved=1")
  }
  if (entry.kind === "preparing") return to("/review/read/request?preparing=1")
  if (entry.kind === "unavailable") return to("/review/read/request?unavailable=1")

  // A periodic re-check after the response, so a change made directly in
  // Papermark is caught.
  if (!entry.verifiedAt || Date.now() - new Date(entry.verifiedAt).getTime() > 6 * 3600_000) {
    after(async () => {
      try {
        await reconcileReaderRoom(email)
      } catch {}
    })
  }
  await recordReaderEvent(email, "library_opened")
  return noStore(NextResponse.redirect(entry.url, 303))
}

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store")
  response.headers.set("Referrer-Policy", "no-referrer")
  return response
}
