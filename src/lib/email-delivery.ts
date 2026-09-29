/**
 * What happened to one email handed to the provider -- decided from what the
 * provider actually returned, never from the absence of an exception.
 *
 * The Resend SDK does not throw when it refuses a message or cannot be
 * reached: it returns `{ error }`. A caller that only checked for a thrown
 * error recorded every refused, unconfigured or unreachable send as sent,
 * which is how a welcome email could be "sent" with no email key at all.
 *
 * Only `accepted` means the provider took the message, and even that is not
 * delivery to the inbox: delivery is confirmed separately, by the provider's
 * `email.delivered` webhook.
 *
 * Dependency-free so every outcome is tested directly.
 */

export type EmailOutcome =
  /** The provider accepted the message and gave it this id. Not yet delivered. */
  | { status: "accepted"; providerMessageId: string }
  /** No email key is configured, so nothing was sent. */
  | { status: "not_configured"; message: string }
  /** The provider refused the message (a 4xx answer). `retryable` for a rate limit. */
  | { status: "rejected"; message: string; retryable: boolean }
  /**
   * No answer that settles it: a timeout, a network failure, a provider fault
   * (5xx) or an answer with no message id. The provider may or may not have
   * accepted the message.
   */
  | { status: "unknown"; message: string }

export type ProviderError = { message?: string | null; statusCode?: number | null; name?: string | null }
export type ProviderResult = { data?: { id?: string | null } | null; error?: ProviderError | null } | null | undefined

/** Sends one message with the given idempotency key; null when email is not configured. */
export type ProviderSend = ((idempotencyKey: string) => Promise<ProviderResult>) | null

export const EMAIL_TIMEOUT_MS = 15_000

class Timeout extends Error {}

/** Provider text is shown to an administrator: kept short, one line, and free of links and addresses. */
export function safeText(value: string | null | undefined): string {
  const text = (value ?? "")
    .replace(/\s+/g, " ")
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/[^\s<>"'()]+@[^\s<>"'()]+/g, "[address]")
    .replace(/\b(token|key)=\S+/gi, "$1=[hidden]")
    .trim()
  return text.length > 200 ? `${text.slice(0, 197)}...` : text || "no reason given"
}

export async function deliverEmail(
  send: ProviderSend,
  idempotencyKey: string,
  options: { timeoutMs?: number } = {},
): Promise<EmailOutcome> {
  if (!send) {
    return { status: "not_configured", message: "Email is not configured (no RESEND_API_KEY), so nothing was sent." }
  }
  const timeoutMs = options.timeoutMs ?? EMAIL_TIMEOUT_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      send(idempotencyKey),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Timeout()), timeoutMs)
      }),
    ])
    const error = result?.error
    if (error) {
      const name = error.name ?? ""
      const code = typeof error.statusCode === "number" ? error.statusCode : null
      // The SDK reports a request it could not make, or another request still
      // running with the same key, as an error -- neither says the message was
      // refused, so neither is a refusal.
      // A provider fault (5xx) is the same: the provider may have taken the
      // message before it failed, so it is not known to have been refused.
      if (name === "application_error" || name === "concurrent_idempotent_requests" || code === null || code >= 500) {
        return {
          status: "unknown",
          message: `The email provider could not be reached or did not settle the request (${safeText(error.message)}). The message may or may not have been accepted.`,
        }
      }
      return {
        status: "rejected",
        message: `The email provider refused the message (${code}: ${safeText(error.message)}).`,
        retryable: code === 429,
      }
    }
    const id = result?.data?.id
    if (!id) {
      return { status: "unknown", message: "The email provider answered without a message id, so it is not known whether it accepted the message." }
    }
    return { status: "accepted", providerMessageId: id }
  } catch (error) {
    if (error instanceof Timeout) {
      return {
        status: "unknown",
        message: `The email provider did not answer within ${Math.round(timeoutMs / 1000)} seconds. The message may or may not have been accepted.`,
      }
    }
    return { status: "unknown", message: "The email provider could not be reached. The message may or may not have been accepted." }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** A short, stable fingerprint of a message body, for an idempotency key. */
export function fingerprint(text: string): string {
  // FNV-1a, 64-bit, in two 32-bit halves: stable across processes and
  // dependency-free. It only tells two payloads apart; it protects nothing.
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")
}
