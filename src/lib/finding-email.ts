import 'server-only'
import { Resend } from 'resend'
import { findingLabel, type LinkFinding } from './link-verification'

/**
 * The security-finding email.
 *
 * A link permitting the wrong person is not a dashboard row: nobody opens a
 * dashboard at the weekend, and the document is readable in the meantime.
 *
 * No address appears in this message. The link id and the publication are what
 * make it actionable, and putting the offending address into an email would put
 * it somewhere else it does not belong.
 */
export async function sendFindingAlert(findings: LinkFinding[]): Promise<boolean> {
  if (findings.length === 0) return false

  const key = process.env.RESEND_API_KEY
  const to = process.env.BRIEFING_MANAGER_EMAIL
  const from = process.env.RESEND_FROM_EMAIL
  if (!key || !to || !from) return false

  const appUrl = (process.env.APP_URL ?? 'https://apri.athenacentre.org').replace(/\/$/, '')

  try {
    const resend = new Resend(key)
    await resend.emails.send({
      from: `APRI Security <${from}>`,
      to,
      subject: `Security: ${findings.length} subscriber link${findings.length === 1 ? '' : 's'} not restricted to one person`,
      html: `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f7f6f3;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f6f3;padding:32px 0;">
    <tr><td align="center">
      <table width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e8e5df;max-width:640px;">

        <tr><td style="padding:24px 32px;border-bottom:3px solid #a94442;">
          <p style="margin:0;font-size:12px;letter-spacing:2px;color:#a94442;">APRI &mdash; SECURITY FINDING</p>
        </td></tr>

        <tr><td style="padding:28px 32px;">
          <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#333;">
            ${findings.length} subscriber link${findings.length === 1 ? ' does' : 's do'} not permit
            exactly one address. Each stamped document carries one person's name, so a link
            open to anyone else means someone can read a document issued to another
            subscriber.
          </p>

          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 24px;">
            <tr>
              <th align="left" style="padding:8px 10px;font-size:12px;color:#888;border-bottom:1px solid #e8e5df;">Finding</th>
              <th align="left" style="padding:8px 10px;font-size:12px;color:#888;border-bottom:1px solid #e8e5df;">Edition &amp; subscriber</th>
              <th align="left" style="padding:8px 10px;font-size:12px;color:#888;border-bottom:1px solid #e8e5df;">Link</th>
            </tr>
            ${findings
              .slice(0, 40)
              .map(
                (f) => `<tr>
              <td style="padding:8px 10px;font-size:13px;color:#a94442;border-bottom:1px solid #f2f0ec;">${esc(findingLabel(f.kind))}</td>
              <td style="padding:8px 10px;font-size:13px;color:#333;border-bottom:1px solid #f2f0ec;">
                ${esc(f.publicationCode ?? f.publicationTitle)}<br>
                <span style="color:#999;font-size:11px;">${esc(f.subscriberName)}${f.organisation ? ' · ' + esc(f.organisation) : ''}</span>
              </td>
              <td style="padding:8px 10px;font-size:11px;color:#777;border-bottom:1px solid #f2f0ec;font-family:monospace;">${esc(f.papermarkLinkId)}</td>
            </tr>`
              )
              .join('')}
          </table>

          ${findings.length > 40 ? `<p style="margin:0 0 20px;font-size:12px;color:#888;">…and ${findings.length - 40} more.</p>` : ''}

          <p style="margin:0 0 20px;font-size:13px;line-height:1.7;color:#555;">
            Fix each in Papermark: the allow-list should hold one address &mdash; the
            subscriber's own &mdash; with downloads off and email verification on. No
            addresses are included here deliberately.
          </p>

          <table cellpadding="0" cellspacing="0"><tr>
            <td style="background:#a94442;">
              <a href="${esc(appUrl)}/admin" style="display:inline-block;padding:12px 26px;font-size:14px;color:#ffffff;text-decoration:none;">Open the admin</a>
            </td>
          </tr></table>
        </td></tr>

        <tr><td style="padding:16px 32px;border-top:1px solid #e8e5df;background:#faf9f6;">
          <p style="margin:0;font-size:11px;color:#aaa;">
            Internal only. Contains no subscriber addresses.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`,
    })
    return true
  } catch {
    return false
  }
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
