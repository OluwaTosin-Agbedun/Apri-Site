import "server-only"
import { Resend } from "resend"
import { tierDisplayName } from "./entitlements"

let _resend: Resend | null = null

function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY)
  return _resend
}

const FROM = process.env.BRIEFING_FROM_EMAIL ?? process.env.RESEND_FROM_EMAIL ?? "briefings@apri.athenacentre.org"
const MANAGER =
  process.env.BRIEFING_MANAGER_EMAIL ?? "intelligence@athenacentre.org"

interface BriefingDetails {
  name: string
  organization: string
  roleTitle: string
  email: string
  phone: string
  briefingType: string
  format: string
  timeline: string
  sector: string
  description: string
  audienceSize: string
  location: string
}

export async function sendBriefingConfirmation(
  d: BriefingDetails,
): Promise<void> {
  const resend = getResend()
  if (!resend) return

  await resend.emails.send({
    from: `APRI Briefings <${FROM}>`,
    to: d.email,
    subject: "Your Briefing Request Has Been Received — APRI",
    html: confirmationHtml(d),
  })
}

export async function sendBriefingNotification(
  d: BriefingDetails,
): Promise<void> {
  const resend = getResend()
  if (!resend) return

  await resend.emails.send({
    from: `APRI System <${FROM}>`,
    to: MANAGER,
    subject: `New Briefing Request: ${d.name} — ${d.organization}`,
    replyTo: d.email,
    html: notificationHtml(d),
  })
}

/**
 * Tells us a subscription enquiry has arrived.
 *
 * This form previously stored the enquiry and notified nobody, so someone
 * asking to pay us sat in a table until an administrator happened to look.
 *
 * Every field the form collects is included, because the seat count and level
 * of interest are what decide which tier is being asked for -- and having to
 * open the admin to find them defeats the point of the email.
 */
export async function sendAccessRequestNotification(d: {
  name: string
  organization: string
  email: string
  phone: string
  roleTitle: string
  seats: number
  subscriptionLevel: string
  note: string
}): Promise<void> {
  const resend = getResend()
  if (!resend) return

  const seatLine = d.seats === 1 ? "1 person" : `${d.seats} people`

  await resend.emails.send({
    from: `APRI System <${FROM}>`,
    to: MANAGER,
    subject: `Subscription enquiry: ${d.name} — ${d.organization} (${seatLine})`,
    replyTo: d.email,
    html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f7f6f3;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f6f3;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e8e5df;border-radius:4px;max-width:600px;">

        <tr><td style="padding:24px 40px;border-bottom:2px solid #b49f69;">
          <p style="margin:0;font-size:13px;letter-spacing:2px;color:#b49f69;">SUBSCRIPTION ENQUIRY</p>
        </td></tr>

        <tr><td style="padding:32px 40px;">
          <h1 style="margin:0 0 8px;font-size:20px;color:#1a1a1a;">${esc(d.name)}</h1>
          <p style="margin:0 0 24px;font-size:15px;color:#555555;">
            ${esc(d.organization)}${
              d.roleTitle ? ` &mdash; ${esc(d.roleTitle)}` : ""
            }
          </p>

          <table width="100%" cellpadding="0" cellspacing="0" style="background:#faf9f6;border:1px solid #e8e5df;border-radius:4px;margin-bottom:24px;">
            ${summaryRow("Email", d.email)}
            ${d.phone ? summaryRow("Phone", d.phone) : ""}
            ${summaryRow("Seats needed", seatLine)}
            ${
              d.subscriptionLevel
                ? summaryRow(
                    "Level of interest",
                    `${tierDisplayName(d.subscriptionLevel)} (advisory)`,
                  )
                : ""
            }
            ${d.note ? summaryRow("Their note", d.note) : ""}
          </table>

          <p style="margin:0 0 8px;font-size:14px;line-height:1.7;color:#333333;">
            Reply to this message to reach ${esc(d.name)} directly. The enquiry is also on
            the Subscribers page in the admin, where it can be activated once payment lands.
          </p>
          <p style="margin:0;font-size:13px;color:#888888;">
            We tell enquirers we reply within one business day.
          </p>
        </td></tr>

        <tr><td style="padding:16px 40px;border-top:1px solid #e8e5df;background:#faf9f6;">
          <p style="margin:0;font-size:11px;color:#aaa;">
            Internal only. Contains an enquirer's contact details.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`,
  })
}

export async function sendAccessRequestConfirmation(d: {
  name: string
  email: string
}): Promise<void> {
  const resend = getResend()
  if (!resend) return
  await resend.emails.send({
    from: `APRI <${FROM}>`,
    to: d.email,
    replyTo: MANAGER,
    subject: "Your APRI subscription request has been received",
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#333"><h1 style="font-size:22px">Thank you, ${esc(d.name)}</h1><p>We have received your APRI subscription request. Our team will review it and reply within one business day.</p><p>If you did not submit this request, please ignore this email.</p></body></html>`,
  })
}

function confirmationHtml(d: BriefingDetails): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f7f6f3;font-family:Georgia,'Times New Roman',serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f6f3;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e8e5df;border-radius:4px;">

        <!-- Header -->
        <tr><td style="padding:32px 40px 24px;border-bottom:2px solid #b49f69;">
          <p style="margin:0;font-size:14px;letter-spacing:2px;color:#b49f69;font-family:Arial,Helvetica,sans-serif;">ATHENA POLITICAL &amp; REGULATORY INTELLIGENCE</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:32px 40px;">
          <h1 style="margin:0 0 20px;font-size:22px;color:#1a1a1a;font-weight:normal;">Thank you, ${esc(d.name)}</h1>

          <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#333333;">
            We have received your briefing request and will review it promptly. A member of our intelligence team will be in touch to discuss scope, format and availability.
          </p>

          <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#333333;">
            Below is a summary of the details you submitted.
          </p>

          <!-- Request summary -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#faf9f6;border:1px solid #e8e5df;border-radius:4px;margin-bottom:24px;">
            ${summaryRow("Organisation", d.organization)}
            ${d.roleTitle ? summaryRow("Role / Title", d.roleTitle) : ""}
            ${d.briefingType ? summaryRow("Briefing Type", d.briefingType) : ""}
            ${d.format ? summaryRow("Preferred Format", d.format) : ""}
            ${d.timeline ? summaryRow("Timeline", d.timeline) : ""}
            ${d.sector ? summaryRow("Sector", d.sector) : ""}
            ${d.audienceSize ? summaryRow("Audience Size", d.audienceSize) : ""}
            ${d.location ? summaryRow("Location", d.location) : ""}
            ${d.description ? summaryRow("Description", d.description) : ""}
          </table>

          <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#333333;">
            If you need to amend any details or have questions in the meantime, please reply to this email or contact us at
            <a href="mailto:${esc(MANAGER)}" style="color:#b49f69;">${esc(MANAGER)}</a>.
          </p>

          <p style="margin:0;font-size:15px;line-height:1.7;color:#333333;">
            We look forward to working with you.
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:24px 40px;border-top:1px solid #e8e5df;background:#faf9f6;">
          <p style="margin:0;font-size:12px;color:#888888;font-family:Arial,Helvetica,sans-serif;line-height:1.6;">
            Athena Political &amp; Regulatory Intelligence (APRI)<br>
            Athena Centre for Policy &amp; Leadership<br>
            This is an automated confirmation. Please do not reply unless you wish to amend your request.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function notificationHtml(d: BriefingDetails): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f7f6f3;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f6f3;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e8e5df;border-radius:4px;">

        <!-- Header -->
        <tr><td style="padding:24px 40px;border-bottom:2px solid #b49f69;">
          <p style="margin:0;font-size:13px;letter-spacing:2px;color:#b49f69;">NEW BRIEFING REQUEST</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:32px 40px;">
          <h1 style="margin:0 0 8px;font-size:20px;color:#1a1a1a;">${esc(d.name)}</h1>
          <p style="margin:0 0 24px;font-size:15px;color:#555555;">
            ${esc(d.organization)}${
              d.roleTitle ? ` &mdash; ${esc(d.roleTitle)}` : ""
            }
          </p>

          <!-- Contact -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr>
              <td style="padding:8px 0;font-size:13px;color:#888;width:120px;vertical-align:top;">Email</td>
              <td style="padding:8px 0;font-size:14px;color:#1a1a1a;">
                <a href="mailto:${esc(d.email)}" style="color:#b49f69;">${esc(d.email)}</a>
              </td>
            </tr>
            ${
              d.phone
                ? `<tr>
              <td style="padding:8px 0;font-size:13px;color:#888;width:120px;vertical-align:top;">Phone</td>
              <td style="padding:8px 0;font-size:14px;color:#1a1a1a;">${esc(d.phone)}</td>
            </tr>`
                : ""
            }
          </table>

          <!-- Request details -->
          <h2 style="margin:0 0 16px;font-size:14px;letter-spacing:1px;color:#b49f69;border-bottom:1px solid #e8e5df;padding-bottom:8px;">REQUEST DETAILS</h2>

          <table width="100%" cellpadding="0" cellspacing="0">
            ${detailRow("Briefing Type", d.briefingType)}
            ${detailRow("Format", d.format)}
            ${detailRow("Timeline", d.timeline)}
            ${detailRow("Sector", d.sector)}
            ${detailRow("Audience Size", d.audienceSize)}
            ${detailRow("Location", d.location)}
          </table>

          ${
            d.description
              ? `
          <h2 style="margin:24px 0 12px;font-size:14px;letter-spacing:1px;color:#b49f69;border-bottom:1px solid #e8e5df;padding-bottom:8px;">DESCRIPTION</h2>
          <p style="margin:0;font-size:14px;line-height:1.7;color:#333;white-space:pre-wrap;">${esc(d.description)}</p>
          `
              : ""
          }

          <p style="margin:24px 0 0;font-size:13px;color:#888;">
            Reply directly to this email to respond to ${esc(d.name)} at ${esc(d.email)}.
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:16px 40px;border-top:1px solid #e8e5df;background:#faf9f6;">
          <p style="margin:0;font-size:11px;color:#aaa;">
            Sent by APRI System &middot; This request is also stored in the admin CMS.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function summaryRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:10px 16px;font-size:13px;color:#888;border-bottom:1px solid #eee;width:140px;vertical-align:top;font-family:Arial,Helvetica,sans-serif;">${esc(label)}</td>
    <td style="padding:10px 16px;font-size:14px;color:#333;border-bottom:1px solid #eee;line-height:1.5;">${esc(value)}</td>
  </tr>`
}

function detailRow(label: string, value: string): string {
  if (!value) return ""
  return `<tr>
    <td style="padding:8px 0;font-size:13px;color:#888;width:120px;vertical-align:top;">${esc(label)}</td>
    <td style="padding:8px 0;font-size:14px;color:#1a1a1a;">${esc(value)}</td>
  </tr>`
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
