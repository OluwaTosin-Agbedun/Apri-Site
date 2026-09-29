'use client'

import { useActionState, useEffect, useState } from 'react'
import { requestAccess } from '@/app/actions/public'
import { submitPublicSubscriptionRequest } from '@/app/actions/review-funnel'
import { PLANS } from '@/lib/subscription-journey'
import {
  PUBLIC_TIER_NAMES,
  tierDisplayName,
  requiresWorkEmail,
  isPersonalEmail,
  WORK_EMAIL_MESSAGE,
} from '@/lib/entitlements'

/**
 * The subscription enquiry form.
 *
 * Every field carries a real <label>. A placeholder disappears the moment
 * someone starts typing -- exactly when they most need to know what the field
 * was for -- and a screen reader announces nothing useful from one at all.
 */

const field =
  'w-full border border-border bg-background p-3 text-sm focus:outline-none focus:border-accent'
const labelClass =
  'block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2'

function Err({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null
  return <p className="mt-2 text-xs text-red-700">{messages[0]}</p>
}

const SOURCES = ['WhatsApp', 'Google', 'Facebook', 'X', 'LinkedIn', 'Referral', 'Other']

export default function AccessForm({
  /**
   * Pre-selected when the visitor arrived by clicking a specific tier.
   * Validated on the server before it reaches here, so it is always either one
   * of the five names or empty.
   */
  defaultLevel = '',
  utm = {},
}: {
  defaultLevel?: string
  /** Campaign attribution from the page URL, kept with a plan request. */
  utm?: Record<string, string>
}) {
  const [enquiry, enquiryAction, enquiryPending] = useActionState(requestAccess, undefined)
  const [planState, planAction, planPending] = useActionState(submitPublicSubscriptionRequest, {})
  const [subscriptionLevel, setSubscriptionLevel] = useState(defaultLevel)
  const [referrerHost, setReferrerHost] = useState('')
  useEffect(() => {
    try {
      setReferrerHost(document.referrer ? new URL(document.referrer).hostname : '')
    } catch {}
  }, [])
  // Individual and Professional Access are priced plans: the same form, but it
  // also collects what the agreement and invoice need and goes to the
  // subscription-request workflow, which grants nothing until an agreement is
  // signed and payment confirmed. The other levels stay a plain enquiry.
  const plan = Object.values(PLANS).find((p) => p.tier === subscriptionLevel) ?? null
  const state = plan ? undefined : enquiry
  const action = plan ? planAction : enquiryAction
  const pending = plan ? planPending : enquiryPending
  const [seats, setSeats] = useState('')
  const [emailValue, setEmailValue] = useState('')
  const showSeats = Boolean(subscriptionLevel && !plan)
  const emailDomainError =
    requiresWorkEmail(subscriptionLevel) && emailValue && isPersonalEmail(emailValue)
      ? WORK_EMAIL_MESSAGE
      : ''

  function changeLevel(value: string) {
    setSubscriptionLevel(value)
    if (value === 'Individual Access' || !value) setSeats('')
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (emailDomainError) {
      event.preventDefault()
    }
  }

  if (state?.ok) {
    return (
      <div className="border border-border bg-accent/5 p-6 w-full max-w-md">
        <p className="font-serif text-foreground text-lg mb-2">Request received</p>
        <p className="text-sm text-foreground/80">{state.message}</p>
      </div>
    )
  }

  return (
    <form
      action={action}
      onSubmit={handleSubmit}
      className="w-full max-w-md border border-border bg-card/30 p-6 space-y-5"
    >
      <div>
        <h3 className="font-serif text-lg text-foreground">Subscription request</h3>
        <p className="text-xs text-muted-foreground mt-1">
          For ongoing access to the intelligence library. To commission a one-off
          briefing instead, use{' '}
          <a href="/request-briefing" className="text-accent hover:text-accent-hover">
            Request a briefing
          </a>
          .
        </p>
      </div>

      {/*
        Honeypot. Hidden from sight and from assistive technology, and taken out
        of the tab order, so no person can reach it. Anything arriving in it came
        from a script filling every input on the page.
      */}
      <div className="hidden" aria-hidden="true">
        <label htmlFor="websiteUrl">Website</label>
        <input
          id="websiteUrl"
          name="websiteUrl"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <div>
        <label htmlFor="name" className={labelClass}>
          Full name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          required
          className={field}
        />
        <Err messages={state?.errors?.name} />
      </div>

      <div>
        <label htmlFor="email" className={labelClass}>
          Work email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={emailValue}
          onChange={(event) => setEmailValue(event.target.value)}
          className={field}
        />
        {emailDomainError && (
          <p className="mt-2 text-xs text-red-700">{emailDomainError}</p>
        )}
        <Err messages={state?.errors?.email} />
      </div>

      <div>
        <label htmlFor="organization" className={labelClass}>
          Organisation
        </label>
        <input
          id="organization"
          name="organization"
          type="text"
          autoComplete="organization"
          required
          className={field}
        />
        <Err messages={state?.errors?.organization} />
      </div>

      <div>
        <label htmlFor="roleTitle" className={labelClass}>
          Role or title
        </label>
        <input
          id="roleTitle"
          name="roleTitle"
          type="text"
          autoComplete="organization-title"
          required
          className={field}
        />
        <Err messages={state?.errors?.roleTitle} />
      </div>

      <div>
        <label htmlFor="subscriptionLevel" className={labelClass}>
          Subscription access level
        </label>
        <select
          id="subscriptionLevel"
          name="subscriptionLevel"
          className={`${field} appearance-none cursor-pointer`}
          value={subscriptionLevel}
          onChange={(event) => changeLevel(event.target.value)}
          required
        >
          <option value="">Select an access level</option>
          {PUBLIC_TIER_NAMES.map((level) => (
            <option key={level} value={level}>
              {tierDisplayName(level)}
            </option>
          ))}
        </select>
        <p className="mt-2 text-xs text-muted-foreground">
          Select the access level required for this subscription.
        </p>
        <Err messages={state?.errors?.subscriptionLevel} />
      </div>

      {showSeats && (
        <div>
          <label htmlFor="seats" className={labelClass}>
            How many people need access?
          </label>
          <input
            id="seats"
            name="seats"
            type="number"
            inputMode="numeric"
            min={1}
            max={500}
            step={1}
            value={seats}
            onChange={(event) => setSeats(event.target.value)}
            required
            className={field}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Each person gets their own sign-in and individually identified access.
          </p>
          <Err messages={state?.errors?.seats} />
        </div>
      )}

      {plan && (
        <div className="space-y-5 border-t border-border pt-5">
          <p className="text-sm text-foreground border border-border bg-background p-3">
            <strong>{plan.label}</strong> — {plan.price}; {plan.users.charAt(0).toLowerCase() + plan.users.slice(1)}.
          </p>
          <input type="hidden" name="plan" value={plan.plan} />
          <input type="hidden" name="referrerHost" value={referrerHost} />
          {Object.entries(utm).map(([k, v]) => (
            <input key={k} type="hidden" name={`utm_${k}`} value={v} />
          ))}
          <div>
            <label htmlFor="source" className={labelClass}>How did you hear about APRI?</label>
            <select id="source" name="source" required defaultValue="" className={`${field} appearance-none cursor-pointer`}>
              <option value="" disabled>Select one</option>
              {SOURCES.map((v) => <option key={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="phone" className={labelClass}>Phone number</label>
            <input id="phone" name="phone" type="tel" autoComplete="tel" required maxLength={40} className={field} />
          </div>
          <div>
            <label htmlFor="legalName" className={labelClass}>Organisation/legal billing name</label>
            <input id="legalName" name="legalName" required maxLength={180} className={field} />
          </div>
          <div>
            <label htmlFor="billingEmail" className={labelClass}>Billing email</label>
            <input id="billingEmail" name="billingEmail" type="email" required maxLength={254} className={field} />
          </div>
          <div>
            <label htmlFor="billingAddress" className={labelClass}>Billing address</label>
            <textarea id="billingAddress" name="billingAddress" required maxLength={400} className={field} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="cityState" className={labelClass}>City/state</label>
              <input id="cityState" name="cityState" required maxLength={120} className={field} />
            </div>
            <div>
              <label htmlFor="country" className={labelClass}>Country</label>
              <input id="country" name="country" required maxLength={100} className={field} />
            </div>
          </div>
          <div>
            <label htmlFor="taxReference" className={labelClass}>Tax/VAT/reference (optional)</label>
            <input id="taxReference" name="taxReference" maxLength={120} className={field} />
          </div>
          <fieldset className="space-y-3">
            <legend className={labelClass}>
              {plan.maxUsers === 1 ? 'Named subscriber' : 'Named subscribers (up to three)'}
            </legend>
            <p className="text-xs text-muted-foreground">
              Each named person receives their own secure sign-in. Access cannot be shared.
            </p>
            {Array.from({ length: plan.maxUsers }, (_, i) => (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input aria-label={`Name ${i + 1}`} placeholder={`Name ${i + 1}`} name={`userName${i}`} required={i === 0} maxLength={120} className={field} />
                <input aria-label={`Email ${i + 1}`} placeholder={`Email ${i + 1}`} type="email" name={`userEmail${i}`} required={i === 0} maxLength={254} className={field} />
              </div>
            ))}
          </fieldset>
          <p className="text-xs text-muted-foreground">
            No card details are collected. We send the subscription agreement and payment details after your request.
          </p>
        </div>
      )}

      {/*
        Sits above the button and gates it. The links open in a new tab so a
        reader can check the terms without losing what they have typed.
      */}
      <div className="pt-1">
        <label htmlFor="acceptedTerms" className="flex items-start gap-3 cursor-pointer">
          <input
            id="acceptedTerms"
            name="acceptedTerms"
            type="checkbox"
            value="on"
            required
            className="mt-0.5 h-4 w-4 shrink-0 accent-accent cursor-pointer"
          />
          <span className="text-xs text-foreground/80 leading-relaxed">
            I accept the{' '}
            <a
              href="/terms"
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:text-accent-hover transition-colors"
            >
              terms of use
            </a>{' '}
            and the{' '}
            <a
              href="/privacy"
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:text-accent-hover transition-colors"
            >
              privacy notice
            </a>
            .
          </span>
        </label>
        <Err messages={state?.errors?.acceptedTerms} />
      </div>

      {state?.message && !state.ok && (
        <p className="text-sm text-red-700 border border-red-200 bg-red-50 p-3">
          {state.message}
        </p>
      )}
      {plan && planState?.message && (
        <p className="text-sm text-red-700 border border-red-200 bg-red-50 p-3" role="alert">
          {planState.message}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="bg-accent text-white px-6 py-2.5 text-sm font-medium tracking-wide hover:bg-accent-hover disabled:opacity-50 transition-colors cursor-pointer"
        >
          {pending ? 'Submitting…' : plan ? `Request ${plan.label}` : 'Request access'}
        </button>
        <p className="text-xs text-muted-foreground">
          We reply within one business day.
        </p>
      </div>
    </form>
  )
}
