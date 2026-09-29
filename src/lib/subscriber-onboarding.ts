import 'server-only'
import { randomUUID } from 'node:crypto'
import { getSql } from './db'
import { issueToken, revokeIssuedToken, revokeOtherTokens } from './magic-link'
import { sendSecureAccess, sendWelcome } from './subscriber-email'
import { onboardingTrackingReady, ONBOARDING_MIGRATION_PENDING } from './subscription-schema'
import {
  runOnboarding,
  describeOnboarding,
  withinIdempotencyWindow,
  type MessageKind,
  type MessageRow,
  type MessageState,
  type OnboardingReport,
} from './onboarding-sequence'
import type { EmailOutcome } from './email-delivery'

type Sql = ReturnType<typeof getSql>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** How soon after one explicit resend another may be sent. */
const RESEND_WINDOW_SECONDS = 60

export type OnboardingRun =
  | { state: 'ran'; report: OnboardingReport; message: string }
  /** The tracking tables do not exist yet: nothing was sent. */
  | { state: 'not_ready'; message: string }
  /** An existing subscriber with no onboarding started: nothing is sent retrospectively. */
  | { state: 'not_started'; message: string }

type Row = {
  id: string
  kind: MessageKind
  state: MessageState
  attempts: number
  claimed_at: string | Date | null
  last_error: string | null
  created_at: string | Date | null
}

function toRow(r: Row): MessageRow {
  return {
    id: r.id,
    kind: r.kind,
    state: r.state,
    attempts: r.attempts,
    claimedAt: r.claimed_at,
    lastError: r.last_error,
    createdAt: r.created_at,
  }
}

async function loadRows(sql: Sql, subscriberId: string): Promise<Row[]> {
  return (await sql`
    select id, kind, state, attempts, claimed_at, last_error, created_at
    from subscriber_onboarding_messages
    where subscriber_id = ${subscriberId}::uuid
  `) as Row[]
}

async function createRows(sql: Sql, subscriberId: string): Promise<void> {
  await sql`
    insert into subscriber_onboarding_messages (subscriber_id, kind)
    values (${subscriberId}::uuid, 'welcome'), (${subscriberId}::uuid, 'secure_access')
    on conflict (subscriber_id, kind) do nothing
  `
}

/**
 * Starts tracking a subscriber's onboarding -- called by activation BEFORE the
 * subscriber is made active, so no crash between the two can leave an active
 * subscriber whose onboarding emails were never owed. Idempotent.
 */
export async function startOnboardingTracking(subscriberId: string): Promise<void> {
  if (!UUID.test(subscriberId)) throw new Error('Unknown subscriber.')
  await createRows(getSql(), subscriberId)
}

type ActiveSubscriber = { id: string; email: string; full_name: string; public_tier: string; term_end: string | Date | null }

async function loadActive(sql: Sql, subscriberId: string, options: { inTerm?: boolean } = {}): Promise<ActiveSubscriber | null> {
  const rows = (await sql`
    select id, email, coalesce(nullif(full_name, ''), name, '') as full_name, public_tier, term_end
    from subscribers
    where id = ${subscriberId}::uuid and client_type = 'subscriber' and lower(status) = 'active'
      and (not ${options.inTerm === true}::boolean or term_end is null or term_end >= current_date)
    limit 1
  `) as ActiveSubscriber[]
  return rows[0] ?? null
}

/**
 * Sends -- or resumes -- a subscriber's two onboarding emails.
 *
 * `start` is for a subscriber activated in this call: it makes sure their two
 * message rows exist. Without it, only a subscriber whose onboarding has
 * already started is touched, so an existing active subscriber is never sent a
 * retrospective welcome.
 */
export async function sendOnboardingEmails(args: {
  subscriberId: string
  start: boolean
}): Promise<OnboardingRun> {
  if (!UUID.test(args.subscriberId)) return { state: 'not_started', message: 'Unknown subscriber.' }
  const sql = getSql()
  if (!(await onboardingTrackingReady(sql, { fresh: true }))) {
    return { state: 'not_ready', message: ONBOARDING_MIGRATION_PENDING }
  }

  // "Your subscription is active" is never sent to a term that has ended.
  const sub = await loadActive(sql, args.subscriberId, { inTerm: true })
  if (!sub) return { state: 'not_started', message: 'Onboarding emails go only to an active subscriber inside their term.' }

  if (args.start) {
    await createRows(sql, sub.id)
  } else if ((await loadRows(sql, sub.id)).length === 0) {
    return { state: 'not_started', message: 'This subscriber was active before onboarding emails were tracked, so none are sent now.' }
  }

  const termEnd = sub.term_end instanceof Date ? sub.term_end.toISOString().slice(0, 10) : sub.term_end

  const report = await runOnboarding({
    rows: async () => {
      // Both rows exist once onboarding has started; a missing one (the second
      // of a pair whose insert was interrupted) is created now.
      await createRows(sql, sub.id)
      const rows = await loadRows(sql, sub.id)
      const find = (kind: MessageKind) => toRow(rows.find((r) => r.kind === kind)!)
      return { welcome: find('welcome'), secureAccess: find('secure_access') }
    },
    // An automatic retry of an unsettled welcome is safe only while the
    // provider still recognises its idempotency key.
    claim: (row, { allowStale }) =>
      claimRow(sql, row.id, allowStale, row.kind !== 'welcome' || withinIdempotencyWindow(row, Date.now())),
    sendWelcome: () =>
      sendWelcome({
        subscriberId: sub.id,
        email: sub.email,
        fullName: sub.full_name,
        publicTier: sub.public_tier,
        termEnd,
      }),
    issueToken: async () => {
      const token = await issueToken(sub.id, { revokeOutstanding: false })
      return { token, revoke: () => revokeIssuedToken(token) }
    },
    sendSecureAccess: (token, attemptKey) =>
      sendSecureAccess({ subscriberId: sub.id, email: sub.email, fullName: sub.full_name, token, attemptKey }),
    record: (row, outcome, attempt) => recordOutcome(sql, row.id, outcome, attempt),
    markUnknown: async (row, message) => {
      await sql`
        update subscriber_onboarding_messages
        set state = 'unknown', last_error = ${message}, updated_at = now()
        where id = ${row.id}::uuid and state = 'sending' and attempts = ${row.attempts}
      `
    },
  })

  return { state: 'ran', report, message: describeOnboarding(report) }
}

/**
 * Claims a row for one attempt: the one caller whose conditional update
 * matches wins, and learns its attempt number. `allowStale` also takes over an
 * unsettled row -- safe only for a message whose resend the provider
 * recognises (the welcome), or for an administrator's explicit resend.
 */
async function claimRow(sql: Sql, rowId: string, allowStale: boolean, withinWindow = true): Promise<number | null> {
  const claimed = (await sql`
    update subscriber_onboarding_messages
    set state = 'sending', attempts = attempts + 1, claimed_at = now(), updated_at = now()
    where id = ${rowId}::uuid
      and (
        state in ('pending', 'failed')
        or (${allowStale}::boolean and state = 'unknown' and ${withinWindow}::boolean)
        or (${allowStale}::boolean and state = 'sending' and claimed_at < now() - interval '2 minutes' and ${withinWindow}::boolean)
      )
    returning attempts
  `) as { attempts: number }[]
  return claimed[0]?.attempts ?? null
}

/**
 * Writes one attempt's outcome onto its row. Only an accepted message gets an
 * id. Fenced: a failure is written only while this attempt still holds the
 * claim, and nothing overwrites an accepted row.
 */
export async function recordOutcome(sql: Sql, rowId: string, outcome: EmailOutcome, attempt: number): Promise<void> {
  if (outcome.status === 'accepted') {
    await sql`
      update subscriber_onboarding_messages
      set state = 'accepted', provider_message_id = ${outcome.providerMessageId},
          accepted_at = now(), last_error = null, updated_at = now()
      where id = ${rowId}::uuid and state <> 'accepted'
    `
    return
  }
  const state = outcome.status === 'unknown' ? 'unknown' : 'failed'
  await sql`
    update subscriber_onboarding_messages
    set state = ${state}, last_error = ${outcome.message}, updated_at = now()
    where id = ${rowId}::uuid and state = 'sending' and attempts = ${attempt}
  `
}

export type ResendResult = { ok: boolean; message: string }

/**
 * The administrator's explicit "Resend sign-in link": the secure-access email
 * only, never the welcome again.
 *
 *  - Claimed atomically, so a double-click or two admins send one link.
 *  - The new link is issued without revoking anything; older links are revoked
 *    only once the provider has accepted the new one. A refused attempt revokes
 *    just its own link, so a failed resend never leaves the subscriber with no
 *    working link.
 *  - For a subscriber whose onboarding welcome was never accepted, the
 *    onboarding emails are retried in order instead, so the access email never
 *    arrives before the welcome.
 */
export async function resendSecureAccessEmail(subscriberId: string): Promise<ResendResult> {
  if (!UUID.test(subscriberId)) return { ok: false, message: 'Unknown subscriber.' }
  const sql = getSql()
  const sub = await loadActive(sql, subscriberId)
  if (!sub) return { ok: false, message: 'Only an active seat can be sent a sign-in link.' }

  const tracked = await onboardingTrackingReady(sql, { fresh: true })
  let accessRow: Row | undefined
  if (tracked) {
    const rows = await loadRows(sql, sub.id)
    const welcome = rows.find((r) => r.kind === 'welcome')
    // A welcome never sent (pending or refused) goes first, in order. One whose
    // outcome is unknown may already be in the inbox, so it is not sent again:
    // the administrator's resend sends the access email alone.
    if (welcome && (welcome.state === 'pending' || welcome.state === 'failed')) {
      const run = await sendOnboardingEmails({ subscriberId: sub.id, start: false })
      return {
        ok: run.state === 'ran' && run.report.complete,
        message: `The welcome email had not been accepted yet, so the onboarding emails were retried in order. ${run.message}`,
      }
    }
    accessRow = rows.find((r) => r.kind === 'secure_access')

    const claim = (await sql`
      insert into subscriber_email_claims (subscriber_id, purpose)
      values (${sub.id}::uuid, 'signin_resend')
      on conflict (subscriber_id, purpose) do update set claimed_at = now()
        where subscriber_email_claims.claimed_at < now() - (${RESEND_WINDOW_SECONDS} || ' seconds')::interval
      returning claimed_at
    `) as unknown[]
    if (claim.length === 0) {
      return { ok: false, message: 'A sign-in link was sent to this subscriber less than a minute ago. Wait a minute before sending another.' }
    }
  } else {
    // Before the migration there is no claim table: the recent-send check
    // keeps an accidental double-click from sending two links.
    const recent = (await sql`
      select 1 from client_engagement_events
      where subscriber_id = ${sub.id}::uuid and event_type = 'signin_email_sent'
        and occurred_at > now() - (${RESEND_WINDOW_SECONDS} || ' seconds')::interval
      limit 1
    `) as unknown[]
    if (recent.length > 0) {
      return { ok: false, message: 'A sign-in link was sent to this subscriber less than a minute ago. Wait a minute before sending another.' }
    }
  }

  const release = async () => {
    if (!tracked) return
    try {
      await sql`delete from subscriber_email_claims where subscriber_id = ${sub.id}::uuid and purpose = 'signin_resend'`
    } catch {
      /* the claim lapses on its own after the window */
    }
  }

  // An onboarding access email not yet accepted is claimed too, so an
  // automatic retry cannot run alongside this one.
  let attempt: number | null = null
  if (accessRow && accessRow.state !== 'accepted') {
    attempt = await claimRow(sql, accessRow.id, true)
    if (attempt === null) {
      await release()
      return { ok: false, message: 'The secure-access email is being sent by another attempt right now. Refresh in a minute to see its outcome.' }
    }
  }

  let token: string
  try {
    token = await issueToken(sub.id, { revokeOutstanding: false })
  } catch {
    const outcome: EmailOutcome = { status: 'rejected', message: 'A sign-in link could not be issued, so nothing was sent.', retryable: true }
    if (accessRow && attempt !== null) await recordOutcome(sql, accessRow.id, outcome, attempt)
    await release()
    return { ok: false, message: 'The sign-in link could not be prepared, so nothing was sent. Please try again.' }
  }

  const outcome = await sendSecureAccess({
    subscriberId: sub.id,
    email: sub.email,
    fullName: sub.full_name,
    token,
    attemptKey: `resend:${randomUUID()}`,
  })
  let recordNote = ''
  if (accessRow && attempt !== null) {
    try {
      await recordOutcome(sql, accessRow.id, outcome, attempt)
    } catch {
      // What the provider said stands; the row settles as unknown later.
      recordNote = ' (The result could not be recorded; the status on this page may lag.)'
    }
  }

  switch (outcome.status) {
    case 'accepted':
      // Before the migration the resend is not claimed atomically, so two
      // overlapping sends could each revoke the other's link: there, older
      // links are left to expire on their own (15 minutes) instead.
      if (tracked) {
        try {
          await revokeOtherTokens(sub.id, token)
        } catch {
          /* the older links still expire on their own within minutes */
        }
      }
      return {
        ok: true,
        message: `A fresh sign-in link was accepted by the email provider for ${sub.email}${tracked ? '; older links were revoked' : ''}. Delivery is confirmed separately.${recordNote}`,
      }
    case 'unknown':
      // It may be in the inbox: the link stays valid, and no second one is sent.
      return { ok: false, message: `The sign-in email's outcome is unknown. ${outcome.message} Wait a minute before trying again.${recordNote}` }
    case 'rejected':
    case 'not_configured':
      try {
        await revokeIssuedToken(token)
      } catch {
        /* an unsent link expires on its own within minutes */
      }
      await release()
      return { ok: false, message: `The sign-in email was not sent: ${outcome.message} Existing links were left as they were.${recordNote}` }
  }
}

export type OnboardingStatus = {
  kind: MessageKind
  state: MessageState
  attempts: number
  lastError: string | null
  acceptedAt: string | null
  /** The provider's webhook reported delivery of this message. */
  delivered: boolean
  /** The provider's webhook reported a bounce or failure. */
  bounced: boolean
}

/** Both messages' tracked state for the Admin screens. Empty until the migration has run. */
export async function getOnboardingStatus(subscriberId: string): Promise<OnboardingStatus[]> {
  if (!UUID.test(subscriberId)) return []
  const sql = getSql()
  if (!(await onboardingTrackingReady(sql))) return []
  const rows = (await sql`
    select m.kind, m.state, m.attempts, m.last_error, m.accepted_at,
           exists (select 1 from client_engagement_events e
                   where e.subscriber_id = m.subscriber_id
                     and e.resend_email_id = m.provider_message_id and e.event_type = 'email_delivered') as delivered,
           exists (select 1 from client_engagement_events e
                   where e.subscriber_id = m.subscriber_id
                     and e.resend_email_id = m.provider_message_id and e.event_type in ('email_bounced', 'email_failed')) as bounced
    from subscriber_onboarding_messages m
    where m.subscriber_id = ${subscriberId}::uuid
    order by case m.kind when 'welcome' then 1 else 2 end
  `) as {
    kind: MessageKind
    state: MessageState
    attempts: number
    last_error: string | null
    accepted_at: string | Date | null
    delivered: boolean
    bounced: boolean
  }[]
  return rows.map((r) => ({
    kind: r.kind,
    state: r.state,
    attempts: r.attempts,
    lastError: r.last_error,
    acceptedAt: r.accepted_at ? new Date(r.accepted_at).toISOString() : null,
    delivered: r.delivered === true,
    bounced: r.bounced === true,
  }))
}

/** A one-line Admin label for one tracked message. Never includes a link. */
export function onboardingStatusLabel(status: OnboardingStatus): string {
  const name = status.kind === 'welcome' ? 'Welcome email' : 'Secure-access email'
  switch (status.state) {
    case 'accepted':
      return status.bounced
        ? `${name}: bounced after the provider accepted it`
        : status.delivered
          ? `${name}: delivered`
          : `${name}: accepted by the provider (delivery not yet confirmed)`
    case 'pending':
      return `${name}: not sent yet`
    case 'sending':
      return `${name}: being sent`
    case 'failed':
      return `${name}: not sent -- ${status.lastError ?? 'refused'}`
    case 'unknown':
      return `${name}: outcome unknown -- ${status.lastError ?? 'the provider did not settle it'}`
  }
}
