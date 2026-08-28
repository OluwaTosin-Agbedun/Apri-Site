import { redirect } from "next/navigation"
import { requirePortalPrincipal } from "@/lib/subscriber-dal"
import { getDataRoomDocumentForSubscriber } from "@/lib/papermark-client-library"
import { recordClientEvent } from "@/lib/client-engagement"

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

  if (!result.allowDownload) {
    redirect(`/portal/document/${encodeURIComponent(documentRowId)}`)
  }

  try {
    await recordClientEvent(
      { type: "subscriber", id: principal.id },
      "document_downloaded",
    )
  } catch {}

  const targetUrl = result.document.dataroomDocumentId
    ? buildDownloadUrl(result.linkUrl, result.document.dataroomDocumentId)
    : result.linkUrl
  redirect(targetUrl)
}

function buildDownloadUrl(linkUrl: string, dataroomDocumentId: string): string {
  try {
    const url = new URL(linkUrl)
    url.searchParams.set("documentId", dataroomDocumentId)
    return url.toString()
  } catch {
    return linkUrl
  }
}
