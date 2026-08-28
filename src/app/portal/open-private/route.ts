import { NextResponse } from "next/server"
import { requirePortalPrincipal } from "@/lib/subscriber-dal"
import { inspectPapermarkShareLink } from "@/lib/papermark-link"
import { recordClientEvent } from "@/lib/client-engagement"

export async function GET(request: Request) {
  const principal = await requirePortalPrincipal()
  if (!principal.hasAccess) return NextResponse.redirect(new URL("/portal",request.url))
  const link = inspectPapermarkShareLink(principal.libraryLinkUrl,process.env.PAPERMARK_CUSTOM_DOMAIN)
  if (!link) return NextResponse.redirect(new URL("/portal",request.url))
  try { await recordClientEvent({type:"subscriber",id:principal.id},"private_link_opened") } catch {}
  return NextResponse.redirect(link.url)
}
