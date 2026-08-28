import { notFound } from "next/navigation"
import { requireAdmin } from "@/lib/dal"
import { getSql } from "@/lib/db"
import AdminShell from "@/components/AdminShell"
import BriefingForm from "./briefing-form"
import BriefingDeleteControl from "../briefing-delete-control"
import PapermarkConnectionPanel from "@/components/PapermarkConnectionPanel"
import BriefingDataRoomPanel from "@/components/BriefingDataRoomPanel"
import { getAssignableFolders } from "@/app/actions/papermark-client-library"
import { getDataRoomLink } from "@/lib/dataroom-dal"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const dynamic = "force-dynamic"
export default async function BriefingDetails({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const admin = await requireAdmin()
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const sql = getSql()
  const [schema] = (await sql`
    select
      (select count(*) = 4 from information_schema.columns
       where table_schema='public' and table_name='briefing_requests'
         and column_name in ('private_link_url','updated_at','activated_at','last_viewed_at'))
      and exists (select 1 from information_schema.columns
       where table_schema='public' and table_name='auth_tokens'
         and column_name='briefing_request_id') as ready
  `) as { ready: boolean }[]
  // Keep the detail page usable before the additive portal migration is applied.
  // Tagged queries avoid constructing SQL from the route parameter.
  const hasDrColumn = (await sql`
    select 1 from information_schema.columns
    where table_schema='public' and table_name='briefing_requests'
      and column_name='papermark_dataroom_id'
  `).length > 0
  const rows = (schema?.ready
    ? hasDrColumn
      ? await sql`select id,name,organization,role_title,email,phone,briefing_type,
          format,timeline,sector,description,audience_size,location,status,
          private_link_url,papermark_folder_id,papermark_dataroom_id,updated_at,private_link_updated_at from briefing_requests where id=${id} limit 1`
      : await sql`select id,name,organization,role_title,email,phone,briefing_type,
          format,timeline,sector,description,audience_size,location,status,
          private_link_url,papermark_folder_id,null::text as papermark_dataroom_id,updated_at,private_link_updated_at from briefing_requests where id=${id} limit 1`
    : await sql`select id,name,organization,role_title,email,phone,briefing_type,
        format,timeline,sector,description,audience_size,location,status,
        null::text as private_link_url,null::text as papermark_folder_id,null::text as papermark_dataroom_id,null::timestamptz as updated_at,null::timestamptz as private_link_updated_at from briefing_requests where id=${id} limit 1`) as {
      id: string
      name: string
      organization: string
      role_title: string
      email: string
      phone: string
      briefing_type: string
      format: string
      timeline: string
      sector: string
      description: string
      audience_size: string
      location: string
      status: string
      private_link_url: string | null
      papermark_folder_id: string | null
      papermark_dataroom_id: string | null
      updated_at: string | null
      private_link_updated_at: string | null
    }[]
  const r = rows[0]
  if (!r) notFound()
  const folderResult = await getAssignableFolders("briefing")

  // Read separately and defensively: this page already tolerates a database
  // where the client-library migration has not run, and the last sync time is a
  // convenience rather than something worth failing the whole page over.
  let librarySyncedAt: string | null = null
  try {
    const synced = (await sql`
      select max(synced_at) as synced_at
      from papermark_client_documents where briefing_request_id=${id}
    `) as { synced_at: string | Date | null }[]
    const value = synced[0]?.synced_at
    librarySyncedAt = value ? new Date(value).toISOString() : null
  } catch {
    librarySyncedAt = null
  }

  let briefingDrLink: {
    id: string; linkUrl: string; assignedName: string;
    allowDownload: boolean; revokeState: string; createdAt: string;
    totalViews: number | null;
  } | null = null
  if (r.papermark_dataroom_id) {
    try {
      const drLink = await getDataRoomLink({
        briefingRequestId: r.id,
        dataroomId: r.papermark_dataroom_id,
      })
      if (drLink) {
        briefingDrLink = {
          id: drLink.id,
          linkUrl: drLink.linkUrl,
          assignedName: drLink.assignedName,
          allowDownload: drLink.allowDownload,
          revokeState: drLink.revokeState,
          createdAt: drLink.createdAt,
          totalViews: drLink.totalViews,
        }
      }
    } catch {}
  }

  return (
    <AdminShell
      admin={admin}
      current="/admin/briefings"
      title={r.name}
      description="Edit and activate this briefing client without creating a subscriber record."
    >
      <BriefingDataRoomPanel
        briefingRequestId={r.id}
        dataroomId={r.papermark_dataroom_id}
        link={briefingDrLink}
      />
      <BriefingForm
        draft={{
          id: r.id,
          name: r.name,
          organization: r.organization,
          email: r.email,
          phone: r.phone,
          roleTitle: r.role_title,
          briefingType: r.briefing_type,
          format: r.format,
          timeline: r.timeline,
          sector: r.sector,
          description: r.description,
          audienceSize: r.audience_size,
          location: r.location,
          status: r.status,
          privateLinkUrl: r.private_link_url ?? "",
          schemaReady: Boolean(schema?.ready),
          papermarkFolderId: r.papermark_folder_id ?? "",
          librarySyncedAt,
        }}
        folders={folderResult.folders}
        folderError={folderResult.error}
      />
      <PapermarkConnectionPanel link={r.private_link_url} updatedAt={r.private_link_updated_at} />
      <BriefingDeleteControl
        id={r.id}
        email={r.email}
        canDelete={admin.role === "owner"}
        detail
      />
    </AdminShell>
  )
}
