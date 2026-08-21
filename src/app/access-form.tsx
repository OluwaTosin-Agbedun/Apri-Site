'use client'

import { useActionState } from 'react'
import { requestAccess } from '@/app/actions/public'

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
          name="organization"
          type="text"
          required
          placeholder="Organisation"
          className={field}
        />
        {state?.errors?.organization && (
          <p className="mt-2 text-xs text-red-700">{state.errors.organization[0]}</p>
        )}
      </div>
      <div>
        <input name="email" type="email" required placeholder="Work Email" className={field} />
        {state?.errors?.email && (
          <p className="mt-2 text-xs text-red-700">{state.errors.email[0]}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full bg-accent text-white px-4 py-2.5 text-sm font-medium tracking-wide hover:bg-accent-hover disabled:opacity-50 transition-colors cursor-pointer"
      >
        {pending ? 'Submitting…' : 'Request Access'}
      </button>
    </form>
  )
}
