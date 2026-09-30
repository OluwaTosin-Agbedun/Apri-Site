import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { APRI_PRODUCTION_URL } from '@/lib/app-url'
import { getDigestData, type DigestPerson } from '@/lib/reader-monitoring'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/engagement-digest
 *
 * A weekly note to ourselves: who is not reading, and whose term is nearly up.
 * It uses the Engagement monitor's own definitions (src/lib/reader-monitoring.ts):
 *
 *  - not reading: active, inside their term, and no confirmed Papermark
 *    session in the paid context in the last 30 days;
 *  - term ending: active, with the term ending within 30 days;
 *  - unmatched: last week's views that no rule could attribute to anyone --
 *    Complimentary Review reads are attributed, and are not "unmatched";
 *  - a line on Complimentary Review activity, kept separate from subscribers.
 *
 * Internal only. It goes to BRIEFING_MANAGER_EMAIL -- our own address -- and
 * never to a subscriber. Protected by the same CRON_SECRET as the view poll.
 */
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'Not configured.' }, { status: 503 })
  }
  if (!isAuthorised(request, expected)) {
    return NextResponse.json({ error: 'Not authorised.' }, { status: 401 })
  }

  const to = process.env.BRIEFING_MANAGER_EMAIL
  const from = process.env.RESEND_FROM_EMAIL
  const key = process.env.RESEND_API_KEY

  // Quiet success when email is not wired up, so the cron does not cry wolf.
  if (!key || !to || !from) {
    return NextResponse.json({
      ok: true,
      skipped: 'email-not-configured',
    })
  }

  const data = await getDigestData()

  // Nothing to report is worth saying once a week, but not worth an email.
  if (data.notReading.length === 0 && data.termEnding.length === 0) {
    return NextResponse.json({ ok: true, sent: false, reason: 'nothing-to-report' })
  }

  try {
    const resend = new Resend(key)
    const result = await resend.emails.send({
      from: `APRI System <${from}>`,
      to,
      subject: `APRI engagement: ${data.notReading.length} not reading, ${data.termEnding.length} renewing soon`,
      html: digestHtml(data),
    })
    // The provider reports a refusal as a returned error, not an exception.
    if (result.error || !result.data?.id) {
      return NextResponse.json({ ok: false, error: 'The email provider did not accept the digest.' }, { status: 502 })
    }
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Could not send the digest.' },
      { status: 502 }
    )
  }

  return NextResponse.json({
    ok: true,
    sent: true,
    flagged: data.notReading.length,
    expiring: data.termEnding.length,
  })
}

/**
 * The secret is accepted from the Authorization header only (how Vercel Cron
 * sends it). Never from the query string: a URL is written to request logs.
 */
function isAuthorised(request: Request, expected: string): boolean {
  const header = request.headers.get('authorization') ?? ''
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : ''
  return constantTimeEquals(bearer, expected)
}

function constantTimeEquals(a: string, b: string): boolean {
  if (!a || !b) return false
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

function digestHtml(data: Awaited<ReturnType<typeof getDigestData>>): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f7f6f3;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f6f3;padding:32px 0;">
    <tr><td align="center">
      <table width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e8e5df;max-width:640px;">

        <tr><td style="padding:24px 32px;border-bottom:2px solid #b49f69;">
          <p style="margin:0;font-size:12px;letter-spacing:2px;color:#b49f69;">APRI &mdash; WEEKLY ENGAGEMENT</p>
        </td></tr>

        <tr><td style="padding:28px 32px;">
          ${section(
            'Not reading (no confirmed session in the last 30 days)',
            data.notReading,
            (r) =>
              `${esc(r.name || r.email)} &middot; ${esc(r.level)} &mdash; last viewed ${r.lastViewedAt ? formatDate(r.lastViewedAt) : 'never'}, last login ${r.lastLoginAt ? formatDate(r.lastLoginAt) : 'no login recorded'}`
          )}

          ${section(
            'Term ending within 30 days',
            data.termEnding,
            (r) => `${esc(r.name || r.email)} &middot; ${esc(r.level)} &mdash; ends ${r.termEnd ? formatDate(r.termEnd) : '—'}`
          )}

          <p style="margin:0 0 20px;font-size:13px;color:#555;">
            Complimentary Review, last 7 days: ${data.review.sessions} confirmed session${data.review.sessions === 1 ? '' : 's'} by ${data.review.readers} reader${data.review.readers === 1 ? '' : 's'}.
          </p>

          ${
            data.unmatchedLastWeek > 0
              ? `<p style="margin:0 0 20px;font-size:13px;color:#8a6d3b;background:#fcf8e3;border:1px solid #faebcc;padding:10px 12px;">
                   ${data.unmatchedLastWeek} view${data.unmatchedLastWeek === 1 ? '' : 's'} last week could not be attributed to any reader. See Diagnostics on the Engagement page.
                 </p>`
              : ''
          }

          <table cellpadding="0" cellspacing="0"><tr>
            <td style="background:#1a1a1a;">
              <a href="${esc(APRI_PRODUCTION_URL)}/admin/engagement" style="display:inline-block;padding:12px 26px;font-size:14px;color:#ffffff;text-decoration:none;">Open Engagement</a>
            </td>
          </tr></table>
        </td></tr>

        <tr><td style="padding:16px 32px;border-top:1px solid #e8e5df;background:#faf9f6;">
          <p style="margin:0;font-size:11px;color:#aaa;">
            Internal only. Contains subscriber activity &mdash; do not forward outside Athena Centre. Dates are in Africa/Lagos time.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`
}

function section(title: string, rows: DigestPerson[], line: (r: DigestPerson) => string): string {
  if (rows.length === 0) return ''

  return `
    <h2 style="margin:0 0 12px;font-size:14px;letter-spacing:1px;color:#b49f69;border-bottom:1px solid #e8e5df;padding-bottom:6px;text-transform:uppercase;">
      ${esc(title)} (${rows.length})
    </h2>
    <ul style="margin:0 0 24px;padding:0 0 0 18px;">
      ${rows.map((r) => `<li style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#333;">${line(r)}</li>`).join('')}
    </ul>`
}

function formatDate(value: string): string {
  const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-GB', {
    timeZone: 'Africa/Lagos',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
