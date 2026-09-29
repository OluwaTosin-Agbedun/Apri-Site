import { notFound } from "next/navigation"
import AdminShell from "@/components/AdminShell"
import { requireOwner } from "@/lib/dal"
import { getSql } from "@/lib/db"
import { retryReviewNotification } from "@/app/actions/review-admin"
import { PLANS, activationGate, parsePlan } from "@/lib/subscription-journey"
import { requesterConfirmed, subscriptionActivationReady, onboardingTrackingReady } from "@/lib/subscription-schema"
import { getOnboardingStatus, onboardingStatusLabel } from "@/lib/subscriber-onboarding"
import SubscriptionProcessing, { type ProcessingRequest } from "./subscription-processing"
import { recipientListHash } from "@/lib/edition-recipients"
import {
  loadActiveRecipientsByEdition,
  readSharedRecipients,
} from "@/lib/edition-recipients-dal"
import { editionRecipientsReady } from "@/lib/edition-recipients-schema"
import { ProspectAccess, type ProspectEditionRow } from "./prospect-access"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fmt = (v: string | null) =>
  v
    ? new Date(v).toLocaleString("en-NG", {
        timeZone: "Africa/Lagos",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Unavailable"
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const admin = await requireOwner(),
    { id } = await params,
    sql = getSql()
  if (!UUID.test(id)) notFound()
  const prospects =
    (await sql`select * from review_prospects where id=${id}::uuid`) as Record<string, string | null>[]
  const p = prospects[0]
  if (!p) notFound()

  // This prospect's standing on every published edition, computed server-side.
  // "Live" means granted and Papermark last verified to match the edition's
  // current list -- never assumed from the grant alone. Before the per-edition
  // migration has run there is nothing to compute, and the section says so.
  const prospectEmail = (p.email ?? "").trim().toLowerCase()
  const perEdition = await editionRecipientsReady(sql, { fresh: true })
  let editionRows: ProspectEditionRow[] = []
  if (perEdition) {
    const publishedEditions = (await sql`
      select e.id, e.series, e.title, e.edition_label, e.recipient_mode, e.recipients_verified_hash,
             e.secure_link_id
      from review_publication_editions e
      where e.publication_state = 'published'
      order by case e.series when 'MIN' then 1 when 'AIU' then 2 when 'PLM' then 3 else 4 end,
               e.is_latest desc, e.edition_sort_key desc, e.created_at desc, e.id desc
    `) as Array<{
      id: string
      series: string | null
      title: string
      edition_label: string
      recipient_mode: string
      recipients_verified_hash: string | null
      secure_link_id: string | null
    }>
    const recipientsByEdition = await loadActiveRecipientsByEdition(sql)
    // Owner-only: whether this one address is on the shared list, for the
    // editions still judged by it. The list itself is not passed on.
    const onSharedList = (await readSharedRecipients(sql)).includes(prospectEmail)
    editionRows = publishedEditions.map((e) => {
      const recipients = recipientsByEdition.get(e.id) ?? []
      const legacy = e.recipient_mode === "shared_legacy"
      const granted = !legacy && recipients.includes(prospectEmail)
      return {
        id: e.id,
        name: [e.series, e.edition_label || e.title].filter(Boolean).join(" · "),
        mode: legacy ? "shared_legacy" : "edition",
        granted,
        live: granted && e.recipients_verified_hash === recipientListHash(recipients),
        hasLink: Boolean(e.secure_link_id),
        viaSharedList: legacy && onSharedList,
      }
    })
  }
  const events =
    (await sql`select * from review_prospect_events where prospect_id=${id}::uuid order by created_at desc`) as Record<string, string | null>[]
  const requests =
    (await sql`select * from review_subscription_requests where prospect_id=${id}::uuid`) as Record<string, unknown>[]
  const r = requests[0]
  const processing = r ? await processingFor(sql, p, r) : null
  return (
    <AdminShell
      admin={admin}
      current="/admin/review-requests"
      title={p.full_name!}
      description={`${p.email} · ${p.status}`}
    >
      <div className="grid lg:grid-cols-[1fr_.9fr] gap-6">
        <div className="space-y-6">
          <section className="border border-border p-6">
            <h3 className="font-serif text-xl mb-4">Prospect</h3>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <dt>Organisation</dt>
              <dd>{p.organisation || "Unavailable"}</dd>
              <dt>Role</dt>
              <dd>{p.role_profession}</dd>
              <dt>User type</dt>
              <dd>{p.user_type}</dd>
              <dt>Source</dt>
              <dd>{p.attributed_source}</dd>
              <dt>Requested</dt>
              <dd>{fmt(p.requested_at)}</dd>
              <dt>Verified</dt>
              <dd>{fmt(p.verified_at)}</dd>
              <dt>Access sent</dt>
              <dd>{fmt(p.access_sent_at)}</dd>
              <dt>First touch UTM</dt>
              <dd>
                {[
                  p.first_utm_source,
                  p.first_utm_medium,
                  p.first_utm_campaign,
                  p.first_utm_term,
                  p.first_utm_content,
                ]
                  .filter(Boolean)
                  .join(" / ") || "Unavailable"}
              </dd>
              <dt>Latest touch UTM</dt>
              <dd>
                {[
                  p.latest_utm_source,
                  p.latest_utm_medium,
                  p.latest_utm_campaign,
                  p.latest_utm_term,
                  p.latest_utm_content,
                ]
                  .filter(Boolean)
                  .join(" / ") || "Unavailable"}
              </dd>
            </dl>
            {!p.manager_notified_at && (
              <form action={retryReviewNotification} className="mt-5">
                <input type="hidden" name="id" value={id} />
                <p className="text-amber-700 mb-2">Notification pending</p>
                <button className="btn-secondary">
                  Retry manager notification
                </button>
              </form>
            )}
          </section>
          {p.verified_at && perEdition && (
            <ProspectAccess
              prospectId={id}
              prospectName={p.full_name ?? "this prospect"}
              prospectEmail={prospectEmail}
              editions={editionRows}
            />
          )}
          {p.verified_at && !perEdition && (
            <section className="border border-amber-300 bg-amber-50 p-6 text-sm leading-relaxed">
              <h3 className="font-serif text-xl mb-2">Review access by edition</h3>
              <p>
                Granting and sending review access needs the per-edition access database migration
                (<code>db/migrations/20260928_review_edition_recipients.sql</code>) to be run first.
                Nothing can be granted or sent until then; this section switches over by itself once
                it has run.
              </p>
            </section>
          )}
          {processing && <SubscriptionProcessing request={processing} />}
        </div>
        <aside>
          <section className="border border-border p-6">
            <h3 className="font-serif text-xl mb-4">Activity history</h3>
            <ol className="space-y-4">
              {events.map((e) => (
                <li
                  key={e.id}
                  className="border-l-2 border-accent pl-4 text-sm"
                >
                  <strong>{e.to_status || e.event_type}</strong>
                  <p className="text-muted-foreground">{e.detail}</p>
                  <time>{fmt(e.created_at)}</time>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </AdminShell>
  )
}

const day = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : ""

/**
 * Everything the processing screen shows, computed here on the server: the
 * gate is the same function the activation action enforces.
 */
async function processingFor(
  sql: ReturnType<typeof getSql>,
  p: Record<string, string | null>,
  r: Record<string, unknown>,
): Promise<ProcessingRequest> {
  const plan = parsePlan(r.plan) ?? "Individual"
  const migrationReady = await subscriptionActivationReady(sql, { fresh: true })
  const confirmed = requesterConfirmed({ ...r, prospect_verified: Boolean(p.verified_at) })
  const people = (Array.isArray(r.authorised_users) ? r.authorised_users : []) as { name: string; email: string }[]
  const emails = people.map((u) => String(u.email).toLowerCase())
  const records = emails.length
    ? ((migrationReady
        ? await sql`select id, lower(email) as email, lower(status) as status, subscription_request_id from subscribers where lower(email) = any(${emails}::text[])`
        : await sql`select id, lower(email) as email, lower(status) as status, null::uuid as subscription_request_id from subscribers where lower(email) = any(${emails}::text[])`) as {
        id: string
        email: string
        status: string
        subscription_request_id: string | null
      }[])
    : []
  const onboardingReady = await onboardingTrackingReady(sql, { fresh: true })
  // Each named person's own two onboarding emails, from their own record only.
  const onboarding = new Map<string, string[]>()
  for (const rec of records) {
    if (rec.subscription_request_id !== r.id) continue
    onboarding.set(rec.id, (await getOnboardingStatus(rec.id)).map(onboardingStatusLabel))
  }
  const gate = activationGate(
    {
      plan: String(r.plan ?? ""),
      requesterConfirmed: confirmed,
      agreementSentAt: day(r.agreement_sent_at) || null,
      agreementSignedAt: day(r.agreement_signed_at) || null,
      invoiceSentAt: day(r.invoice_sent_at) || null,
      paymentConfirmedAt: day(r.payment_confirmed_at) || null,
      termStart: day(r.subscription_starts_at) || null,
      termEnd: day(r.subscription_ends_at) || null,
      authorisedUsers: r.authorised_users,
    },
    new Date().toISOString().slice(0, 10),
  )
  const utm = (prefix: "first" | "latest") =>
    [p[`${prefix}_utm_source`], p[`${prefix}_utm_medium`], p[`${prefix}_utm_campaign`], p[`${prefix}_utm_term`], p[`${prefix}_utm_content`]]
      .filter(Boolean)
      .join(" / ") || "None"
  return {
    prospectId: String(p.id),
    planLabel: PLANS[plan].label,
    price: PLANS[plan].price,
    agreementType: String(r.agreement_type ?? PLANS[plan].agreement),
    submittedVia: r.submitted_via === "access_page" ? "access_page" : "review_library",
    requesterConfirmed: confirmed,
    requester: { name: String(r.requester_name ?? ""), email: String(r.requester_email ?? ""), phone: String(r.phone ?? "") },
    billing: {
      legalName: String(r.legal_billing_name ?? ""),
      email: String(r.billing_email ?? ""),
      address: String(r.billing_address ?? ""),
      cityState: String(r.city_state ?? ""),
      country: String(r.country ?? ""),
      tax: r.tax_reference ? String(r.tax_reference) : null,
    },
    attribution: {
      declared: String(p.self_reported_source ?? "Unknown"),
      attributed: String(p.attributed_source ?? "Unknown"),
      firstUtm: utm("first"),
      latestUtm: utm("latest"),
    },
    milestones: {
      docusignReference: String(r.docusign_reference ?? ""),
      agreementSent: day(r.agreement_sent_at),
      agreementSigned: day(r.agreement_signed_at),
      invoiceReference: String(r.invoice_reference ?? ""),
      invoiceSent: day(r.invoice_sent_at),
      paymentReference: String(r.payment_reference ?? ""),
      paymentConfirmed: day(r.payment_confirmed_at),
      termStart: day(r.subscription_starts_at),
      termEnd: day(r.subscription_ends_at),
      notes: String(r.internal_notes ?? ""),
    },
    gate: gate.ok ? { ok: true, missing: [] } : { ok: false, missing: gate.missing },
    migrationReady,
    onboardingReady,
    activatedAt: r.activated_at ? day(r.activated_at) : null,
    people: people.map((u) => {
      const rec = records.find((x) => x.email === String(u.email).toLowerCase())
      return {
        name: String(u.name),
        email: String(u.email),
        record: !rec
          ? ("none" as const)
          : rec.subscription_request_id === r.id
            ? ("this_request" as const)
            : rec.subscription_request_id
              ? ("other_request" as const)
              : ("unlinked" as const),
        status: rec?.status ?? null,
        subscriberId: rec && rec.subscription_request_id === r.id ? rec.id : null,
        onboarding: rec ? (onboarding.get(rec.id) ?? []) : [],
      }
    }),
  }
}
