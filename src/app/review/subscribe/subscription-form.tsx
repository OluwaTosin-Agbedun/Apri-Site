"use client"
import { useActionState, useEffect, useState } from "react"
import {
  submitPublicSubscriptionRequest,
  submitSubscriptionRequest,
  type ReviewFormState,
} from "@/app/actions/review-funnel"
import { PLANS, type PlanKey } from "@/lib/subscription-journey"

const USER_TYPES = ["Individual professional", "Small professional team", "Corporate or institutional"]
const SOURCES = ["WhatsApp", "Google", "Facebook", "X", "LinkedIn", "Referral", "Other"]

type Props =
  | { mode: "review"; prospectId: string; plan: PlanKey }
  | { mode: "public"; plan: PlanKey; utm: Record<string, string> }

/**
 * One form for both routes into a subscription request. From the Review
 * Library the prospect is already known (and confirmed) through their session;
 * from Subscription Access the visitor also gives their own contact details.
 * Either way no card details are collected: payment is arranged offline.
 */
export default function SubscriptionForm(props: Props) {
  const { plan } = props
  const action =
    props.mode === "review"
      ? submitSubscriptionRequest.bind(null, props.prospectId)
      : submitPublicSubscriptionRequest
  const [state, formAction, pending] = useActionState<ReviewFormState, FormData>(action, {})
  const [referrerHost, setReferrerHost] = useState("")
  useEffect(() => {
    try {
      setReferrerHost(document.referrer ? new URL(document.referrer).hostname : "")
    } catch {}
  }, [])
  const input = "mt-2 w-full border border-border bg-background px-4 py-3"
  const details = PLANS[plan]
  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="plan" value={plan} />
      <p className="border border-border bg-card/40 p-4">
        <strong>{details.label}</strong> — {details.price}; {details.users.charAt(0).toLowerCase() + details.users.slice(1)}.
      </p>

      {props.mode === "public" && (
        <fieldset className="space-y-5">
          <legend className="font-serif text-xl mb-4">Your details</legend>
          <input name="website" className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" />
          <input type="hidden" name="referrerHost" value={referrerHost} />
          {Object.entries(props.utm).map(([k, v]) => (
            <input key={k} type="hidden" name={`utm_${k}`} value={v} />
          ))}
          <label className="block">
            Full name
            <input className={input} name="fullName" required maxLength={120} autoComplete="name" />
          </label>
          <label className="block">
            Email address
            <input className={input} name="email" required type="email" maxLength={254} autoComplete="email" />
          </label>
          <label className="block">
            Organisation <span className="text-muted-foreground">— optional</span>
            <input className={input} name="organisation" maxLength={160} autoComplete="organization" />
          </label>
          <label className="block">
            Role or profession
            <input className={input} name="role" required maxLength={160} />
          </label>
          <div className="grid sm:grid-cols-2 gap-5">
            <label>
              Which best describes you?
              <select className={input} name="userType" required defaultValue="">
                <option value="" disabled>
                  Select one
                </option>
                {USER_TYPES.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              How did you hear about APRI?
              <select className={input} name="source" required defaultValue="">
                <option value="" disabled>
                  Select one
                </option>
                {SOURCES.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
          </div>
        </fieldset>
      )}

      <fieldset className="space-y-5">
        <legend className="font-serif text-xl mb-4">Contracting and billing</legend>
        <label className="block">
          Phone number
          <input className={input} name="phone" required maxLength={40} autoComplete="tel" />
        </label>
        <label className="block">
          Organisation/legal billing name
          <input className={input} name="legalName" required maxLength={180} />
        </label>
        <label className="block">
          Billing email
          <input className={input} name="billingEmail" required type="email" maxLength={254} />
        </label>
        <label className="block">
          Billing address
          <textarea className={input} name="billingAddress" required maxLength={400} />
        </label>
        <div className="grid sm:grid-cols-2 gap-5">
          <label>
            City/state
            <input className={input} name="cityState" required maxLength={120} />
          </label>
          <label>
            Country
            <input className={input} name="country" required maxLength={100} />
          </label>
        </div>
        <label className="block">
          Tax/VAT/reference information <span className="text-muted-foreground">— optional</span>
          <input className={input} name="taxReference" maxLength={120} />
        </label>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="font-serif text-xl mb-2">Authorised subscribers</legend>
        <p className="text-sm text-muted-foreground mb-2">
          {plan === "Individual"
            ? "The one person who will hold this subscription. They receive their own secure sign-in."
            : "Up to three named people. Each receives their own secure sign-in; access cannot be shared."}
        </p>
        {Array.from({ length: details.maxUsers }, (_, i) => (
          <div className="grid sm:grid-cols-2 gap-4" key={i}>
            <label>
              Name {i + 1}
              <input className={input} name={`userName${i}`} required={i === 0} maxLength={120} />
            </label>
            <label>
              Email {i + 1}
              <input className={input} type="email" name={`userEmail${i}`} required={i === 0} maxLength={254} />
            </label>
          </div>
        ))}
      </fieldset>

      <label className="flex gap-3 text-sm">
        <input type="checkbox" name="terms" required />
        <span>
          I accept the{" "}
          <a className="underline" href="/terms">
            terms
          </a>{" "}
          and{" "}
          <a className="underline" href="/privacy">
            privacy notice
          </a>
          .
        </span>
      </label>
      <p className="text-sm text-muted-foreground">
        No card details are collected. APRI will issue the agreement and payment details separately.
      </p>
      {state.message && (
        <p className="text-red-700" role="alert">
          {state.message}
        </p>
      )}
      <button className="btn-primary" disabled={pending}>
        {pending ? "Submitting…" : `Request ${details.label}`}
      </button>
    </form>
  )
}
