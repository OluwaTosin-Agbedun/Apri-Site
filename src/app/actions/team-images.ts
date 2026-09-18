"use server"
import { revalidatePath } from "next/cache"
import { requireOwner } from "@/lib/dal"
import { getSql } from "@/lib/db"
import {
  deleteHeadshotBlob,
  importHeadshot,
  TeamImageUploadError,
  uploadHeadshot,
  validTeamKey,
} from "@/lib/team-images"

export type TeamImageActionState =
  | { status: "idle"; message: "" }
  | {
      status: "success" | "error"
      message: string
    }

export const initialTeamImageState: TeamImageActionState = {
  status: "idle",
  message: "",
}

function actionError(error: unknown): TeamImageActionState {
  if (error instanceof TeamImageUploadError)
    return { status: "error", message: error.message }
  const safeMessages = new Set([
    "Unknown team member",
    "Accessible alt text is required",
    "Choose an image file or enter an HTTPS image URL",
    "Headshots must be 4 MB or smaller",
    "Only JPEG, PNG and WebP images are accepted",
    "The file contents do not match its image type",
    "Enter a safe HTTPS image URL",
    "Private network URLs are not allowed",
    "The image URL could not be fetched",
    "The URL did not return a valid JPEG, PNG or WebP image",
  ])
  if (error instanceof Error && safeMessages.has(error.message))
    return { status: "error", message: error.message }
  return { status: "error", message: "The image could not be saved." }
}

export async function saveTeamImage(
  _previousState: TeamImageActionState,
  formData: FormData,
): Promise<TeamImageActionState> {
  const admin = await requireOwner()
  try {
    const key = String(formData.get("memberKey") || "")
    if (!validTeamKey(key)) throw new Error("Unknown team member")
    const alt = String(formData.get("altText") || "")
      .trim()
      .slice(0, 200)
    if (!alt) throw new Error("Accessible alt text is required")
    const file = formData.get("file"),
      external = String(formData.get("imageUrl") || "").trim()
    let result: { url: string; contentType: string; blob: boolean }
    if (file instanceof File && file.size)
      result = await uploadHeadshot(file, key)
    else if (external) result = await importHeadshot(external, key)
    else throw new Error("Choose an image file or enter an HTTPS image URL")
    const sql = getSql()
    const previous =
      (await sql`select blob_url from team_member_images where member_key=${key}`) as {
        blob_url: string | null
      }[]
    await sql`insert into team_member_images(member_key,image_url,blob_url,alt_text,content_type,updated_by) values(${key},${result.url},${
      result.blob ? result.url : null
    },${alt},${result.contentType},${admin.id}::uuid) on conflict(member_key) do update set image_url=excluded.image_url,blob_url=excluded.blob_url,alt_text=excluded.alt_text,content_type=excluded.content_type,updated_by=excluded.updated_by,updated_at=now()`
    if (previous[0]?.blob_url && previous[0].blob_url !== result.url)
      await deleteHeadshotBlob(previous[0].blob_url)
    revalidatePath("/team")
    revalidatePath("/admin/team")
    return { status: "success", message: "Team image saved." }
  } catch (error) {
    return actionError(error)
  }
}
export async function removeTeamImage(
  _previousState: TeamImageActionState,
  formData: FormData,
): Promise<TeamImageActionState> {
  await requireOwner()
  try {
    const key = String(formData.get("memberKey") || "")
    if (!validTeamKey(key)) throw new Error("Unknown team member")
    const sql = getSql()
    const previous =
      (await sql`select blob_url from team_member_images where member_key=${key}`) as {
        blob_url: string | null
      }[]
    await sql`update team_member_images set image_url=null,blob_url=null,alt_text='',content_type=null,updated_at=now() where member_key=${key}`
    if (previous[0]?.blob_url) await deleteHeadshotBlob(previous[0].blob_url)
    revalidatePath("/team")
    revalidatePath("/admin/team")
    return { status: "success", message: "Team image removed." }
  } catch (error) {
    return actionError(error)
  }
}
