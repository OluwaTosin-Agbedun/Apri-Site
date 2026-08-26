"use server"

import { revalidatePath } from "next/cache"
import * as z from "zod"
import { requireAdmin } from "@/lib/dal"
import { getSql } from "@/lib/db"
import { issueBriefingToken } from "@/lib/magic-link"
import { sendBriefingWelcome } from "@/lib/subscriber-email"
import { fieldErrors, type FormState } from "@/lib/definitions"
import { papermarkEmbedUrl } from "@/lib/papermark-embed"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const Schema = z.object({
  name: z.string().trim().min(1).max(160),
  organization: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  phone: z.string().trim().max(60),
  status: z.enum(["New", "In Progress", "Scheduled", "Active", "Closed"]),
  privateLinkUrl: z.union([
    z.literal(""),
    z
      .string()
      .trim()
      .max(500)
      .pipe(z.url({ protocol: /^https$/, error: "Must be an https:// URL." })),
  ]),
})

export async function saveBriefing(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireAdmin()
  if (!UUID.test(id)) return { message: "Unknown briefing request." }
  const parsed = Schema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { errors: fieldErrors(parsed.error) }
  const d = parsed.data
  if (d.privateLinkUrl && !papermarkEmbedUrl(d.privateLinkUrl, process.env.PAPERMARK_CUSTOM_DOMAIN)) {
    return {
      errors: {
        privateLinkUrl: [
          "Use an HTTPS Papermark share link or the configured APRI Papermark custom domain.",
        ],
      },
    }
  }
  const sql = getSql()
  if (d.privateLinkUrl) {
    const duplicates = await sql`
      select 1 from briefing_requests
      where private_link_url = ${d.privateLinkUrl} and id <> ${id}
      union all
      select 1 from subscribers where library_link_url = ${d.privateLinkUrl}
      limit 1
    `
    if (duplicates.length > 0) {
      return {
        message:
          "That private Papermark link is already assigned to another client.",
      }
    }
  }
  const rows =
    await sql`update briefing_requests set name=${d.name}, organization=${d.organization},
    email=${d.email}, phone=${d.phone}, status=${d.status},
    private_link_url=${d.privateLinkUrl || null}, updated_at=now()
    where id=${id} returning id`
  if (!rows[0]) return { message: "That briefing request no longer exists." }
  revalidatePath("/admin/briefings")
  revalidatePath(`/admin/briefings/${id}`)
  return { ok: true, message: "Saved." }
}

export async function activateBriefing(id: string): Promise<FormState> {
  await requireAdmin()
  if (!UUID.test(id)) return { message: "Unknown briefing request." }
  const sql = getSql()
  const rows =
    (await sql`select id,name,email,private_link_url from briefing_requests where id=${id} limit 1`) as {
      id: string
      name: string
      email: string
      private_link_url: string | null
    }[]
  const row = rows[0]
  if (!row) return { message: "That briefing request no longer exists." }
  if (!row.private_link_url)
    return { message: "Set the private briefing link before activating." }
  if (!papermarkEmbedUrl(row.private_link_url, process.env.PAPERMARK_CUSTOM_DOMAIN))
    return { message: "Replace the private briefing link with a valid Papermark share link before activating." }
  const duplicates = await sql`
    select 1 from briefing_requests
    where private_link_url = ${row.private_link_url} and id <> ${id}
    union all
    select 1 from subscribers where library_link_url = ${row.private_link_url}
    limit 1
  `
  if (duplicates.length > 0)
    return {
      message:
        "That private Papermark link is assigned to another client. Give this briefing client a unique link before activating.",
    }
  await sql`update briefing_requests set status='Active',activated_at=now(),updated_at=now() where id=${id}`
  const token = await issueBriefingToken(id)
  try {
    await sendBriefingWelcome({ email: row.email, fullName: row.name, token })
  } catch {
    return {
      ok: true,
      message:
        "Activated, but the sign-in email could not be sent. Check the email configuration.",
    }
  }
  revalidatePath("/admin/briefings")
  revalidatePath(`/admin/briefings/${id}`)
  return { ok: true, message: "Activated and sent a secure sign-in link." }
}
