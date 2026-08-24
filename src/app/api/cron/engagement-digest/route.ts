import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import {
  getEngagement,
  getEngagementWindow,
  getEngagementSummary,
  type EngagementRow,
} from '@/lib/engagement'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/engagement-digest
 *
 * A weekly note to ourselves: who is not reading, and whose term is nearly up.
 *
 * Internal only. It goes to BRIEFING_MANAGER_EMAIL -- our own address -- and
 * never to a subscriber. Nothing here is reachable by a subscriber, and no
 * subscriber's activity is ever sent outside Athena Centre.
 *
 * Protected by the same CRON_SECRET as the view poll.
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

  const window = await getEngagementWindow()
  const rows = await getEngagement(window)
  const summary = await getEngagementSummary()

  const flagged = rows.filter((r) => r.flagged)
  const expiring = rows.filter(
    (r) => r.daysUntilTermEnd !== null && r.daysUntilTermEnd >= 0 && r.daysUntilTermEnd <= 30
  )

  // Nothing to report is worth saying once a week, but not worth an email.
  if (flagged.length === 0 && expiring.length === 0) {
    return NextResponse.json({ ok: true, sent: false, reason: 'nothing-to-report' })
  }

  try {
    const resend = new Resend(key)
    await resend.emails.send({
      from: `APRI System <${from}>`,
      to,
      subject: `APRI engagement: ${flagged.length} not reading, ${expiring.length} renewing soon`,
      html: digestHtml({ flagged, expiring, window, summary }),
    })
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Could not send the digest.' },
      { status: 502 }
    )
  }

  return NextResponse.json({
    ok: true,
    sent: true,
    flagged: flagged.length,
    expiring: expiring.length,
  })
}

function isAuthorised(request: Request, expected: string): boolean {
  const header = request.headers.get('authorization') ?? ''
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : ''
  const query = new URL(request.url).searchParams.get('secret') ?? ''
  return constantTimeEquals(bearer, expected) || constantTimeEquals(query, expected)
}

function constantTimeEquals(a: string, b: string): boolean {
  if (!a || !b) return false
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

function digestHtml(args: {
  flagged: EngagementRow[]
  expiring: EngagementRow[]
  window: number
  summary: { unmatchedViews: number; totalViews: number }
}): string {
  const appUrl = (process.env.APP_URL ?? 'https://apri.athenacentre.org').replace(/\/$/, '')

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
            `Not reading (opened none of the last ${args.window})`,
            args.flagged,
            (r) =>
              `${esc(r.fullName)} &middot; ${esc(r.organisation || r.email)} &mdash; last opened ${r.lastOpenedAt ? formatDate(r.lastOpenedAt) : 'never'}`
          )}

          ${section(
            'Term ending within 30 days',
            args.expiring,
            (r) =>
              `${esc(r.fullName)} &middot; ${esc(r.organisation || r.email)} &mdash; ends ${r.termEnd ? formatDate(r.termEnd) : '—'} (${r.daysUntilTermEnd} days)`
          )}

          ${
            args.summary.unmatchedViews > 0
              ? `<p style="margin:0 0 20px;font-size:13px;color:#8a6d3b;background:#fcf8e3;border:1px solid #faebcc;padding:10px 12px;">
                   ${args.summary.unmatchedViews} of ${args.summary.totalViews} recorded opens could not be matched to a subscriber. Check the link ids on their records.
                 </p>`
              : ''
          }

          <table cellpadding="0" cellspacing="0"><tr>
            <td style="background:#1a1a1a;">
              <a href="${esc(appUrl)}/admin/engagement" style="display:inline-block;padding:12px 26px;font-size:14px;color:#ffffff;text-decoration:none;">Open the attention list</a>
            </td>
          </tr></table>
        </td></tr>

        <tr><td style="padding:16px 32px;border-top:1px solid #e8e5df;background:#faf9f6;">
          <p style="margin:0;font-size:11px;color:#aaa;">
            Internal only. Contains subscriber activity &mdash; do not forward outside Athena Centre.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`
}

function section(
  title: string,
  rows: EngagementRow[],
  line: (r: EngagementRow) => string
): string {
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
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-GB', {
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
