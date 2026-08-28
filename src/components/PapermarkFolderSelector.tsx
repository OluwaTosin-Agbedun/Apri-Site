"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { syncClientLibrary, type ClientKind } from "@/app/actions/papermark-client-library"
import type { PapermarkFolder } from "@/lib/papermark"

export default function PapermarkFolderSelector({kind,id,value,folders,error}:{
  kind:ClientKind; id:string; value:string; folders:PapermarkFolder[]; error?:string
}) {
  const router = useRouter()
  const [search,setSearch] = useState("")
  const [selected,setSelected] = useState(value)
  const [pending,start] = useTransition()
  const [message,setMessage] = useState("")
  const visible = useMemo(() => folders.filter(f => f.name.toLowerCase().includes(search.toLowerCase())),[folders,search])
  return <div className="space-y-3">
    <label className="block text-xs font-medium uppercase tracking-wider text-muted-foreground">Private Papermark folder</label>
    <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search folders…" className="w-full border border-border bg-background p-3 text-sm" />
    <select name="papermarkFolderId" value={selected} onChange={e=>setSelected(e.target.value)} className="w-full border border-border bg-background p-3 text-sm">
      <option value="">No folder selected — use private link fallback</option>
      {visible.map(folder=><option key={folder.id} value={folder.id}>{folder.name}</option>)}
    </select>
    {error && <p className="text-xs text-red-700">{error}</p>}
    {!error && folders.length === 0 && <p className="text-xs text-muted-foreground">No client folders were found.</p>}
    <div className="flex flex-wrap gap-3">
      <button type="button" onClick={()=>router.refresh()} className="border border-border px-4 py-2 text-sm">Refresh folders</button>
      <button type="button" disabled={pending || !selected || selected !== value} onClick={()=>start(async()=>{const result=await syncClientLibrary(kind,id);setMessage(result?.message??"");if(result?.ok)router.refresh()})} className="bg-foreground text-background px-4 py-2 text-sm disabled:opacity-40">{pending?"Syncing…":"Sync library now"}</button>
    </div>
    {message && <p className="text-sm">{message}</p>}
    <p className="text-xs text-muted-foreground">Save a folder selection before syncing. Only direct children of the configured {kind} root are shown.</p>
  </div>
}
