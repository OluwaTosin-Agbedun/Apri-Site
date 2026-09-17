"use server"
import { revalidatePath } from "next/cache"
import { requireOwner } from "@/lib/dal"
import { getSql } from "@/lib/db"
import { sendReviewManagerNotification } from "@/lib/review-email"

const UUID = /^[0-9a-f-]{36}$/i
const base = () => {
  if (!process.env.APP_URL) throw new Error("APP_URL is not configured")
  return process.env.APP_URL.replace(/\/$/, "")
}
export async function retryReviewNotification(formData: FormData) {
  await requireOwner()
  const id = String(formData.get("id") || "")
  if (!UUID.test(id)) throw new Error("Invalid prospect")
  const sql = getSql(),
    rows =
      (await sql`select * from review_prospects where id=${id}::uuid and verified_at is not null and manager_notified_at is null`) as Record<string, string | null>[]
  const p = rows[0]
  if (!p) return
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
    }).format(new Date(p.verified_at!)),
    url: `${base()}/admin/review-requests/${id}`,
  })
  await sql`update review_prospects set manager_notified_at=now(),manager_notification_error=null where id=${id}::uuid and manager_notified_at is null`
  revalidatePath(`/admin/review-requests/${id}`)
}

export async function saveCommercialMilestones(formData: FormData) {
  const admin = await requireOwner()
  const id = String(formData.get("id") || "")
  if (!UUID.test(id)) throw new Error("Invalid prospect")
  const sql = getSql(),
    rows =
      (await sql`select r.*,p.status from review_subscription_requests r join review_prospects p on p.id=r.prospect_id where r.prospect_id=${id}::uuid`) as Record<string, string | null>[]
  const before = rows[0]
  if (!before) throw new Error("Subscription request not found")
  const date = (key: string) => {
    const v = String(formData.get(key) || "")
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
  }
  // Completed commercial milestones are monotonic. An omitted field may not
  // erase a fact already recorded by another owner session.
  const sent = date("agreementSent") || before.agreement_sent_at,
    signed = date("agreementSigned") || before.agreement_signed_at,
    invoice = date("invoiceSent") || before.invoice_sent_at,
    paid = date("paymentConfirmed") || before.payment_confirmed_at
  if (signed && !sent)
    throw new Error("Agreement sent must be recorded before signing")
  if (paid && !invoice)
    throw new Error("Invoice sent must be recorded before payment confirmation")
  const next = paid
    ? "Payment Confirmed"
    : invoice
      ? "Invoice Sent"
      : signed
        ? "Agreement Signed"
        : sent
          ? "Agreement Sent"
          : "Subscription Requested"
  const order = [
    "Review Requested", "Email Verified", "Review Access Sent", "Subscription Requested",
    "Agreement Sent", "Agreement Signed", "Invoice Sent", "Payment Confirmed",
    "Access Activated", "Active Subscriber",
  ]
  if (order.indexOf(next) < order.indexOf(before.status || "")) {
    throw new Error("Status transitions cannot move a prospect backwards.")
  }
  await sql`update review_subscription_requests set docusign_reference=${
    String(formData.get("docusignReference") || "")
      .trim()
      .slice(0, 120) || null
  },agreement_sent_at=${sent}::date,agreement_signed_at=${signed}::date,invoice_reference=${
    String(formData.get("invoiceReference") || "")
      .trim()
      .slice(0, 120) || null
  },invoice_sent_at=${invoice}::date,payment_reference=${
    String(formData.get("paymentReference") || "")
      .trim()
      .slice(0, 120) || null
  },payment_confirmed_at=${paid}::date,papermark_access_prepared_at=${
    formData.get("papermarkPrepared") === "on" ? new Date() : before.papermark_access_prepared_at
  },subscription_starts_at=${date("termStart")}::date,subscription_ends_at=${date("termEnd")}::date,internal_notes=${
    String(formData.get("notes") || "")
      .trim()
      .slice(0, 2000) || null
  },updated_at=now() where prospect_id=${id}::uuid`
  if (next !== before.status) {
    await sql`update review_prospects set status=${next},updated_at=now() where id=${id}::uuid`
    await sql`insert into review_prospect_events(prospect_id,event_type,from_status,to_status,detail,actor_admin_id) values(${id}::uuid,'commercial_milestone',${before.status},${next},'Commercial milestones updated',${admin.id}::uuid)`
  }
  revalidatePath(`/admin/review-requests/${id}`)
}

export async function activateReviewSubscription(formData: FormData) {
  const admin = await requireOwner()
  const id = String(formData.get("id") || "")
  if (!UUID.test(id)) throw new Error("Invalid prospect")
  const sql = getSql(),
    rows =
      (await sql`select r.*,p.verified_at,p.status from review_subscription_requests r join review_prospects p on p.id=r.prospect_id where r.prospect_id=${id}::uuid`) as Record<string, unknown>[]
  const r = rows[0]
  if (!r) throw new Error("Subscription request not found")
  const users = r.authorised_users as { name: string; email: string }[]
  const expected = r.plan === "Individual" ? 1 : 3
  if (
    !r.verified_at ||
    !r.agreement_sent_at ||
    !r.agreement_signed_at ||
    !r.invoice_sent_at ||
    !r.payment_confirmed_at ||
    !r.papermark_access_prepared_at ||
    !r.subscription_starts_at ||
    !r.subscription_ends_at ||
    !Array.isArray(users) ||
    users.length < 1 ||
    users.length > expected ||
    (r.plan === "Individual" && users.length !== 1)
  )
    throw new Error(
      "Activation blocked: verification, agreement, invoice, payment, named users, Papermark preparation and subscription term are all required.",
    )
  const tier =
    r.plan === "Individual" ? "Individual Access" : "Professional Team Access"
  const activeCollision = (await sql`
    select email from subscribers where lower(status)='active'
      and lower(email) = any(${users.map((user) => user.email.toLowerCase())}::text[])
    limit 1
  `) as { email: string }[]
  if (activeCollision[0]) throw new Error("Activation preparation stopped: an authorised email already belongs to an active subscriber. Existing active subscribers are never overwritten or regressed.")
  for (const user of users) {
    await sql`insert into subscribers(full_name,name,email,organization,client_type,public_tier,subscription_level,level,seats,term_start,term_end,status,invoice_ref,note) values(${user.name},${user.name},${user.email.toLowerCase()},${String(r.legal_billing_name)},'subscriber',${tier},${tier},'L1',1,${String(r.subscription_starts_at)}::date,${String(r.subscription_ends_at)}::date,'pending',${String(r.invoice_reference || "")},${`Activated from review prospect ${id}`}) on conflict ((lower(email))) do update set full_name=excluded.full_name,name=excluded.name,organization=excluded.organization,public_tier=excluded.public_tier,subscription_level=excluded.subscription_level,level='L1',term_start=excluded.term_start,term_end=excluded.term_end,invoice_ref=excluded.invoice_ref where lower(subscribers.status)<>'active'`
  }
  await sql`insert into review_prospect_events(prospect_id,event_type,from_status,to_status,detail,actor_admin_id) values(${id}::uuid,'subscriber_records_prepared',${String(r.status)},${String(r.status)},'Named pending subscriber records prepared; final activation remains in the existing Subscribers workflow',${admin.id}::uuid)`
  revalidatePath(`/admin/review-requests/${id}`)
  revalidatePath("/admin/subscribers")
}
