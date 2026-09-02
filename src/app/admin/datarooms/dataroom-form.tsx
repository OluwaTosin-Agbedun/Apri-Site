"use client"

import { useActionState, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  saveLevelRoomMapping,
  deleteLevelRoomMapping,
  syncDataRoomForLevel,
  syncAndNotify,
  fetchAvailableDataRooms,
  prepareDocumentLinksForLevel,
  autoLinkPublicationsByPapermarkId,
  createPublicationForDocument,
  linkPublicationToSyncedDocument,
  previewSubscriberWatermarkUpdate,
  applySubscriberWatermarkUpdate,
  auditLegacyOpenEditions,
  generateMissingDetails,
  generateMissingDetailsForDocument,
} from "@/app/actions/datarooms"
import type { FormState } from "@/lib/definitions"
import { tierDisplayName } from "@/lib/entitlements"

const field =
  "w-full border border-border bg-background p-3 text-sm focus:outline-none focus:border-accent"
const label =
  "block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2"
const btnPrimary =
  "bg-foreground text-background px-6 py-3 text-sm font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50 cursor-pointer"
const btnSecondary =
  "border border-border px-4 py-2 text-sm hover:bg-black/5 transition-colors disabled:opacity-50 cursor-pointer"

export default function DataRoomMappingForm({
  unmappedTiers,
}: {
  unmappedTiers: string[]
  }) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    saveLevelRoomMapping,
    {},
  )
  const [rooms, setRooms] = useState<
    { id: string; name: string; documentCount: number }[]
  >([])
  const [loadingRooms, setLoadingRooms] = useState(false)
  const [roomError, setRoomError] = useState("")

  useEffect(() => {
    if (state?.ok) router.refresh()
  }, [state, router])

  async function loadRooms() {
    setLoadingRooms(true)
    setRoomError("")
    const result = await fetchAvailableDataRooms()
    if (result.ok) {
      setRooms(result.rooms)
    } else {
      setRoomError(result.message)
    }
    setLoadingRooms(false)
  }

  return (
    <div>
      <form action={formAction} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={label}>Subscription Level</label>
            <select name="publicTier" className={field} required>
              <option value="">Select a level</option>
              {unmappedTiers.map((tier) => (
                <option key={tier} value={tier}>{tierDisplayName(tier)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Papermark Data Room</label>
            {rooms.length === 0 ? (
              <button
                type="button"
                onClick={loadRooms}
                disabled={loadingRooms}
                className={btnSecondary}
              >
                {loadingRooms ? "Loading..." : "Fetch Data Rooms from Papermark"}
              </button>
            ) : (
              <select name="dataroomId" className={field} required>
                <option value="">Select a Data Room</option>
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name} ({room.documentCount} docs)
                  </option>
                ))}
              </select>
            )}
            {roomError && (
              <p className="text-xs text-red-600 mt-1">{roomError}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button type="submit" disabled={pending || rooms.length === 0} className={btnPrimary}>
            {pending ? "Saving..." : "Save mapping"}
          </button>
          {state?.message && (
            <p className={`text-sm ${state.ok ? "text-accent" : "text-red-600"}`}>
              {state.message}
            </p>
          )}
        </div>
      </form>

    </div>
  )
}

export function MappingActions({ mappedTiers }: { mappedTiers: string[] }) {
  const [syncing, setSyncing] = useState("")
  const [syncMsg, setSyncMsg] = useState("")
  const [notifying, setNotifying] = useState("")
  const [notifyMsg, setNotifyMsg] = useState("")
  const [deleting, setDeleting] = useState("")
  const [deleteMsg, setDeleteMsg] = useState("")
  const [preparing, setPreparing] = useState("")
  const [prepareMsg, setPrepareMsg] = useState("")
  const [autoLinking, setAutoLinking] = useState("")
  const [autoLinkMsg, setAutoLinkMsg] = useState("")
  const [generating, setGenerating] = useState("")
  const [generateMsg, setGenerateMsg] = useState("")
  const [tier, setTier] = useState("")
  const router = useRouter()

  async function handleSync() {
    if (!tier) return
    setSyncing(tier)
    setSyncMsg("")
    const result = await syncDataRoomForLevel(tier)
    setSyncMsg(result?.message ?? "")
    setSyncing("")
    if (result?.ok) router.refresh()
  }

  async function handleSyncAndNotify() {
    if (!tier) return
    if (!window.confirm(`Sync documents and notify all ${tier} subscribers of new publications?`)) return
    setNotifying(tier)
    setNotifyMsg("")
    const result = await syncAndNotify(tier)
    setNotifyMsg(result?.message ?? "")
    setNotifying("")
    if (result?.ok) router.refresh()
  }

  async function handleDelete() {
    if (!tier) return
    if (!window.confirm(`Remove the Data Room mapping for "${tier}"?`)) return
    setDeleting(tier)
    setDeleteMsg("")
    const result = await deleteLevelRoomMapping(tier)
    setDeleteMsg(result?.message ?? "")
    setDeleting("")
    if (result?.ok) router.refresh()
  }

  async function handlePrepareLinks() {
    if (!tier) return
    setPreparing(tier)
    setPrepareMsg("")
    const result = await prepareDocumentLinksForLevel(tier)
    setPrepareMsg(result?.message ?? "")
    setPreparing("")
    if (result?.ok) router.refresh()
  }

  async function handleAutoLink() {
    if (!tier) return
    setAutoLinking(tier)
    setAutoLinkMsg("")
    const result = await autoLinkPublicationsByPapermarkId(tier)
    setAutoLinkMsg(result?.message ?? "")
    setAutoLinking("")
    if (result?.ok) router.refresh()
  }

  async function handleGenerateDetails() {
    if (!tier) return
    setGenerating(tier)
    setGenerateMsg("")
    const result = await generateMissingDetails(tier)
    setGenerateMsg(result?.message ?? "")
    setGenerating("")
    if (result?.ok) router.refresh()
  }

  return (
    <div className="mt-6 pt-6 border-t border-border">
      <p className={label}>Quick actions on an existing mapping</p>
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={tier}
          onChange={(e) => setTier(e.target.value)}
          className={`${field} max-w-xs`}
        >
          <option value="">Select a mapped level</option>
          {mappedTiers.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleSync}
          disabled={!tier || syncing !== ""}
          className={btnSecondary}
        >
          {syncing ? "Syncing..." : "Sync documents"}
        </button>
        <button
          type="button"
          onClick={handleSyncAndNotify}
          disabled={!tier || notifying !== ""}
          className={btnSecondary}
        >
          {notifying ? "Syncing & notifying..." : "Sync and notify"}
        </button>
        <button
          type="button"
          onClick={handlePrepareLinks}
          disabled={!tier || preparing !== ""}
          className={btnSecondary}
        >
          {preparing ? "Preparing links..." : "Prepare document links"}
        </button>
        <button
          type="button"
          onClick={handleAutoLink}
          disabled={!tier || autoLinking !== ""}
          className={btnSecondary}
        >
          {autoLinking ? "Linking..." : "Auto-link publications"}
        </button>
        <button
          type="button"
          onClick={handleGenerateDetails}
          disabled={!tier || generating !== ""}
          className={btnSecondary}
        >
          {generating ? "Generating..." : "Generate missing details"}
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={!tier || deleting !== ""}
          className="border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 transition-colors disabled:opacity-50 cursor-pointer"
        >
          {deleting ? "Removing..." : "Remove mapping"}
        </button>
      </div>
      {syncMsg && <p className="text-sm text-foreground/70 mt-2">{syncMsg}</p>}
      {notifyMsg && <p className="text-sm text-foreground/70 mt-2">{notifyMsg}</p>}
      {prepareMsg && <p className="text-sm text-foreground/70 mt-2">{prepareMsg}</p>}
      {autoLinkMsg && <p className="text-sm text-foreground/70 mt-2">{autoLinkMsg}</p>}
      {generateMsg && <p className="text-sm text-foreground/70 mt-2">{generateMsg}</p>}
      {deleteMsg && <p className="text-sm text-foreground/70 mt-2">{deleteMsg}</p>}
      <WatermarkUpdateAction />
    </div>
  )
}

function WatermarkUpdateAction() {
  const [step, setStep] = useState<"idle" | "previewing" | "previewed" | "applying">("idle")
  const [msg, setMsg] = useState("")
  const [previewDetail, setPreviewDetail] = useState("")
  const router = useRouter()

  async function handlePreview() {
    setStep("previewing")
    setMsg("")
    setPreviewDetail("")
    const result = await previewSubscriberWatermarkUpdate()
    setMsg(result?.message ?? "")
    if (result?.preview) {
      const lines: string[] = []
      if (result.preview.eligible.length > 0)
        lines.push(`${result.preview.eligible.length} link${result.preview.eligible.length === 1 ? "" : "s"} will be updated to Subscriber Edition watermark.`)
      if (result.preview.alreadyCorrect > 0)
        lines.push(`${result.preview.alreadyCorrect} already correct — will be skipped.`)
      for (const ex of result.preview.excluded)
        lines.push(`${ex.count} excluded: ${ex.reason}.`)
      setPreviewDetail(lines.join("\n"))
      setStep("previewed")
    } else {
      setStep("idle")
    }
  }

  async function handleApply() {
    if (!window.confirm(
      "Apply Subscriber Edition watermark to all eligible paid-subscriber links?\n\n" +
      "This updates only the watermark text and appearance. URLs, expiry, downloads, " +
      "permissions and verification settings are preserved. No emails are sent.\n\n" +
      "The Complimentary Review Data Room link is excluded."
    )) return
    setStep("applying")
    setMsg("")
    const result = await applySubscriberWatermarkUpdate()
    setMsg(result?.message ?? "")
    setStep("idle")
    setPreviewDetail("")
    if (result?.ok) router.refresh()
  }

  return (
    <div className="mt-4 pt-4 border-t border-border/50">
      <h4 className="text-sm font-medium text-foreground mb-2">Subscriber watermark update</h4>
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={handlePreview}
          disabled={step === "previewing" || step === "applying"}
          className={btnSecondary}
        >
          {step === "previewing" ? "Checking links..." : "Preview subscriber watermark update"}
        </button>
        {(step === "previewed" || step === "applying") && (
          <button
            type="button"
            onClick={handleApply}
            disabled={step === "applying"}
            className={btnSecondary}
          >
            {step === "applying" ? "Applying..." : "Apply subscriber watermark update"}
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-1">
        Updates only paid-subscriber link watermarks to the Subscriber Edition format. Does not change URLs, expiry, downloads or send emails. Excludes prospect/review links.
      </p>
      {msg && <p className="text-sm text-foreground/70 mt-2">{msg}</p>}
      {previewDetail && (
        <pre className="text-xs text-muted-foreground mt-2 whitespace-pre-wrap font-mono bg-black/5 p-3 rounded">
          {previewDetail}
        </pre>
      )}

      <div className="mt-4 pt-4 border-t border-border/30">
        <h4 className="text-sm font-medium text-foreground mb-2">Cover and version label checklist</h4>
        <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
          <li>Prospect PDFs use <code className="font-mono">Version: Complimentary Review Copy</code></li>
          <li>Paid-subscriber PDFs use <code className="font-mono">Version: Subscriber Edition</code></li>
          <li>Internal masters remain private and are never shared</li>
        </ul>
      </div>

      <LegacyAuditSection />
    </div>
  )
}

function LegacyAuditSection() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState("")
  const [detail, setDetail] = useState("")
  const router = useRouter()

  async function handle() {
    setBusy(true)
    setMsg("")
    setDetail("")
    const result = await auditLegacyOpenEditions()
    setMsg(result?.message ?? "")
    if (result?.audit) {
      const lines = result.audit.records.map((r) =>
        `${r.title} — ${r.safe ? "archived" : `kept (${r.referencedBy.join(", ") || r.status})`}`
      )
      if (lines.length > 0) setDetail(lines.join("\n"))
    }
    setBusy(false)
    if (result?.ok) router.refresh()
  }

  return (
    <div className="mt-4 pt-4 border-t border-border/30">
      <h4 className="text-sm font-medium text-foreground mb-2">Legacy Open Edition audit</h4>
      <div className="flex items-center gap-3">
        <button type="button" onClick={handle} disabled={busy} className={btnSecondary}>
          {busy ? "Auditing..." : "Audit legacy OPEN records"}
        </button>
        <span className="text-xs text-muted-foreground">
          Archives unreferenced OPEN documents. Referenced records are left unchanged.
        </span>
      </div>
      {msg && <p className="text-sm text-foreground/70 mt-2">{msg}</p>}
      {detail && (
        <pre className="text-xs text-muted-foreground mt-2 whitespace-pre-wrap font-mono bg-black/5 p-3 rounded">
          {detail}
        </pre>
      )}
    </div>
  )
}

export function CreatePublicationButton({
  documentRowId,
  publicTier,
}: {
  documentRowId: string
  publicTier: string
}) {
  const [busy, setBusy] = useState(false)
  const router = useRouter()

  async function handleCreate() {
    setBusy(true)
    const result = await createPublicationForDocument(documentRowId, publicTier)
    if (result.publicationId) {
      router.push(`/admin/documents/${result.publicationId}`)
    } else {
      setBusy(false)
      alert(result.message || "Could not create publication.")
    }
  }

  return (
    <button
      type="button"
      onClick={handleCreate}
      disabled={busy}
      className="text-xs text-accent hover:text-accent-hover transition-colors disabled:opacity-50 cursor-pointer"
    >
      {busy ? "Creating..." : "Create publication details"}
    </button>
  )
}

export function LinkExistingPublication({
  documentRowId,
}: {
  documentRowId: string
}) {
  const [show, setShow] = useState(false)
  const [pubId, setPubId] = useState("")
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState("")
  const router = useRouter()

  async function handleLink() {
    if (!pubId.trim()) return
    setBusy(true)
    setMsg("")
    const result = await linkPublicationToSyncedDocument(documentRowId, pubId.trim())
    setMsg(result?.message ?? "")
    setBusy(false)
    if (result?.ok) {
      setShow(false)
      router.refresh()
    }
  }

  if (!show) {
    return (
      <button
        type="button"
        onClick={() => setShow(true)}
        className="text-[0.65rem] text-muted-foreground hover:text-foreground transition-colors cursor-pointer ml-2"
      >
        Link existing
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 ml-2">
      <input
        type="text"
        placeholder="Publication ID"
        value={pubId}
        onChange={(e) => setPubId(e.target.value)}
        className="border border-border bg-background px-2 py-1 text-[0.65rem] w-56"
      />
      <button
        type="button"
        onClick={handleLink}
        disabled={busy || !pubId.trim()}
        className="text-[0.65rem] text-accent hover:text-accent-hover disabled:opacity-50 cursor-pointer"
      >
        {busy ? "..." : "Link"}
      </button>
      <button
        type="button"
        onClick={() => { setShow(false); setMsg("") }}
        className="text-[0.65rem] text-muted-foreground cursor-pointer"
      >
        Cancel
      </button>
      {msg && <span className="text-[0.65rem] text-red-600">{msg}</span>}
    </span>
  )
}

export function GenerateDocumentDetailsButton({
  documentRowId,
}: {
  documentRowId: string
}) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState("")
  const router = useRouter()

  async function handleGenerate() {
    setBusy(true)
    setMsg("")
    const result = await generateMissingDetailsForDocument(documentRowId)
    setMsg(result?.message ?? "")
    setBusy(false)
    if (result?.ok) router.refresh()
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={handleGenerate}
        disabled={busy}
        className="text-[0.65rem] text-accent hover:text-accent-hover transition-colors disabled:opacity-50 cursor-pointer ml-2"
      >
        {busy ? "..." : "Generate missing details"}
      </button>
      {msg && <span className="text-[0.65rem] text-foreground/70">{msg}</span>}
    </span>
  )
}
