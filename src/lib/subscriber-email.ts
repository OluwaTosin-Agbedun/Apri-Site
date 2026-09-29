import "server-only"
import { randomUUID } from "node:crypto"
import { Resend } from "resend"
import { seriesLabel, tierDisplayName } from "./entitlements"
import { emailNotice } from "./delivery"
import { APRI_PRODUCTION_URL, portalSignInUrl, portalVerificationUrl } from "./app-url"
import { recordClientEvent, type ClientPrincipal } from "./client-engagement"
import { deliverEmail, fingerprint, type EmailOutcome } from "./email-delivery"

export type { EmailOutcome } from "./email-delivery"

/**
 * Transactional email for the subscriber portal.
 *
 * Kept apart from lib/email.ts, which serves the public briefing enquiry form,
 * because these messages carry sign-in links and must not accidentally acquire
 * a Cc, a Bcc or a shared recipient. Every message here goes to exactly one
 * named seat.
 *
 * Every send returns what the provider actually said (see email-delivery.ts):
 * accepted with its message id, not configured, refused, or unknown. None of
 * them throws for an expected failure, and none of them reports a message as
 * sent that the provider did not accept. Each carries an idempotency key, so a
 * retry of the same message is recognised by the provider rather than sent
 * twice.
 */

let _resend: Resend | null = null

function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY)
  return _resend
}

type Message = Parameters<Resend["emails"]["send"]>[0]

/** Hands one message to the provider under an idempotency key and reports what happened. */
function send(message: Message, idempotencyKey: string): Promise<EmailOutcome> {
  const resend = getResend()
  return deliverEmail(
    resend ? (key) => resend.emails.send(message, { idempotencyKey: key }) : null,
    idempotencyKey,
  )
}

const FROM = process.env.SUBSCRIBER_FROM_EMAIL ?? process.env.RESEND_FROM_EMAIL ?? "briefings@apri.athenacentre.org"
const CONTACT =
  process.env.BRIEFING_MANAGER_EMAIL ?? "intelligence@athenacentre.org"

// ---------------------------------------------------------------------------
// Sign-in link
// ---------------------------------------------------------------------------

/** The sign-in page's link, sent when someone asks for it there. */
export async function sendSignInLink(args: {
  subscriberId: string
  email: string
  fullName: string
  token: string
}): Promise<EmailOutcome> {
  const url = portalVerificationUrl(args.token)
  const greeting = args.fullName ? `, ${args.fullName}` : ""

  const outcome = await send({
    from: `APRI <${FROM}>`,
    to: args.email,
    subject: "Your APRI sign-in link",
    html: shell(`
      <h1 style="margin:0 0 20px;font-size:22px;color:#1a1a1a;font-weight:normal;">Sign in to your APRI library</h1>

      <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#333333;">
        Good day${esc(greeting)}. Use the button below to open your intelligence library.
        The link works once and expires in 15 minutes.
      </p>

      ${button("Open my library", url)}

      <p style="margin:24px 0 0;font-size:13px;line-height:1.7;color:#888888;">
        If you did not request this, you can ignore this message &mdash; nothing has changed
        on your account. This link is personal to you; please do not forward it.
      </p>
    `),
  }, `signin:${args.subscriberId}:${fingerprint(args.token)}`)
  await trackAccepted({ type: "subscriber", id: args.subscriberId }, outcome)
  return outcome
}

// ---------------------------------------------------------------------------
// Lapsed access
//
// Sent instead of a sign-in link when the subscription has ended. The person
// still gets a reply, so the portal never has to say "your access has lapsed"
// on a public page, which would confirm to a stranger that the address is on
// our list.
// ---------------------------------------------------------------------------

export async function sendLapsedNotice(args: {
  email: string
  fullName: string
}): Promise<EmailOutcome> {
  const greeting = args.fullName ? `, ${args.fullName}` : ""

  return send({
    from: `APRI <${FROM}>`,
    to: args.email,
    replyTo: CONTACT,
    subject: "Your APRI access",
    html: shell(`
      <h1 style="margin:0 0 20px;font-size:22px;color:#1a1a1a;font-weight:normal;">Your APRI access has ended</h1>

      <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#333333;">
        Good day${esc(greeting)}. Your subscription term has come to an end, so your
        intelligence library is no longer open.
      </p>

      <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#333333;">
        We would be glad to continue. Reply to this message, or write to
        <a href="mailto:${esc(CONTACT)}" style="color:#b49f69;">${esc(CONTACT)}</a>,
        and we will arrange renewal.
      </p>
    `),
  }, `lapsed:${randomUUID()}`)
}

// ---------------------------------------------------------------------------
// Welcome, sent when an administrator activates a seat
// ---------------------------------------------------------------------------

/**
 * The first onboarding email: the subscription is active, and a separate
 * secure-access email follows. It carries no sign-in link -- the personal,
 * one-time link travels only in the second message.
 *
 * The body is fixed for a given subscriber, so its idempotency key is too:
 * sending it again after an unsettled attempt is recognised by the provider
 * and never produces a second welcome.
 */
export function welcomeMessage(args: {
  subscriberId: string
  email: string
  fullName: string
  publicTier: string
  termEnd: string | null
}): { message: Message; idempotencyKey: string } {
  const greeting = args.fullName ? `, ${args.fullName}` : ""
  const html = shell(`
      <h1 style="margin:0 0 20px;font-size:22px;color:#1a1a1a;font-weight:normal;">Welcome to APRI</h1>

      <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#333333;">
        Good day${esc(greeting)}. Your APRI subscription is now active.
      </p>

      <table width="100%" cellpadding="0" cellspacing="0" style="background:#faf9f6;border:1px solid #e8e5df;border-radius:4px;margin:0 0 24px;">
        ${args.publicTier ? row("Subscription", tierDisplayName(args.publicTier)) : ""}
        ${args.termEnd ? row("Access until", formatDate(args.termEnd)) : ""}
      </table>

      <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#333333;">
        We are sending your secure access link in a separate email. It is personal to you,
        works once and expires shortly after it is sent.
      </p>

      <p style="margin:0 0 0;font-size:13px;line-height:1.7;color:#888888;">
        If that link has expired, request a fresh one at any time from
        <a href="${esc(portalSignInUrl())}" style="color:#b49f69;">the APRI sign-in page</a>
        using this email address. ${esc(emailNotice())}
      </p>
    `)
  return {
    message: {
      from: `APRI <${FROM}>`,
      to: args.email,
      replyTo: CONTACT,
      subject: "Your APRI subscription is active",
      html,
    },
    idempotencyKey: `welcome:${args.subscriberId}:${fingerprint(`${args.email}\n${html}`)}`,
  }
}

export function sendWelcome(args: Parameters<typeof welcomeMessage>[0]): Promise<EmailOutcome> {
  const { message, idempotencyKey } = welcomeMessage(args)
  return send(message, idempotencyKey)
}

/**
 * The second onboarding email, and the one "Resend sign-in link" sends: the
 * subscriber's personal, one-time sign-in link from the existing mechanism.
 * `attemptKey` identifies this one attempt, so the provider never sends the
 * same attempt twice.
 */
export async function sendSecureAccess(args: {
  subscriberId: string
  email: string
  fullName: string
  token: string
  attemptKey: string
}): Promise<EmailOutcome> {
  const url = portalVerificationUrl(args.token)
  const greeting = args.fullName ? `, ${args.fullName}` : ""
  const outcome = await send({
    from: `APRI <${FROM}>`,
    to: args.email,
    replyTo: CONTACT,
    subject: "Your secure APRI access link",
    html: shell(`
      <h1 style="margin:0 0 20px;font-size:22px;color:#1a1a1a;font-weight:normal;">Your secure access link</h1>

      <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#333333;">
        Good day${esc(greeting)}. Use the button below to open your APRI intelligence
        library. The link is personal to you, works once and expires in 15 minutes.
      </p>

      ${button("Open my library", url)}

      <p style="margin:24px 0 0;font-size:13px;line-height:1.7;color:#888888;">
        If it has expired, request a fresh link from
        <a href="${esc(portalSignInUrl())}" style="color:#b49f69;">the APRI sign-in page</a>
        using this email address. Please do not forward this email. ${esc(emailNotice())}
      </p>
    `),
  }, `access:${args.attemptKey}`)
  await trackAccepted({ type: "subscriber", id: args.subscriberId }, outcome)
  return outcome
}

/**
 * The existing engagement record for a sign-in email, written only once the
 * provider accepted it. The Resend webhook finds the subscriber through it to
 * record delivery, opens and bounces.
 */
async function trackAccepted(principal: ClientPrincipal, outcome: EmailOutcome) {
  if (outcome.status !== "accepted") return
  try {
    await recordClientEvent(principal, "signin_email_sent", { resendEmailId: outcome.providerMessageId })
  } catch {
    /* the provider's acceptance stands; analytics must not undo it */
  }
}

// ---------------------------------------------------------------------------
// New edition alert
//
// One message per entitled seat, each carrying a one-tap link. Structured so a
// phone channel can send the same payload without reworking the caller.
// ---------------------------------------------------------------------------

export type EditionAlert = {
  email: string
  fullName: string
  title: string
  series: string
  editionDate: string | null
  summary: string
  /** Direct document link, or null to send them to the portal instead. */
  linkUrl: string | null
}

export async function sendEditionAlert(alert: EditionAlert, idempotencyKey?: string): Promise<EmailOutcome> {
  const target = alert.linkUrl ?? `${APRI_PRODUCTION_URL}/portal`
  const label = alert.linkUrl ? "Read it now" : "Open my library"
  const kicker = [seriesLabel(alert.series), formatDate(alert.editionDate)]
    .filter(Boolean)
    .join(" · ")

  return send({
    from: `APRI <${FROM}>`,
    to: alert.email,
    replyTo: CONTACT,
    subject: `New: ${alert.title}`,
    html: shell(`
      ${
        kicker
          ? `<p style="margin:0 0 12px;font-size:12px;letter-spacing:1.5px;color:#b49f69;font-family:Arial,Helvetica,sans-serif;text-transform:uppercase;">${esc(kicker)}</p>`
          : ""
      }

      <h1 style="margin:0 0 16px;font-size:22px;color:#1a1a1a;font-weight:normal;">${esc(alert.title)}</h1>

      ${
        alert.summary
          ? `<p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#333333;">${esc(alert.summary)}</p>`
          : ""
      }

      ${button(label, target)}

      <p style="margin:24px 0 0;font-size:13px;line-height:1.7;color:#888888;">
        ${esc(emailNotice())}
      </p>
    `),
  }, idempotencyKey ?? `alert:${randomUUID()}`)
}

// ---------------------------------------------------------------------------
// Shared shell and helpers
// ---------------------------------------------------------------------------

function shell(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f7f6f3;font-family:Georgia,'Times New Roman',serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f6f3;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e8e5df;border-radius:4px;max-width:600px;">

        <tr><td style="padding:32px 40px 24px;border-bottom:2px solid #b49f69;">
          <p style="margin:0;font-size:13px;letter-spacing:2px;color:#b49f69;font-family:Arial,Helvetica,sans-serif;">ATHENA POLITICAL &amp; REGULATORY INTELLIGENCE</p>
        </td></tr>

        <tr><td style="padding:32px 40px;">${body}</td></tr>

        <tr><td style="padding:24px 40px;border-top:1px solid #e8e5df;background:#faf9f6;">
          <p style="margin:0;font-size:12px;color:#888888;font-family:Arial,Helvetica,sans-serif;line-height:1.6;">
            Athena Political &amp; Regulatory Intelligence (APRI)<br>
            Athena Centre for Policy &amp; Leadership
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function button(label: string, url: string): string {
  return `<table cellpadding="0" cellspacing="0"><tr>
    <td style="background:#1a1a1a;border-radius:2px;">
      <a href="${esc(url)}" style="display:inline-block;padding:14px 32px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#ffffff;text-decoration:none;">${esc(label)}</a>
    </td>
  </tr></table>`
}

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:10px 16px;font-size:13px;color:#888;border-bottom:1px solid #eee;width:140px;vertical-align:top;font-family:Arial,Helvetica,sans-serif;">${esc(label)}</td>
    <td style="padding:10px 16px;font-size:14px;color:#333;border-bottom:1px solid #eee;line-height:1.5;">${esc(value)}</td>
  </tr>`
}

function formatDate(value: string | null): string {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
