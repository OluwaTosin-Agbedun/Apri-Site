'use server'

import { revalidatePath } from 'next/cache'
import { getSql } from '@/lib/db'
import {
  sendBriefingConfirmation,
  sendBriefingNotification,
} from '@/lib/email'
import {
  BriefingRequestSchema,
  SubscriberSchema,
  fieldErrors,
  type FormState,
} from '@/lib/definitions'
import { levelForPublicTier, seatsForPublicTier } from '@/lib/entitlements'

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
  const parsed = SubscriberSchema.safeParse({
    name: formData.get('name'),
    organization: formData.get('organization'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    roleTitle: formData.get('roleTitle') ?? '',
    subscriptionLevel: formData.get('subscriptionLevel') ?? '',
    note: formData.get('note') ?? '',
  })

  if (!parsed.success) return { errors: fieldErrors(parsed.error) }

  const { name, organization, email, phone, roleTitle, subscriptionLevel, note } =
    parsed.data

  // The internal level is derived here from the chosen public tier name. It is
  // never read from the form: a crafted POST must not be able to award itself
  // Board-level entitlement by naming it.
  const level = levelForPublicTier(subscriptionLevel)
  const seats = seatsForPublicTier(subscriptionLevel)

  const sql = getSql()

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
        note = ${note},
        updated_at = now()
      where lower(email) = ${email}
        and lower(status) in ('pending', 'declined')
    `
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
