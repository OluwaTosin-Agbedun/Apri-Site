'use client'

import { useActionState, useState } from 'react'
import { requestSignInLink, signInWithEmailCode } from '@/app/actions/subscriber-auth'
import { Busy } from '@/components/Spinner'

const field =
  'w-full border border-border bg-background p-4 text-base focus:outline-none focus:border-accent'
const label = 'block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3'
const primary =
  'w-full bg-foreground text-background px-6 py-4 text-base font-medium tracking-wide hover:bg-foreground/90 disabled:opacity-60 transition-colors cursor-pointer'

/**
 * Sign-in in two steps, both in THIS browser.
 *
 * 1. The subscriber asks for an email. It carries a link and an 8-digit code.
 * 2. Either opens the library. The code, typed here, signs in this browser
 *    even when their email app opens links in a browser of its own -- the
 *    reason subscribers were asked for their email on every return. The link
 *    signs in at once when opened in this same browser.
 */
export default function SignInForm() {
  const [requested, request, requesting] = useActionState(requestSignInLink, undefined)
  const [email, setEmail] = useState('')
  const [haveCode, setHaveCode] = useState(false)

  if (requested?.ok || haveCode) {
    return <CodeForm email={email} sent={Boolean(requested?.ok)} message={requested?.message} onEmail={setEmail} />
  }

  return (
    <form action={request} className="border border-border bg-card/30 p-8 space-y-5">
      <div>
        <label htmlFor="email" className={label}>
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
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@organisation.com"
          className={field}
        />
      </div>

      {requested?.message && !requested.ok && (
        <p className="text-sm text-red-700 border border-red-200 bg-red-50 p-3">{requested.message}</p>
      )}

      <button type="submit" disabled={requesting} aria-busy={requesting} className={primary}>
        <Busy pending={requesting} idle="Email me a sign-in link" busy="Sending…" />
      </button>

      <p className="text-xs text-muted-foreground leading-relaxed">
        We will email you a link and an 8-digit code. Use either one here, in this browser, and you stay
        signed in on this browser for 90 days, renewed each time you visit. Sign-in is available to
        activated subscriptions.
      </p>
      <button
        type="button"
        onClick={() => setHaveCode(true)}
        className="text-xs text-accent hover:text-accent-hover transition-colors cursor-pointer"
      >
        I already have a code
      </button>
    </form>
  )
}

function CodeForm({
  email,
  sent,
  message,
  onEmail,
}: {
  email: string
  sent: boolean
  message?: string
  onEmail: (value: string) => void
}) {
  const [state, action, pending] = useActionState(signInWithEmailCode, undefined)
  return (
    <div className="border border-border bg-card/30 p-8 space-y-6">
      {sent && (
        <div>
          <p className="font-serif text-foreground text-xl mb-3">Check your email</p>
          <p className="text-sm text-foreground/80 leading-relaxed">{message}</p>
        </div>
      )}
      <form action={action} className="space-y-5">
        <div>
          <label htmlFor="code-email" className={label}>
            Email address
          </label>
          <input
            id="code-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={email}
            onChange={(e) => onEmail(e.target.value)}
            className={field}
          />
        </div>
        <div>
          <label htmlFor="code" className={label}>
            8-digit code from the email
          </label>
          <input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{8,9}"
            maxLength={9}
            required
            placeholder="1234 5678"
            className={`${field} tracking-[0.3em] font-mono`}
          />
        </div>
        {state?.message && (
          <p className="text-sm text-red-700 border border-red-200 bg-red-50 p-3" role="alert">
            {state.message}
          </p>
        )}
        <button type="submit" disabled={pending} aria-busy={pending} className={primary}>
          <Busy pending={pending} idle="Sign in on this browser" busy="Signing in…" />
        </button>
      </form>
      <p className="text-xs text-muted-foreground leading-relaxed">
        The code and the link work once and expire after 15 minutes. Opening the link in this browser
        works too. If your email app opens it in its own browser instead, type the code here so you stay
        signed in here. Nothing arrived? Check your spam folder, or reload this page to ask again.
      </p>
    </div>
  )
}
