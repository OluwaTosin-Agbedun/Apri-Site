import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function POST() {
  return NextResponse.json(
    {
      error:
        "The Open Editions sync has been retired. " +
        "Use the Review Library page at /admin/review-library to sync complimentary review documents.",
    },
    { status: 410 },
  )
}
