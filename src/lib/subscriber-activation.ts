import 'server-only'
import { getSql } from './db'
import { isLevel, levelLabel } from './entitlements'
import { papermarkEmbedUrl } from './papermark-embed'
import { issueToken } from './magic-link'
import { sendWelcome } from './subscriber-email'
import { ensureSubscriberLibraryAccess, type LibraryAccess } from './dataroom-lifecycle'
import { activationGate, type GateResult } from './subscription-journey'
import { subscriptionActivationReady, requesterConfirmed } from './subscription-schema'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LEGACY_REQUEST_NOTE = /^Activated from review prospect ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

export type SubscriberActivation =
  /** Active, and the library opens. `welcome` says whether the welcome email went out on this run. */
  | { state: 'activated'; welcome: 'sent' | 'failed' | 'skipped'; message: string }
  /** Active, but the library is not ready, so the welcome email is held. */
  | { state: 'held'; message: string }
  /** Not activated. Nothing was changed. */
  | { state: 'blocked'; message: string }

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * The acquisition gate, for a subscriber created from an Individual or
 * Professional subscription request.
 *
 * Enforced here, inside the one function every activation goes through, so
 * activating such a subscriber from the Subscribers page cannot skip it: a
 * signed agreement and a confirmed payment are both required, and the person
 * must be one of the request's named subscribers. Returns null for a
 * subscriber that did not come from a request.
 */
async function acquisitionGate(
  sql: ReturnType<typeof getSql>,
  row: { id: string; email: string; note: string | null },
): Promise<GateResult | null> {
  let requestRows: Record<string, unknown>[] = []
  if (await subscriptionActivationReady(sql)) {
    requestRows = (await sql`
      select r.*, (p.verified_at is not null) as prospect_verified
      from subscribers s
      join review_subscription_requests r on r.id = s.subscription_request_id
      join review_prospects p on p.id = r.prospect_id
      where s.id = ${row.id}::uuid
      limit 1
    `) as Record<string, unknown>[]
  }
  if (requestRows.length === 0) {
    // Records prepared before the link column existed carry the prospect id
    // in their note; they are held to the same gate.
    const legacy = LEGACY_REQUEST_NOTE.exec((row.note ?? '').trim())
    if (!legacy) return null
    requestRows = (await sql`
      select r.*, (p.verified_at is not null) as prospect_verified
      from review_subscription_requests r
      join review_prospects p on p.id = r.prospect_id
      where r.prospect_id = ${legacy[1]}::uuid
      limit 1
    `) as Record<string, unknown>[]
    if (requestRows.length === 0) {
      return { ok: false, missing: ['The subscription request this subscriber was prepared from'] }
    }
  }

  const r = requestRows[0]!
  const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null)
  const gate = activationGate(
    {
      plan: String(r.plan ?? ''),
      requesterConfirmed: requesterConfirmed(r),
      agreementSentAt: day(r.agreement_sent_at),
      agreementSignedAt: day(r.agreement_signed_at),
      invoiceSentAt: day(r.invoice_sent_at),
      paymentConfirmedAt: day(r.payment_confirmed_at),
      termStart: day(r.subscription_starts_at),
      termEnd: day(r.subscription_ends_at),
      authorisedUsers: r.authorised_users,
    },
    new Date().toISOString().slice(0, 10),
  )
  if (!gate.ok) return gate
  if (!gate.users.some((u) => u.email === row.email.trim().toLowerCase())) {
    return { ok: false, missing: ['This person listed as a named subscriber on the request'] }
  }
  return gate
}

/**
 * Activates one subscriber record: the checks, the status change, their Data
 * Room library (room link and a Papermark-confirmed personal link for every
 * document), and then -- only once all of that is ready -- their welcome email
 * with its sign-in link.
 *
 * `welcome: 'skip'` is for a retry that has already welcomed this person, so
 * nobody is emailed twice. Never throws for an expected failure: the result
 * says what happened and what to do next.
 */
export async function activateSubscriberRecord(args: {
  subscriberId: string
  admin: { id: string; name: string }
  welcome: 'send' | 'skip'
}): Promise<SubscriberActivation> {
  const id = args.subscriberId
  const blocked = (message: string): SubscriberActivation => ({ state: 'blocked', message })
  if (!UUID.test(id)) return blocked('Unknown subscriber.')

  let sql: ReturnType<typeof getSql>
  try {
    sql = getSql()
  } catch {
    return blocked('Subscriber storage is temporarily unavailable. Please try again.')
  }

  let rows: {
    id: string
    full_name: string | null
    name: string
    email: string
    level: string | null
    public_tier: string
    seats: number
    term_end: string | null
    status: string
    library_link_url: string | null
    papermark_folder_id: string | null
    note: string | null
  }[]
  try {
    rows = (await sql`
      select id, full_name, name, email, level, public_tier, seats, term_end, status,
             library_link_url, papermark_folder_id, note
      from subscribers where id = ${id} limit 1
    `) as typeof rows
  } catch {
    return blocked('The subscriber could not be loaded for activation. Please try again.')
  }

  const row = rows[0]
  if (!row) return blocked('That subscriber no longer exists.')

  if (!row.public_tier) return blocked('Set Subscription access level before activating.')
  if (!isLevel(row.level)) return blocked('Save a valid Subscription access level before activating.')
  if (!row.term_end) return blocked('Set a term end date before activating this seat.')
  if (row.library_link_url && !papermarkEmbedUrl(row.library_link_url, process.env.PAPERMARK_CUSTOM_DOMAIN)) {
    return blocked('Replace the private library link with a valid Papermark share link before activating.')
  }
  try {
    if (row.papermark_folder_id) {
      const folderDuplicates = await sql`
        select 1 from subscribers where papermark_folder_id=${row.papermark_folder_id} and id<>${id} and lower(status)='active'
        union all select 1 from briefing_requests where papermark_folder_id=${row.papermark_folder_id} and lower(status)='active' limit 1`
      if (folderDuplicates.length) return blocked('That private folder is assigned to another active client.')
    }
    if (row.library_link_url) {
      const duplicates = await sql`
        select 1 from subscribers
        where library_link_url = ${row.library_link_url} and id <> ${id}
        union all
        select 1 from briefing_requests where private_link_url = ${row.library_link_url}
        limit 1
      `
      if (duplicates.length > 0) {
        return blocked(
          'That private Papermark link is assigned to another client. Give this subscriber a unique link before activating.',
        )
      }
    }
  } catch {
    return blocked('Activation checks could not be completed. Please try again.')
  }
  if (new Date(row.term_end) < startOfToday()) {
    return blocked('That term end date is in the past. Extend it before activating.')
  }

  let gate: GateResult | null
  try {
    gate = await acquisitionGate(sql, row)
  } catch {
    return blocked('The subscription request behind this subscriber could not be checked. Please try again.')
  }
  if (gate && !gate.ok) {
    return blocked(
      `This subscriber comes from a subscription request that cannot be activated yet. Still needed: ${gate.missing.join('; ')}.`,
    )
  }

  try {
    await sql`
      update subscribers
      set status = 'active',
          term_start = coalesce(term_start, current_date),
          updated_at = now()
      where id = ${id}
    `
  } catch {
    return blocked(
      'The subscriber was not fully activated. Refresh the page and use Activate or Resend sign-in link again.',
    )
  }

  const granted = levelLabel(row.level, row.seats)

  // The welcome says the library is open, so the library has to open first:
  // the room link, and a personal link Papermark has confirmed for every
  // document in the room. If any is not ready the email is held and the Admin
  // is told which and why, instead of the failure vanishing into a catch.
  const access = await ensureSubscriberLibraryAccess({
    subscriberId: id,
    publicTier: row.public_tier,
    assignedName: row.full_name || row.name,
    assignedEmail: row.email,
    termEnd: row.term_end,
    createRoomLink: true,
    changedById: args.admin.id,
    changedByName: args.admin.name,
  })
  if (access.state === 'incomplete' || access.state === 'blocked') {
    return { state: 'held', message: `Seat activated at ${granted}, but ${heldWelcome(access)}` }
  }

  const note =
    access.state === 'ready'
      ? ` ${access.message}`
      : access.state === 'no_room'
        ? ' No Data Room is mapped for this level yet.'
        : ''

  if (args.welcome === 'skip') {
    return { state: 'activated', welcome: 'skipped', message: `Seat active at ${granted}; the welcome email was already sent.${note}` }
  }

  // Issued only now, when it is about to be sent: a held welcome leaves no
  // unsent sign-in token behind.
  let token: string
  try {
    token = await issueToken(id)
  } catch {
    return {
      state: 'held',
      message: `Seat activated at ${granted}, but a sign-in link could not be issued, so the welcome email was not sent. Use Resend sign-in link.`,
    }
  }

  let mailed = true
  try {
    await sendWelcome({
      subscriberId: id,
      email: row.email,
      fullName: row.full_name || row.name || '',
      publicTier: row.public_tier,
      termEnd: row.term_end,
      token,
    })
  } catch {
    mailed = false
  }

  return mailed
    ? { state: 'activated', welcome: 'sent', message: `Seat activated at ${granted}, and the welcome email has been sent.${note}` }
    : {
        state: 'activated',
        welcome: 'failed',
        message: `Seat activated at ${granted}, but the welcome email could not be sent. Check the email configuration.${note}`,
      }
}

/**
 * Why a welcome email was held, and what to do about it.
 *
 * Resend sign-in link is the retry that sends: it prepares what is missing and
 * sends the welcome only once every link is ready. Check and repair document
 * links fixes the same things and sends nothing.
 */
export function heldWelcome(access: Extract<LibraryAccess, { state: 'incomplete' | 'blocked' }>): string {
  const retry =
    access.state === 'blocked' && /Data Room link (could not|was created)/.test(access.message)
      ? 'Create the Data Room link from the Data Room panel on this page, then use Resend sign-in link to send the welcome email.'
      : 'Use Resend sign-in link to retry: it prepares what is missing and sends the welcome email only once every link is ready. Check and repair document links on this page fixes the same without sending anything.'
  return `the welcome email was held because the library is not ready yet. ${access.message} ${retry}`
}
