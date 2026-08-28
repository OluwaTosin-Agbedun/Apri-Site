import "server-only"
import { Resend } from "resend"
import { seriesLabel } from "./entitlements"
import { emailNotice } from "./delivery"
import { APRI_PRODUCTION_URL, portalVerificationUrl } from "./app-url"
import { recordClientEvent, type ClientPrincipal } from "./client-engagement"

/**
 * Transactional email for the subscriber portal.
 *
 * Kept apart from lib/email.ts, which serves the public briefing enquiry form,
 * because these messages carry sign-in links and must not accidentally acquire
 * a Cc, a Bcc or a shared recipient. Every message here goes to exactly one
 * named seat.
 *
 * Degrades quietly: with no RESEND_API_KEY the send is skipped and the caller
 * carries on, so a missing key never breaks a page.
 */

let _resend: Resend | null = null

function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY)
  return _resend
}

const FROM = process.env.SUBSCRIBER_FROM_EMAIL ?? process.env.RESEND_FROM_EMAIL ?? "briefings@apri.athenacentre.org"
const CONTACT =
  process.env.BRIEFING_MANAGER_EMAIL ?? "intelligence@athenacentre.org"

// ---------------------------------------------------------------------------
// Sign-in link
// ---------------------------------------------------------------------------

export async function sendSignInLink(args: {
  subscriberId: string
  email: string
  fullName: string
  token: string
}): Promise<void> {
  const resend = getResend()
  if (!resend) return

  const url = portalVerificationUrl(args.token)
  const greeting = args.fullName ? `, ${args.fullName}` : ""

  const result = await resend.emails.send({
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
  })
  await trackEmail({type:"subscriber",id:args.subscriberId}, result.data?.id)
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
}): Promise<void> {
  const resend = getResend()
  if (!resend) return

  const greeting = args.fullName ? `, ${args.fullName}` : ""

  await resend.emails.send({
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
  })
}

// ---------------------------------------------------------------------------
// Welcome, sent when an administrator activates a seat
// ---------------------------------------------------------------------------

export async function sendWelcome(args: {
  subscriberId: string
  email: string
  fullName: string
  publicTier: string
  termEnd: string | null
  token: string
}): Promise<void> {
  const resend = getResend()
  if (!resend) return

  const url = portalVerificationUrl(args.token)
  const greeting = args.fullName ? `, ${args.fullName}` : ""

  const result = await resend.emails.send({
    from: `APRI <${FROM}>`,
    to: args.email,
    replyTo: CONTACT,
    subject: "Your APRI subscription is active",
    html: shell(`
      <h1 style="margin:0 0 20px;font-size:22px;color:#1a1a1a;font-weight:normal;">Welcome to APRI</h1>

      <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#333333;">
        Good day${esc(greeting)}. Your subscription is now active and your intelligence
        library is open.
      </p>

      <table width="100%" cellpadding="0" cellspacing="0" style="background:#faf9f6;border:1px solid #e8e5df;border-radius:4px;margin:0 0 24px;">
        ${args.publicTier ? row("Subscription", args.publicTier) : ""}
        ${args.termEnd ? row("Access until", formatDate(args.termEnd)) : ""}
      </table>

      ${button("Open my library", url)}

      <p style="margin:24px 0 0;font-size:13px;line-height:1.7;color:#888888;">
        This link is personal to you and works once. Whenever you return, request a fresh
        link from the sign-in page using this email address. ${esc(emailNotice())}
      </p>
    `),
  })
  await trackEmail({type:"subscriber",id:args.subscriberId}, result.data?.id)
}

export async function sendBriefingWelcome(args: {
  briefingRequestId: string
  email: string
  fullName: string
  token: string
}): Promise<void> {
  const resend = getResend()
  if (!resend) return
  const url = portalVerificationUrl(args.token)
  const greeting = args.fullName ? `, ${args.fullName}` : ""
  const result = await resend.emails.send({
    from: `APRI <${FROM}>`,
    to: args.email,
    replyTo: CONTACT,
    subject: "Your private APRI briefing is ready",
    html: shell(
      `<h1 style="margin:0 0 20px;font-size:22px;font-weight:normal">Your briefing is ready</h1><p style="font-size:15px;line-height:1.7">Good day${esc(greeting)}. Use this secure, one-time link to enter your portal and open your private briefing.</p>${button("Open my briefing", url)}<p style="font-size:13px;color:#888">The sign-in link expires in 15 minutes and works once. Your briefing link is private; please do not forward it.</p>`,
    ),
  })
  await trackEmail({type:"briefing",id:args.briefingRequestId}, result.data?.id)
}

async function trackEmail(principal: ClientPrincipal, resendEmailId?: string) {
  if (!resendEmailId) return
  try { await recordClientEvent(principal,"signin_email_sent",{resendEmailId}) } catch { /* email delivery must not depend on analytics */ }
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

export async function sendEditionAlert(alert: EditionAlert): Promise<void> {
  const resend = getResend()
  if (!resend) return

  const target = alert.linkUrl ?? `${APRI_PRODUCTION_URL}/portal`
  const label = alert.linkUrl ? "Read it now" : "Open my library"
  const kicker = [seriesLabel(alert.series), formatDate(alert.editionDate)]
    .filter(Boolean)
    .join(" · ")

  await resend.emails.send({
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
  })
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
