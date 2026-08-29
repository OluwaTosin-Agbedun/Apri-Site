'use client'

import { useActionState, useState } from 'react'
import { requestAccess } from '@/app/actions/public'
import { PUBLIC_TIER_NAMES, tierDisplayName } from '@/lib/entitlements'

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

export default function AccessForm({
  /**
   * Pre-selected when the visitor arrived by clicking a specific tier.
   * Validated on the server before it reaches here, so it is always either one
   * of the five names or empty.
   */
  defaultLevel = '',
}: {
  defaultLevel?: string
}) {
  const [state, action, pending] = useActionState(requestAccess, undefined)
  const [subscriptionLevel, setSubscriptionLevel] = useState(defaultLevel)
  const [seats, setSeats] = useState('')
  const showSeats = Boolean(subscriptionLevel && subscriptionLevel !== 'Individual Access')

  function changeLevel(value: string) {
    setSubscriptionLevel(value)
    if (value === 'Individual Access' || !value) setSeats('')
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
          className={field}
        />
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

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="bg-accent text-white px-6 py-2.5 text-sm font-medium tracking-wide hover:bg-accent-hover disabled:opacity-50 transition-colors cursor-pointer"
        >
          {pending ? 'Submitting…' : 'Request access'}
        </button>
        <p className="text-xs text-muted-foreground">
          We reply within one business day.
        </p>
      </div>
    </form>
  )
}
