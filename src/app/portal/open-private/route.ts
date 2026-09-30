import { NextResponse } from "next/server"
import { requirePortalPrincipal } from "@/lib/subscriber-dal"
import { recordClientEvent } from "@/lib/client-engagement"

export async function GET(request: Request) {
  const principal = await requirePortalPrincipal()
  if (!principal.hasAccess) return NextResponse.redirect(new URL("/portal",request.url))
  // Unrestricted room URLs cannot enforce edition-date coverage. Exact-document
  // personal links are exposed only after the server-side policy check.
  try { await recordClientEvent({type:"subscriber",id:principal.id},"private_link_opened") } catch {}
  return NextResponse.redirect(new URL("/portal",request.url))
}
