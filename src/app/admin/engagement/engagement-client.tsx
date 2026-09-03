"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  syncPapermarkAnalyticsNow,
  previewAttributionRepair,
  applyAttributionRepair,
  type RepairPreview,
} from "@/app/actions/engagement-analytics"

const btnSecondary =
  "border border-border px-4 py-2 text-sm hover:bg-black/5 transition-colors disabled:opacity-50 cursor-pointer"

/**
 * The owner-only maintenance panel.
 *
 * Two things live here: the manual Papermark sync, and the historical
 * attribution repair. Both call server actions that begin with
 * `requireOwner()`, so nothing here is reachable by an ordinary admin even
 * though the page itself is admin-visible.
 */
export function EngagementMaintenance() {
  return (
    <div className="space-y-6">
      <ManualSyncPanel />
      <RepairPanel />
    </div>
  )
}

function ManualSyncPanel() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState("")
  const [ok, setOk] = useState(false)
  const router = useRouter()

  async function handleSync() {
    setBusy(true)
    setMsg("")
    const result = await syncPapermarkAnalyticsNow()
    setMsg(result.message)
    setOk(result.ok)
    setBusy(false)
    if (result.ok) router.refresh()
  }

  return (
    <div className="border border-border bg-card/30 p-6">
      <h4 className="font-serif text-lg text-foreground mb-2">
        Sync Papermark analytics now
      </h4>
      <p className="text-sm text-foreground/70 mb-4 max-w-3xl">
        Runs exactly the collector the nightly cron runs, over the same link ids,
        and reports what it found. Safe to run repeatedly: every row is keyed on
        Papermark&rsquo;s own ids, so nothing is duplicated and data the webhook
        already delivered is left alone.
      </p>
      <button type="button" onClick={handleSync} disabled={busy} className={btnSecondary}>
        {busy ? "Syncing..." : "Sync Papermark analytics now"}
      </button>
      {msg && (
        <p className={`text-sm mt-3 ${ok ? "text-accent" : "text-red-600"}`}>{msg}</p>
      )}
    </div>
  )
}

/**
 * Preview then Apply, deliberately in that order and never combined.
 *
 * The repair only ever fills a field that is currently empty. An attribution
 * already stored is evidence from when the view arrived, so it is never
 * rewritten -- and that rule is enforced in the SQL, not just here, so a stale
 * preview cannot cause an overwrite.
 */
function RepairPanel() {
  const [preview, setPreview] = useState<RepairPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [applyMsg, setApplyMsg] = useState("")
  const router = useRouter()

  async function handlePreview() {
    setBusy(true)
    setApplyMsg("")
    const result = await previewAttributionRepair()
    setPreview(result)
    setBusy(false)
  }

  async function handleApply() {
    if (
      !window.confirm(
        "Apply the repair? Only missing subscriber, publication and reader-type " +
          "fields will be filled in. No existing attribution will be changed.",
      )
    ) {
      return
    }
    setBusy(true)
    const result = await applyAttributionRepair()
    setApplyMsg(result.message)
    setPreview(null)
    setBusy(false)
    router.refresh()
  }

  return (
    <div className="border border-border bg-card/30 p-6">
      <h4 className="font-serif text-lg text-foreground mb-2">
        Repair historical attribution
      </h4>
      <p className="text-sm text-foreground/70 mb-4 max-w-3xl">
        Re-runs the canonical resolver over stored views whose subscriber,
        publication or reader type was never resolved &mdash; usually because the
        link had not been provisioned when the view arrived. Only missing fields
        are filled; an existing attribution is never overwritten.
      </p>

      <div className="flex items-center gap-3 flex-wrap">
        <button type="button" onClick={handlePreview} disabled={busy} className={btnSecondary}>
          {busy && !applyMsg ? "Checking..." : "Preview repair"}
        </button>
        {preview && preview.repairable > 0 && (
          <button type="button" onClick={handleApply} disabled={busy} className={btnSecondary}>
            Apply repair to {preview.repairable} rows
          </button>
        )}
      </div>

      {preview && (
        <div className="mt-4">
          <p className="text-sm text-foreground/80 mb-3">{preview.message}</p>
          {preview.rows.length > 0 && (
            <div className="border border-border overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-black/5 text-foreground/70 sticky top-0">
                  <tr>
                    <th className="font-medium p-2">View id</th>
                    <th className="font-medium p-2">Would fill</th>
                    <th className="font-medium p-2">Reader type</th>
                    <th className="font-medium p-2">Matched by</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {preview.rows.map((r) => (
                    <tr key={r.papermarkViewId}>
                      <td className="p-2 font-mono text-[0.65rem] break-all">
                        {r.papermarkViewId}
                      </td>
                      <td className="p-2">{r.fillsFields.join(", ")}</td>
                      <td className="p-2">{r.proposedReaderType}</td>
                      <td className="p-2 text-muted-foreground">{r.proposedMethod}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {applyMsg && <p className="text-sm mt-3 text-accent">{applyMsg}</p>}
    </div>
  )
}

/** Separates and filters subscriber readers from Complimentary Review readers. */
export function ReaderTypeFilter({
  current,
  params,
  counts,
}: {
  current: string
  params: Record<string, string | undefined>
  counts: Record<string, number>
}) {
  const link = (reader: string) => {
    const sp = new URLSearchParams()
    sp.set("tab", "readers")
    if (params.window) sp.set("window", params.window)
    if (params.from) sp.set("from", params.from)
    if (params.to) sp.set("to", params.to)
    if (reader) sp.set("reader", reader)
    return `?${sp.toString()}`
  }

  const options = [
    { key: "", label: "All readers", count: counts.all },
    { key: "subscriber", label: "Subscribers", count: counts.subscriber },
    { key: "complimentary_review", label: "Complimentary Review", count: counts.complimentary_review },
    { key: "briefing", label: "Briefing", count: counts.briefing },
    { key: "unknown", label: "Unattributed", count: counts.unknown },
  ]

  return (
    <div className="flex flex-wrap items-center gap-2 mb-6">
      {options.map((o) => (
        <Link
          key={o.key || "all"}
          href={link(o.key)}
          className={`px-3 py-1.5 text-xs font-medium border transition-colors ${
            current === o.key
              ? "border-accent text-accent bg-accent/5"
              : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label} ({o.count ?? 0})
        </Link>
      ))}
    </div>
  )
}
