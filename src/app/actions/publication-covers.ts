"use server"

import { randomUUID } from "node:crypto"
import { put, del } from "@vercel/blob"
import { revalidatePath } from "next/cache"
import { requireAdmin } from "@/lib/dal"
import { getSql } from "@/lib/db"
import { coverKey, COVER_TYPES, readStoredCover, validCoverUrl, validateCoverFile, type CoverKind, type CoverActionState, type StoredPublicationCover } from "@/lib/publication-cover"

const conflict = "The cover changed since you opened this page. Refresh it before trying again."
const safeErrors = new Set([conflict, "Choose a cover image.", "Cover images must be 4 MB or smaller.",
  "Choose a JPEG, PNG or WebP image. Upload the report PDF through the existing publication process.",
  "The file contents do not match a supported image type.", "Enter a short image description of 200 characters or fewer.",
  "Keep the image credit to 200 characters or fewer.", "Confirm that this cover is approved for public display."])

async function cleanup(url: string, kind: CoverKind, id: string) {
  if (!validCoverUrl(url, kind, id)) return
  try { await del(url) } catch { console.error("[publication-covers] An unused cover image could not be removed.") }
}

async function changeCover(kind: CoverKind, id: string, form: FormData, removing: boolean): Promise<CoverActionState> {
  const admin = await requireAdmin()
  if (kind === "review" && admin.role !== "owner") return { ok: false, message: "Only an owner can manage review edition covers." }
  const key = coverKey(kind, id)
  if (!key) return { ok: false, message: "Choose an existing publication edition." }
  const sql = getSql()
  let uploaded: string | null = null
  // Distinguish a refused save from an uncertain database response. Never delete a
  // newly uploaded image after an uncertain save: the database may have kept it.
  let persistenceStarted = false
  try {
    const rows = kind === "review"
      ? await sql`select id from review_publication_editions where id=${id}::uuid limit 1`
      : await sql`select id from documents where id=${id}::uuid limit 1`
    if (!rows.length) return { ok: false, message: "This publication no longer exists. Refresh the page." }
    const previous = await sql`select value from app_settings where key=${key} limit 1` as { value: string }[]
    const raw = previous[0]?.value ?? ""
    const saved = raw ? readStoredCover(raw, kind, id) : null
    if (raw && !saved) return { ok: false, message: "The saved cover information needs checking before it can be replaced." }
    if (String(form.get("revision") ?? "") !== (saved?.revision ?? "")) throw new Error(conflict)
    let image = null
    if (!removing) {
      const alt = String(form.get("alt") ?? "").trim().replace(/\s+/g, " ")
      const credit = String(form.get("credit") ?? "").trim().replace(/\s+/g, " ")
      if (!alt || alt.length > 200) throw new Error("Enter a short image description of 200 characters or fewer.")
      if (credit.length > 200) throw new Error("Keep the image credit to 200 characters or fewer.")
      if (form.get("approved") !== "on") throw new Error("Confirm that this cover is approved for public display.")
      const file = form.get("file")
      if (!(file instanceof File)) throw new Error("Choose a cover image.")
      const contentType = await validateCoverFile(file)
      if (!process.env.BLOB_READ_WRITE_TOKEN) return { ok: false, message: "Cover upload is not configured yet. Ask the website administrator to check the image-storage connection." }
      const blob = await put(`publication-covers/${kind}/${id.toLowerCase()}/cover.${COVER_TYPES[contentType]}`, file, { access: "public", addRandomSuffix: true, contentType })
      uploaded = blob.url
      if (!validCoverUrl(uploaded, kind, id)) throw new Error("Unexpected image storage response")
      image = { src: uploaded, alt, credit }
    } else if (!saved?.image) {
      return { ok: true, message: "This edition has no uploaded cover." }
    }
    const value: StoredPublicationCover = { revision: randomUUID(), image, updatedAt: new Date().toISOString(), updatedBy: admin.id }
    persistenceStarted = true
    const result = await sql`insert into app_settings(key,value) values(${key},${JSON.stringify(value)})
      on conflict(key) do update set value=excluded.value where app_settings.value=${raw}
      returning key`
    if (!result.length) {
      if (uploaded) await cleanup(uploaded, kind, id)
      return { ok: false, message: conflict }
    }
    revalidatePath("/")
    revalidatePath("/publications")
    revalidatePath("/publications/[slug]", "page")
    revalidatePath(`/admin/documents/${id}`)
    revalidatePath("/admin/review-library")
    if (saved?.image && saved.image.src !== uploaded) await cleanup(saved.image.src, kind, id)
    return { ok: true, message: removing ? "Cover removed. The report and reader access are unchanged." : "Cover saved. It appears wherever this edition is already published on the public website." }
  } catch (error) {
    if (uploaded && !persistenceStarted) await cleanup(uploaded, kind, id)
    return { ok: false, message: error instanceof Error && safeErrors.has(error.message) ? error.message :
      persistenceStarted ? "The save could not be confirmed. Refresh the page to check the cover before trying again." :
      "The cover could not be uploaded. Check the public image-storage connection and try again. The existing cover is unchanged." }
  }
}

export async function savePublicationCover(kind: CoverKind, id: string, _state: CoverActionState, form: FormData): Promise<CoverActionState> {
  return changeCover(kind, id, form, false)
}

export async function removePublicationCover(kind: CoverKind, id: string, _state: CoverActionState, form: FormData): Promise<CoverActionState> {
  return changeCover(kind, id, form, true)
}
