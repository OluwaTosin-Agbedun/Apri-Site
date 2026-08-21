'use client'

import { useActionState, useState } from 'react'
import { inviteAdmin } from '@/app/actions/auth'

const field =
  'w-full border border-border bg-background p-3 text-sm focus:outline-none focus:border-accent'
const label =
  'block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2'

export default function InviteForm() {
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(inviteAdmin, undefined)

  if (!open) {
    return (
      <div className="mb-8 flex items-center justify-between gap-4">
        {state?.ok && state.message ? (
          <p className="text-sm text-foreground border border-border bg-accent/5 p-3 flex-1">
            {state.message}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Additional administrators are added here, not through the setup screen.
          </p>
        )}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="bg-foreground text-background px-4 py-2 text-sm font-medium tracking-wide hover:bg-foreground/90 transition-colors cursor-pointer shrink-0"
        >
          Add Administrator
        </button>
      </div>
    )
  }

  const err = (name: string) =>
    state?.errors?.[name] ? (
      <p className="mt-2 text-xs text-red-700">{state.errors[name][0]}</p>
    ) : null

  return (
    <div className="mb-8 border border-border bg-card/30 p-8">
      <h3 className="font-serif text-lg text-foreground mb-6">Add Administrator</h3>
      <form action={action} className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <label htmlFor="name" className={label}>Full name</label>
            <input id="name" name="name" required className={field} />
            {err('name')}
          </div>
          <div>
            <label htmlFor="email" className={label}>Email</label>
            <input id="email" name="email" type="email" required className={field} />
            {err('email')}
          </div>
          <div>
            <label htmlFor="password" className={label}>Temporary password</label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="new-password"
              className={field}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              At least 12 characters, with upper case, lower case and a number.
              Share it with them over a channel other than email, and have them
              change it.
            </p>
            {err('password')}
          </div>
          <div>
            <label htmlFor="role" className={label}>Role</label>
            <select id="role" name="role" defaultValue="editor" className={field}>
              <option value="editor">Editor — manage publications and requests</option>
              <option value="owner">Owner — also manages administrators</option>
            </select>
            {err('role')}
          </div>
        </div>

        {state?.message && !state.ok && (
          <p className="text-sm text-red-700 border border-red-200 bg-red-50 p-3">
            {state.message}
          </p>
        )}

        <div className="flex justify-end gap-4 pt-4 border-t border-border">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="px-4 py-2 text-sm font-medium text-foreground/70 hover:text-foreground transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className="bg-accent text-white px-6 py-2 text-sm font-medium tracking-wide hover:bg-accent-hover disabled:opacity-50 transition-colors cursor-pointer"
          >
            {pending ? 'Adding…' : 'Add Administrator'}
          </button>
        </div>
      </form>
    </div>
  )
}
