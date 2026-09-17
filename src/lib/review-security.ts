import "server-only"
import { createHash, randomBytes } from "node:crypto"
import { cookies, headers } from "next/headers"
import { jwtVerify, SignJWT } from "jose"
import { getSql } from "./db"

const REVIEW_COOKIE = "apri_review_session"
const DAY = 24 * 60 * 60

export const hashToken = (value: string) =>
  createHash("sha256").update(value).digest("hex")
export const newToken = () => randomBytes(32).toString("base64url")

function key() {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32)
    throw new Error("SESSION_SECRET must be at least 32 characters")
  return new TextEncoder().encode(secret)
}

export async function createReviewSession(prospectId: string) {
  const token = await new SignJWT({ prospectId, kind: "review" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${DAY}s`)
    .sign(key())
  ;(await cookies()).set(REVIEW_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/review",
    maxAge: DAY,
  })
}

export async function readReviewSession(): Promise<string | null> {
  const token = (await cookies()).get(REVIEW_COOKIE)?.value
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] })
    return payload.kind === "review" && typeof payload.prospectId === "string"
      ? payload.prospectId
      : null
  } catch {
    return null
  }
}

export async function enforceReviewRateLimit(action: string, limit = 8) {
  const h = await headers()
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const identityHash = hashToken(
    `${process.env.SESSION_SECRET || "missing"}:${ip}`,
  )
  const sql = getSql()
  const rows = (await sql`
    select count(*)::int as count from review_rate_limits
    where action=${action} and identity_hash=${identityHash} and created_at > now() - interval '1 hour'
  `) as { count: number }[]
  if ((rows[0]?.count ?? 0) >= limit)
    throw new Error("Too many attempts. Please try again later.")
  await sql`insert into review_rate_limits(action, identity_hash) values (${action}, ${identityHash})`
}

export function safeHttpsUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      return null
    const h = url.hostname.toLowerCase().replace(/^\[|\]$/g, "")
    if (
      h === "localhost" ||
      h.endsWith(".localhost") ||
      h === "0.0.0.0" ||
      h === "::1" ||
      /^127\./.test(h) ||
      /^10\./.test(h) ||
      /^192\.168\./.test(h) ||
      /^169\.254\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
      /^fc/i.test(h) ||
      /^fd/i.test(h) ||
      /^fe80:/i.test(h)
    )
      return null
    return url
  } catch {
    return null
  }
}
