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
  roleTitle: z.string().trim().max(160), briefingType: z.string().trim().max(120),
  format: z.string().trim().max(60), timeline: z.string().trim().max(160),
  sector: z.string().trim().max(160), description: z.string().trim().max(4000),
  audienceSize: z.string().trim().max(60), location: z.string().trim().max(200),
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
  if (!(await briefingPortalSchemaReady(sql))) {
    return { message: "Apply the briefing portal migration before saving this request." }
  }
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
    email=${d.email}, phone=${d.phone}, role_title=${d.roleTitle},
    briefing_type=${d.briefingType}, format=${d.format}, timeline=${d.timeline},
    sector=${d.sector}, description=${d.description}, audience_size=${d.audienceSize},
    location=${d.location},
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
  if (!(await briefingPortalSchemaReady(sql))) {
    return { message: "Apply the briefing portal migration before activating this request." }
  }
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

export async function resendBriefingSignInLink(id: string): Promise<FormState> {
  await requireAdmin()
  if (!UUID.test(id)) return { message: "Unknown briefing request." }
  const sql = getSql()
  if (!(await briefingPortalSchemaReady(sql))) {
    return { message: "Apply the briefing portal migration before sending sign-in." }
  }
  const rows = (await sql`select id,name,email,status,private_link_url
    from briefing_requests where id=${id} limit 1`) as {
      id:string; name:string; email:string; status:string; private_link_url:string|null
    }[]
  const row = rows[0]
  if (!row || row.status !== "Active" || !row.private_link_url) {
    return { message: "Only an active briefing client with a private link can receive sign-in." }
  }
  const token = await issueBriefingToken(id)
  try { await sendBriefingWelcome({ email: row.email, fullName: row.name, token }) }
  catch { return { message: "Could not send the sign-in email. Check email configuration." } }
  return { ok:true, message:`A fresh sign-in link has been sent to ${row.email}.` }
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

  // The briefing_request_id FK cascades briefing tokens in the same database
  // statement. Subscriber tokens have a different principal column and cannot
  // be selected by this deletion.
  await sql`delete from briefing_requests where id=${id}`

  revalidatePath("/admin/briefings")
  revalidatePath("/portal")
  return {
    ok: true,
    message:
      "Briefing request deleted from APRI. Revoke its Papermark link separately.",
  }
}

async function briefingPortalSchemaReady(
  sql: ReturnType<typeof getSql>,
): Promise<boolean> {
  const [row] = (await sql`
    select
      (select count(*) = 4 from information_schema.columns
       where table_schema='public' and table_name='briefing_requests'
         and column_name in ('private_link_url','updated_at','activated_at','last_viewed_at'))
      and exists (select 1 from information_schema.columns
       where table_schema='public' and table_name='auth_tokens'
         and column_name='briefing_request_id') as ready
  `) as { ready: boolean }[]
  return Boolean(row?.ready)
}
