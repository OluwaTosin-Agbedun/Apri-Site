import { notFound } from "next/navigation"
import AdminShell from "@/components/AdminShell"
import { requireOwner } from "@/lib/dal"
import { getSql } from "@/lib/db"
import {
  activateReviewSubscription,
  retryReviewNotification,
  saveCommercialMilestones,
} from "@/app/actions/review-admin"
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
          {r && (
            <section className="border border-border p-6">
              <h3 className="font-serif text-xl mb-4">
                Agreement, invoice and payment
              </h3>
              <p className="text-sm mb-4">
                {String(r.agreement_type)} · {String(r.plan)} Access
              </p>
              <form
                action={saveCommercialMilestones}
                className="grid sm:grid-cols-2 gap-4 text-sm"
              >
                <input type="hidden" name="id" value={id} />
                {[
                  ["docusignReference", "DocuSign envelope/reference", "text"],
                  ["agreementSent", "Agreement sent date", "date"],
                  ["agreementSigned", "Agreement signed date", "date"],
                  ["invoiceReference", "Invoice reference", "text"],
                  ["invoiceSent", "Invoice sent date", "date"],
                  ["paymentReference", "Payment reference", "text"],
                  ["paymentConfirmed", "Payment confirmed date", "date"],
                  ["termStart", "Subscription starts", "date"],
                  ["termEnd", "Subscription ends", "date"],
                ].map(([n, l, t]) => (
                  <label key={n}>
                    {l}
                    <input
                      className="mt-1 w-full border border-border p-2"
                      name={n}
                      type={t}
                      defaultValue={String(
                        r[n.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)] ||
                          "",
                      ).slice(0, 10)}
                    />
                  </label>
                ))}
                <label className="sm:col-span-2 flex gap-2">
                  <input
                    type="checkbox"
                    name="papermarkPrepared"
                    defaultChecked={Boolean(r.papermark_access_prepared_at)}
                  />
                  Every named user has secure Papermark subscriber access
                  prepared
                </label>
                <label className="sm:col-span-2">
                  Internal notes
                  <textarea
                    name="notes"
                    maxLength={2000}
                    defaultValue={String(r.internal_notes || "")}
                    className="mt-1 w-full border border-border p-2"
                  />
                </label>
                <button className="btn-secondary">Save milestones</button>
              </form>
              <form action={activateReviewSubscription} className="mt-4">
                <input type="hidden" name="id" value={id} />
                <button className="btn-primary">
                  Prepare named subscriber activation
                </button>
              </form>
            </section>
          )}
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
