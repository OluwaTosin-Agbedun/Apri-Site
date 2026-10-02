"use server"
import { revalidatePath } from "next/cache"
import { requireOwner } from "@/lib/dal"
import { getSql } from "@/lib/db"
import { sendReviewManagerNotification } from "@/lib/review-email"
import type { FormState } from "@/lib/definitions"
import { levelForPublicTier } from "@/lib/entitlements"
import {
  PLANS,
  activationGate,
  activationComplete,
  describeActivation,
  laterStatus,
  milestoneStatus,
  type SeatOutcome,
} from "@/lib/subscription-journey"
import {
  subscriptionActivationReady,
  requesterConfirmed,
  SUBSCRIPTION_MIGRATION_PENDING,
} from "@/lib/subscription-schema"
import { activateSubscriberRecord, activationDone } from "@/lib/subscriber-activation"
import { emailOrigin } from "@/lib/app-url"

const UUID = /^[0-9a-f-]{36}$/i
const base = emailOrigin
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

const day = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null

/**
 * Record the agreement, invoice and payment milestones of one subscription
 * request, each with its date and reference.
 *
 * Milestones only move forward: a blank field keeps what is already recorded
 * rather than erasing it, a signature needs the agreement sent first and a
 * payment needs the invoice first, and no milestone date may be in the
 * future. Every milestone newly recorded or changed is written to the
 * prospect's append-only activity history. Recording a payment grants nothing
 * on its own: activation is a separate, gated step.
 */
export async function saveCommercialMilestones(
  prospectId: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireOwner()
  if (!UUID.test(prospectId)) return { message: "Unknown request." }
  const sql = getSql()
  const rows = (await sql`
    select r.*, p.status from review_subscription_requests r
    join review_prospects p on p.id = r.prospect_id
    where r.prospect_id = ${prospectId}::uuid
  `) as Record<string, unknown>[]
  const before = rows[0]
  if (!before) return { message: "No subscription request is recorded for this prospect." }

  const today = new Date().toISOString().slice(0, 10)
  const problems: string[] = []
  const date = (field: string, label: string, allowFuture = false) => {
    const raw = String(formData.get(field) ?? "").trim()
    if (!raw) return null
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(`${raw}T00:00:00Z`))
    if (!valid) problems.push(`${label} is not a real date.`)
    else if (!allowFuture && raw > today) problems.push(`${label} cannot be in the future.`)
    return valid ? raw : null
  }
  const text = (field: string) => String(formData.get(field) ?? "").trim().slice(0, 120) || null

  const sent = date("agreementSent", "Agreement sent") ?? day(before.agreement_sent_at)
  const signed = date("agreementSigned", "Agreement signed") ?? day(before.agreement_signed_at)
  const invoice = date("invoiceSent", "Invoice issued") ?? day(before.invoice_sent_at)
  const paid = date("paymentConfirmed", "Payment confirmed") ?? day(before.payment_confirmed_at)
  const termStart = date("termStart", "Subscription start", true) ?? day(before.subscription_starts_at)
  const termEnd = date("termEnd", "Subscription end", true) ?? day(before.subscription_ends_at)
  if (problems.length) return { message: problems.join(" ") }
  if (signed && !sent) return { message: "Record the date the agreement was sent before recording its signature." }
  if (signed && sent && signed < sent) return { message: "The agreement cannot be signed before it was sent." }
  if (paid && !invoice) return { message: "Record the invoice before confirming payment." }
  if (paid && invoice && paid < invoice) return { message: "Payment cannot be confirmed before the invoice was issued." }
  if (termStart && termEnd && termEnd < termStart) return { message: "The subscription must end after it starts." }

  const docusign = text("docusignReference") ?? ((before.docusign_reference as string | null) || null)
  const invoiceRef = text("invoiceReference") ?? ((before.invoice_reference as string | null) || null)
  const paymentRef = text("paymentReference") ?? ((before.payment_reference as string | null) || null)
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 2000) || null

  const next = laterStatus(
    String(before.status ?? ""),
    milestoneStatus({ agreementSentAt: sent, agreementSignedAt: signed, invoiceSentAt: invoice, paymentConfirmedAt: paid }),
  )

  await sql`
    update review_subscription_requests set
      docusign_reference = ${docusign},
      agreement_sent_at = ${sent}::date,
      agreement_signed_at = ${signed}::date,
      invoice_reference = ${invoiceRef},
      invoice_sent_at = ${invoice}::date,
      payment_reference = ${paymentRef},
      payment_confirmed_at = ${paid}::date,
      subscription_starts_at = ${termStart}::date,
      subscription_ends_at = ${termEnd}::date,
      internal_notes = ${notes},
      updated_at = now()
    where prospect_id = ${prospectId}::uuid
  `

  // One history entry per milestone recorded or changed, with its reference.
  const changes: { event: string; was: string | null; now: string | null; detail: string }[] = [
    {
      event: "agreement_sent",
      was: day(before.agreement_sent_at),
      now: sent,
      detail: `Agreement sent on ${sent}${docusign ? ` (agreement reference ${docusign})` : ""}`,
    },
    { event: "agreement_signed", was: day(before.agreement_signed_at), now: signed, detail: `Agreement signed on ${signed}` },
    {
      event: "invoice_issued",
      was: day(before.invoice_sent_at),
      now: invoice,
      detail: `Invoice issued on ${invoice}${invoiceRef ? ` (reference ${invoiceRef})` : ""}`,
    },
    {
      event: "payment_confirmed",
      was: day(before.payment_confirmed_at),
      now: paid,
      detail: `Payment confirmed on ${paid}${paymentRef ? ` (reference ${paymentRef})` : ""}`,
    },
    {
      event: "term_recorded",
      was: `${day(before.subscription_starts_at)}|${day(before.subscription_ends_at)}`,
      now: termStart && termEnd ? `${termStart}|${termEnd}` : null,
      detail: `Subscription term ${termStart} to ${termEnd}`,
    },
  ]
  for (const change of changes) {
    if (change.now && change.now !== change.was) {
      await sql`
        insert into review_prospect_events (prospect_id, event_type, from_status, to_status, detail, actor_admin_id)
        values (${prospectId}::uuid, ${change.event}, ${String(before.status)}, ${next}, ${change.detail}, ${admin.id}::uuid)
      `
    }
  }
  if (next !== before.status) {
    await sql`update review_prospects set status = ${next}, updated_at = now() where id = ${prospectId}::uuid`
  }
  revalidatePath(`/admin/review-requests/${prospectId}`)
  revalidatePath("/admin/review-requests")
  return { ok: true, message: `Milestones saved. Status: ${next}.` }
}

/**
 * Activate an Individual or Professional subscription request.
 *
 * Refused unless the agreement is signed AND payment confirmed (with the other
 * checks in activationGate). Then each named person gets their own subscriber
 * record -- linked to this request, at the plan's tier -- and is activated
 * through the same path as the Subscribers page: status, Data Room library
 * with Papermark-confirmed personal links, and only then their own welcome
 * email with its sign-in link.
 *
 * Safe to repeat. People this request already created are recognised, not
 * duplicated; anyone already welcomed is not emailed again; an existing
 * subscriber who did not come from this request is never changed. The request
 * is marked activated only when every named person's access is ready.
 */
export async function activateSubscriptionRequest(prospectId: string, _state: FormState): Promise<FormState> {
  const admin = await requireOwner()
  if (!UUID.test(prospectId)) return { message: "Unknown request." }
  const sql = getSql()
  if (!(await subscriptionActivationReady(sql, { fresh: true }))) {
    return { message: SUBSCRIPTION_MIGRATION_PENDING }
  }

  const rows = (await sql`
    select r.*, p.status, (p.verified_at is not null) as prospect_verified
    from review_subscription_requests r
    join review_prospects p on p.id = r.prospect_id
    where r.prospect_id = ${prospectId}::uuid
  `) as Record<string, unknown>[]
  const r = rows[0]
  if (!r) return { message: "No subscription request is recorded for this prospect." }

  const gate = activationGate(
    {
      plan: String(r.plan ?? ""),
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
  if (!gate.ok) {
    return { message: `Activation is blocked. Still needed: ${gate.missing.join("; ")}. Nothing was changed.` }
  }

  const requestId = String(r.id)
  const status = String(r.status ?? "")
  const tier = PLANS[gate.plan].tier
  const level = levelForPublicTier(tier)
  if (!level) return { message: `The ${tier} tier is not configured. Nothing was changed.` }
  const termStart = day(r.subscription_starts_at)
  const termEnd = day(r.subscription_ends_at)
  const organisation = String(r.legal_billing_name ?? "")
  const invoiceRef = String(r.invoice_reference ?? "")

  const outcomes: SeatOutcome[] = []
  for (const user of gate.users) {
    const found = (await sql`
      select id, status, client_type, subscription_request_id
      from subscribers where lower(email) = ${user.email}
      limit 1
    `) as { id: string; status: string; client_type: string; subscription_request_id: string | null }[]
    const existing = found[0]
    let subscriberId: string | null = null

    if (!existing) {
      const created = (await sql`
        insert into subscribers (
          full_name, name, email, organization, client_type, public_tier, subscription_level,
          level, seats, term_start, term_end, status, invoice_ref, subscription_request_id, note
        ) values (
          ${user.name}, ${user.name}, ${user.email}, ${organisation}, 'subscriber',
          ${tier}, ${tier}, ${level}, 1, ${termStart}::date, ${termEnd}::date,
          'pending', ${invoiceRef}, ${requestId}::uuid, ${`${PLANS[gate.plan].label} subscription request`}
        )
        on conflict ((lower(email))) do nothing
        returning id
      `) as { id: string }[]
      subscriberId = created[0]?.id ?? null
      if (!subscriberId) {
        outcomes.push({ ...user, state: "blocked", reason: "a record for this email appeared while activating; activate again." })
        continue
      }
    } else if (existing.subscription_request_id === requestId) {
      subscriberId = existing.id
      // Re-assert what the request pays for on a record not yet active, in
      // case it was edited while it waited.
      await sql`
        update subscribers set
          public_tier = ${tier}, subscription_level = ${tier}, level = ${level}, seats = 1,
          term_start = ${termStart}::date, term_end = ${termEnd}::date, updated_at = now()
        where id = ${existing.id}::uuid and subscription_request_id = ${requestId}::uuid
          and lower(status) <> 'active'
      `
    } else if (existing.subscription_request_id) {
      outcomes.push({
        ...user,
        state: "blocked",
        reason: "this email belongs to a subscriber from another subscription request, who was not changed.",
      })
      continue
    } else if (existing.status.toLowerCase() === "active") {
      outcomes.push({
        ...user,
        state: "blocked",
        reason: "this email already belongs to an active subscriber, who was not changed. Resolve it on their Subscribers page.",
      })
      continue
    } else if (existing.client_type !== "subscriber") {
      outcomes.push({ ...user, state: "blocked", reason: "this email belongs to an engagement client record, which was not changed." })
      continue
    } else {
      // An inactive record not linked to any request -- for example one
      // prepared before this workflow -- is taken on for this request.
      const adopted = (await sql`
        update subscribers set
          full_name = ${user.name}, name = ${user.name}, organization = ${organisation},
          public_tier = ${tier}, subscription_level = ${tier}, level = ${level}, seats = 1,
          term_start = ${termStart}::date, term_end = ${termEnd}::date,
          invoice_ref = ${invoiceRef}, subscription_request_id = ${requestId}::uuid,
          updated_at = now()
        where id = ${existing.id}::uuid and subscription_request_id is null and lower(status) <> 'active'
        returning id
      `) as { id: string }[]
      subscriberId = adopted[0]?.id ?? null
      if (!subscriberId) {
        outcomes.push({ ...user, state: "blocked", reason: "the existing record for this email changed while activating; activate again." })
        continue
      }
    }

    await sql`
      insert into subscriber_subscription_periods(subscriber_id, starts_on, ends_on, level, source)
      values (${subscriberId}::uuid, ${termStart}::date, ${termEnd}::date, ${level}, 'subscription-request')
      on conflict do nothing
    `
    await sql`
      insert into subscriber_access_reconciliations(subscriber_id, generation, state, requested_at)
      values (${subscriberId}::uuid, 1, 'pending', now())
      on conflict (subscriber_id) do update set generation = subscriber_access_reconciliations.generation + 1,
        state = 'pending', requested_at = now(), completed_at = null
    `

    // Each named subscriber's two onboarding emails are tracked on their own
    // record, so running this again resumes only what is still owed. Someone
    // this request activated under the previous flow without a welcome (it
    // was held) is still owed their onboarding; someone it welcomed is not.
    const welcomedBefore = (await sql`
      select 1 from review_prospect_events
      where prospect_id = ${prospectId}::uuid and event_type = 'subscriber_welcomed' and detail = ${subscriberId}
      limit 1
    `) as unknown[]
    const result = await activateSubscriberRecord({ subscriberId, admin, onboardingOwed: welcomedBefore.length === 0 })
    if (result.state === "activated" && activationDone(result)) {
      const fresh =
        result.onboarding.state === "ran" &&
        [result.onboarding.report.welcome, result.onboarding.report.secureAccess].some(
          (s) => s.step === "accepted" && s.when === "now",
        )
      outcomes.push({ ...user, state: "activated", emails: fresh ? "now" : "earlier" })
    } else if (result.state === "activated") {
      outcomes.push({ ...user, state: "emails_pending", reason: result.onboarding.message })
    } else if (result.state === "access_not_ready") {
      outcomes.push({ ...user, state: "held", reason: result.message })
    } else {
      outcomes.push({ ...user, state: "blocked", reason: result.message })
    }
  }

  const complete = activationComplete(outcomes, gate.users.length)
  const summary = describeActivation(outcomes, gate.users.length)
  const next = complete ? laterStatus(status, "Access Activated") : status
  if (complete) {
    await sql`
      update review_subscription_requests
      set activated_at = coalesce(activated_at, now()),
          papermark_access_prepared_at = coalesce(papermark_access_prepared_at, now()),
          updated_at = now()
      where id = ${requestId}::uuid
    `
    if (next !== status) {
      await sql`update review_prospects set status = ${next}, updated_at = now() where id = ${prospectId}::uuid`
    }
  }
  // Names and outcomes only: never a link, token or document address.
  await sql`
    insert into review_prospect_events (prospect_id, event_type, from_status, to_status, detail, actor_admin_id)
    values (
      ${prospectId}::uuid, ${complete ? "access_activated" : "activation_incomplete"}, ${status}, ${next},
      ${summary.slice(0, 1800)}, ${admin.id}::uuid
    )
  `
  revalidatePath(`/admin/review-requests/${prospectId}`)
  revalidatePath("/admin/review-requests")
  revalidatePath("/admin/subscribers")
  return { ok: complete, message: summary }
}

// ---------------------------------------------------------------------------
// The order editions appear in on the Publications page
// ---------------------------------------------------------------------------

/**
 * Moves one published review edition up or down within its series on the
 * Publications page (and in the review library). The whole series is given
 * explicit positions in the order shown, so the result is exactly what the
 * owner sees in Admin.
 */
export async function moveReviewEdition(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireOwner()
  const id = String(formData.get("editionId") ?? "")
  const direction = String(formData.get("direction") ?? "")
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return { message: "Unknown edition." }
  if (direction !== "up" && direction !== "down") return { message: "Unknown direction." }
  const sql = getSql()
  const ready = (await sql`
    select exists (select 1 from information_schema.columns
                   where table_name = 'review_publication_editions' and column_name = 'display_position') as ready
  `) as { ready: boolean }[]
  if (!ready[0]?.ready) return { message: "Ordering is available once db/migrations/20261006_review_edition_display_order.sql is applied." }
  const target = (await sql`select series from review_publication_editions where id = ${id}::uuid and publication_state = 'published'`) as { series: string | null }[]
  if (!target[0]) return { message: "Only a published edition can be ordered." }
  const series = target[0].series
  const rows = (await sql`
    select e.id from review_publication_editions e
    where e.publication_state = 'published' and e.series is not distinct from ${series}
    -- The same order readers see (src/lib/publications.ts), so a move is exactly what is shown.
    order by e.display_position asc nulls last, e.is_latest desc, e.edition_sort_key desc,
             e.edition_date desc nulls last, e.edition_order desc, e.created_at desc, e.id desc
  `) as { id: string }[]
  const { moveInOrder } = await import("@/lib/review-order")
  const order = moveInOrder(rows.map((r) => r.id), id, direction)
  for (let i = 0; i < order.length; i++) {
    await sql`update review_publication_editions set display_position = ${i + 1} where id = ${order[i]}::uuid`
  }
  revalidatePath("/admin/review-library")
  revalidatePath("/publications")
  revalidatePath("/review")
  return { ok: true, message: "Order saved. The Publications page shows it now." }
}
