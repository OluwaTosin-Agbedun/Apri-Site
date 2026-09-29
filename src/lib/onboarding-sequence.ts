/**
 * A newly activated subscriber's two onboarding emails -- the decisions and
 * the sequence, with no database or network in the way.
 *
 *   1. The welcome: the subscription is active, a separate secure-access email
 *      follows. No sign-in link.
 *   2. The secure-access email: their personal, one-time sign-in link. Sent
 *      only once the provider has accepted the welcome.
 *
 * Each message is one tracked row per subscriber. A row is claimed before it is
 * sent -- the claim is a conditional update only one caller can win -- so a
 * double-click or two admins at once never send a message twice.
 *
 * What an unsettled attempt (a timeout, a network failure, a crash after the
 * provider accepted it) means differs between the two:
 *
 *  - the welcome's body and idempotency key are fixed, so sending it again is
 *    recognised by the provider and cannot produce a second welcome: an
 *    unsettled welcome is simply retried;
 *  - each secure-access attempt carries a new one-time link, so a second
 *    attempt would be a second email -- and the first may already be in the
 *    inbox. An unsettled secure-access email is therefore never retried
 *    automatically; it is reported, and "Resend sign-in link" is the decision
 *    to send another.
 *
 * A refused secure-access attempt revokes the one link it carried (it never
 * reached anyone). No attempt ever revokes other links, so a retry cannot
 * invalidate a link already delivered.
 *
 * Dependency-free so every path is tested directly: the service
 * (src/lib/subscriber-onboarding.ts) supplies the reads and writes.
 */

import type { EmailOutcome } from "./email-delivery"

export type MessageKind = "welcome" | "secure_access"
export type MessageState = "pending" | "sending" | "accepted" | "failed" | "unknown"

export type MessageRow = {
  id: string
  kind: MessageKind
  state: MessageState
  attempts: number
  claimedAt: string | Date | number | null
  lastError: string | null
  /** When the row was created, just before its first attempt. */
  createdAt?: string | Date | number | null
}

/** A timestamp as milliseconds; NaN when it cannot be read. */
function millis(value: string | Date | number): number {
  if (value instanceof Date) return value.getTime()
  if (typeof value === "number") return value
  return Date.parse(value)
}

export type StepResult =
  | { step: "accepted"; when: "now" | "earlier" }
  | { step: "failed"; message: string; retryable: boolean }
  | { step: "not_configured"; message: string }
  | { step: "unknown"; message: string }
  /** Another attempt holds the claim right now. */
  | { step: "in_progress" }
  /** The secure-access email waits for the welcome to be accepted. */
  | { step: "waiting_for_welcome" }

export type OnboardingReport = {
  welcome: StepResult
  secureAccess: StepResult
  /** Both messages accepted by the provider (not necessarily delivered yet). */
  complete: boolean
}

export type OnboardingDeps = {
  /** Both rows, creating any that are missing. */
  rows(): Promise<{ welcome: MessageRow; secureAccess: MessageRow }>
  /** Claims a row for one attempt. Resolves to the attempt number, or null if another caller holds it. */
  claim(row: MessageRow, options: { allowStale: boolean }): Promise<number | null>
  sendWelcome(): Promise<EmailOutcome>
  /** Issues one new sign-in link without revoking any other. */
  issueToken(): Promise<{ token: string; revoke(): Promise<void> }>
  sendSecureAccess(token: string, attemptKey: string): Promise<EmailOutcome>
  /**
   * Records the outcome of one attempt on its row. Fenced on `attempt`: a late
   * writer from an older attempt can never overwrite a newer one, and nothing
   * overwrites an accepted row.
   */
  record(row: MessageRow, outcome: EmailOutcome, attempt: number): Promise<void>
  /** Marks a row whose attempt was left unsettled (for example a crash) as unknown. */
  markUnknown(row: MessageRow, message: string): Promise<void>
}

export const STALE_CLAIM_MS = 2 * 60_000

/**
 * The provider recognises a repeated idempotency key for 24 hours from its
 * first use. An unsettled welcome is retried automatically only inside that
 * window (with an hour's margin); after it, a resend could be a second welcome.
 */
export const IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60_000

export function withinIdempotencyWindow(row: Pick<MessageRow, "createdAt">, now: number): boolean {
  if (!row.createdAt) return false
  const at = millis(row.createdAt)
  return Number.isFinite(at) && now - at < IDEMPOTENCY_WINDOW_MS
}

function isStale(row: MessageRow, now: number): boolean {
  if (!row.claimedAt) return true
  const at = millis(row.claimedAt)
  return Number.isNaN(at) || now - at > STALE_CLAIM_MS
}

function fromOutcome(outcome: EmailOutcome): StepResult {
  switch (outcome.status) {
    case "accepted":
      return { step: "accepted", when: "now" }
    case "not_configured":
      return { step: "not_configured", message: outcome.message }
    case "rejected":
      return { step: "failed", message: outcome.message, retryable: outcome.retryable }
    case "unknown":
      return { step: "unknown", message: outcome.message }
  }
}

async function settle<T>(run: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await run() }
  } catch {
    return { ok: false }
  }
}

const UNREACHABLE: EmailOutcome = { status: "unknown", message: "The attempt stopped before its result could be read." }

/**
 * Records an outcome without letting a failed write replace what the
 * provider said: an accepted message is still reported as accepted, and its
 * row -- left 'sending' -- is settled as unknown by a later run, never resent
 * automatically as a secure-access email.
 */
async function recordSafely(deps: OnboardingDeps, row: MessageRow, outcome: EmailOutcome, attempt: number): Promise<void> {
  await settle(() => deps.record(row, outcome, attempt))
}

async function runWelcome(deps: OnboardingDeps, row: MessageRow, now: number): Promise<StepResult> {
  if (row.state === "accepted") return { step: "accepted", when: "earlier" }
  if (row.state === "sending" && !isStale(row, now)) return { step: "in_progress" }
  // An unsettled welcome (unknown, or a stale claim) is safe to send again
  // only while the provider still recognises its idempotency key. After that
  // it may already be in the inbox, and a resend would be a second welcome.
  if ((row.state === "unknown" || row.state === "sending") && !withinIdempotencyWindow(row, now)) {
    return {
      step: "unknown",
      message:
        "The welcome email's outcome was never settled and it is too old to resend safely. Use Resend sign-in link to send the access email.",
    }
  }
  // pending, failed, or unsettled inside the window: safe to send.
  const attempt = await deps.claim(row, { allowStale: true })
  if (attempt === null) return { step: "in_progress" }
  const sent = await settle(() => deps.sendWelcome())
  const outcome = sent.ok ? sent.value : UNREACHABLE
  await recordSafely(deps, row, outcome, attempt)
  return fromOutcome(outcome)
}

async function runSecureAccess(deps: OnboardingDeps, row: MessageRow, now: number): Promise<StepResult> {
  if (row.state === "accepted") return { step: "accepted", when: "earlier" }
  if (row.state === "unknown") {
    return {
      step: "unknown",
      message:
        row.lastError ??
        "An earlier attempt did not settle, so the secure-access email may already have been sent. Use Resend sign-in link to send a fresh one.",
    }
  }
  if (row.state === "sending") {
    if (!isStale(row, now)) return { step: "in_progress" }
    // An attempt was claimed and never finished: it may have been sent.
    const message =
      "The last attempt stopped before its result was recorded, so the secure-access email may already have been sent. Use Resend sign-in link to send a fresh one."
    await deps.markUnknown(row, message)
    return { step: "unknown", message }
  }

  // pending or failed: never sent, so sending is safe.
  const attempt = await deps.claim(row, { allowStale: false })
  if (attempt === null) return { step: "in_progress" }
  const issued = await settle(() => deps.issueToken())
  if (!issued.ok) {
    const outcome: EmailOutcome = { status: "rejected", message: "A sign-in link could not be issued, so nothing was sent.", retryable: true }
    await recordSafely(deps, row, outcome, attempt)
    return fromOutcome(outcome)
  }
  const sent = await settle(() => deps.sendSecureAccess(issued.value.token, `${row.id}:${attempt}`))
  const outcome = sent.ok ? sent.value : UNREACHABLE
  // A link the provider refused never reached anyone: revoke it. One whose
  // outcome is unknown is left alone -- it may be in the inbox.
  if (outcome.status === "rejected" || outcome.status === "not_configured") {
    await settle(() => issued.value.revoke())
  }
  await recordSafely(deps, row, outcome, attempt)
  return fromOutcome(outcome)
}

/**
 * Runs whatever the subscriber's onboarding still needs: the welcome if it
 * has not been accepted, then the secure-access email once it has.
 * Idempotent: messages already accepted are never sent again.
 */
export async function runOnboarding(deps: OnboardingDeps, now = Date.now()): Promise<OnboardingReport> {
  const { welcome, secureAccess } = await deps.rows()
  const welcomeResult = await runWelcome(deps, welcome, now)
  const accessResult =
    welcomeResult.step === "accepted"
      ? await runSecureAccess(deps, secureAccess, now)
      : secureAccess.state === "accepted"
        ? ({ step: "accepted", when: "earlier" } as const)
        : ({ step: "waiting_for_welcome" } as const)
  return {
    welcome: welcomeResult,
    secureAccess: accessResult,
    complete: welcomeResult.step === "accepted" && accessResult.step === "accepted",
  }
}

function describeStep(label: string, step: StepResult): string {
  switch (step.step) {
    case "accepted":
      return `${label} accepted by the email provider${step.when === "earlier" ? " earlier" : ""} (delivery is confirmed separately).`
    case "failed":
      return `${label} was not sent: ${step.message}${step.retryable ? " It can be retried." : ""}`
    case "not_configured":
      return `${label} was not sent: ${step.message}`
    case "unknown":
      return `${label}: outcome unknown. ${step.message}`
    case "in_progress":
      return `${label} is being sent by another attempt right now.`
    case "waiting_for_welcome":
      return `${label} will follow once the welcome email is accepted.`
  }
}

/** The administrator's account of both emails. Never includes a link. */
export function describeOnboarding(report: OnboardingReport): string {
  if (report.complete) {
    const fresh = [report.welcome, report.secureAccess].filter((s) => s.step === "accepted" && s.when === "now").length
    return fresh === 0
      ? "Both onboarding emails were accepted by the email provider earlier."
      : "Welcome and secure-access emails accepted by the email provider (delivery is confirmed separately)."
  }
  return [describeStep("Welcome email", report.welcome), describeStep("Secure-access email", report.secureAccess)].join(" ")
}
