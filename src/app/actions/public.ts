"use server"

/** At most this many enquiries from one address or IP inside the window. */

/**
 * The one response a submission gets, whether it was stored or silently
 * dropped as spam.
 */

/**
 * Throttling, on the same table the sign-in flow uses.
 *
 * The key is namespaced so a burst of enquiries cannot lock anyone out of
 * signing in, and vice versa.
 */

/**
 * Subscriber access request from the home page.
 *
 * Status is always written as 'Pending' from a server constant -- never taken
 * from the submitted form -- so a crafted POST cannot grant itself access.
 */
/**
 * Honeypot. A field no person sees and no person fills; anything in it came
 * from a bot filling every input on the page. Answered with the same success
 * message as a real submission, because telling a bot it was caught only
 * teaches whoever wrote it to skip the field next time.
 */

// Stored in one shape so two enquiries from the same person are recognisable.

// Throttled per address and per IP. This form reaches our inbox, so it will
// be found by spam; the limit is what stops one script filling the
// subscribers table overnight.

// The internal level is derived here from the chosen public tier name. It is
// never read from the form: a crafted POST must not be able to award itself
// Board-level entitlement by naming it.
//
// Seats now comes from the form instead of being guessed from the tier, so a
// two-person team is not recorded as the same size as a fifty-person one.

// An enquiry is not a seat. Status is written as the pending constant, and
// level is recorded only as what they asked for -- an administrator sets the
// real entitlement when payment lands.
// The unique index on lower(email) means a repeat enquiry from the same
// address lands here. Update the existing enquiry rather than reporting a
// failure -- and never touch status, level or term, so re-submitting the
// public form cannot alter a live subscription.

// Until now this form stored the enquiry and told nobody. Someone asking to
// pay us is worth an email, not a row waiting to be noticed.
// The enquiry is already saved; a mail failure must not lose it.

/**
 * Briefing request from the Services & Briefings page. Captures the field set
 * specified in the brief.
 */
// Email failure must not block the request — the data is already saved.

import { revalidatePath } from "next/cache"
import { headers } from "next/headers"
import { getSql } from "@/lib/db"
import {
  sendBriefingConfirmation,
  sendBriefingNotification,
  sendAccessRequestNotification,
  sendAccessRequestConfirmation,
} from "@/lib/email"
import {
  BriefingRequestSchema,
  SubscriberSchema,
  fieldErrors,
  normalisePhone,
  type FormState,
} from "@/lib/definitions"
import { levelForPublicTier, seatsForSubscriptionRequest, requiresWorkEmail, isPersonalEmail, WORK_EMAIL_MESSAGE } from "@/lib/entitlements"
const MAX_REQUESTS = 3
const WINDOW_MINUTES = 60
const ACCEPTED: FormState = {
  ok: true,
  message:
    "Your details have been submitted. We reply within one business day.",
}

async function clientIp(): Promise<string> {
  const h = await headers()
  const forwarded = h.get("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0]!.trim().slice(0, 64)
  return h.get("x-real-ip")?.slice(0, 64) ?? ""
}
async function isThrottled(
  sql: ReturnType<typeof getSql>,
  email: string,
  ip: string,
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
  ip: string,
): Promise<void> {
  await sql`
    insert into login_attempts (email_key, ip, successful)
    values (${`enquiry:${email}`}, ${ip}, true)
  `
}
export async function requestAccess(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const decoy = formData.get("websiteUrl")
  if (typeof decoy === "string" && decoy.trim() !== "") return ACCEPTED

  const requestedTier = String(formData.get("subscriptionLevel") ?? "")

  /**
   * Seats: one submitted value, one enforced value, and nothing in between.
   *
   * `requestedSeats` is what the form sent -- untrusted, possibly absent, and
   * never written anywhere. `seatCount` is what the server decided, and it is
   * the only seat number used from here on: in the schema, in the insert, in the
   * update and in both emails.
   *
   * Keeping it to two names is the point. An earlier merge left a second
   * derivation of the same thing further down the function, referring to a
   * variable that no longer existed, and the build stopped there.
   *
   * Individual Access is forced to one seat inside the helper rather than
   * trusted from the form, so a request with `seats=50` posted straight at this
   * action still stores one.
   */
  const requestedSeats = formData.get("seats")
  const seatCount = seatsForSubscriptionRequest(requestedTier, requestedSeats)
  if (seatCount === null) {
    return {
      errors: {
        [requestedTier ? "seats" : "subscriptionLevel"]: [
          requestedTier
            ? "Enter how many people need access."
            : "Select a subscription access level.",
        ],
      },
    }
  }

  const parsed = SubscriberSchema.safeParse({
    name: formData.get("name"),
    organization: formData.get("organization"),
    email: formData.get("email"),
    phone: formData.get("phone") ?? "",
    roleTitle: formData.get("roleTitle") ?? "",
    seats: seatCount,
    subscriptionLevel: requestedTier,
    note: formData.get("note") ?? "",
    acceptedTerms: formData.get("acceptedTerms"),
  })

  if (!parsed.success) return { errors: fieldErrors(parsed.error) }

  const {
    name,
    organization,
    email,
    roleTitle,
    subscriptionLevel,
    note,
  } = parsed.data
  const phone = normalisePhone(parsed.data.phone)

  if (requiresWorkEmail(subscriptionLevel) && isPersonalEmail(email)) {
    return { errors: { email: [WORK_EMAIL_MESSAGE] } }
  }

  const sql = getSql()
  const ip = await clientIp()
  const throttled = await isThrottled(sql, email, ip)
  if (throttled) {
    return {
      message:
        "We have already received a request from you. Please give us a day to reply.",
    }
  }
  const level = levelForPublicTier(subscriptionLevel)
  try {
    await sql`
      insert into subscribers (
        name, full_name, organization, email, phone, role_title,
        subscription_level, public_tier, level, seats, note, status,
        terms_accepted_at
      ) values (
        ${name}, ${name}, ${organization}, ${email}, ${phone}, ${roleTitle},
        ${subscriptionLevel}, ${subscriptionLevel}, ${level}, ${seatCount}, ${note}, 'Pending',
        now()
      )
    `
  } catch {
    await sql`
      update subscribers set
        name = ${name},
        full_name = ${name},
        organization = ${organization},
        phone = ${phone},
        role_title = ${roleTitle},
        client_type = 'subscriber',
        subscription_level = ${subscriptionLevel},
        public_tier = ${subscriptionLevel},
        level = ${level},
        seats = ${seatCount},
        note = ${note},
        status = 'Pending',
        terms_accepted_at = now(),
        updated_at = now()
      where lower(email) = ${email}
        and lower(status) in ('pending', 'declined')
    `
  }

  await recordAttempt(sql, email, ip)
  try {
    await Promise.all([
      sendAccessRequestNotification({
        name,
        organization,
        email,
        phone,
        roleTitle,
        seats: seatCount,
        subscriptionLevel,
        note,
      }),
      sendAccessRequestConfirmation({ name, email }),
    ])
  } catch {}

  revalidatePath("/admin")
  revalidatePath("/admin/subscribers")

  return {
    ok: true,
    message:
      "Your details have been submitted. We reply within one business day.",
  }
}
export async function requestBriefing(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = BriefingRequestSchema.safeParse({
    name: formData.get("name"),
    organization: formData.get("organization"),
    roleTitle: formData.get("roleTitle"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    briefingType: formData.get("briefingType"),
    format: formData.get("format"),
    timeline: formData.get("timeline"),
    sector: formData.get("sector"),
    description: formData.get("description"),
    audienceSize: formData.get("audienceSize"),
    location: formData.get("location"),
    acceptedTerms: formData.get("acceptedTerms"),
  })

  if (!parsed.success) return { errors: fieldErrors(parsed.error) }

  const d = parsed.data
  const sql = getSql()

  await sql`
    insert into briefing_requests (
      name, organization, role_title, email, phone, briefing_type,
      format, timeline, sector, description, audience_size, location, status,
      terms_accepted_at
    ) values (
      ${d.name}, ${d.organization}, ${d.roleTitle}, ${d.email}, ${d.phone},
      ${d.briefingType}, ${d.format}, ${d.timeline}, ${d.sector},
      ${d.description}, ${d.audienceSize}, ${d.location}, 'New',
      now()
    )
  `

  revalidatePath("/admin")
  revalidatePath("/admin/briefings")

  try {
    await Promise.all([
      sendBriefingConfirmation(d),
      sendBriefingNotification(d),
    ])
  } catch {}

  return {
    ok: true,
    message:
      "Your request has been received. We will respond to discuss scope and availability.",
  }
}
