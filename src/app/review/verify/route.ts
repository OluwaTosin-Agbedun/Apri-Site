import { NextRequest, NextResponse } from "next/server"
import { verifyReviewToken } from "@/app/actions/review-funnel"
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") || ""
  const result = await verifyReviewToken(token)
  return NextResponse.redirect(
    new URL(`/review/confirmed?result=${result}`, request.url),
    303,
  )
}
