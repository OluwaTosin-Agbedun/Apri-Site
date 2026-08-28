import { notFound } from "next/navigation"
import { requireAdmin } from "@/lib/dal"
import { getSql } from "@/lib/db"
import AdminShell from "@/components/AdminShell"
import BriefingForm from "./briefing-form"
import BriefingDeleteControl from "../briefing-delete-control"

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

  const rows = (await sql`
    select id, name, organization, role_title, email, phone, briefing_type,
      format, timeline, sector, description, audience_size, location, status,
      private_link_url, created_at, updated_at
    from briefing_requests where id=${id} limit 1
  `) as {
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
    created_at: string
    updated_at: string | null
  }[]

  const r = rows[0]
  if (!r) notFound()

  return (
    <AdminShell
      admin={admin}
      current="/admin/briefings"
      title={r.name}
      description="View and manage this briefing service request."
    >
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
          notes: r.private_link_url ?? "",
        }}
      />
      <BriefingDeleteControl
        id={r.id}
        email={r.email}
        canDelete={admin.role === "owner"}
        detail
      />
    </AdminShell>
  )
}
