"use client"

import { useState } from "react"
import { setPublicationException } from "@/app/actions/subscribers"

export default function PublicationAccessControl({ subscriberId, publicationId, title, current }: { subscriberId:string; publicationId:string; title:string; current:string|null }) {
  const [decision,setDecision]=useState(current ?? "automatic")
  const [reason,setReason]=useState("")
  const [preview,setPreview]=useState(false)
  return <form action={setPublicationException} className="flex flex-wrap items-center gap-2">
    <input type="hidden" name="subscriberId" value={subscriberId}/><input type="hidden" name="publicationId" value={publicationId}/>
    <select name="decision" value={decision} onChange={(e)=>{setDecision(e.target.value);setPreview(false)}} className="border border-border bg-background p-2 text-xs"><option value="automatic">Automatic</option><option value="allow">Allow</option><option value="block">Block</option></select>
    <input name="reason" value={reason} onChange={(e)=>setReason(e.target.value)} aria-label="Reason" placeholder="Reason required for Allow/Block" className="border border-border bg-background p-2 text-xs" />
    {!preview ? <button className="btn-secondary text-xs" type="button" onClick={()=>setPreview(true)}>Preview</button> : <><span className="text-xs" role="status">{decision === "allow" ? `Add access to “${title}”` : decision === "block" ? `Remove access to “${title}”` : `Return “${title}” to automatic policy`}</span><button className="btn-secondary text-xs" type="submit">Confirm</button></>}
  </form>
}
