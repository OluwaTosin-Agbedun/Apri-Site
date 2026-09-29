/**
 * The Individual and Professional subscription journey -- the decisions, with
 * no database, network or email in the way.
 *
 * A request never grants anything. Paid access follows, in order: the request;
 * APRI sends the agreement (the existing DocuSign/manual process) and the
 * invoice; the agreement is signed and payment confirmed, both recorded by an
 * owner; then activation, which gives each named person their own subscriber
 * record, their own portal sign-in and their own personal document links.
 * Payment is manual and offline: there is no gateway, and nothing here takes
 * or checks a card.
 *
 * Dependency-free so every rule is tested directly.
 */

export const PLANS = {
  Individual: {
    plan: "Individual",
    label: "Individual Access",
    price: "₦2 million annually",
    users: "1 named authorised subscriber",
    maxUsers: 1,
    /** The stored subscription tier. Its name is unchanged, so existing subscribers are unaffected. */
    tier: "Individual Access",
    agreement: "APRI Individual Subscription",
  },
  Professional: {
    plan: "Professional",
    label: "Professional Access",
    price: "₦5 million annually",
    users: "Up to 3 named authorised subscribers",
    maxUsers: 3,
    // Professional Access is sold as the existing Professional Team Access
    // tier: the same L1 content for individually named readers.
    tier: "Professional Team Access",
    agreement: "APRI Professional Subscription",
  },
} as const

export type PlanKey = keyof typeof PLANS

export function parsePlan(value: unknown): PlanKey | null {
  return value === "Individual" || value === "Professional" ? value : null
}

export type AuthorisedUser = { name: string; email: string }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * The named people a plan covers: one for Individual, one to three for
 * Professional, each with a name and a distinct valid email.
 */
export function validateAuthorisedUsers(
  plan: PlanKey,
  users: readonly AuthorisedUser[],
): { ok: true; users: AuthorisedUser[] } | { ok: false; message: string } {
  const max = PLANS[plan].maxUsers
  const cleaned = users.map((u) => ({ name: u.name.trim(), email: u.email.trim().toLowerCase() }))
  if (cleaned.length < 1) return { ok: false, message: "At least one authorised subscriber is required." }
  if (cleaned.length > max) {
    return {
      ok: false,
      message:
        plan === "Individual"
          ? "Individual Access covers one named subscriber."
          : "Professional Access covers at most three named subscribers.",
    }
  }
  for (const user of cleaned) {
    if (user.name.length < 2 || user.name.length > 120 || !EMAIL.test(user.email) || user.email.length > 254) {
      return { ok: false, message: "Each authorised subscriber needs a name and a valid email address." }
    }
  }
  if (new Set(cleaned.map((u) => u.email)).size !== cleaned.length) {
    return { ok: false, message: "Each authorised subscriber needs their own email address." }
  }
  return { ok: true, users: cleaned }
}

// ---------------------------------------------------------------------------
// The activation gate
// ---------------------------------------------------------------------------

export type RequestFacts = {
  plan: string
  /** The requester owns the email: a verified Review Library session, or the confirmation link used. */
  requesterConfirmed: boolean
  agreementSentAt: string | null
  agreementSignedAt: string | null
  invoiceSentAt: string | null
  paymentConfirmedAt: string | null
  termStart: string | null
  termEnd: string | null
  authorisedUsers: unknown
}

export type GateResult = { ok: true; plan: PlanKey; users: AuthorisedUser[] } | { ok: false; missing: string[] }

const DATE = /^\d{4}-\d{2}-\d{2}/

function dayOf(value: string | null): string | null {
  return value && DATE.test(value) ? value.slice(0, 10) : null
}

/**
 * Whether a request may be activated.
 *
 * Both a signed agreement and a confirmed payment are required -- neither is
 * enough alone, and nothing else (the request, a verified email, an invoice)
 * stands in for either. The other conditions are what an activation needs to
 * be correct: a verified requester, a term that has not already ended, and
 * the plan's named subscribers.
 */
export function activationGate(facts: RequestFacts, today: string): GateResult {
  const missing: string[] = []
  const plan = parsePlan(facts.plan)
  if (!plan) missing.push("A known plan (Individual or Professional)")
  if (!facts.requesterConfirmed) missing.push("The requester's email address confirmed")
  if (!dayOf(facts.agreementSentAt)) missing.push("Agreement sent")
  if (!dayOf(facts.agreementSignedAt)) missing.push("Agreement signed")
  if (!dayOf(facts.invoiceSentAt)) missing.push("Invoice issued")
  if (!dayOf(facts.paymentConfirmedAt)) missing.push("Payment confirmed")

  const start = dayOf(facts.termStart)
  const end = dayOf(facts.termEnd)
  if (!start || !end) missing.push("Subscription start and end dates")
  else if (end < start) missing.push("A subscription end date after its start date")
  else if (end < today) missing.push("A subscription end date that has not passed")

  let users: AuthorisedUser[] = []
  if (plan) {
    const list = Array.isArray(facts.authorisedUsers)
      ? (facts.authorisedUsers as unknown[]).filter(
          (u): u is AuthorisedUser =>
            Boolean(u) && typeof (u as AuthorisedUser).name === "string" && typeof (u as AuthorisedUser).email === "string",
        )
      : []
    const checked = validateAuthorisedUsers(plan, list)
    if (!checked.ok) missing.push(checked.message)
    else users = checked.users
  }

  if (missing.length > 0 || !plan) return { ok: false, missing }
  return { ok: true, plan, users }
}

// ---------------------------------------------------------------------------
// What an activation run achieved
// ---------------------------------------------------------------------------

export type SeatOutcome =
  /**
   * Active, library verified, and both onboarding emails accepted by the
   * provider -- in this run (`now`) or an earlier one (`earlier`).
   */
  | { email: string; name: string; state: "activated"; emails: "now" | "earlier" }
  /** Active, library verified, but an onboarding email still needs a retry. */
  | { email: string; name: string; state: "emails_pending"; reason: string }
  /** Not activated because their library could not be verified. Nothing was sent. */
  | { email: string; name: string; state: "held"; reason: string }
  /** Could not be activated: nothing was changed for this person. */
  | { email: string; name: string; state: "blocked"; reason: string }

/**
 * Activation is complete only when every named subscriber is active with a
 * verified library and both onboarding emails accepted by the provider.
 */
export function activationComplete(outcomes: readonly SeatOutcome[], expected: number): boolean {
  return outcomes.length === expected && expected > 0 && outcomes.every((o) => o.state === "activated")
}

export function describeActivation(outcomes: readonly SeatOutcome[], expected: number): string {
  if (activationComplete(outcomes, expected)) {
    const fresh = outcomes.filter((o) => o.state === "activated" && o.emails === "now").length
    return `Access activated for all ${expected} named subscriber${expected === 1 ? "" : "s"}${
      fresh
        ? `; welcome and secure-access emails accepted by the email provider for ${fresh} (delivery is confirmed separately)`
        : ""
    }.`
  }
  const lines = outcomes.map((o) =>
    o.state === "activated"
      ? `${o.name}: activated; onboarding emails accepted.`
      : o.state === "emails_pending"
        ? `${o.name}: access is ready, but the onboarding emails need retrying -- ${o.reason}`
        : o.state === "held"
          ? `${o.name}: access not ready -- ${o.reason}`
          : `${o.name}: not activated -- ${o.reason}`,
  )
  return `Activation is not complete. ${lines.join(" ")} Fix what is listed, then activate again: an email the provider already accepted is never sent twice.`
}

/** The status ladder a prospect moves up. It never moves down. */
export const PROSPECT_STATUSES = [
  "Review Requested",
  "Email Verified",
  "Review Access Sent",
  "Subscription Requested",
  "Agreement Sent",
  "Agreement Signed",
  "Invoice Sent",
  "Payment Confirmed",
  "Access Activated",
  "Active Subscriber",
] as const

export function laterStatus(current: string, next: string): string {
  const a = PROSPECT_STATUSES.indexOf(current as (typeof PROSPECT_STATUSES)[number])
  const b = PROSPECT_STATUSES.indexOf(next as (typeof PROSPECT_STATUSES)[number])
  if (b < 0) return current
  return a > b ? current : next
}

/**
 * The status a request's recorded milestones reach. Payment follows the
 * invoice and signature follows sending, as the Admin form enforces.
 */
export function milestoneStatus(m: {
  agreementSentAt: string | null
  agreementSignedAt: string | null
  invoiceSentAt: string | null
  paymentConfirmedAt: string | null
}): string {
  if (m.paymentConfirmedAt) return "Payment Confirmed"
  if (m.invoiceSentAt) return "Invoice Sent"
  if (m.agreementSignedAt) return "Agreement Signed"
  if (m.agreementSentAt) return "Agreement Sent"
  return "Subscription Requested"
}
