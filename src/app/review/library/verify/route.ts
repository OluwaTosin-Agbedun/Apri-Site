import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import {
  READER_PENDING_COOKIE,
  READER_LINK_COOKIE,
  readerShortCookieOptions,
  inspectReaderToken,
  signInReaderWithToken,
  hashToken,
} from "@/lib/review-reader"

export const dynamic = "force-dynamic"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /review/library/verify?token=…[&edition=…]
 *
 * Signs in at once only the browser that asked for the email. Opened anywhere
 * else -- an email app's own browser, or a mail scanner following links --
 * nothing is spent until the reader confirms, and they are pointed to the code
 * for the browser they normally use.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const token = url.searchParams.get("token") ?? ""
  const edition = url.searchParams.get("edition") ?? ""
  const next = UUID.test(edition) ? `/review/library/open/${edition}` : "/review/library"
  const store = await cookies()
  try {
    const pending = store.get(READER_PENDING_COOKIE)?.value
    const state = await inspectReaderToken(token, pending ? hashToken(pending) : null)
    if (!state.usable) return NextResponse.redirect(new URL("/review/library/sign-in?reason=invalid", request.url), 303)
    if (!state.sameBrowser) {
      store.set(READER_LINK_COOKIE, token, readerShortCookieOptions())
      const q = UUID.test(edition) ? `?edition=${edition}` : ""
      return NextResponse.redirect(new URL(`/review/library/verify/continue${q}`, request.url), 303)
    }
    const result = await signInReaderWithToken(token)
    if (!result.ok) return NextResponse.redirect(new URL(`/review/library/sign-in?reason=${result.reason}`, request.url), 303)
    store.set(READER_PENDING_COOKIE, "", { ...readerShortCookieOptions(), maxAge: 0 })
    return NextResponse.redirect(new URL(next, request.url), 303)
  } catch {
    return NextResponse.redirect(new URL("/review/library/sign-in?reason=unavailable", request.url), 303)
  }
}
