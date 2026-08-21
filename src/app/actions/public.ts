'use server'

import { revalidatePath } from 'next/cache'
import { getSql } from '@/lib/db'
import {
  BriefingRequestSchema,
  SubscriberSchema,
  fieldErrors,
  type FormState,
} from '@/lib/definitions'

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
  })

  if (!parsed.success) return { errors: fieldErrors(parsed.error) }

  const { name, organization, email } = parsed.data
  const sql = getSql()

  await sql`
    insert into subscribers (name, organization, email, status)
    values (${name}, ${organization}, ${email}, 'Pending')
  `

  revalidatePath('/admin')
  revalidatePath('/admin/subscribers')

  return {
    ok: true,
    message:
      'Your details have been submitted. If authorised, a secure access link will be sent to your email.',
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

  return {
    ok: true,
    message:
      'Your request has been received. We will respond to discuss scope and availability.',
  }
}
