import { NextRequest, NextResponse } from "next/server"
import { consumeReviewAccessToken } from "@/app/actions/review-funnel"
export async function GET(request: NextRequest) {
  const ok = await consumeReviewAccessToken(
    request.nextUrl.searchParams.get("token") || "",
  )
  return NextResponse.redirect(
    new URL(
      ok ? "/review/library" : "/review/confirmed?result=invalid",
      request.url,
    ),
    303,
  )
}
