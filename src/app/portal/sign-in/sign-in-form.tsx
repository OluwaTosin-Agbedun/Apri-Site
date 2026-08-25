'use client'

import { useActionState } from 'react'
import { requestSignInLink } from '@/app/actions/subscriber-auth'

const field =
  'w-full border border-border bg-background p-4 text-base focus:outline-none focus:border-accent'

export default function SignInForm() {
  const [state, action, pending] = useActionState(requestSignInLink, undefined)

  if (state?.ok) {
    return (
      <div className="border border-border bg-accent/5 p-8">
        <p className="font-serif text-foreground text-xl mb-3">Check your email</p>
        <p className="text-sm text-foreground/80 leading-relaxed">{state.message}</p>
        <p className="text-xs text-muted-foreground leading-relaxed mt-6">
          The link works once and expires in 15 minutes. Once you have used it you will
          stay signed in on this device for 90 days. If nothing arrives, check your spam
          folder or request another.
        </p>
      </div>
    )
  }

  return (
    <form action={action} className="border border-border bg-card/30 p-8 space-y-5">
      <div>
        <label
          htmlFor="email"
          className="block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3"
        >
          Email address
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
          placeholder="you@organisation.com"
          className={field}
        />
      </div>

      {state?.message && !state.ok && (
        <p className="text-sm text-red-700 border border-red-200 bg-red-50 p-3">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full bg-foreground text-background px-6 py-4 text-base font-medium tracking-wide hover:bg-foreground/90 disabled:opacity-50 transition-colors cursor-pointer"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>

      {/*
        Says what will happen, because the click does not log anyone straight in
        -- there is no password in this system. It also sets the expectation that
        this is a one-off: the session lasts ninety days, so an activated
        subscriber does this once and then simply opens their library.
      */}
      <p className="text-xs text-muted-foreground leading-relaxed">
        We will email you a link to open your library. You stay signed in on this device
        for 90 days, so you only need to do this once. Sign-in is available to activated
        subscriptions.
      </p>
    </form>
  )
}
