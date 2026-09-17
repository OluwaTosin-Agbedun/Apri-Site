import { notFound } from "next/navigation"
import AdminShell from "@/components/AdminShell"
import { requireOwner } from "@/lib/dal"
import { getSql } from "@/lib/db"
import {
  activateReviewSubscription,
  retryReviewNotification,
  saveCommercialMilestones,
} from "@/app/actions/review-admin"
import {
  approveProspectRecipient,
  sendSecureReviewAccessForm,
} from "@/app/actions/review-funnel"
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
  const prospects =
    (await sql`select * from review_prospects where id=${id}::uuid`) as Record<string, string | null>[]
  const p = prospects[0]
  if (!p) notFound()
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
          {p.verified_at && (
            <section className="border border-border p-6">
              <h3 className="font-serif text-xl mb-4">
                Manual Papermark approval
              </h3>
              <ol className="list-decimal pl-5 space-y-2 text-sm mb-5">
                <li>
                  Append the verified address without removing existing approved
                  recipients.
                </li>
                <li>
                  Preview and apply restrictions in Review Library
                  administration.
                </li>
                <li>Verify the address is on MIN, AIU and PLM.</li>
                <li>Verify every link still maps to its fixed document.</li>
                <li>
                  Verify email authentication, downloads disabled, and the
                  approved watermark.
                </li>
              </ol>
              <div className="flex gap-3 mb-5">
                <form action={approveProspectRecipient}>
                  <input type="hidden" name="id" value={id} />
                  <button className="btn-secondary">
                    Append Approved Recipient
                  </button>
                </form>
                <a className="btn-secondary" href="/admin/review-library">
                  Preview / Apply restrictions
                </a>
              </div>
              <form action={sendSecureReviewAccessForm} className="space-y-2">
                <input type="hidden" name="id" value={id} />
                {[
                  ["allowlist", "Approved email present on all three links"],
                  ["mapped", "All links map to their fixed documents"],
                  ["email_auth", "Verified-email authentication enabled"],
                  ["downloads", "Downloads disabled"],
                  [
                    "watermark",
                    "Approved watermark applied; IP not visible; opacity 0.15; size 18",
                  ],
                ].map(([v, l]) => (
                  <label className="flex gap-2 text-sm" key={v}>
                    <input type="checkbox" name="readiness" value={v} />
                    {l}
                  </label>
                ))}
                <button className="btn-primary mt-4">
                  Send secure review access
                </button>
              </form>
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
