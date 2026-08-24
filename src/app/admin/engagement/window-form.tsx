'use client'

import { useActionState } from 'react'
import { updateEngagementWindow } from '@/app/actions/engagement'
import type { FormState } from '@/lib/definitions'

export default function WindowForm({ current }: { current: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    updateEngagementWindow,
    undefined
  )

  return (
    <form action={action} className="flex flex-wrap items-end gap-4">
      <div>
        <label
          htmlFor="window"
          className="block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2"
        >
          Editions considered
        </label>
        <input
          id="window"
          name="window"
          type="number"
          min={1}
          max={12}
          defaultValue={current}
          className="w-24 border border-border bg-background p-2.5 text-sm focus:outline-none focus:border-accent"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="border border-border px-4 py-2.5 text-sm font-medium text-foreground/80 hover:border-accent hover:text-foreground disabled:opacity-50 transition-colors cursor-pointer"
      >
        {pending ? 'Saving…' : 'Update'}
      </button>

      {state?.message && (
        <p
          className={`text-xs ${state.ok ? 'text-foreground/70' : 'text-red-700'} max-w-md`}
        >
          {state.message}
        </p>
      )}
    </form>
  )
}
