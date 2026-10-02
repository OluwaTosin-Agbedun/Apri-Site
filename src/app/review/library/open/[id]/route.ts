import { NextResponse } from "next/server"
import { currentReviewReader, recordReaderEvent } from "@/lib/review-reader"
import { getReviewEditionForEmail } from "@/lib/publications"

export const dynamic = "force-dynamic"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /review/library/open/{editionId}
 *
 * The only way the Review Library hands out an edition's Papermark link, and
 * it is checked on every open: the browser's verified email must still be one
 * of THIS edition's recipients, and the edition must still be published with a
 * verified exact-document link. A guessed id, a withdrawn or draft edition, or
 * another reader's edition all get the same answer. The library page itself
 * never carries a Papermark URL.
 *
 * Papermark then applies its own gate on that link: the allow list, email
 * verification, the personal watermark and screenshot protection.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const reader = await currentReviewReader()
  if (!reader) {
    const next = UUID.test(id) ? `?edition=${id}` : ""
    return noStore(NextResponse.redirect(new URL(`/review/library/sign-in${next}`, request.url), 303))
  }
  const edition = UUID.test(id) ? await getReviewEditionForEmail(reader.email, id) : null
  if (!edition) {
    return noStore(NextResponse.redirect(new URL("/review/library?unavailable=1", request.url), 303))
  }
  await recordReaderEvent(reader.email, "edition_opened", edition.id)
  return noStore(NextResponse.redirect(edition.secureUrl, 303))
}

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store")
  response.headers.set("Referrer-Policy", "no-referrer")
  return response
}
