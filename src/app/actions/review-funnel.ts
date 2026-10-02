"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { getSql } from "@/lib/db"
import { requireOwner } from "@/lib/dal"
import {
  enforceReviewRateLimit,
  hashToken,
  newToken,
  createReviewSession,
} from "@/lib/review-security"
import {
  sendReviewAccess,
  sendReviewManagerNotification,
  sendReviewVerification,
  sendSubscriptionMessages,
  sendSubscriptionConfirmation,
  ReviewEmailNotSent,
} from "@/lib/review-email"
import {
  expectedRecipientsForEdition,
  grantedEditionsForProspect,
} from "@/lib/edition-recipients-dal"
import { editionRecipientsReady } from "@/lib/edition-recipients-schema"
import { MIGRATION_PENDING_MESSAGE } from "@/lib/edition-recipients"
import {
  PLANS,
  laterStatus,
  parsePlan,
  validateAuthorisedUsers,
  type AuthorisedUser,
  type PlanKey,
} from "@/lib/subscription-journey"
import { subscriptionActivationReady } from "@/lib/subscription-schema"
import { emailOrigin } from "@/lib/app-url"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ReviewFormState = { ok?: boolean; message?: string }
const USER_TYPES = [
  "Individual professional",
  "Small professional team",
  "Corporate or institutional",
]
const SOURCES = [
  "WhatsApp",
  "Google",
  "Facebook",
  "X",
  "LinkedIn",
  "Referral",
  "Other",
]
const clean = (v: FormDataEntryValue | null, max: number) =>
  typeof v === "string" ? v.trim().slice(0, max) : ""
const emailOk = (v: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254
const baseUrl = emailOrigin

function attributedSource(self: string, utm: string, referrer: string) {
  const source = utm.toLowerCase()
  if (source.includes("whatsapp")) return "WhatsApp"
  if (source.includes("google")) return "Google"
  if (source.includes("facebook") || source === "fb") return "Facebook"
  if (source === "x" || source.includes("twitter")) return "X"
  if (source.includes("linkedin")) return "LinkedIn"
  if (referrer) return "Referral"
  return self || "Direct traffic"
}

export async function requestReview(
  _state: ReviewFormState,
  formData: FormData,
): Promise<ReviewFormState> {
  if (clean(formData.get("website"), 200))
    return { ok: true, message: "Please check your email." }
  await enforceReviewRateLimit("review_request", 6)
  const fullName = clean(formData.get("fullName"), 120),
    email = clean(formData.get("email"), 254).toLowerCase()
  const organisation = clean(formData.get("organisation"), 160),
    role = clean(formData.get("role"), 160)
  const userType = clean(formData.get("userType"), 60),
    selfSource = clean(formData.get("source"), 30)
  if (
    fullName.length < 2 ||
    !emailOk(email) ||
    role.length < 2 ||
    !USER_TYPES.includes(userType) ||
    !SOURCES.includes(selfSource)
  )
    return {
      message: "Please complete every required field with valid information.",
    }
  const utm = ["source", "medium", "campaign", "term", "content"].map((k) =>
    clean(formData.get(`utm_${k}`), 120),
  )
  const referrer = clean(formData.get("referrerHost"), 253).toLowerCase()
  const safeRef =
    /^[a-z0-9.-]+$/.test(referrer) && !referrer.includes("localhost")
      ? referrer
      : ""
  const attributed = attributedSource(selfSource, utm[0]!, safeRef)
  const sql = getSql()
  const rows = (await sql`
    insert into review_prospects(full_name,email,organisation,role_profession,user_type,self_reported_source,attributed_source,
      first_utm_source,first_utm_medium,first_utm_campaign,first_utm_term,first_utm_content,
      latest_utm_source,latest_utm_medium,latest_utm_campaign,latest_utm_term,latest_utm_content,safe_referrer_host)
    values(${fullName},${email},${organisation || null},${role},${userType},${selfSource},${attributed},
      ${utm[0] || null},${utm[1] || null},${utm[2] || null},${utm[3] || null},${utm[4] || null},
      ${utm[0] || null},${utm[1] || null},${utm[2] || null},${utm[3] || null},${utm[4] || null},${safeRef || null})
    on conflict ((lower(email))) do update set full_name=excluded.full_name, organisation=excluded.organisation,
      role_profession=excluded.role_profession,user_type=excluded.user_type,self_reported_source=excluded.self_reported_source,
      latest_utm_source=excluded.latest_utm_source,
      latest_utm_medium=excluded.latest_utm_medium,latest_utm_campaign=excluded.latest_utm_campaign,
      latest_utm_term=excluded.latest_utm_term,latest_utm_content=excluded.latest_utm_content,
      safe_referrer_host=excluded.safe_referrer_host,requested_at=now(),updated_at=now()
    returning id
  `) as { id: string }[]
  const id = rows[0]!.id,
    token = newToken(),
    tokenHash = hashToken(token)
  await sql`update review_tokens set consumed_at=now() where prospect_id=${id}::uuid and purpose='email_verification' and consumed_at is null`
  await sql`insert into review_tokens(prospect_id,purpose,token_hash,expires_at) values(${id}::uuid,'email_verification',${tokenHash},now()+interval '24 hours')`
  await sql`insert into review_prospect_events(prospect_id,event_type,to_status,detail) values(${id}::uuid,'review_requested','Review Requested','Review request received')`
  try {
    await sendReviewVerification(
      email,
      fullName,
      `${baseUrl()}/review/verify?token=${encodeURIComponent(token)}`,
    )
  } catch {
    // The request is stored; only the email failed. Say so, rather than
    // telling the visitor to wait for an email that is not coming.
    return {
      message:
        "Your request was saved, but we could not send the confirmation email just now. Please try again in a few minutes.",
    }
  }
  return {
    ok: true,
    message: "Please check your email to confirm your APRI review request.",
  }
}

export async function verifyReviewToken(
  token: string,
): Promise<"confirmed" | "subscription" | "invalid"> {
  await enforceReviewRateLimit("review_verify", 20)
  if (!/^[A-Za-z0-9_-]{40,80}$/.test(token)) return "invalid"
  const sql = getSql(),
    hash = hashToken(token)
  // Status only ever moves up: a prospect who has already requested a
  // subscription is not sent back to "Email Verified" by confirming.
  const rows = (await sql`
    with consumed as (
      update review_tokens set consumed_at=now() where token_hash=${hash} and purpose='email_verification'
        and consumed_at is null and expires_at>now() returning prospect_id
    )
    update review_prospects p
      set status = case when p.status = 'Review Requested' then 'Email Verified' else p.status end,
          verified_at=coalesce(verified_at,now()),updated_at=now()
    from consumed c where p.id=c.prospect_id
    returning p.*
  `) as Record<string, string | null>[]
  if (!rows[0]) return "invalid"
  const p = rows[0]

  // A subscription request from the public page is confirmed by this link.
  if (await subscriptionActivationReady(sql)) {
    const confirmed = (await sql`
      update review_subscription_requests set requester_confirmed_at=coalesce(requester_confirmed_at,now()),updated_at=now()
      where prospect_id=${p.id}::uuid and submitted_via='access_page' and requester_confirmed_at is null
      returning id
    `) as { id: string }[]
    if (confirmed[0]) {
      await sql`insert into review_prospect_events(prospect_id,event_type,from_status,to_status,detail) values(${p.id}::uuid,'subscription_request_confirmed',${p.status},${p.status},'Requester confirmed their email address')`
      return "subscription"
    }
  }

  await sql`insert into review_prospect_events(prospect_id,event_type,from_status,to_status,detail) values(${p.id}::uuid,'email_verified','Review Requested',${p.status},'Email confirmed')`
  try {
    await sendReviewManagerNotification({
      name: p.full_name!,
      email: p.email!,
      organisation: p.organisation || "Not provided",
      role: p.role_profession!,
      userType: p.user_type!,
      source: p.attributed_source!,
      utm:
        [
          p.first_utm_source,
          p.first_utm_medium,
          p.first_utm_campaign,
          p.first_utm_term,
          p.first_utm_content,
        ]
          .filter(Boolean)
          .join(" / ") || "Unavailable",
      when: new Intl.DateTimeFormat("en-NG", {
        timeZone: "Africa/Lagos",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date()),
      url: `${baseUrl()}/admin/review-requests/${p.id}`,
    })
    await sql`update review_prospects set manager_notified_at=now(),manager_notification_error=null where id=${p.id}::uuid and manager_notified_at is null`
  } catch (error) {
    const reason = error instanceof ReviewEmailNotSent ? `Not sent: ${error.outcome.status}` : "Notification pending"
    await sql`update review_prospects set manager_notification_error=${reason} where id=${p.id}::uuid and manager_notified_at is null`
  }
  return "confirmed"
}

export async function consumeReviewAccessToken(
  token: string,
): Promise<boolean> {
  await enforceReviewRateLimit("review_access", 20)
  if (!/^[A-Za-z0-9_-]{40,80}$/.test(token)) return false
  const sql = getSql(),
    rows = (await sql`
    update review_tokens set consumed_at=now() where token_hash=${hashToken(token)} and purpose='review_access'
      and consumed_at is null and expires_at>now() returning prospect_id
  `) as { prospect_id: string }[]
  if (!rows[0]) return false
  await createReviewSession(rows[0].prospect_id)
  // And the remembered Review Library session, so this reader returns on this
  // browser without another email. Best effort: the one-day session stands.
  try {
    const { reviewReaderSchemaReady, createReaderSession } = await import("@/lib/review-reader")
    if (await reviewReaderSchemaReady()) {
      const [p] = (await sql`select lower(btrim(email)) as email from review_prospects where id = ${rows[0].prospect_id}::uuid`) as { email: string }[]
      if (p?.email) await createReaderSession(p.email, "access_link")
    }
  } catch {}
  return true
}

export async function sendSecureReviewAccess(
  prospectId: string,
  readiness: string[],
): Promise<ReviewFormState> {
  const admin = await requireOwner()
  if (!UUID.test(prospectId)) return { message: "Unknown review request." }
  const required = [
    "allowlist",
    "mapped",
    "email_auth",
    "downloads",
    "watermark",
  ]
  if (!required.every((v) => readiness.includes(v)))
    return {
      message: "Complete and confirm every Papermark readiness check first.",
    }
  if (!(await editionRecipientsReady(getSql(), { fresh: true })))
    return { message: MIGRATION_PENDING_MESSAGE }
  const sql = getSql(),
    rows =
      (await sql`select id,full_name,email,status from review_prospects where id=${prospectId}::uuid and verified_at is not null`) as {
        id: string
        full_name: string
        email: string
        status: string
      }[]
  const p = rows[0]
  if (!p) return { message: "Verified prospect not found." }

  // Only the editions this prospect was explicitly granted -- never a fixed
  // set, and never everything published. Each is then checked live against
  // its own list, which is what the prospect's library will actually show.
  const granted = await grantedEditionsForProspect(sql, p.email)
  if (granted.length === 0)
    return {
      message:
        "No published edition is granted to this prospect yet. Grant at least one edition, apply it in Review Library, then send access.",
    }
  const { verifyReviewDocumentLink } = await import("@/lib/papermark-datarooms")
  for (const edition of granted) {
    const label = [edition.series, edition.editionLabel || edition.title].filter(Boolean).join(" · ")
    const expected = await expectedRecipientsForEdition(sql, edition)
    if (!expected.includes(p.email.trim().toLowerCase()))
      return { message: `${label} does not list this prospect. Nothing was sent.` }
    const checked = await verifyReviewDocumentLink({
      linkId: edition.secureLinkId,
      expectedDocumentId: edition.papermarkDocumentId,
      expectedAllowList: expected,
    })
    if (!checked.ok) return { message: `${label} is not ready. ${checked.message} Nothing was sent.` }
  }
  const token = newToken()
  await sql`update review_tokens set consumed_at=now() where prospect_id=${p.id}::uuid and purpose='review_access' and consumed_at is null`
  await sql`insert into review_tokens(prospect_id,purpose,token_hash,expires_at) values(${p.id}::uuid,'review_access',${hashToken(token)},now()+interval '24 hours')`
  try {
    await sendReviewAccess(
      p.email,
      p.full_name,
      `${baseUrl()}/review/access?token=${encodeURIComponent(token)}`,
    )
  } catch (error) {
    // Not sent: the link is withdrawn and nothing is marked as sent.
    await sql`update review_tokens set consumed_at=now() where token_hash=${hashToken(token)} and consumed_at is null`
    const reason = error instanceof ReviewEmailNotSent ? error.outcome.message : "the email could not be handed to the provider"
    return { ok: false, message: `The access email was not sent: ${reason}. Nothing was marked as sent; try again.` }
  }
  await sql`update review_prospects set status='Review Access Sent',access_sent_at=now(),updated_at=now() where id=${p.id}::uuid`
  await sql`insert into review_prospect_events(prospect_id,event_type,from_status,to_status,detail,actor_admin_id) values(${p.id}::uuid,'review_access_sent',${p.status},'Review Access Sent','Secure library access email accepted by the email provider',${admin.id}::uuid)`
  revalidatePath(`/admin/review-requests/${p.id}`)
  return {
    ok: true,
    message:
      "Accepted by the email provider. That is not proof of delivery: Admin -> Review Library -> Advanced shows delivery once the provider reports it.",
  }
}

// Approving a prospect no longer appends them to the shared list, which would
// have granted every published edition. Editions are granted explicitly, one
// choice at a time, by grantProspectEditions in review-edition-access.ts.

/**
 * Form-state wrapper for the Admin page.
 *
 * Returns the reason access was not sent rather than throwing: a thrown
 * server-action error is redacted in production, which would leave the owner
 * with no idea which edition was not ready.
 */
export async function sendSecureReviewAccessFromForm(
  prospectId: string,
  _state: ReviewFormState,
  formData: FormData,
): Promise<ReviewFormState> {
  await requireOwner()
  const readiness = formData.getAll("readiness").map(String)
  return sendSecureReviewAccess(prospectId, readiness)
}

type Contracting = {
  phone: string
  legal: string
  billingEmail: string
  address: string
  city: string
  country: string
  tax: string
}

/** The contracting and billing details both request paths collect. */
function readContracting(formData: FormData): { ok: true; value: Contracting } | { ok: false; message: string } {
  const value = {
    phone: clean(formData.get("phone"), 40),
    legal: clean(formData.get("legalName"), 180),
    billingEmail: clean(formData.get("billingEmail"), 254).toLowerCase(),
    address: clean(formData.get("billingAddress"), 400),
    city: clean(formData.get("cityState"), 120),
    country: clean(formData.get("country"), 100),
    tax: clean(formData.get("taxReference"), 120),
  }
  if (!/^[+0-9 ()-]{7,40}$/.test(value.phone)) return { ok: false, message: "Enter a valid phone number." }
  if (!value.legal || !emailOk(value.billingEmail) || !value.address || !value.city || !value.country)
    return { ok: false, message: "Complete all required contracting fields." }
  return { ok: true, value }
}

/** The plan's named subscribers, validated against its limit. */
function readUsers(formData: FormData, plan: PlanKey): { ok: true; users: AuthorisedUser[] } | { ok: false; message: string } {
  const users: AuthorisedUser[] = []
  for (let i = 0; i < 3; i++) {
    const name = clean(formData.get(`userName${i}`), 120),
      email = clean(formData.get(`userEmail${i}`), 254).toLowerCase()
    if (name || email) {
      if (!name || !emailOk(email)) return { ok: false, message: "Each authorised subscriber needs a name and a valid email address." }
      users.push({ name, email })
    }
  }
  return validateAuthorisedUsers(plan, users)
}

/**
 * The confirmation emails, sent after the request is safely stored. A mail
 * failure never loses the request: it is recorded for the Admin page instead.
 */
async function sendRequestEmails(
  sql: ReturnType<typeof getSql>,
  prospectId: string,
  d: { email: string; name: string; plan: PlanKey },
) {
  try {
    await sendSubscriptionMessages({
      email: d.email,
      name: d.name,
      plan: d.plan,
      adminUrl: `${baseUrl()}/admin/review-requests/${prospectId}`,
    })
  } catch {
    await sql`insert into review_prospect_events(prospect_id,event_type,detail) values(${prospectId}::uuid,'confirmation_email_failed','The subscription request confirmation email could not be sent')`
  }
}

/**
 * A subscription request from the Review Library.
 *
 * The prospect is whoever holds the review session, never an id the form
 * sends: the bound id is only accepted when it matches the session.
 */
export async function submitSubscriptionRequest(
  prospectId: string,
  _state: ReviewFormState,
  formData: FormData,
): Promise<ReviewFormState> {
  const session = (await import("@/lib/review-security")).readReviewSession
  if ((await session()) !== prospectId)
    return { message: "Your review session has expired." }
  await enforceReviewRateLimit("subscription_request", 4)
  const plan = parsePlan(clean(formData.get("plan"), 20))
  if (!plan) return { message: "Choose Individual or Professional Access." }
  const users = readUsers(formData, plan)
  if (!users.ok) return { message: users.message }
  if (formData.get("terms") !== "on")
    return { message: "You must accept the terms and privacy notice." }
  const contracting = readContracting(formData)
  if (!contracting.ok) return { message: contracting.message }
  const values = contracting.value

  const sql = getSql(),
    prospects =
      (await sql`select full_name,email,status,verified_at from review_prospects where id=${prospectId}::uuid`) as {
        full_name: string
        email: string
        status: string
        verified_at: string | null
      }[]
  const p = prospects[0]
  if (!p?.verified_at)
    return { message: "A verified review prospect is required." }

  const agreement = PLANS[plan].agreement
  const tracked = await subscriptionActivationReady(sql)
  const inserted = (tracked
    ? await sql`insert into review_subscription_requests(prospect_id,plan,requester_name,requester_email,phone,legal_billing_name,billing_email,billing_address,city_state,country,tax_reference,authorised_users,terms_accepted_at,agreement_type,submitted_via,requester_confirmed_at) values(${prospectId}::uuid,${plan},${p.full_name},${p.email},${values.phone},${values.legal},${values.billingEmail},${values.address},${values.city},${values.country},${values.tax || null},${JSON.stringify(users.users)}::jsonb,now(),${agreement},'review_library',now()) on conflict(prospect_id) do nothing returning id`
    : await sql`insert into review_subscription_requests(prospect_id,plan,requester_name,requester_email,phone,legal_billing_name,billing_email,billing_address,city_state,country,tax_reference,authorised_users,terms_accepted_at,agreement_type) values(${prospectId}::uuid,${plan},${p.full_name},${p.email},${values.phone},${values.legal},${values.billingEmail},${values.address},${values.city},${values.country},${values.tax || null},${JSON.stringify(users.users)}::jsonb,now(),${agreement}) on conflict(prospect_id) do nothing returning id`) as { id: string }[]

  // A repeat submission changes nothing and sends nothing.
  if (inserted[0]) {
    const next = laterStatus(p.status, "Subscription Requested")
    await sql`update review_prospects set status=${next},updated_at=now() where id=${prospectId}::uuid`
    await sql`insert into review_prospect_events(prospect_id,event_type,from_status,to_status,detail) values(${prospectId}::uuid,'subscription_requested',${p.status},${next},${`${PLANS[plan].label}, from the Review Library`})`
    await sendRequestEmails(sql, prospectId, { email: p.email, name: p.full_name, plan })
  }
  redirect("/review/subscribe/thanks")
}

/**
 * A subscription request from the public Subscription Access page, by a
 * visitor with no review session.
 *
 * The visitor is identified by the email they give, matched to an existing
 * prospect or recorded as a new one -- never by an id the form sends. Nothing
 * about an existing prospect is overwritten, and the response is the same
 * whether or not the address was known. Because anyone can type any address,
 * the request only counts as its requester's once they open the confirmation
 * link sent to that address; activation requires it. Payment is manual: the
 * request grants nothing.
 */
export async function submitPublicSubscriptionRequest(
  _state: ReviewFormState,
  formData: FormData,
): Promise<ReviewFormState> {
  // The form on /access names its shared fields its own way; either spelling
  // is read, and nothing else about the two forms differs.
  const either = (a: string, b: string, max: number) => clean(formData.get(a), max) || clean(formData.get(b), max)

  // The honeypot: a bot is shown the same thank-you page and nothing is stored.
  if (either("website", "websiteUrl", 200)) redirect("/review/subscribe/thanks?from=access")
  await enforceReviewRateLimit("subscription_request_public", 4)

  const level = clean(formData.get("subscriptionLevel"), 60)
  const plan =
    parsePlan(clean(formData.get("plan"), 20)) ??
    (Object.values(PLANS).find((p) => p.tier === level)?.plan ?? null)
  if (!plan) return { message: "Choose Individual or Professional Access." }
  const fullName = either("fullName", "name", 120),
    email = clean(formData.get("email"), 254).toLowerCase(),
    organisation = either("organisation", "organization", 160),
    role = either("role", "roleTitle", 160),
    userType =
      clean(formData.get("userType"), 60) ||
      (plan === "Individual" ? "Individual professional" : "Small professional team"),
    selfSource = clean(formData.get("source"), 30)
  if (formData.get("terms") !== "on" && formData.get("acceptedTerms") !== "on")
    return { message: "You must accept the terms and privacy notice." }
  if (
    fullName.length < 2 ||
    !emailOk(email) ||
    role.length < 2 ||
    !USER_TYPES.includes(userType) ||
    !SOURCES.includes(selfSource)
  )
    return { message: "Please complete every required field with valid information." }
  const users = readUsers(formData, plan)
  if (!users.ok) return { message: users.message }
  const contracting = readContracting(formData)
  if (!contracting.ok) return { message: contracting.message }
  const values = contracting.value

  const sql = getSql()
  if (!(await subscriptionActivationReady(sql))) {
    return {
      message:
        "Subscription requests cannot be taken from this page just yet. Please email intelligence@athenacentre.org and we will help you directly.",
    }
  }

  const utm = ["source", "medium", "campaign", "term", "content"].map((k) => clean(formData.get(`utm_${k}`), 120))
  const referrer = clean(formData.get("referrerHost"), 253).toLowerCase()
  const safeRef = /^[a-z0-9.-]+$/.test(referrer) && !referrer.includes("localhost") ? referrer : ""
  const attributed = attributedSource(selfSource, utm[0]!, safeRef)

  // Match or create the prospect. An existing prospect keeps their own
  // details and first-touch attribution; only the latest touch is updated.
  const created = (await sql`
    insert into review_prospects(full_name,email,organisation,role_profession,user_type,self_reported_source,attributed_source,
      first_utm_source,first_utm_medium,first_utm_campaign,first_utm_term,first_utm_content,
      latest_utm_source,latest_utm_medium,latest_utm_campaign,latest_utm_term,latest_utm_content,safe_referrer_host,status)
    values(${fullName},${email},${organisation || null},${role},${userType},${selfSource},${attributed},
      ${utm[0] || null},${utm[1] || null},${utm[2] || null},${utm[3] || null},${utm[4] || null},
      ${utm[0] || null},${utm[1] || null},${utm[2] || null},${utm[3] || null},${utm[4] || null},${safeRef || null},'Subscription Requested')
    on conflict ((lower(email))) do nothing
    returning id
  `) as { id: string }[]
  let prospectId = created[0]?.id
  if (!prospectId) {
    const existing = (await sql`select id from review_prospects where lower(email)=${email} limit 1`) as { id: string }[]
    prospectId = existing[0]?.id
    if (!prospectId) return { message: "Your request could not be recorded. Please try again." }
    if (utm.some(Boolean)) {
      await sql`update review_prospects set latest_utm_source=${utm[0] || null},latest_utm_medium=${utm[1] || null},latest_utm_campaign=${utm[2] || null},latest_utm_term=${utm[3] || null},latest_utm_content=${utm[4] || null},updated_at=now() where id=${prospectId}::uuid`
    }
  } else {
    await sql`insert into review_prospect_events(prospect_id,event_type,to_status,detail) values(${prospectId}::uuid,'prospect_created','Subscription Requested','Created from a Subscription Access page request')`
  }

  const inserted = (await sql`
    insert into review_subscription_requests(prospect_id,plan,requester_name,requester_email,phone,legal_billing_name,billing_email,billing_address,city_state,country,tax_reference,authorised_users,terms_accepted_at,agreement_type,submitted_via)
    values(${prospectId}::uuid,${plan},${fullName},${email},${values.phone},${values.legal},${values.billingEmail},${values.address},${values.city},${values.country},${values.tax || null},${JSON.stringify(users.users)}::jsonb,now(),${PLANS[plan].agreement},'access_page')
    on conflict(prospect_id) do nothing
    returning id
  `) as { id: string }[]

  if (inserted[0]) {
    const before = (await sql`select status from review_prospects where id=${prospectId}::uuid`) as { status: string }[]
    const from = before[0]?.status ?? "Subscription Requested"
    const next = laterStatus(from, "Subscription Requested")
    await sql`update review_prospects set status=${next},updated_at=now() where id=${prospectId}::uuid`
    await sql`insert into review_prospect_events(prospect_id,event_type,from_status,to_status,detail) values(${prospectId}::uuid,'subscription_requested',${from},${next},${`${PLANS[plan].label}, from the Subscription Access page (awaiting email confirmation)`})`
    await sendRequestEmails(sql, prospectId, { email, name: fullName, plan })
  }

  // Ask the requester to confirm the address, unless an earlier confirmation
  // already covers this request. The same response either way.
  const pending = (await sql`
    select 1 from review_subscription_requests
    where prospect_id=${prospectId}::uuid and submitted_via='access_page' and requester_confirmed_at is null
    limit 1
  `) as unknown[]
  if (pending.length > 0) {
    const token = newToken()
    await sql`update review_tokens set consumed_at=now() where prospect_id=${prospectId}::uuid and purpose='email_verification' and consumed_at is null`
    await sql`insert into review_tokens(prospect_id,purpose,token_hash,expires_at) values(${prospectId}::uuid,'email_verification',${hashToken(token)},now()+interval '24 hours')`
    try {
      await sendSubscriptionConfirmation(email, fullName, `${baseUrl()}/review/verify?token=${encodeURIComponent(token)}`)
    } catch {
      await sql`insert into review_prospect_events(prospect_id,event_type,detail) values(${prospectId}::uuid,'confirmation_email_failed','The email confirmation link could not be sent')`
    }
  }
  redirect("/review/subscribe/thanks?from=access")
}
