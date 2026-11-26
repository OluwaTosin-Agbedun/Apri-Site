/** Public cover images are separate from protected report files and reader access. */
export type CoverKind = "publication" | "review"
export type PublicationCover = { src: string; alt: string; credit: string }
export type StoredPublicationCover = {
  revision: string
  image: PublicationCover | null
  updatedAt: string
  updatedBy: string
}
export type CoverActionState = { ok: boolean; message: string }

export const COVER_SETTING_PREFIX = "publication_cover_v1:"
export const MAX_COVER_BYTES = 4 * 1024 * 1024
export const COVER_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const
export const EMPTY_COVER_STATE: CoverActionState = { ok: false, message: "" }
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

export function coverKey(kind: string, id: string): string | null {
  return (kind === "publication" || kind === "review") && UUID.test(id)
    ? `${COVER_SETTING_PREFIX}${kind}:${id.toLowerCase()}` : null
}

export function validCoverUrl(value: string, kind: CoverKind, id: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.search && !url.hash &&
      /^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/i.test(url.hostname) &&
      new RegExp(`^/publication-covers/${kind}/${id.toLowerCase()}/cover-[a-zA-Z0-9_-]+\\.(jpg|png|webp)$`).test(url.pathname)
  } catch { return false }
}

/** Fail closed on malformed settings; never interpret arbitrary report URLs as covers. */
export function readStoredCover(value: string, kind: CoverKind, id: string): StoredPublicationCover | null {
  try {
    const item = JSON.parse(value) as StoredPublicationCover
    if (!item || !UUID.test(item.revision) || typeof item.updatedAt !== "string" || typeof item.updatedBy !== "string") return null
    if (item.image !== null && (!item.image || typeof item.image.src !== "string" || !validCoverUrl(item.image.src, kind, id) ||
      typeof item.image.alt !== "string" || !item.image.alt.trim() || item.image.alt.length > 200 ||
      typeof item.image.credit !== "string" || item.image.credit.length > 200)) return null
    return item
  } catch { return null }
}

export async function validateCoverFile(file: File): Promise<keyof typeof COVER_TYPES> {
  if (!file.size) throw new Error("Choose a cover image.")
  if (file.size > MAX_COVER_BYTES) throw new Error("Cover images must be 4 MB or smaller.")
  if (!Object.hasOwn(COVER_TYPES, file.type)) throw new Error("Choose a JPEG, PNG or WebP image. Upload the report PDF through the existing publication process.")
  const bytes = new Uint8Array(await file.arrayBuffer())
  let actual: keyof typeof COVER_TYPES | null = null
  if (bytes.length >= 12 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) actual = "image/jpeg"
  if (bytes.length >= 24 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) actual = "image/png"
  if (bytes.length >= 20 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") actual = "image/webp"
  if (!actual || actual !== file.type) throw new Error("The file contents do not match a supported image type.")
  return actual
}
