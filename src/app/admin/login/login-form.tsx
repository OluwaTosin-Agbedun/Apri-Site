'use client'

import { useActionState } from 'react'
import { login } from '@/app/actions/auth'

const field =
  'w-full border border-border bg-background p-3 text-sm focus:outline-none focus:border-accent'

export default function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined)

  return (
    <form action={action} className="border border-border bg-card/30 p-8 space-y-5">
      <div>
        <label htmlFor="email" className="block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
          Email
        </label>
        <input id="email" name="email" type="email" required autoComplete="username" className={field} />
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
          autoComplete="current-password"
          className={field}
        />
      </div>

      {/* One message for every failure. It never says whether the address
          exists, so the form cannot be used to enumerate accounts. */}
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
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}
