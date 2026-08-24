'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { getSql } from '@/lib/db'
import {
  sendBriefingConfirmation,
  sendBriefingNotification,
  sendAccessRequestNotification,
} from '@/lib/email'
import {
  BriefingRequestSchema,
  SubscriberSchema,
  fieldErrors,
  normalisePhone,
  type FormState,
} from '@/lib/definitions'
import { levelForPublicTier } from '@/lib/entitlements'

/** At most this many enquiries from one address or IP inside the window. */
const MAX_REQUESTS = 3
const WINDOW_MINUTES = 60

/**
 * The one response a submission gets, whether it was stored or silently
 * dropped as spam.
 */
const ACCEPTED: FormState = {
  ok: true,
  message: 'Your details have been submitted. We reply within one business day.',
}

async function clientIp(): Promise<string> {
  const h = await headers()
  const forwarded = h.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]!.trim().slice(0, 64)
  return h.get('x-real-ip')?.slice(0, 64) ?? ''
}

/**
 * Throttling, on the same table the sign-in flow uses.
 *
 * The key is namespaced so a burst of enquiries cannot lock anyone out of
 * signing in, and vice versa.
 */
async function isThrottled(
  sql: ReturnType<typeof getSql>,
  email: string,
  ip: string
): Promise<boolean> {
  const [{ recent }] = (await sql`
    select count(*)::int as recent
    from login_attempts
    where email_key like 'enquiry:%'
      and created_at > now() - (${WINDOW_MINUTES} || ' minutes')::interval
      and (email_key = ${`enquiry:${email}`} or (ip <> '' and ip = ${ip}))
  `) as { recent: number }[]

  return recent >= MAX_REQUESTS
}

async function recordAttempt(
  sql: ReturnType<typeof getSql>,
  email: string,
  ip: string
): Promise<void> {
  await sql`
    insert into login_attempts (email_key, ip, successful)
    values (${`enquiry:${email}`}, ${ip}, true)
  `
}

/**
 * Subscriber access request from the home page.
 *
 * Status is always written as 'Pending' from a server constant -- never taken
 * from the submitted form -- so a crafted POST cannot grant itself access.
 */
export async function requestAccess(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  /**
   * Honeypot. A field no person sees and no person fills; anything in it came
   * from a bot filling every input on the page. Answered with the same success
   * message as a real submission, because telling a bot it was caught only
   * teaches whoever wrote it to skip the field next time.
   */
  const decoy = formData.get('websiteUrl')
  if (typeof decoy === 'string' && decoy.trim() !== '') return ACCEPTED

  const parsed = SubscriberSchema.safeParse({
    name: formData.get('name'),
    organization: formData.get('organization'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    roleTitle: formData.get('roleTitle') ?? '',
    seats: formData.get('seats') ?? 1,
    subscriptionLevel: formData.get('subscriptionLevel') ?? '',
    note: formData.get('note') ?? '',
  })

  if (!parsed.success) return { errors: fieldErrors(parsed.error) }

  const { name, organization, email, roleTitle, seats, subscriptionLevel, note } =
    parsed.data

  // Stored in one shape so two enquiries from the same person are recognisable.
  const phone = normalisePhone(parsed.data.phone)

  const sql = getSql()

  // Throttled per address and per IP. This form reaches our inbox, so it will
  // be found by spam; the limit is what stops one script filling the
  // subscribers table overnight.
  const ip = await clientIp()
  const throttled = await isThrottled(sql, email, ip)
  if (throttled) {
    return {
      message: 'We have already received a request from you. Please give us a day to reply.',
    }
  }

  // The internal level is derived here from the chosen public tier name. It is
  // never read from the form: a crafted POST must not be able to award itself
  // Board-level entitlement by naming it.
  //
  // Seats now comes from the form instead of being guessed from the tier, so a
  // two-person team is not recorded as the same size as a fifty-person one.
  const level = levelForPublicTier(subscriptionLevel)

  // An enquiry is not a seat. Status is written as the pending constant, and
  // level is recorded only as what they asked for -- an administrator sets the
  // real entitlement when payment lands.
  try {
    await sql`
      insert into subscribers (
        name, full_name, organization, email, phone, role_title,
        subscription_level, public_tier, level, seats, note, status
      ) values (
        ${name}, ${name}, ${organization}, ${email}, ${phone}, ${roleTitle},
        ${subscriptionLevel}, ${subscriptionLevel}, ${level}, ${seats}, ${note}, 'Pending'
      )
    `
  } catch {
    // The unique index on lower(email) means a repeat enquiry from the same
    // address lands here. Update the existing enquiry rather than reporting a
    // failure -- and never touch status, level or term, so re-submitting the
    // public form cannot alter a live subscription.
    await sql`
      update subscribers set
        name = ${name},
        full_name = ${name},
        organization = ${organization},
        phone = ${phone},
        role_title = ${roleTitle},
        subscription_level = ${subscriptionLevel},
        seats = ${seats},
        note = ${note},
        updated_at = now()
      where lower(email) = ${email}
        and lower(status) in ('pending', 'declined')
    `
  }

  await recordAttempt(sql, email, ip)

  // Until now this form stored the enquiry and told nobody. Someone asking to
  // pay us is worth an email, not a row waiting to be noticed.
  try {
    await sendAccessRequestNotification({
      name,
      organization,
      email,
      phone,
      roleTitle,
      seats,
      subscriptionLevel,
      note,
    })
  } catch {
    // The enquiry is already saved; a mail failure must not lose it.
  }

  revalidatePath('/admin')
  revalidatePath('/admin/subscribers')

  return {
    ok: true,
    message:
      'Your details have been submitted. We reply within one business day.',
  }
}

/**
 * Briefing request from the Services & Briefings page. Captures the field set
 * specified in the brief.
 */
export async function requestBriefing(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const parsed = BriefingRequestSchema.safeParse({
    name: formData.get('name'),
    organization: formData.get('organization'),
    roleTitle: formData.get('roleTitle'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    briefingType: formData.get('briefingType'),
    format: formData.get('format'),
    timeline: formData.get('timeline'),
    sector: formData.get('sector'),
    description: formData.get('description'),
    audienceSize: formData.get('audienceSize'),
    location: formData.get('location'),
  })

  if (!parsed.success) return { errors: fieldErrors(parsed.error) }

  const d = parsed.data
  const sql = getSql()

  await sql`
    insert into briefing_requests (
      name, organization, role_title, email, phone, briefing_type,
      format, timeline, sector, description, audience_size, location, status
    ) values (
      ${d.name}, ${d.organization}, ${d.roleTitle}, ${d.email}, ${d.phone},
      ${d.briefingType}, ${d.format}, ${d.timeline}, ${d.sector},
      ${d.description}, ${d.audienceSize}, ${d.location}, 'New'
    )
  `

  revalidatePath('/admin')
  revalidatePath('/admin/briefings')

  try {
    await Promise.all([
      sendBriefingConfirmation(d),
      sendBriefingNotification(d),
    ])
  } catch {
    // Email failure must not block the request — the data is already saved.
  }

  return {
    ok: true,
    message:
      'Your request has been received. We will respond to discuss scope and availability.',
  }
}
