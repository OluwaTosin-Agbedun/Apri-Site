import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import {
  isPapermarkConfigured,
  listLinks,
  listViewsForLink,
  getViewDetail,
} from '@/lib/papermark'
import { recordView, refreshLastViewed } from '@/lib/view-attribution'
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

// Vercel's hobby/pro function ceiling for a cron invocation. Kept explicit so
// the poll is cut short by our own budget rather than by an opaque timeout.
export const maxDuration = 60

/** How many of the newest views get a second call for their duration. */
const ENRICH_LIMIT = 25

/** Views older than this are ignored: this is a catch-up, not a backfill. */
const LOOKBACK_DAYS = 14

/**
 * GET /api/cron/papermark-views
 *
 * The safety net behind the webhook. Pulls recent views from Papermark and
 * upserts them by papermark_view_id, so anything the webhook missed -- a
 * deploy, an outage, a dropped delivery -- is filled in within a day.
 *
 * Idempotent by construction: every row is written through recordView, which
 * conflicts on papermark_view_id, so running this twice changes nothing.
 *
 * Protected by CRON_SECRET. Vercel Cron sends it as `Authorization: Bearer …`;
 * a manual run can pass `?secret=`. Without the secret configured the route
 * refuses to run at all rather than defaulting to open.
 */
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'Not configured.' }, { status: 503 })
  }

  if (!isAuthorised(request, expected)) {
    return NextResponse.json({ error: 'Not authorised.' }, { status: 401 })
  }

  // Exits quietly, and successfully, when there is no API token. A cron that
  // reported failure every night until the key arrives would train us to
  // ignore it.
  if (!isPapermarkConfigured()) {
    return NextResponse.json({
      ok: true,
      skipped: 'papermark-not-configured',
      message: 'No Papermark API token set; nothing to poll.',
    })
  }

  const startedAt = Date.now()
  const since = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000

  let links: Awaited<ReturnType<typeof listLinks>>
  try {
    links = await listLinks()
  } catch {
    // No detail echoed: the message could quote the request, which holds the token.
    return NextResponse.json(
      { ok: false, error: 'Could not list links from Papermark.' },
      { status: 502 }
    )
  }

  // Only links we actually issued are worth polling. A link id we have never
  // stored cannot be attributed to a subscriber anyway.
  const known = await knownLinkIds()

  const candidates = links
    .map((l) => l.id)
    .filter((id): id is string => Boolean(id))
    .filter((id) => known.size === 0 || known.has(id))

  let seen = 0
  let created = 0
  let attributed = 0
  let unmatched = 0
  let enriched = 0
  const touched = new Set<string>()

  for (const linkId of candidates) {
    // Leave headroom so the run ends by returning a summary rather than being
    // killed mid-write.
    if (Date.now() - startedAt > (maxDuration - 10) * 1000) break

    let views
    try {
      views = await listViewsForLink(linkId)
    } catch {
      continue // One bad link must not end the run.
    }

    for (const view of views) {
      if (!view?.id) continue

      const viewedAt = view.viewed_at ? Date.parse(view.viewed_at) : NaN
      if (Number.isFinite(viewedAt) && viewedAt < since) continue

      seen++

      let durationSeconds: number | null = null
      if (enriched < ENRICH_LIMIT) {
        const detail = await getViewDetail(view.id)
        if (typeof detail?.total_duration_seconds === 'number') {
          durationSeconds = Math.round(detail.total_duration_seconds)
        }
        enriched++
      }

      try {
        const { created: isNew, attribution } = await recordView({
          papermarkViewId: view.id,
          papermarkLinkId: view.link_id ?? linkId,
          papermarkDocumentId: view.document_id ?? null,
          viewerEmail: view.viewer_email ?? null,
          viewedAt: view.viewed_at ?? null,
          durationSeconds,
          completionPct: null,
          downloaded: Boolean(view.downloaded_at),
          source: 'poll',
        })

        if (isNew) created++
        if (attribution.subscriberId) {
          attributed++
          touched.add(attribution.subscriberId)
        } else {
          unmatched++
        }
      } catch {
        // Skip the row, keep the run going.
      }
    }
  }

  for (const subscriberId of touched) {
    try {
      await refreshLastViewed(subscriberId)
    } catch {
      // Derived field; not worth failing the run.
    }
  }

  await recordRun({ seen, created, attributed, unmatched })

  // Reconciliation runs alongside the poll: a copy nobody made is the failure
  // that no permission check catches, so it is checked on the same schedule as
  // the views rather than waiting for someone to open the admin.
  const reconciliation = await reconcile()

  return NextResponse.json({
    ok: true,
    linksPolled: candidates.length,
    viewsSeen: seen,
    rowsCreated: created,
    attributed,
    unmatched,
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

/** Every Papermark link id we have on file, from either place it can live. */
async function knownLinkIds(): Promise<Set<string>> {
  const sql = getSql()
  const rows = (await sql`
    select papermark_link_id as id from subscribers where papermark_link_id is not null
    union
    select papermark_link_id as id from publication_access where papermark_link_id is not null
  `) as { id: string }[]

  return new Set(rows.map((r) => r.id))
}

/** Leaves a trace of the last run, so a silent cron is visible in the admin. */
async function recordRun(summary: {
  seen: number
  created: number
  attributed: number
  unmatched: number
}): Promise<void> {
  try {
    const sql = getSql()
    const value = JSON.stringify({ ...summary, at: new Date().toISOString() })
    await sql`
      insert into app_settings (key, value)
      values ('papermark_last_poll', ${value})
      on conflict (key) do update set value = excluded.value
    `
  } catch {
    // Diagnostics only.
  }
}
