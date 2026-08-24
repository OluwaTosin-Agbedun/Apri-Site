import 'server-only'
import { Resend } from 'resend'
import type { CopyGap } from './provisioning'

/**
 * The overdue-copies email.
 *
 * Internal only, to our own address. Someone paying for something they cannot
 * open is not a dashboard row — nobody looks at a dashboard on a Saturday.
 *
 * Sent once per gap. The nightly run would otherwise repeat itself until the
 * copy was made, and a mail that arrives every night stops being read.
 */
export async function sendCopyGapAlert(gaps: CopyGap[]): Promise<boolean> {
  if (gaps.length === 0) return false

  const key = process.env.RESEND_API_KEY
  const to = process.env.BRIEFING_MANAGER_EMAIL
  const from = process.env.RESEND_FROM_EMAIL

  // Not configured is not a failure: the queue is still in the admin.
  if (!key || !to || !from) return false

  const appUrl = (process.env.APP_URL ?? 'https://apri.athenacentre.org').replace(/\/$/, '')
  const oldest = Math.max(...gaps.map((g) => g.ageDays))

  try {
    const resend = new Resend(key)
    await resend.emails.send({
      from: `APRI System <${from}>`,
      to,
      subject: `${gaps.length} stamped ${gaps.length === 1 ? 'copy' : 'copies'} overdue`,
      html: `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f7f6f3;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f6f3;padding:32px 0;">
    <tr><td align="center">
      <table width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e8e5df;max-width:640px;">

        <tr><td style="padding:24px 32px;border-bottom:2px solid #b49f69;">
          <p style="margin:0;font-size:12px;letter-spacing:2px;color:#b49f69;">APRI &mdash; COPIES OVERDUE</p>
        </td></tr>

        <tr><td style="padding:28px 32px;">
          <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#333;">
            ${gaps.length} entitled ${gaps.length === 1 ? 'subscriber has' : 'subscribers have'}
            no stamped copy of an edition they are paying for. The oldest has been waiting
            ${oldest} ${oldest === 1 ? 'day' : 'days'}. They see an empty library until a copy is made.
          </p>

          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 24px;">
            <tr>
              <th align="left" style="padding:8px 10px;font-size:12px;color:#888;border-bottom:1px solid #e8e5df;">Subscriber</th>
              <th align="left" style="padding:8px 10px;font-size:12px;color:#888;border-bottom:1px solid #e8e5df;">Edition</th>
              <th align="right" style="padding:8px 10px;font-size:12px;color:#888;border-bottom:1px solid #e8e5df;">Waiting</th>
            </tr>
            ${gaps
              .slice(0, 40)
              .map(
                (g) => `<tr>
              <td style="padding:8px 10px;font-size:13px;color:#333;border-bottom:1px solid #f2f0ec;">${esc(g.subscriberName)}<br><span style="color:#999;font-size:11px;">${esc(g.organisation)}</span></td>
              <td style="padding:8px 10px;font-size:13px;color:#333;border-bottom:1px solid #f2f0ec;">${esc(g.publicationCode ?? g.publicationTitle)}</td>
              <td align="right" style="padding:8px 10px;font-size:13px;color:${g.ageDays >= 3 ? '#a94442' : '#333'};border-bottom:1px solid #f2f0ec;">${g.ageDays}d</td>
            </tr>`
              )
              .join('')}
          </table>

          ${gaps.length > 40 ? `<p style="margin:0 0 20px;font-size:12px;color:#888;">…and ${gaps.length - 40} more in the queue.</p>` : ''}

          <table cellpadding="0" cellspacing="0"><tr>
            <td style="background:#1a1a1a;">
              <a href="${esc(appUrl)}/admin/copies" style="display:inline-block;padding:12px 26px;font-size:14px;color:#ffffff;text-decoration:none;">Open the copies queue</a>
            </td>
          </tr></table>
        </td></tr>

        <tr><td style="padding:16px 32px;border-top:1px solid #e8e5df;background:#faf9f6;">
          <p style="margin:0;font-size:11px;color:#aaa;">
            Internal only. Contains subscriber names &mdash; do not forward outside Athena Centre.
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
