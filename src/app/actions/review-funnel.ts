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
} from "@/lib/review-email"

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
const baseUrl = () => {
  const value = process.env.APP_URL
  if (!value) throw new Error("APP_URL is not configured")
  return value.replace(/\/$/, "")
}

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
  await sendReviewVerification(
    email,
    fullName,
    `${baseUrl()}/review/verify?token=${encodeURIComponent(token)}`,
  )
  return {
    ok: true,
    message: "Please check your email to confirm your APRI review request.",
  }
}

export async function verifyReviewToken(
  token: string,
): Promise<"confirmed" | "invalid"> {
  await enforceReviewRateLimit("review_verify", 20)
  if (!/^[A-Za-z0-9_-]{40,80}$/.test(token)) return "invalid"
  const sql = getSql(),
    hash = hashToken(token)
  const rows = (await sql`
    with consumed as (
      update review_tokens set consumed_at=now() where token_hash=${hash} and purpose='email_verification'
        and consumed_at is null and expires_at>now() returning prospect_id
    )
    update review_prospects p set status='Email Verified',verified_at=coalesce(verified_at,now()),updated_at=now()
    from consumed c where p.id=c.prospect_id
    returning p.*
  `) as Record<string, string | null>[]
  if (!rows[0]) return "invalid"
  const p = rows[0]
  await sql`insert into review_prospect_events(prospect_id,event_type,from_status,to_status,detail) values(${p.id}::uuid,'email_verified','Review Requested','Email Verified','Email confirmed')`
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
  } catch {
    await sql`update review_prospects set manager_notification_error='Notification pending' where id=${p.id}::uuid and manager_notified_at is null`
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
  return true
}

export async function sendSecureReviewAccess(
  prospectId: string,
  readiness: string[],
): Promise<ReviewFormState> {
  const admin = await requireOwner()
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
  const links =
    (await sql`select slot_key,secure_link_id,papermark_document_id from complimentary_review_items where slot_key in ('MIN','AIU','PLM') and secure_link_verified_at is not null and secure_link_document_id=papermark_document_id and secure_link_url<>'' order by slot_key`) as {
      slot_key: string
      secure_link_id: string | null
      papermark_document_id: string | null
    }[]
  if (links.length !== 3 || links.some((link) => !link.secure_link_id || !link.papermark_document_id))
    return {
      message:
        "All three fixed links must be verified and mapped before access can be sent.",
    }
  const approvedRow = (await sql`select value from app_settings where key='review_approved_recipients'`) as { value: string }[]
  const approved = (approvedRow[0]?.value ?? "").split(/[\n,]/).map((email) => email.trim().toLowerCase()).filter(Boolean)
  if (!approved.includes(p.email.toLowerCase())) return { message: "This verified address is not yet in Approved Review Recipients." }
  const { verifyReviewDocumentLink } = await import("@/lib/papermark-datarooms")
  for (const link of links) {
    const checked = await verifyReviewDocumentLink({
      linkId: link.secure_link_id!,
      expectedDocumentId: link.papermark_document_id!,
      expectedAllowList: approved,
    })
    if (!checked.ok) return { message: `${link.slot_key} is not ready. ${checked.message}` }
  }
  const token = newToken()
  await sql`update review_tokens set consumed_at=now() where prospect_id=${p.id}::uuid and purpose='review_access' and consumed_at is null`
  await sql`insert into review_tokens(prospect_id,purpose,token_hash,expires_at) values(${p.id}::uuid,'review_access',${hashToken(token)},now()+interval '24 hours')`
  await sendReviewAccess(
    p.email,
    p.full_name,
    `${baseUrl()}/review/access?token=${encodeURIComponent(token)}`,
  )
  await sql`update review_prospects set status='Review Access Sent',access_sent_at=now(),updated_at=now() where id=${p.id}::uuid`
  await sql`insert into review_prospect_events(prospect_id,event_type,from_status,to_status,detail,actor_admin_id) values(${p.id}::uuid,'review_access_sent',${p.status},'Review Access Sent','Secure library access email sent',${admin.id}::uuid)`
  revalidatePath(`/admin/review-requests/${p.id}`)
  return { ok: true, message: "Secure review access sent." }
}

export async function approveProspectRecipient(formData: FormData) {
  await requireOwner()
  const id = String(formData.get("id") || "")
  const sql = getSql(),
    prospects =
      (await sql`select email from review_prospects where id=${id}::uuid and verified_at is not null`) as {
        email: string
      }[]
  if (!prospects[0]) throw new Error("Verified prospect not found")
  const current =
    (await sql`select value from app_settings where key='review_approved_recipients'`) as {
      value: string
    }[]
  const emails = new Set(
    (current[0]?.value || "")
      .split(/[\n,]/)
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean),
  )
  emails.add(prospects[0].email.toLowerCase())
  await sql`insert into app_settings(key,value) values('review_approved_recipients',${[...emails].sort().join("\n")}) on conflict(key) do update set value=excluded.value`
  revalidatePath(`/admin/review-requests/${id}`)
  revalidatePath("/admin/review-library")
}

export async function sendSecureReviewAccessForm(formData: FormData) {
  const id = String(formData.get("id") || "")
  const readiness = formData.getAll("readiness").map(String)
  const result = await sendSecureReviewAccess(id, readiness)
  if (!result.ok)
    throw new Error(result.message || "Review access could not be sent")
}

export async function submitSubscriptionRequest(
  prospectId: string,
  _state: ReviewFormState,
  formData: FormData,
): Promise<ReviewFormState> {
  const session = (await import("@/lib/review-security")).readReviewSession
  if ((await session()) !== prospectId)
    return { message: "Your review session has expired." }
  await enforceReviewRateLimit("subscription_request", 4)
  const plan = clean(formData.get("plan"), 20),
    expected = plan === "Individual" ? 1 : plan === "Professional" ? 3 : 0
  const users = [] as { name: string; email: string }[]
  for (let i = 0; i < 3; i++) {
    const name = clean(formData.get(`userName${i}`), 120),
      email = clean(formData.get(`userEmail${i}`), 254).toLowerCase()
    if (name || email) {
      if (!name || !emailOk(email))
        return { message: "Each authorised user needs a valid name and email." }
      users.push({ name, email })
    }
  }
  if (
    !expected ||
    users.length < 1 ||
    users.length > expected ||
    (plan === "Individual" && users.length !== 1)
  )
    return {
      message:
        "Individual requires one authorised user; Professional permits one to three.",
    }
  if (formData.get("terms") !== "on")
    return { message: "You must accept the terms and privacy notice." }
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
  const values = {
    phone: clean(formData.get("phone"), 40),
    legal: clean(formData.get("legalName"), 180),
    billingEmail: clean(formData.get("billingEmail"), 254).toLowerCase(),
    address: clean(formData.get("billingAddress"), 400),
    city: clean(formData.get("cityState"), 120),
    country: clean(formData.get("country"), 100),
    tax: clean(formData.get("taxReference"), 120),
  }
  if (
    !values.phone ||
    !values.legal ||
    !emailOk(values.billingEmail) ||
    !values.address ||
    !values.city ||
    !values.country
  )
    return { message: "Complete all required contracting fields." }
  const agreement =
    plan === "Individual"
      ? "APRI Individual Subscription"
      : "APRI Professional Subscription"
  await sql`insert into review_subscription_requests(prospect_id,plan,requester_name,requester_email,phone,legal_billing_name,billing_email,billing_address,city_state,country,tax_reference,authorised_users,terms_accepted_at,agreement_type) values(${prospectId}::uuid,${plan},${p.full_name},${p.email},${values.phone},${values.legal},${values.billingEmail},${values.address},${values.city},${values.country},${values.tax || null},${JSON.stringify(users)}::jsonb,now(),${agreement}) on conflict(prospect_id) do nothing`
  await sql`update review_prospects set status='Subscription Requested',updated_at=now() where id=${prospectId}::uuid`
  await sql`insert into review_prospect_events(prospect_id,event_type,from_status,to_status,detail) values(${prospectId}::uuid,'subscription_requested',${p.status},'Subscription Requested',${plan})`
  await sendSubscriptionMessages({
    email: p.email,
    name: p.full_name,
    plan,
    adminUrl: `${baseUrl()}/admin/review-requests/${prospectId}`,
  })
  redirect("/review/subscribe/thanks")
}
