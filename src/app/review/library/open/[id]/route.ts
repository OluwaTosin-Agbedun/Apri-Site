import { NextResponse } from "next/server"
import { currentReviewReader, recordReaderEvent } from "@/lib/review-reader"
import { getReviewEditionForEmail } from "@/lib/publications"
import { readerDocumentFor } from "@/lib/review-reader-rooms"
import { enforceReviewRateLimit } from "@/lib/review-security"

export const dynamic = "force-dynamic"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /review/library/open/{editionId} -- "Read".
 *
 * The only way the Review Library hands out a Papermark address, checked on
 * every open: the browser must hold an APRI reader session (its email
 * verified with APRI's one-time code), the edition must still be published
 * with a verified exact-document link, and this email must still be one of ITS
 * recipients. A guessed id, a withdrawn or draft edition, or another reader's
 * edition all get the same answer.
 *
 * Then the reader goes straight to that one PDF inside their personal
 * Papermark link: only their address, no second code, watermark, screenshot
 * protection, no downloads, and open only until their APRI session ends.
 * Before 20261011 is applied it is the edition's own link instead (Papermark
 * asks for its code per edition).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const to = (path: string) => noStore(NextResponse.redirect(new URL(path, request.url), 303))
  const reader = await currentReviewReader()
  if (!reader) return to(UUID.test(id) ? `/review/library/sign-in?edition=${id}` : "/review/library/sign-in")
  try {
    await enforceReviewRateLimit("review_library_open", 120)
  } catch {
    return to(UUID.test(id) ? `/review/library?busy=1&edition=${id}` : "/review/library?busy=1")
  }
  const edition = UUID.test(id) ? await getReviewEditionForEmail(reader.email, id) : null
  if (!edition) return to("/review/library?unavailable=1")

  // "via=edition": the reader chose the edition's own link (Papermark's code)
  // because their personal link needs repair. Still only after both checks.
  const viaEdition = new URL(request.url).searchParams.get("via") === "edition"
  if (reader.sid && reader.until && !viaEdition) {
    const target = await readerDocumentFor(reader.email, edition.id, reader.until)
    if (target.kind === "open") {
      await recordReaderEvent(reader.email, "edition_opened", edition.id)
      return noStore(NextResponse.redirect(target.url, 303))
    }
    if (target.kind === "not_assigned") return to("/review/library?unavailable=1")
    if (target.kind === "preparing") return to(`/review/library?preparing=1&edition=${edition.id}`)
    // Not in the Review Data Room: its own link (Papermark's code) still works.
    if (target.kind === "unavailable" && target.reason !== "not_in_room") return to(`/review/library?repair=1&edition=${edition.id}`)
    // "legacy": the open-window migration is not applied yet.
  }
  await recordReaderEvent(reader.email, "edition_opened", edition.id)
  return noStore(NextResponse.redirect(edition.secureUrl, 303))
}

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store")
  response.headers.set("Referrer-Policy", "no-referrer")
  return response
}
