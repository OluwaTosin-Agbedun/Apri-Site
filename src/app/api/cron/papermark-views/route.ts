import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { collectPapermarkAnalytics } from '@/lib/papermark-collector'
import { getUnalertedGaps, markGapsAlerted } from '@/lib/provisioning'
import { revokeLapsedAccess } from '@/lib/revocation'
import { sendCopyGapAlert } from '@/lib/copy-gap-email'
import {
  verifyAllowLists,
  getUnalertedFindings,
  markFindingsAlerted,
} from '@/lib/link-verification'
import { sendFindingAlert } from '@/lib/finding-email'

export const dynamic = 'force-dynamic'

// Vercel's hobby/pro function ceiling for a cron invocation.
//
// Written as a literal, not as the collector's MAX_DURATION_SECONDS. Next.js
// reads route segment config by statically analysing the module without
// executing it, so an imported constant is not a value it can see -- which is
// what failed the production build. The collector keeps its own copy of the
// same 60 seconds and derives its internal time budget from it; the two are
// intentionally stated separately rather than shared.
export const maxDuration = 60

/**
 * GET /api/cron/papermark-views
 *
 * The safety net behind the webhook. The collection itself lives in
 * `@/lib/papermark-collector`, which the owner's "Sync Papermark analytics
 * now" button also calls -- so a manual run and this scheduled run do exactly
 * the same work. That equivalence is the point: the manual run is how the owner
 * checks whether the scheduled one is working.
 *
 * Protected by CRON_SECRET. Vercel Cron sends it as `Authorization: Bearer …`;
 * a manual run can pass `?secret=`. Without the secret configured the route
 * refuses to run rather than defaulting to open.
 */
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'Not configured.' }, { status: 503 })
  }

  if (!isAuthorised(request, expected)) {
    return NextResponse.json({ error: 'Not authorised.' }, { status: 401 })
  }

  const startedAt = Date.now()

  const collection = await collectPapermarkAnalytics()

  // Reconciliation runs alongside the poll: a copy nobody made is the failure
  // no permission check catches, so it is checked on the same schedule as the
  // views rather than waiting for someone to open the admin.
  const reconciliation = await reconcile()

  return NextResponse.json({
    ok: collection.ok,
    ...(collection.skipped ? { skipped: collection.skipped } : {}),
    linksPolled: collection.linksChecked,
    viewsSeen: collection.viewsFound,
    rowsCreated: collection.newViews,
    downloadsRecorded: collection.downloadsRecorded,
    attributed: collection.attributed,
    unmatched: collection.unmatched,
    unknownLinkIds: collection.unknownLinkIds,
    enriched: collection.enriched,
    enrichmentCoveragePct: collection.enrichmentCoveragePct,
    failures: collection.failures,
    ...reconciliation,
    elapsedMs: Date.now() - startedAt,
  })
}

/**
 * The daily reconciliation: escalate overdue copy gaps, withdraw lapsed links.
 *
 * Wrapped so a failure here cannot make the view poll look broken -- the two
 * are on the same schedule but are not the same job.
 */
async function reconcile(): Promise<{
  gapsAlerted: number
  linksRevoked: number
  revokeManual: number
  linksChecked: number
  securityFindings: number
}> {
  let gapsAlerted = 0
  let linksRevoked = 0
  let revokeManual = 0
  let linksChecked = 0
  let securityFindings = 0

  try {
    // A gap open longer than a day is someone paying for something they cannot
    // open. That is an email, not a dashboard row.
    const overdue = await getUnalertedGaps(24)
    if (overdue.length > 0 && (await sendCopyGapAlert(overdue))) {
      await markGapsAlerted(overdue)
      gapsAlerted = overdue.length
    }
  } catch {
    // Reported as zero rather than failing the run.
  }

  try {
    const summary = await revokeLapsedAccess()
    linksRevoked = summary.revoked
    revokeManual = summary.manualRequired
  } catch {
    // As above.
  }

  try {
    // Every live link read back and checked: exactly one permitted address,
    // matching the subscriber it belongs to, downloads off, verification on.
    // A person cannot confirm this in the Papermark interface, so it is checked
    // here on the same schedule as everything else.
    const summary = await verifyAllowLists()
    linksChecked = summary.checked

    const unalerted = await getUnalertedFindings()
    securityFindings = unalerted.length

    if (unalerted.length > 0 && (await sendFindingAlert(unalerted))) {
      await markFindingsAlerted(unalerted)
    }
  } catch {
    // Reported as zero rather than failing the run.
  }

  return { gapsAlerted, linksRevoked, revokeManual, linksChecked, securityFindings }
}

/**
 * Accepts the secret from the Authorization header or a query parameter,
 * compared in constant time so the endpoint cannot be used as an oracle.
 */
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
