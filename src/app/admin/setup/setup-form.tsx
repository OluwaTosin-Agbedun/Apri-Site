'use client'

import { useActionState } from 'react'
import { setupFirstAdmin } from '@/app/actions/auth'

const field =
  'w-full border border-border bg-background p-3 text-sm focus:outline-none focus:border-accent'

export default function SetupForm() {
  const [state, action, pending] = useActionState(setupFirstAdmin, undefined)

  return (
    <form action={action} className="border border-border bg-card/30 p-8 space-y-5">
      <div>
        <label htmlFor="name" className="block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
          Full name
        </label>
        <input id="name" name="name" type="text" required autoComplete="name" className={field} />
        {state?.errors?.name && (
          <p className="mt-2 text-xs text-red-700">{state.errors.name[0]}</p>
        )}
      </div>

      <div>
        <label htmlFor="email" className="block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
          Email
        </label>
        <input id="email" name="email" type="email" required autoComplete="username" className={field} />
        {state?.errors?.email && (
          <p className="mt-2 text-xs text-red-700">{state.errors.email[0]}</p>
        )}
      </div>

      <div>
        <label htmlFor="password" className="block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="new-password"
          className={field}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          At least 12 characters, with an upper-case letter, a lower-case letter
          and a number.
        </p>
        {state?.errors?.password && (
          <ul className="mt-2 space-y-1">
            {state.errors.password.map((e) => (
              <li key={e} className="text-xs text-red-700">
                {e}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <label htmlFor="confirmPassword" className="block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
          Confirm password
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          required
          autoComplete="new-password"
          className={field}
        />
        {state?.errors?.confirmPassword && (
          <p className="mt-2 text-xs text-red-700">{state.errors.confirmPassword[0]}</p>
        )}
      </div>

      {state?.message && (
        <p className="text-sm text-red-700 border border-red-200 bg-red-50 p-3">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full bg-foreground text-background px-6 py-3 text-sm font-medium tracking-wide hover:bg-foreground/90 disabled:opacity-50 transition-colors cursor-pointer"
      >
        {pending ? 'Creating account…' : 'Create owner account'}
      </button>
    </form>
  )
}
