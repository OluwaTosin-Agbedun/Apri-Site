import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

/**
 * GET /review/read -- the older reading entry, kept so saved bookmarks still
 * work. Personal reader links no longer ask for Papermark's code, so nothing
 * here may hand one out: every reader goes through the Review Library, which
 * needs an APRI session (its email verified with APRI's one-time code).
 */
export async function GET(request: Request) {
  const response = NextResponse.redirect(new URL("/review/library", request.url), 303)
  response.headers.set("Cache-Control", "private, no-store")
  return response
}
