import { redirect } from "next/navigation"
import { requirePortalPrincipal } from "@/lib/subscriber-dal"
import { getDataRoomDocumentForSubscriber } from "@/lib/papermark-client-library"
import {latestPaidPublicationFor} from '@/lib/publication-versions'

export const dynamic = "force-dynamic"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const principal = await requirePortalPrincipal()
  if (principal.type !== "subscriber" || !principal.hasAccess) {
    redirect("/portal/sign-in")
  }

  const { id } = await params
  const documentRowId = decodeURIComponent(id)

  const result = await getDataRoomDocumentForSubscriber(principal.id, documentRowId)
  if (!result) {
    redirect("/portal")
  }
  if(result.document.publicationId){const latest=await latestPaidPublicationFor(principal.id,result.document.publicationId);if(latest&&latest!==result.document.publicationId)redirect(`/portal/publication/${latest}`)}

  if (!result.allowDownload || !result.documentLinkUrl) {
    redirect(`/portal/document/${encodeURIComponent(documentRowId)}`)
  }

  redirect(result.documentLinkUrl)
}
