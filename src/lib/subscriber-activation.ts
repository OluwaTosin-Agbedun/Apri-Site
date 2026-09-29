import 'server-only'
import { getSql } from './db'
import { isLevel, levelLabel, levelForPublicTier, visibilitiesForLevel, type Level } from './entitlements'
import { PORTAL_SERIES } from './portal-library'
import { papermarkEmbedUrl } from './papermark-embed'
import { ensureSubscriberLibraryAccess, type LibraryAccess } from './dataroom-lifecycle'
import { sendOnboardingEmails, startOnboardingTracking, type OnboardingRun } from './subscriber-onboarding'
import { activationGate, PLANS, type GateResult } from './subscription-journey'
import {
  subscriptionActivationReady,
  requesterConfirmed,
  onboardingTrackingReady,
  ONBOARDING_MIGRATION_PENDING,
} from './subscription-schema'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LEGACY_REQUEST_NOTE = /^Activated from review prospect ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

export type SubscriberActivation =
  /** Not activated: a check or the acquisition gate failed. Nothing was changed. */
  | { state: 'blocked'; message: string }
  /**
   * The library could not be verified, so the subscriber was not made active
   * (one already active stays as they were) and no email was sent.
   */
  | { state: 'access_not_ready'; message: string }
  /**
   * Active, with a verified library. `onboarding` says what happened to the
   * two onboarding emails -- which can still need a retry.
   */
  | {
      state: 'activated'
      access: 'data_room' | 'legacy'
      onboarding: OnboardingRun
      /** Active before this call: nothing new is owed unless onboarding had started. */
      wasActive: boolean
      message: string
    }

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
  row: { id: string; email: string; note: string | null; public_tier: string; level: string | null; seats: number },
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
  // The record must carry exactly what the request pays for: its plan's tier
  // and level, one seat. A pending record can be edited elsewhere (for
  // example by the public form), so this is checked here, at activation.
  const tier = PLANS[gate.plan].tier
  if (row.public_tier !== tier || row.level !== levelForPublicTier(tier) || Number(row.seats) !== 1) {
    return {
      ok: false,
      missing: [`This record set to the request's plan (${tier}, one seat). Run Activate subscription on the request, which sets it`],
    }
  }
  return gate
}

/**
 * Activates one subscriber record, in this order:
 *
 *   1. the checks, including the acquisition gate (signed agreement and
 *      confirmed payment) for a subscriber from a subscription request;
 *   2. their library, prepared and verified while they are still pending --
 *      the Data Room link and a Papermark-confirmed personal link for every
 *      document, or, off Data Rooms, a legacy library that really opens;
 *   3. only then the status change to active;
 *   4. the two onboarding emails (welcome, then secure access), each tracked.
 *
 * Access preparation and email delivery are reported separately: a failure in
 * 2 leaves the subscriber as they were; a failure in 4 leaves them active with
 * the emails marked for retry. Never throws for an expected failure.
 */
export async function activateSubscriberRecord(args: {
  subscriberId: string
  admin: { id: string; name: string }
  /**
   * For a subscriber already active whose onboarding emails are still owed --
   * one a subscription request activated under the previous flow, which held
   * their welcome. Starts their onboarding instead of treating them as done.
   */
  onboardingOwed?: boolean
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

  const wasActive = row.status.toLowerCase() === 'active'
  const granted = levelLabel(row.level, row.seats)

  // A new activation needs durable onboarding tracking: without it the two
  // emails could be neither sent reliably nor retried, so nothing is changed.
  if (!wasActive) {
    let tracked = false
    try {
      tracked = await onboardingTrackingReady(sql, { fresh: true })
    } catch {
      tracked = false
    }
    if (!tracked) return blocked(`${ONBOARDING_MIGRATION_PENDING} Nothing was changed.`)
  }

  // 1. The library, prepared and verified BEFORE the subscriber is made active:
  //    the room link and a Papermark-confirmed personal link for every
  //    document. A pending subscriber can be prepared (allowPending), so
  //    activation never needs the subscriber active before their links exist.
  const access = await ensureSubscriberLibraryAccess({
    subscriberId: id,
    publicTier: row.public_tier,
    assignedName: row.full_name || row.name,
    assignedEmail: row.email,
    termEnd: row.term_end,
    createRoomLink: true,
    allowPending: !wasActive,
    changedById: args.admin.id,
    changedByName: args.admin.name,
  })
  const notReady = (reason: string): SubscriberActivation => ({
    state: 'access_not_ready',
    message: `${wasActive ? 'The subscriber stays active as before' : 'The subscriber was not activated'}, and no email was sent: ${reason}`,
  })

  let accessKind: 'data_room' | 'legacy'
  let accessNote = ''
  if (access.state === 'ready') {
    accessKind = 'data_room'
    accessNote = access.message
  } else if (access.state === 'no_room') {
    if (gate) {
      // Individual and Professional Access are served from the level's Data
      // Room: without one there is no library to open.
      return notReady(
        `no Data Room is mapped for ${row.public_tier}. Map one under Admin → Data Rooms, then activate again.`,
      )
    }
    let legacy = false
    try {
      legacy = await validatedLegacyLibrary(sql, row, row.level as Level)
    } catch {
      return notReady('the legacy library could not be checked. Try again.')
    }
    if (!legacy) {
      return notReady(
        `no Data Room is mapped for ${row.public_tier}, and this subscriber has no legacy library to open (no private library link, client-folder document, live personal copy or shared edition at their level). Map a Data Room for this tier under Admin → Data Rooms, or give them a private Papermark library link on this page, then activate again.`,
      )
    }
    accessKind = 'legacy'
    accessNote = 'Their legacy library opens.'
  } else if (access.state === 'no_room_link') {
    return notReady('their Data Room link is missing. Create it from the Data Room panel, then activate again.')
  } else {
    return notReady(`${access.message} ${retryHint(access)}`)
  }

  // 2. Only now, with the library verified, is the subscriber made active --
  //    after their onboarding rows exist, so no failure between the two steps
  //    can leave an active subscriber whose emails were never owed.
  if (!wasActive) {
    try {
      await startOnboardingTracking(id)
    } catch {
      return blocked('The library is ready, but onboarding tracking could not be prepared. Try again; nothing was sent.')
    }
    try {
      // Conditional on the tier and level that were verified, so a record
      // changed since it was checked is not activated at the new values.
      const flipped = (await sql`
        update subscribers
        set status = 'active',
            term_start = coalesce(term_start, current_date),
            updated_at = now()
        where id = ${id}
          and public_tier = ${row.public_tier}
          and level is not distinct from ${row.level}
          and lower(status) <> 'active'
        returning id
      `) as unknown[]
      if (flipped.length === 0) {
        return blocked('The subscriber changed while being activated. Nothing was sent; activate again.')
      }
    } catch {
      return {
        state: 'access_not_ready',
        message: 'The library is ready, but the subscriber could not be marked active. Try again; nothing was sent.',
      }
    }
  }

  // 3. The two onboarding emails. Started only for a subscriber activated now;
  //    one already active is resumed only if their onboarding had started, so
  //    nobody already active is sent a retrospective welcome.
  let onboarding: OnboardingRun
  try {
    onboarding = await sendOnboardingEmails({ subscriberId: id, start: !wasActive || args.onboardingOwed === true })
  } catch {
    onboarding = { state: 'not_ready', message: 'The onboarding emails could not be started. Use Retry onboarding emails.' }
  }

  const head = wasActive ? `Seat is active at ${granted}; access is ready.` : `Seat activated at ${granted}; access is ready.`
  const emails =
    onboarding.state === 'ran'
      ? onboarding.report.complete
        ? onboarding.message
        : `Onboarding emails need attention: ${onboarding.message}`
      : onboarding.message
  return {
    state: 'activated',
    access: accessKind,
    onboarding,
    wasActive,
    message: `${head} ${accessNote} ${emails}`.replace(/\s+/g, ' ').trim(),
  }
}

/** Whether activation's work is fully done: access ready, and both onboarding emails accepted or none owed. */
export function activationDone(result: SubscriberActivation): boolean {
  if (result.state !== 'activated') return false
  // "Not started" is done only for someone who was active already (nothing
  // retrospective is owed) -- never for a fresh activation.
  return (
    (result.onboarding.state === 'not_started' && result.wasActive) ||
    (result.onboarding.state === 'ran' && result.onboarding.report.complete)
  )
}

/**
 * Whether a subscriber on no Data Room has a library the legacy portal would
 * actually open for them:
 *
 *  - their private Papermark library link (already validated above as a
 *    Papermark share link, unique to them), or
 *  - a document in their Papermark client folder, or
 *  - a live personal copy, or a shared edition, of a published edition at
 *    their level in a series the portal lists.
 */
async function validatedLegacyLibrary(
  sql: ReturnType<typeof getSql>,
  row: { id: string; library_link_url: string | null },
  level: Level,
): Promise<boolean> {
  if (row.library_link_url && papermarkEmbedUrl(row.library_link_url, process.env.PAPERMARK_CUSTOM_DOMAIN)) return true
  const rows = (await sql.query(
    `select 1
     from papermark_client_documents cd
     where cd.subscriber_id = $1 and cd.share_url like 'https://%'
     union all
     select 1
     from documents d
     left join publication_access pa
       on pa.publication_id = d.id and pa.subscriber_id = $1 and pa.revoke_state = 'live'
     where d.status = 'published'
       and d.visibility <> 'OPEN'
       and d.visibility = any($2::text[])
       and d.series = any($3::text[])
       and ((pa.link_url like 'https://%') or (d.is_shared_copy and d.papermark_link like 'https://%'))
     limit 1`,
    [row.id, visibilitiesForLevel(level), [...PORTAL_SERIES]],
  )) as unknown[]
  return rows.length > 0
}

function retryHint(access: Extract<LibraryAccess, { state: 'incomplete' | 'blocked' }>): string {
  return access.state === 'blocked' && /Data Room link (could not|was created)/.test(access.message)
    ? 'Create the Data Room link from the Data Room panel on this page, then activate again.'
    : 'Fix what is listed (Check and repair document links on the subscriber page), then activate again.'
}
