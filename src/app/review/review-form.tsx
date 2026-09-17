"use client"
import { useActionState, useEffect, useState } from "react"
import {
  requestReview,
  type ReviewFormState,
} from "@/app/actions/review-funnel"

export default function ReviewForm({ utm }: { utm: Record<string, string> }) {
  const [state, action, pending] = useActionState<ReviewFormState, FormData>(
    requestReview,
    {},
  )
  const [referrerHost, setReferrerHost] = useState("")
  useEffect(() => {
    try {
      setReferrerHost(
        document.referrer ? new URL(document.referrer).hostname : "",
      )
    } catch {}
  }, [])
  if (state.ok)
    return (
      <div
        className="border border-accent/30 bg-accent/5 p-6 text-sm"
        role="status"
      >
        {state.message}
      </div>
    )
  const input =
    "mt-2 w-full border border-border bg-background px-4 py-3 text-sm"
  return (
    <form action={action} className="space-y-5" noValidate>
      <input
        name="website"
        className="hidden"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
      />
      <input type="hidden" name="referrerHost" value={referrerHost} />
      {Object.entries(utm).map(([k, v]) => (
        <input key={k} type="hidden" name={`utm_${k}`} value={v} />
      ))}
      <label className="block text-sm">
        Full name
        <input
          className={input}
          name="fullName"
          required
          maxLength={120}
          autoComplete="name"
        />
      </label>
      <label className="block text-sm">
        Email address
        <input
          className={input}
          name="email"
          required
          maxLength={254}
          type="email"
          autoComplete="email"
        />
      </label>
      <label className="block text-sm">
        Organisation/company{" "}
        <span className="text-muted-foreground">— optional</span>
        <input
          className={input}
          name="organisation"
          maxLength={160}
          autoComplete="organization"
        />
      </label>
      <label className="block text-sm">
        Role/profession
        <input
          className={input}
          name="role"
          required
          maxLength={160}
          autoComplete="organization-title"
        />
      </label>
      <label className="block text-sm">
        Which best describes you?
        <select className={input} name="userType" required defaultValue="">
          <option value="" disabled>
            Select one
          </option>
          {[
            "Individual professional",
            "Small professional team",
            "Corporate or institutional",
          ].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        How did you hear about APRI?
        <select className={input} name="source" required defaultValue="">
          <option value="" disabled>
            Select one
          </option>
          {[
            "WhatsApp",
            "Google",
            "Facebook",
            "X",
            "LinkedIn",
            "Referral",
            "Other",
          ].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      <p className="text-xs text-muted-foreground">
        By submitting, you acknowledge our{" "}
        <a href="/terms" className="underline">
          terms
        </a>{" "}
        and{" "}
        <a href="/privacy" className="underline">
          privacy notice
        </a>
        . Confirmation is required before APRI prepares access.
      </p>
      {state.message && (
        <p className="text-sm text-red-700" role="alert">
          {state.message}
        </p>
      )}
      <button disabled={pending} className="btn-primary disabled:opacity-60">
        {pending ? "Submitting…" : "Request Complimentary Review Access"}
      </button>
    </form>
  )
}
