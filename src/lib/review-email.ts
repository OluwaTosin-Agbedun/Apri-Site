import "server-only"
import { randomUUID } from "node:crypto"
import { Resend } from "resend"
import { deliverEmail, type EmailOutcome } from "./email-delivery"
import { recordReviewEmailAttempt, type ReviewEmailKind } from "./review-email-attempts"

const MANAGER = "intelligence@athenacentre.org"
/**
 * The sender for review emails. The same resolution as the subscriber emails
 * that are delivered today (SUBSCRIBER_FROM_EMAIL, then RESEND_FROM_EMAIL, then
 * the subscriber default), unless REVIEW_FROM_EMAIL names a verified sender of
 * its own. Replies still go to the intelligence desk.
 */
const from =
  process.env.REVIEW_FROM_EMAIL ||
  process.env.SUBSCRIBER_FROM_EMAIL ||
  process.env.RESEND_FROM_EMAIL ||
  "briefings@apri.athenacentre.org"
const esc = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  )

/** Raised when the provider did not accept an email; it carries what the provider said. */
export class ReviewEmailNotSent extends Error {
  readonly outcome: Exclude<EmailOutcome, { status: "accepted" }>
  constructor(outcome: Exclude<EmailOutcome, { status: "accepted" }>) {
    super(outcome.message)
    this.outcome = outcome
  }
}

/**
 * Hands one email to the provider and records what it said (owner-only
 * diagnostics). Resolves only when the provider ACCEPTED it -- which is not
 * delivery to an inbox -- and throws ReviewEmailNotSent otherwise, so no caller
 * can tell anyone an email is on its way when it was refused or not sent.
 */
async function send(kind: ReviewEmailKind, message: Parameters<Resend["emails"]["send"]>[0]): Promise<EmailOutcome & { status: "accepted" }> {
  const key = process.env.RESEND_API_KEY
  const resend = key ? new Resend(key) : null
  const outcome = await deliverEmail(
    resend ? (idempotencyKey) => resend.emails.send(message, { idempotencyKey }) : null,
    `review:${kind}:${randomUUID()}`,
  )
  const to = Array.isArray(message.to) ? message.to[0] : message.to
  await recordReviewEmailAttempt(kind, String(to ?? ""), outcome)
  if (outcome.status !== "accepted") throw new ReviewEmailNotSent(outcome)
  return outcome
}

export function sendReviewVerification(
  email: string,
  name: string,
  url: string,
) {
  return send("review_verification", {
    from: `APRI <${from}>`,
    to: email,
    replyTo: MANAGER,
    subject: "Confirm your APRI review request",
    html: `<p>Dear ${esc(name)},</p><p>Please confirm your email before APRI prepares secure access.</p><p><a href="${esc(url)}">Confirm Email</a></p>`,
  })
}
export function sendReviewManagerNotification(d: {
  name: string
  email: string
  organisation: string
  role: string
  userType: string
  source: string
  utm: string
  when: string
  url: string
}) {
  return send("review_manager_notice", {
    from: `APRI System <${from}>`,
    to: MANAGER,
    replyTo: d.email,
    subject: `Verified APRI review request: ${d.name}`,
    html: `<h1>Verified review request</h1><p>Name: ${esc(d.name)}</p><p>Verified email: ${esc(d.email)}</p><p>Organisation: ${esc(d.organisation)}</p><p>Role: ${esc(d.role)}</p><p>User type: ${esc(d.userType)}</p><p>Lead source: ${esc(d.source)}</p><p>UTM: ${esc(d.utm)}</p><p>Verified: ${esc(d.when)} (Africa/Lagos)</p><p><a href="${esc(d.url)}">Open prospect record</a></p>`,
  })
}
export function sendReviewAccess(email: string, name: string, url: string) {
  return send("review_access", {
    from: `APRI <${from}>`,
    to: email,
    replyTo: MANAGER,
    subject: "Your APRI Complimentary Review access",
    html: `<p>Dear ${esc(name)},</p><p><a href="${esc(url)}">Access APRI Review Library</a></p><p>Access is personal, confidential and not for redistribution.</p>`,
  })
}
/**
 * Asks someone who requested a subscription from the public Subscription
 * Access page to confirm the address it was made with. Until they do, the
 * request cannot be activated: anyone could have typed their address.
 */
export function sendSubscriptionConfirmation(email: string, name: string, url: string) {
  return send("subscription_confirmation", {
    from: `APRI <${from}>`,
    to: email,
    replyTo: MANAGER,
    subject: "Confirm your APRI subscription request",
    html: `<p>Dear ${esc(name)},</p><p>Please confirm your email address so APRI can prepare your subscription agreement and payment details.</p><p><a href="${esc(url)}">Confirm Email</a></p><p>If you did not request an APRI subscription, you can ignore this email.</p>`,
  })
}
export function sendSubscriptionMessages(d: {
  email: string
  name: string
  plan: string
  adminUrl: string
}) {
  return Promise.all([
    send("subscription_messages", {
      from: `APRI <${from}>`,
      to: d.email,
      replyTo: MANAGER,
      subject: "Your APRI subscription request",
      html: `<p>Thank you for your APRI subscription request.</p><p>We will send your subscription agreement and payment details shortly. Your secure subscriber access will be activated once the agreement has been completed and payment confirmed.</p>`,
    }),
    send("subscription_messages", {
      from: `APRI System <${from}>`,
      to: MANAGER,
      replyTo: d.email,
      subject: `APRI ${d.plan} subscription request: ${d.name}`,
      html: `<p>${esc(d.name)} requested ${esc(d.plan)} Access.</p><p><a href="${esc(d.adminUrl)}">Open prospect record</a></p>`,
    }),
  ])
}

/**
 * The Review Library's sign-in email: ONE code, and no link. The reader types
 * it on the sign-in page in the browser they are reading in, which then stays
 * signed in for 24 hours. Sent only to an address assigned at least one
 * published edition, and only when that reader asks. Needs no site address.
 */
export function sendReviewLibrarySignIn(email: string, code: string) {
  const spaced = `${code.slice(0, 4)} ${code.slice(4)}`
  return send("library_sign_in", {
    from: `APRI <${from}>`,
    to: email,
    replyTo: MANAGER,
    subject: "Your APRI Review Library sign-in code",
    html: `<p>Your APRI Complimentary Review Library sign-in code is:</p>
<p style="font-family:'Courier New',Courier,monospace;font-size:28px;letter-spacing:4px;margin:16px 0;">${esc(spaced)}</p>
<p>Enter it on the sign-in page, in the browser you want to read in. It works once and expires in 15 minutes. That browser then stays signed in to your library for 24 hours.</p>
<p>Access is personal, confidential and not for redistribution. If you did not ask for this code, you can ignore this email.</p>`,
    text: `Your APRI Complimentary Review Library sign-in code is ${spaced}. Enter it on the sign-in page, in the browser you want to read in. It works once and expires in 15 minutes. That browser then stays signed in to your library for 24 hours. Access is personal, confidential and not for redistribution. If you did not ask for this code, you can ignore this email.`,
  })
}
