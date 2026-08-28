"use client"

import { useActionState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { saveBriefing } from "@/app/actions/briefings"
import type { FormState } from "@/lib/definitions"

const field = "w-full border border-border bg-background p-3 text-sm focus:outline-none focus:border-accent"
const label = "block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2"

export type BriefingDraft = {
  id: string; name: string; organization: string; roleTitle: string; email: string
  phone: string; briefingType: string; format: string; timeline: string; sector: string
  description: string; audienceSize: string; location: string; status: string
  notes: string
}

const STATUSES = ["New", "Pending", "Active", "Closed"] as const

export default function BriefingForm({ draft }: { draft: BriefingDraft }) {
  const router = useRouter()
  const [state, action, pending] = useActionState<FormState, FormData>(
    saveBriefing.bind(null, draft.id), undefined
  )
  useEffect(() => { if (state?.ok) router.refresh() }, [state, router])
  const err = (name: string) => state?.errors?.[name]?.[0]
    ? <p className="mt-2 text-xs text-red-700">{state.errors[name][0]}</p> : null
  const fields: [string, string, string][] = [
    ["roleTitle", "Role or title", draft.roleTitle], ["briefingType", "Briefing type", draft.briefingType],
    ["format", "Mode of briefing", draft.format], ["timeline", "Timeline", draft.timeline],
    ["sector", "Sector", draft.sector], ["audienceSize", "Audience size", draft.audienceSize],
    ["location", "Location", draft.location],
  ]

  return <form action={action} className="border border-border bg-card/30 p-8 space-y-6">
    <div className="grid sm:grid-cols-2 gap-6">
      <div><label className={label}>Name</label><input name="name" required defaultValue={draft.name} className={field}/>{err("name")}</div>
      <div><label className={label}>Email</label><input name="email" type="email" required defaultValue={draft.email} className={field}/>{err("email")}</div>
      <div><label className={label}>Organisation</label><input name="organization" required defaultValue={draft.organization} className={field}/>{err("organization")}</div>
      <div><label className={label}>Phone</label><input name="phone" defaultValue={draft.phone} className={field}/></div>
      {fields.map(([name, text, value]) => <div key={name}><label className={label}>{text}</label><input name={name} defaultValue={value} className={field}/></div>)}
      <div>
        <label className={label}>Status</label>
        <select name="status" defaultValue={draft.status} className={field}>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
    </div>
    <div><label className={label}>Request details</label><textarea name="description" rows={5} defaultValue={draft.description} className={field}/></div>
    <div><label className={label}>Internal notes</label><textarea name="notes" rows={4} defaultValue={draft.notes} placeholder="Internal notes visible only to administrators." className={field}/></div>
    {state?.message && <p className="text-sm">{state.message}</p>}
    <button disabled={pending} className="bg-accent text-white px-6 py-2 text-sm">{pending ? "Saving…" : "Save"}</button>
  </form>
}
