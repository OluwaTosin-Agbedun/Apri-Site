import { notFound } from "next/navigation"
import { requireAdmin } from "@/lib/dal"
import { getSql } from "@/lib/db"
import AdminShell from "@/components/AdminShell"
import BriefingForm from "./briefing-form"
const UUID = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i
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
  const rows =
    (await sql`select id,name,organization,email,phone,status,private_link_url from briefing_requests where id=${id} limit 1`) as {
      id: string
      name: string
      organization: string
      email: string
      phone: string
      status: string
      private_link_url: string | null
    }[]
  const r = rows[0]
  if (!r) notFound()
  return (
    <AdminShell
      admin={admin}
      current="/admin/briefings"
      title={r.name}
      description="Edit and activate this briefing client without creating a subscriber record."
    >
      <BriefingForm
        draft={{
          id: r.id,
          name: r.name,
          organization: r.organization,
          email: r.email,
          phone: r.phone,
          status: r.status,
          privateLinkUrl: r.private_link_url ?? "",
        }}
      />
    </AdminShell>
  )
}
