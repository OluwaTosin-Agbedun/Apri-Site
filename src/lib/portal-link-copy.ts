import { dateOnly, lagosToday } from "./subscription-term.ts"
/**
 * When Admin may offer "Copy portal link" for one subscriber, and what it
 * copies.
 *
 * Dependency-free so the rule is tested directly. The subscriber page reads the
 * record and that subscriber's own latest access email, calls this, and shows
 * the button only on `show: true`.
 *
 * What is copied is the stable portal sign-in page, never the link inside the
 * access email. That link carries a single-use sign-in token -- a bearer
 * credential -- so exposing it through Admin or a clipboard would hand out a
 * sign-in. The sign-in page carries no token and no identity, so the copied
 * value is identical for every subscriber and grants nothing by itself: the
 * subscriber still has to prove their own address to get in.
 */

export type PortalLinkSubject = {
  subscriberId: string
  status: string
  clientType: string
  /** The term end date, or null for an open-ended term. */
  termEnd: string | Date | null
}

/** The latest access or sign-in email Resend accepted for one subscriber. */
export type AccessEmailRecord = {
  /** Whose engagement event this is. Must be the subject's own. */
  subscriberId: string
  resendEmailId: string | null
  sentAt: string | null
  /** A bounce or failure was later recorded for this same email. */
  failed: boolean
}

export type PortalLinkDecision =
  | { show: true; url: string; subscriberId: string }
  | { show: false; reason: string }

/**
 * Whether the sign-in URL is the stable, token-free page.
 *
 * Checked rather than assumed, so a future change that pointed this at a URL
 * with a query string -- where a token would live -- hides the button instead
 * of copying it.
 */
export function isStableSignInUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return (
      u.protocol === "https:" &&
      u.pathname === "/portal/sign-in" &&
      u.search === "" &&
      u.hash === "" &&
      !u.username &&
      !u.password
    )
  } catch {
    return false
  }
}

/**
 * The portal's own sign-in rule (src/lib/subscription-term.ts): a seat whose
 * term has ended is refused there, so no link is offered for it here.
 */
function termCurrent(termEnd: string | Date | null, now: Date): boolean {
  if (termEnd === null || termEnd === "") return true
  const end = dateOnly(termEnd)
  if (!end) return false
  return end >= lagosToday(now)
}

export function decidePortalLinkCopy(args: {
  subscriber: PortalLinkSubject
  accessEmail: AccessEmailRecord | null
  signInUrl: string
  /** For tests. Defaults to the current time. */
  now?: Date
}): PortalLinkDecision {
  const { subscriber, accessEmail } = args

  if (subscriber.clientType !== "subscriber") {
    return { show: false, reason: "Only a subscriber record has a portal sign-in." }
  }
  if ((subscriber.status ?? "").toLowerCase() !== "active") {
    return { show: false, reason: "Only an active seat can sign in to the portal." }
  }
  // Read only: this decides whether to offer the button, never who may sign
  // in. The portal applies its own check again when the link is used.
  if (!termCurrent(subscriber.termEnd, args.now ?? new Date())) {
    return { show: false, reason: "This subscriber's term has ended, so the portal would refuse their sign-in." }
  }
  if (!accessEmail) {
    return { show: false, reason: "No access email to this subscriber has been accepted for delivery yet." }
  }
  // Defence in depth: the record must belong to this subscriber, so one
  // subscriber's delivery can never unlock the button on another's page.
  if (accessEmail.subscriberId !== subscriber.subscriberId) {
    return { show: false, reason: "The access email on record does not belong to this subscriber." }
  }
  if (!accessEmail.resendEmailId) {
    return { show: false, reason: "No access email to this subscriber has been accepted for delivery yet." }
  }
  if (accessEmail.failed) {
    return {
      show: false,
      reason: "The last access email to this subscriber bounced or failed, so portal sign-in would not reach them.",
    }
  }
  if (!isStableSignInUrl(args.signInUrl)) {
    return { show: false, reason: "The portal sign-in address is not configured as a stable, token-free page." }
  }
  return { show: true, url: args.signInUrl, subscriberId: subscriber.subscriberId }
}
