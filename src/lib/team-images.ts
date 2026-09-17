import "server-only"
import { lookup } from "node:dns/promises"
import { isIP } from "node:net"
import { getSql } from "./db"
import { TEAM_MEMBERS } from "@/data/team"
import { safeHttpsUrl } from "./review-security"

export const MAX_HEADSHOT_BYTES = 5 * 1024 * 1024
const types = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const
export type TeamImage = { memberKey: string; imageUrl: string; altText: string }

function detectedType(bytes: Uint8Array): keyof typeof types | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg"
  if (
    bytes
      .slice(0, 8)
      .every(
        (v, i) => v === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][i],
      )
  )
    return "image/png"
  if (
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  )
    return "image/webp"
  return null
}
function privateIp(ip: string) {
  return (
    /^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(
      ip,
    ) ||
    ip === "::1" ||
    /^f[cd]/i.test(ip) ||
    /^fe80:/i.test(ip)
  )
}
async function assertPublicHost(host: string) {
  if (isIP(host)) {
    if (privateIp(host)) throw new Error("Private network URLs are not allowed")
    return
  }
  const addresses = await lookup(host, { all: true, verbatim: true })
  if (!addresses.length || addresses.some((a) => privateIp(a.address)))
    throw new Error("Private network URLs are not allowed")
}

async function putBlob(
  bytes: Uint8Array,
  contentType: keyof typeof types,
  key: string,
) {
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) throw new Error("Blob upload is unavailable")
  const response = await fetch(
    `https://blob.vercel-storage.com/team/${encodeURIComponent(key)}-${Date.now()}.${types[contentType]}`,
    {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "x-api-version": "7",
        "x-content-type": contentType,
        "x-add-random-suffix": "1",
      },
      body: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: contentType }),
    },
  )
  if (!response.ok) throw new Error("Blob upload failed")
  const body = (await response.json()) as { url?: string }
  if (!body.url) throw new Error("Blob did not return an image URL")
  return body.url
}
export async function uploadHeadshot(file: File, key: string) {
  if (file.size > MAX_HEADSHOT_BYTES)
    throw new Error("Headshots must be 5 MB or smaller")
  if (!(file.type in types))
    throw new Error("Only JPEG, PNG and WebP images are accepted")
  const bytes = new Uint8Array(await file.arrayBuffer())
  const actual = detectedType(bytes)
  if (!actual || actual !== file.type)
    throw new Error("The file contents do not match its image type")
  return { url: await putBlob(bytes, actual, key), contentType: actual }
}
export async function importHeadshot(value: string, key: string) {
  const url = safeHttpsUrl(value)
  if (!url) throw new Error("Enter a safe HTTPS image URL")
  await assertPublicHost(url.hostname)
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(8000),
    headers: { accept: "image/jpeg,image/png,image/webp" },
  })
  if (!response.ok) throw new Error("The image URL could not be fetched")
  const length = Number(response.headers.get("content-length") || 0)
  if (length > MAX_HEADSHOT_BYTES)
    throw new Error("Headshots must be 5 MB or smaller")
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length > MAX_HEADSHOT_BYTES)
    throw new Error("Headshots must be 5 MB or smaller")
  const actual = detectedType(bytes)
  if (!actual)
    throw new Error("The URL did not return a valid JPEG, PNG or WebP image")
  if (process.env.BLOB_READ_WRITE_TOKEN)
    return {
      url: await putBlob(bytes, actual, key),
      contentType: actual,
      blob: true,
    }
  return { url: url.toString(), contentType: actual, blob: false }
}
export async function getTeamImages(): Promise<Map<string, TeamImage>> {
  try {
    const rows =
      (await getSql()`select member_key,image_url,alt_text from team_member_images where image_url is not null`) as {
        member_key: string
        image_url: string
        alt_text: string
      }[]
    return new Map(
      rows.map((r) => [
        r.member_key,
        { memberKey: r.member_key, imageUrl: r.image_url, altText: r.alt_text },
      ]),
    )
  } catch {
    return new Map()
  }
}
export function validTeamKey(key: string) {
  return TEAM_MEMBERS.some((m) => m.key === key)
}
