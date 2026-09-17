"use server"
import { revalidatePath } from "next/cache"
import { requireOwner } from "@/lib/dal"
import { getSql } from "@/lib/db"
import { importHeadshot, uploadHeadshot, validTeamKey } from "@/lib/team-images"
export async function saveTeamImage(formData: FormData) {
  const admin = await requireOwner()
  const key = String(formData.get("memberKey") || "")
  if (!validTeamKey(key)) throw new Error("Unknown team member")
  const alt = String(formData.get("altText") || "")
    .trim()
    .slice(0, 200)
  if (!alt) throw new Error("Accessible alt text is required")
  const file = formData.get("file"),
    external = String(formData.get("imageUrl") || "").trim()
  let result: { url: string; contentType: string; blob?: boolean }
  if (file instanceof File && file.size)
    result = await uploadHeadshot(file, key)
  else if (external) result = await importHeadshot(external, key)
  else throw new Error("Choose an image file or enter an HTTPS image URL")
  await getSql()`insert into team_member_images(member_key,image_url,blob_url,alt_text,content_type,updated_by) values(${key},${result.url},${
    result.blob === false ? null : result.url
  },${alt},${result.contentType},${admin.id}::uuid) on conflict(member_key) do update set image_url=excluded.image_url,blob_url=excluded.blob_url,alt_text=excluded.alt_text,content_type=excluded.content_type,updated_by=excluded.updated_by,updated_at=now()`
  revalidatePath("/team")
  revalidatePath("/admin/team")
}
export async function removeTeamImage(formData: FormData) {
  await requireOwner()
  const key = String(formData.get("memberKey") || "")
  if (!validTeamKey(key)) throw new Error("Unknown team member")
  await getSql()`update team_member_images set image_url=null,blob_url=null,alt_text='',content_type=null,updated_at=now() where member_key=${key}`
  revalidatePath("/team")
  revalidatePath("/admin/team")
}
