"use client"
import { useActionState } from "react"
import {
  submitSubscriptionRequest,
  type ReviewFormState,
} from "@/app/actions/review-funnel"
export default function SubscriptionForm({
  prospectId,
  plan,
}: {
  prospectId: string
  plan: "Individual" | "Professional"
}) {
  const action = submitSubscriptionRequest.bind(null, prospectId)
  const [state, formAction, pending] =
    useActionState<ReviewFormState, FormData>(action, {})
  const input = "mt-2 w-full border border-border bg-background px-4 py-3"
  const max = plan === "Individual" ? 1 : 3
  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="plan" value={plan} />
      <p className="border border-border bg-card/40 p-4">
        <strong>{plan} Access</strong> —{" "}
        {plan === "Individual"
          ? "₦2 million annually; one named authorised subscriber."
          : "₦5 million annually; up to three named authorised subscribers."}
      </p>
      <label className="block">
        Phone number
        <input
          className={input}
          name="phone"
          required
          maxLength={40}
          autoComplete="tel"
        />
      </label>
      <label className="block">
        Organisation/legal billing name
        <input className={input} name="legalName" required maxLength={180} />
      </label>
      <label className="block">
        Billing email
        <input
          className={input}
          name="billingEmail"
          required
          type="email"
          maxLength={254}
        />
      </label>
      <label className="block">
        Billing address
        <textarea
          className={input}
          name="billingAddress"
          required
          maxLength={400}
        />
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
        Tax/VAT/reference information{" "}
        <span className="text-muted-foreground">— optional</span>
        <input className={input} name="taxReference" maxLength={120} />
      </label>
      <fieldset className="space-y-4">
        <legend className="font-serif text-xl mb-4">
          Authorised subscribers
        </legend>
        {Array.from({ length: max }, (_, i) => (
          <div className="grid sm:grid-cols-2 gap-4" key={i}>
            <label>
              Name {i + 1}
              <input
                className={input}
                name={`userName${i}`}
                required={i === 0}
                maxLength={120}
              />
            </label>
            <label>
              Email {i + 1}
              <input
                className={input}
                type="email"
                name={`userEmail${i}`}
                required={i === 0}
                maxLength={254}
              />
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
        No card details are collected. APRI will issue the agreement and payment
        details separately.
      </p>
      {state.message && (
        <p className="text-red-700" role="alert">
          {state.message}
        </p>
      )}
      <button className="btn-primary" disabled={pending}>
        {pending ? "Submitting…" : `Request ${plan} Access`}
      </button>
    </form>
  )
}
