"use client"
import { useActionState, useEffect, useTransition } from "react"
import { useRouter } from "next/navigation"
import { saveBriefing, activateBriefing } from "@/app/actions/briefings"
import type { FormState } from "@/lib/definitions"

const field =
  "w-full border border-border bg-background p-3 text-sm focus:outline-none focus:border-accent"
const label =
  "block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2"
export type BriefingDraft = {
  id: string
  name: string
  organization: string
  email: string
  phone: string
  status: string
  privateLinkUrl: string
}
export default function BriefingForm({ draft }: { draft: BriefingDraft }) {
  const router = useRouter()
  const [state, action, pending] = useActionState<FormState, FormData>(
    saveBriefing.bind(null, draft.id),
    undefined,
  )
  const [activating, start] = useTransition()
  useEffect(() => {
    if (state?.ok) router.refresh()
  }, [state?.ok, router])
  const err = (n: string) =>
    state?.errors?.[n]?.[0] ? (
      <p className="mt-2 text-xs text-red-700">{state.errors[n][0]}</p>
    ) : null
  return (
    <div className="space-y-6">
      <form
        action={action}
        className="border border-border bg-card/30 p-8 space-y-6"
      >
        <div className="grid sm:grid-cols-2 gap-6">
          <div>
            <label className={label}>Name</label>
            <input
              name="name"
              required
              defaultValue={draft.name}
              className={field}
            />
            {err("name")}
          </div>
          <div>
            <label className={label}>Email (sign-in)</label>
            <input
              name="email"
              type="email"
              required
              defaultValue={draft.email}
              className={field}
            />
            {err("email")}
          </div>
          <div>
            <label className={label}>Organisation</label>
            <input
              name="organization"
              required
              defaultValue={draft.organization}
              className={field}
            />
            {err("organization")}
          </div>
          <div>
            <label className={label}>Phone</label>
            <input name="phone" defaultValue={draft.phone} className={field} />
          </div>
          <div>
            <label className={label}>Status</label>
            <select name="status" defaultValue={draft.status} className={field}>
              {["New", "In Progress", "Scheduled", "Active", "Closed"].map(
                (x) => (
                  <option key={x}>{x}</option>
                ),
              )}
            </select>
          </div>
        </div>
        <div>
          <label className={label}>
            Unique private Papermark briefing link
          </label>
          <input
            name="privateLinkUrl"
            type="url"
            defaultValue={draft.privateLinkUrl}
            placeholder="https://www.papermark.com/view/…"
            className={field}
          />
          {err("privateLinkUrl")}
          <p className="mt-2 text-xs text-muted-foreground">
            Use this client's private view-only link, never a Masters folder or
            shared master link.
          </p>
        </div>
        {state?.message && <p className="text-sm">{state.message}</p>}
        <button
          disabled={pending}
          className="bg-accent text-white px-6 py-2 text-sm"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </form>
      <div className="border border-border bg-card/30 p-6">
        <button
          disabled={activating || !draft.privateLinkUrl}
          onClick={() =>
            start(async () => {
              const result = await activateBriefing(draft.id)
              alert(result?.message ?? "Done")
              if (result?.ok) router.refresh()
            })
          }
          className="bg-foreground text-background px-6 py-2.5 text-sm disabled:opacity-40"
        >
          {activating ? "Working…" : "Activate & send sign-in link"}
        </button>
        {!draft.privateLinkUrl && (
          <p className="mt-3 text-xs text-muted-foreground">
            Save a private link before activation.
          </p>
        )}
      </div>
    </div>
  )
}
