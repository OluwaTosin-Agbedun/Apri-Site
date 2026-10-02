import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

/**
 * GET /review/library/verify -- the older emailed sign-in link. Sign-in emails
 * now carry a one-time code only, so a link here signs nobody in: it opens the
 * sign-in page, where the reader asks for a code.
 */
export async function GET(request: Request) {
  const response = NextResponse.redirect(new URL("/review/library/sign-in?reason=code_only", request.url), 303)
  response.headers.set("Cache-Control", "private, no-store")
  response.headers.set("Referrer-Policy", "no-referrer")
  return response
}
