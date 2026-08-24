'use client'

import { useActionState } from 'react'
import { requestAccess } from '@/app/actions/public'
import { PUBLIC_TIER_NAMES } from '@/lib/entitlements'

const field =
  'w-full border border-border bg-background p-3 text-sm focus:outline-none focus:border-accent'

export default function AccessForm() {
  const [state, action, pending] = useActionState(requestAccess, undefined)

  if (state?.ok) {
    return (
      <div className="border border-border bg-accent/5 p-6 w-full max-w-md">
        <p className="font-serif text-foreground text-lg mb-2">Request Received</p>
        <p className="text-sm text-foreground/80">{state.message}</p>
      </div>
    )
  }

  return (
    <form action={action} className="w-full max-w-md border border-border bg-card/30 p-6 space-y-4">
      <h3 className="font-serif text-lg text-foreground mb-4">Request Access</h3>

      <div>
        <input name="name" type="text" required placeholder="Full Name" className={field} />
        {state?.errors?.name && (
          <p className="mt-2 text-xs text-red-700">{state.errors.name[0]}</p>
        )}
      </div>
      <div>
        <input
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          placeholder="Work Email"
          className={field}
        />
        {state?.errors?.email && (
          <p className="mt-2 text-xs text-red-700">{state.errors.email[0]}</p>
        )}
      </div>
      <div>
        {/* type=tel brings up the phone keypad on a mobile browser. */}
        <input
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          placeholder="Phone"
          className={field}
        />
        {state?.errors?.phone && (
          <p className="mt-2 text-xs text-red-700">{state.errors.phone[0]}</p>
        )}
      </div>
      <div>
        <input
          name="organization"
          type="text"
          autoComplete="organization"
          required
          placeholder="Organisation"
          className={field}
        />
        {state?.errors?.organization && (
          <p className="mt-2 text-xs text-red-700">{state.errors.organization[0]}</p>
        )}
      </div>
      <div>
        <input
          name="roleTitle"
          type="text"
          autoComplete="organization-title"
          placeholder="Role"
          className={field}
        />
        {state?.errors?.roleTitle && (
          <p className="mt-2 text-xs text-red-700">{state.errors.roleTitle[0]}</p>
        )}
      </div>
      <div>
        <select
          name="subscriptionLevel"
          className={`${field} appearance-none cursor-pointer`}
          defaultValue=""
        >
          <option value="" disabled>
            Level of interest (optional)
          </option>
          {PUBLIC_TIER_NAMES.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </div>
      <div>
        <input
          name="note"
          type="text"
          placeholder="Anything we should know (optional)"
          className={field}
        />
        {state?.errors?.note && (
          <p className="mt-2 text-xs text-red-700">{state.errors.note[0]}</p>
        )}
      </div>

      {state?.message && !state.ok && (
        <p className="text-sm text-red-700 border border-red-200 bg-red-50 p-3">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full bg-accent text-white px-4 py-2.5 text-sm font-medium tracking-wide hover:bg-accent-hover disabled:opacity-50 transition-colors cursor-pointer"
      >
        {pending ? 'Submitting…' : 'Request Access'}
      </button>

      <p className="text-xs text-muted-foreground">We reply within one business day.</p>
    </form>
  )
}
