"use client"

import { useActionState } from "react"
import { activateSubscriptionRequest, saveCommercialMilestones } from "@/app/actions/review-admin"
import type { FormState } from "@/lib/definitions"

export type ProcessingRequest = {
  prospectId: string
  planLabel: string
  price: string
  agreementType: string
  submittedVia: "review_library" | "access_page"
  requesterConfirmed: boolean
  requester: { name: string; email: string; phone: string }
  billing: { legalName: string; email: string; address: string; cityState: string; country: string; tax: string | null }
  attribution: { declared: string; attributed: string; firstUtm: string; latestUtm: string }
  milestones: {
    docusignReference: string
    agreementSent: string
    agreementSigned: string
    invoiceReference: string
    invoiceSent: string
    paymentReference: string
    paymentConfirmed: string
    termStart: string
    termEnd: string
    notes: string
  }
  gate: { ok: boolean; missing: string[] }
  migrationReady: boolean
  onboardingReady: boolean
  activatedAt: string | null
  people: {
    name: string
    email: string
    record: "none" | "this_request" | "other_request" | "unlinked"
    status: string | null
    subscriberId: string | null
    /** One line per onboarding email (welcome, secure access). Empty until activation starts them. */
    onboarding: string[]
  }[]
}

const input = "mt-1 w-full border border-border p-2"

/**
 * Following one Individual or Professional request from agreement to access.
 *
 * Every rule is enforced by the server actions; this screen only shows where
 * the request stands and what is still needed, and reports what the actions
 * did in words an owner can act on.
 */
export default function SubscriptionProcessing({ request: r }: { request: ProcessingRequest }) {
  const [saved, save, saving] = useActionState<FormState, FormData>(
    saveCommercialMilestones.bind(null, r.prospectId),
    undefined,
  )
  const [activated, activate, activating] = useActionState<FormState, FormData>(
    activateSubscriptionRequest.bind(null, r.prospectId),
    undefined,
  )

  const m = r.milestones
  const checklist: [string, boolean][] = [
    ["Requester's email confirmed", r.requesterConfirmed],
    ["Agreement sent", Boolean(m.agreementSent)],
    ["Agreement signed", Boolean(m.agreementSigned)],
    ["Invoice issued", Boolean(m.invoiceSent)],
    ["Payment confirmed", Boolean(m.paymentConfirmed)],
    ["Subscription term recorded", Boolean(m.termStart && m.termEnd)],
  ]

  return (
    <section className="border border-border p-6 space-y-6">
      <div>
        <h3 className="font-serif text-xl">
          {r.planLabel} — {r.price}
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          {r.agreementType} · requested from{" "}
          {r.submittedVia === "access_page" ? "the Subscription Access page" : "the Review Library"}
          {r.activatedAt ? ` · access activated ${r.activatedAt}` : ""}
        </p>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Requester</dt>
        <dd>
          {r.requester.name} · {r.requester.email} · {r.requester.phone}
        </dd>
        <dt className="text-muted-foreground">Billing</dt>
        <dd>
          {r.billing.legalName}, {r.billing.email}
          <br />
          {r.billing.address}, {r.billing.cityState}, {r.billing.country}
          {r.billing.tax ? ` · Tax/VAT ${r.billing.tax}` : ""}
        </dd>
        <dt className="text-muted-foreground">Lead source</dt>
        <dd>
          Declared {r.attribution.declared} · attributed {r.attribution.attributed}
        </dd>
        <dt className="text-muted-foreground">UTM (first / latest)</dt>
        <dd>
          {r.attribution.firstUtm} / {r.attribution.latestUtm}
        </dd>
      </dl>

      <div>
        <h4 className="text-xs font-medium uppercase tracking-wider text-accent mb-3">Before activation</h4>
        <ul className="grid sm:grid-cols-2 gap-2 text-sm" aria-label="Activation checklist">
          {checklist.map(([label, done]) => (
            <li key={label} className={done ? "text-foreground" : "text-amber-800"}>
              <span aria-hidden>{done ? "✓" : "○"}</span> {label}
              <span className="sr-only">{done ? " (done)" : " (still needed)"}</span>
            </li>
          ))}
        </ul>
        {!r.requesterConfirmed && r.submittedVia === "access_page" && (
          <p className="mt-2 text-xs text-muted-foreground">
            This request came from the public page, so it counts only once the requester opens the confirmation link
            emailed to them.
          </p>
        )}
      </div>

      <form action={save} className="grid sm:grid-cols-2 gap-4 text-sm">
        <h4 className="sm:col-span-2 text-xs font-medium uppercase tracking-wider text-accent">
          Agreement, invoice and payment
        </h4>
        <label>
          Agreement reference (DocuSign envelope or manual)
          <input className={input} name="docusignReference" defaultValue={m.docusignReference} maxLength={120} />
        </label>
        <label>
          Agreement sent
          <input className={input} name="agreementSent" type="date" defaultValue={m.agreementSent} />
        </label>
        <label>
          Agreement signed
          <input className={input} name="agreementSigned" type="date" defaultValue={m.agreementSigned} />
        </label>
        <label>
          Invoice reference
          <input className={input} name="invoiceReference" defaultValue={m.invoiceReference} maxLength={120} />
        </label>
        <label>
          Invoice issued
          <input className={input} name="invoiceSent" type="date" defaultValue={m.invoiceSent} />
        </label>
        <label>
          Payment reference
          <input className={input} name="paymentReference" defaultValue={m.paymentReference} maxLength={120} />
        </label>
        <label>
          Payment confirmed
          <input className={input} name="paymentConfirmed" type="date" defaultValue={m.paymentConfirmed} />
        </label>
        <span className="hidden sm:block" />
        <label>
          Subscription starts
          <input className={input} name="termStart" type="date" defaultValue={m.termStart} />
        </label>
        <label>
          Subscription ends
          <input className={input} name="termEnd" type="date" defaultValue={m.termEnd} />
        </label>
        <label className="sm:col-span-2">
          Internal notes
          <textarea name="notes" maxLength={2000} defaultValue={m.notes} className={input} />
        </label>
        <p className="sm:col-span-2 text-xs text-muted-foreground">
          Recorded milestones are kept when a field is left blank. Recording a payment does not grant access.
        </p>
        <div className="sm:col-span-2 flex items-center gap-4">
          <button className="btn-secondary" disabled={saving}>
            {saving ? "Saving…" : "Save milestones"}
          </button>
          {saved?.message && (
            <p className={saved.ok ? "text-sm text-foreground/80" : "text-sm text-red-700"} role="status">
              {saved.message}
            </p>
          )}
        </div>
      </form>

      <div>
        <h4 className="text-xs font-medium uppercase tracking-wider text-accent mb-3">Named subscribers</h4>
        <table className="w-full text-left text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 font-normal">Name</th>
              <th className="py-1 font-normal">Subscriber record</th>
              <th className="py-1 font-normal">Onboarding emails</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {r.people.map((p) => (
              <tr key={p.email}>
                <td className="py-2 pr-3">
                  {p.name}
                  <br />
                  <span className="text-xs text-muted-foreground">{p.email}</span>
                </td>
                <td className="py-2 pr-3">
                  {p.record === "none" && "Not created yet"}
                  {p.record === "this_request" && (
                    <a className="text-accent hover:text-accent-hover" href={`/admin/subscribers/${p.subscriberId}`}>
                      {p.status === "active" ? "Active" : `Created (${p.status})`}
                    </a>
                  )}
                  {p.record === "other_request" && <span className="text-amber-800">Belongs to another request</span>}
                  {p.record === "unlinked" &&
                    (p.status === "active" ? (
                      <span className="text-amber-800">An existing active subscriber — not changed</span>
                    ) : (
                      "Existing inactive record — taken on at activation"
                    ))}
                </td>
                <td className="py-2 text-xs">
                  {p.onboarding.length === 0
                    ? "Not started"
                    : p.onboarding.map((line) => <div key={line}>{line}</div>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form action={activate} className="space-y-3">
        {!r.migrationReady && (
          <p className="text-sm text-amber-800">
            Activation needs the database migration db/migrations/20260930_subscription_activation.sql to be run first.
          </p>
        )}
        {r.migrationReady && !r.onboardingReady && (
          <p className="text-sm text-amber-800">
            Activation needs the database migration db/migrations/20261001_subscriber_onboarding_messages.sql to be run
            first, so the onboarding emails can be tracked.
          </p>
        )}
        {r.migrationReady && !r.gate.ok && (
          <p className="text-sm text-amber-800">Still needed before activation: {r.gate.missing.join("; ")}.</p>
        )}
        <button className="btn-primary" disabled={activating || !r.migrationReady || !r.onboardingReady || !r.gate.ok}>
          {activating ? "Activating…" : r.activatedAt ? "Check and complete activation" : "Activate subscription"}
        </button>
        <p className="text-xs text-muted-foreground">
          Each named person gets their own subscriber record, and their Data Room library and personal document links
          are verified before they are made active. Then each is sent a welcome email and, once the provider has
          accepted it, a separate secure-access email with their personal sign-in link. Running this again is safe: it
          resumes only what is still owed, an email already accepted is never sent twice, and existing subscribers are
          never changed.
        </p>
        {activated?.message && (
          <p className={activated.ok ? "text-sm text-foreground/80" : "text-sm text-red-700"} role="status">
            {activated.message}
          </p>
        )}
      </form>
    </section>
  )
}
