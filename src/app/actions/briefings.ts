"use server"

import { revalidatePath } from "next/cache"
import * as z from "zod"
import { requireAdmin } from "@/lib/dal"
import { getSql } from "@/lib/db"
import { fieldErrors, type FormState } from "@/lib/definitions"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const Schema = z.object({
  name: z.string().trim().min(1).max(160),
  organization: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  phone: z.string().trim().max(60),
  roleTitle: z.string().trim().max(160),
  briefingType: z.string().trim().max(120),
  format: z.string().trim().max(60),
  timeline: z.string().trim().max(160),
  sector: z.string().trim().max(160),
  description: z.string().trim().max(4000),
  audienceSize: z.string().trim().max(60),
  location: z.string().trim().max(200),
  status: z.enum(["New", "Pending", "Active", "Closed"]),
  notes: z.string().trim().max(4000).default(""),
})

export async function saveBriefing(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireAdmin()
  if (!UUID.test(id)) return { message: "Unknown briefing request." }
  const input = Object.fromEntries(formData)
  const parsed = Schema.safeParse(input)
  if (!parsed.success) return { errors: fieldErrors(parsed.error) }
  const d = parsed.data
  let sql: ReturnType<typeof getSql>
  try {
    sql = getSql()
  } catch {
    return { message: "Briefing storage is temporarily unavailable. Please try again." }
  }
  try {
    const rows =
      await sql`update briefing_requests set name=${d.name}, organization=${d.organization},
      email=${d.email}, phone=${d.phone}, role_title=${d.roleTitle},
      briefing_type=${d.briefingType}, format=${d.format}, timeline=${d.timeline},
      sector=${d.sector}, description=${d.description}, audience_size=${d.audienceSize},
      location=${d.location}, status=${d.status},
      private_link_url=${d.notes || null},
      updated_at=now()
      where id=${id} returning id`
    if (!rows[0]) return { message: "That briefing request no longer exists." }
  } catch {
    return { message: "The briefing request could not be saved. Please check the fields and try again." }
  }
  revalidatePath("/admin/briefings")
  revalidatePath(`/admin/briefings/${id}`)
  return { ok: true, message: "Saved." }
}

/** Delete exactly one briefing principal without touching a same-email subscriber. */
export async function deleteBriefing(
  id: string,
  confirmationEmail: string,
): Promise<FormState> {
  const admin = await requireAdmin()
  if (admin.role !== "owner") {
    return { message: "Only an owner can delete briefing requests." }
  }
  if (!UUID.test(id)) return { message: "Unknown briefing request." }

  const sql = getSql()
  const matches = await sql`
    select id from briefing_requests
    where id=${id} and email=${confirmationEmail.trim()}
    limit 1
  `
  if (!matches[0]) {
    return { message: "The confirmation email did not match." }
  }

  await sql`delete from briefing_requests where id=${id}`

  revalidatePath("/admin/briefings")
  revalidatePath("/portal")
  return {
    ok: true,
    message: "Briefing request deleted.",
  }
}
