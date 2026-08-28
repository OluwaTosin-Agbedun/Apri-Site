"use client"

import { useActionState, useEffect, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  activateBriefing,
  resendBriefingSignInLink,
  saveBriefing,
} from "@/app/actions/briefings"
import type { FormState } from "@/lib/definitions"
import PapermarkFolderSelector from "@/components/PapermarkFolderSelector"
import type { PapermarkFolder } from "@/lib/papermark"

const field = "w-full border border-border bg-background p-3 text-sm focus:outline-none focus:border-accent"
const label = "block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2"

export type BriefingDraft = {
  id: string; name: string; organization: string; roleTitle: string; email: string
  phone: string; briefingType: string; format: string; timeline: string; sector: string
  description: string; audienceSize: string; location: string; status: string
  privateLinkUrl: string; schemaReady: boolean; papermarkFolderId: string
}

export default function BriefingForm({ draft, folders, folderError }: { draft: BriefingDraft; folders: PapermarkFolder[]; folderError?: string }) {
  const router = useRouter()
  const [state, action, pending] = useActionState<FormState, FormData>(
    saveBriefing.bind(null, draft.id), undefined
  )
  const [activating, start] = useTransition()
  useEffect(() => { if (state?.ok) router.refresh() }, [state, router])
  const err = (name: string) => state?.errors?.[name]?.[0]
    ? <p className="mt-2 text-xs text-red-700">{state.errors[name][0]}</p> : null
  const fields: [string, string, string][] = [
    ["roleTitle", "Role or title", draft.roleTitle], ["briefingType", "Briefing type", draft.briefingType],
    ["format", "Format", draft.format], ["timeline", "Timeline", draft.timeline],
    ["sector", "Sector", draft.sector], ["audienceSize", "Audience size", draft.audienceSize],
    ["location", "Location", draft.location],
  ]

  function activateOrResend() {
    start(async () => {
      const result = draft.status === "Active"
        ? await resendBriefingSignInLink(draft.id)
        : await activateBriefing(draft.id)
      window.alert(result?.message ?? "Done")
      if (result?.ok) router.refresh()
    })
  }

  return <div className="space-y-6">
    <form action={action} className="border border-border bg-card/30 p-8 space-y-6">
      <div className="grid sm:grid-cols-2 gap-6">
        <div><label className={label}>Name</label><input name="name" required defaultValue={draft.name} className={field}/>{err("name")}</div>
        <div><label className={label}>Email (sign-in)</label><input name="email" type="email" required defaultValue={draft.email} className={field}/>{err("email")}</div>
        <div><label className={label}>Organisation</label><input name="organization" required defaultValue={draft.organization} className={field}/>{err("organization")}</div>
        <div><label className={label}>Phone</label><input name="phone" defaultValue={draft.phone} className={field}/></div>
        {fields.map(([name, text, value]) => <div key={name}><label className={label}>{text}</label><input name={name} defaultValue={value} className={field}/></div>)}
      </div>
      <div><label className={label}>Request details</label><textarea name="description" rows={5} defaultValue={draft.description} className={field}/></div>
      <div><span className={label}>Status</span><p className="text-sm font-medium">{draft.status}</p></div>
      <PapermarkFolderSelector kind="briefing" id={draft.id} value={draft.papermarkFolderId} folders={folders} error={folderError} />
      <div><label className={label}>Private Papermark share link</label><input name="privateLinkUrl" type="text" defaultValue={draft.privateLinkUrl} placeholder="https://www.papermark.com/view/…" className={field}/>{err("privateLinkUrl")}<p className="mt-2 text-xs text-muted-foreground">Use a document link when this person should see one document. Use a multi-file share link when they should see a library containing several documents. Uploading another document into the same Papermark folder does not automatically add it to an existing single-document link. Never use Masters or a shared default. HTTPS is added automatically when omitted.</p></div>
      {state?.message && <p className="text-sm">{state.message}</p>}
      <button disabled={pending || !draft.schemaReady} className="bg-accent text-white px-6 py-2 text-sm">{pending ? "Saving…" : "Save"}</button>
    </form>
    {!draft.schemaReady && <p className="border border-red-200 bg-red-50 p-4 text-sm text-red-700">Apply the briefing portal migration before saving or activating this request.</p>}
    <div className="border border-border bg-card/30 p-6"><button disabled={activating || (!draft.privateLinkUrl && !draft.papermarkFolderId) || !draft.schemaReady} onClick={activateOrResend} className="bg-foreground text-background px-6 py-2.5 text-sm disabled:opacity-40">{activating ? "Working…" : draft.status === "Active" ? "Resend sign-in link" : "Activate & send sign-in link"}</button>{!draft.privateLinkUrl && !draft.papermarkFolderId && <p className="mt-3 text-xs text-muted-foreground">Save a private folder or fallback link before activation.</p>}</div>
  </div>
}
