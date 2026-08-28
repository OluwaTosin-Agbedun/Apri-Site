import { createHmac, timingSafeEqual } from "node:crypto"

export function verifyResendWebhook(
  body: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  secret: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!secret || !headers.id || !headers.timestamp || !headers.signature) return false
  const timestamp = Number(headers.timestamp)
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > 300) return false
  try {
    const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64")
    const expected = createHmac("sha256", key)
      .update(`${headers.id}.${headers.timestamp}.${body}`).digest("base64")
    return headers.signature.split(" ").some((part) => {
      const value = part.startsWith("v1,") ? part.slice(3) : ""
      const a = Buffer.from(value); const b = Buffer.from(expected)
      return a.length === b.length && timingSafeEqual(a,b)
    })
  } catch { return false }
}
