import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

export function newAuthenticatorSecret(): string {
  const bytes = randomBytes(20)
  let bits = ""
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0")
  return bits.match(/.{5}/g)!.map((part) => ALPHABET[parseInt(part, 2)]).join("")
}

function decodeBase32(secret: string): Buffer {
  if (!/^[A-Z2-7]{16,128}$/.test(secret)) throw new Error("Invalid authenticator secret")
  const bits = [...secret].map((char) => ALPHABET.indexOf(char).toString(2).padStart(5, "0")).join("")
  return Buffer.from((bits.match(/.{8}/g) ?? []).map((part) => parseInt(part, 2)))
}

/** RFC 6238 / RFC 4226; six digits, 30 seconds in normal use. */
export function totp(secret: string, step: number, digits = 6): string {
  if (!Number.isSafeInteger(step) || step < 0 || ![6, 8].includes(digits)) throw new Error("Invalid OTP parameters")
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const mac = createHmac("sha1", decodeBase32(secret)).update(counter).digest()
  const offset = mac[mac.length - 1]! & 15
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits).padStart(digits, "0")
}

export function equalSecret(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** Returns the matched step; the caller MUST claim it atomically against replay. */
export function matchingTotpStep(secret: string, input: string, now = Date.now(), lastStep = -1): number | null {
  const code = input.replace(/\s/g, "")
  if (!/^\d{6}$/.test(code)) return null
  const current = Math.floor(now / 30_000)
  for (const step of [current, current - 1, current + 1]) {
    if (step >= 0 && step > lastStep && equalSecret(totp(secret, step), code)) return step
  }
  return null
}

function key(master: string, purpose: string): Buffer {
  if (master.length < 32) throw new Error("Security key is not configured")
  return createHmac("sha256", master).update(`apri-staff-security:v1:${purpose}`).digest()
}

export function sealStaffSecret(value: string, master: string, adminId: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key(master, "encryption"), iv)
  cipher.setAAD(Buffer.from(adminId))
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".")
}

export function openStaffSecret(value: string, master: string, adminId: string): string {
  const [version, nonce, tag, ciphertext, extra] = value.split(".")
  if (version !== "v1" || !nonce || !tag || !ciphertext || extra) throw new Error("Invalid protected secret")
  const decipher = createDecipheriv("aes-256-gcm", key(master, "encryption"), Buffer.from(nonce, "base64url"))
  decipher.setAAD(Buffer.from(adminId))
  decipher.setAuthTag(Buffer.from(tag, "base64url"))
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8")
}

export function newRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, () => randomBytes(12).toString("hex").match(/.{6}/g)!.join("-"))
}

export function recoveryHash(code: string, master: string, adminId: string): string | null {
  const normal = code.replace(/[\s-]/g, "").toLowerCase()
  if (!/^[0-9a-f]{24}$/.test(normal)) return null
  return createHmac("sha256", key(master, "recovery")).update(`${adminId}:${normal}`).digest("hex")
}

export function challengeHash(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}
