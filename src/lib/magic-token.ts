import { createHash } from "node:crypto"

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export type StoredTokenState = {
  consumed_at: string | null
  expires_at: string
}

export function storedTokenFailureReason(
  row: StoredTokenState | null | undefined,
  now = new Date(),
): "invalid" | "expired" | "used" {
  if (!row) return "invalid"
  if (row.consumed_at) return "used"
  const expiresAt = new Date(row.expires_at)
  return Number.isNaN(expiresAt.getTime()) || expiresAt <= now
    ? "expired"
    : "invalid"
}
