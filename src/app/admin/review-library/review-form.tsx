"use client"

import { useActionState, useState } from "react"
import { useRouter } from "next/navigation"
import {
  saveReviewLibrarySettings,
  saveReviewDataRoom,
  fetchAvailableReviewDataRooms,
  syncReviewLibrary,
  repairMissingMappings,
  ensureFixedSlots,
  updateSlotSecureLink,
  createSlotSecureLink,
  verifySlotSecureLink,
  preparePendingSecureLink,
  makeVersionCurrent,
  generateSlotDetails,
  mapCandidateToCard,
  ignoreCandidate,
  saveReviewItemDetails,
} from "@/app/actions/review-library"
import type { FormState } from "@/lib/definitions"
import { PublicationTitleEditor } from "./recipients-form"

const field =
  "w-full border border-border bg-background p-3 text-sm focus:outline-none focus:border-accent"
const label =
  "block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2"
const btnPrimary =
  "bg-foreground text-background px-6 py-3 text-sm font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50 cursor-pointer"
const btnSecondary =
  "border border-border px-4 py-2 text-sm hover:bg-black/5 transition-colors disabled:opacity-50 cursor-pointer"

const SLOT_LABELS: Record<string, string> = {
  MIN: "Monthly Intelligence Note",
  AIU: "Athena Intelligence Update",
  PLM: "Political Landscape Monitor",
}

type ReviewSlot = {
  id: string
  publicationId: string
  slotKey: string
  displayOrder: number
  isActive: boolean
  publicationType: string
  description: string
  frequency: string
  audience: string
  secureLinkUrl: string
  secureLinkId: string | null
  secureLinkDocumentId: string | null
  secureLinkVerifiedAt: string | null
  papermarkDocumentId: string | null
  papermarkDataroomId: string | null
  lastSyncedAt: string | null
  ownerEditedFields: string[]
  pendingDocumentId: string | null
  pendingCleanTitle: string | null
  pendingVersionKey: string | null
  pendingDetectedAt: string | null
  pendingSecureLinkId: string | null
  pendingSecureLinkUrl: string | null
  pendingSecureLinkDocumentId: string | null
  pendingSecureLinkVerifiedAt: string | null
  pubTitle: string
  series: string
  slug: string
  /** The Chancellor-approved title, where one has been set for this slot. */
  approvedTitle: string | null
}

type Candidate = {
  id: string
  papermarkDocumentId: string
  rawFilename: string
  cleanTitle: string
  detectedSeries: string
  detectedEditionDate: string | null
  syncStatus: string
  numPages: number | null
  firstSeenAt: string
  lastSeenAt: string
  isPresent: boolean
}

export default function ReviewLibraryForm({
  enabled,
  dataroomId,
  lastSyncAt,
  lastSyncResult,
  slots,
  candidates,
}: {
  enabled: boolean
  dataroomId: string
  lastSyncAt: string
  lastSyncResult: string
  slots: ReviewSlot[]
  candidates: Candidate[]
}) {
  return (
    <div className="space-y-8">
      <EnableSection enabled={enabled} slots={slots} />
      {slots.length === 0 && <SetupSection />}
      <DataRoomSection dataroomId={dataroomId} />
      <SyncSection
        dataroomId={dataroomId}
        lastSyncAt={lastSyncAt}
        lastSyncResult={lastSyncResult}
      />
      {candidates.length > 0 && (
        <CandidatesSection candidates={candidates} slots={slots} />
      )}
      {slots.map((slot) => (
        <SlotCard key={slot.slotKey} slot={slot} candidates={candidates} />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Enable / Disable
// ---------------------------------------------------------------------------

function EnableSection({ enabled, slots }: { enabled: boolean; slots: ReviewSlot[] }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    saveReviewLibrarySettings,
    {},
  )

  const missingSlots = ['MIN', 'AIU', 'PLM'].filter(
    (k) => !slots.find((s) => s.slotKey === k),
  )
  const missingLinks = slots.filter((s) => !s.secureLinkUrl)
  const missingDocs = slots.filter((s) => !s.publicationId)

  return (
    <div className="border border-border bg-card/30 p-6">
      <h3 className="font-serif text-lg text-foreground mb-4">Library Status</h3>
      <form action={formAction} className="space-y-4">
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            name="enabled"
            id="review-enabled"
            defaultChecked={enabled}
            className="accent-accent"
          />
          <label htmlFor="review-enabled" className="text-sm text-foreground">
            Enable complimentary review library
          </label>
        </div>

        {(missingSlots.length > 0 || missingLinks.length > 0 || missingDocs.length > 0) && (
          <div className="text-xs text-amber-600 space-y-1">
            {missingSlots.length > 0 && (
              <p>Missing slots: {missingSlots.join(', ')}. Use "Initialise fixed slots" below.</p>
            )}
            {missingDocs.length > 0 && (
              <p>Missing mapped document: {missingDocs.map((s) => s.slotKey).join(', ')}.</p>
            )}
            {missingLinks.length > 0 && (
              <p>Missing secure link: {missingLinks.map((s) => s.slotKey).join(', ')}.</p>
            )}
          </div>
        )}

        <div className="flex items-center gap-4">
          <button type="submit" disabled={pending} className={btnPrimary}>
            {pending ? "Saving..." : "Save"}
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

// ---------------------------------------------------------------------------
// One-time setup: ensure fixed slots
// ---------------------------------------------------------------------------

function SetupSection() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState("")
  const router = useRouter()

  async function handleInit() {
    setBusy(true)
    setMsg("")
    const result = await ensureFixedSlots()
    setMsg(result?.message ?? "")
    setBusy(false)
    if (result?.ok) router.refresh()
  }

  return (
    <div className="border border-amber-300 bg-amber-50 p-6">
      <h3 className="font-serif text-lg text-amber-900 mb-3">Fixed Slots Not Found</h3>
      <p className="text-sm text-amber-800 mb-4">
        The review library uses three fixed slots: Monthly Intelligence Note (MIN),
        Athena Intelligence Update (AIU) and Political Landscape Monitor (PLM).
        Click below to create them from existing publications.
      </p>
      <button type="button" onClick={handleInit} disabled={busy} className={btnPrimary}>
        {busy ? "Initialising..." : "Initialise fixed slots"}
      </button>
      {msg && <p className="text-sm mt-2 text-amber-800">{msg}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Data Room selector
// ---------------------------------------------------------------------------

function DataRoomSection({ dataroomId }: { dataroomId: string }) {
  const [rooms, setRooms] = useState<{ id: string; name: string; documentCount: number }[]>([])
  const [selected, setSelected] = useState(dataroomId)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState("")
  const router = useRouter()

  async function loadRooms() {
    setLoading(true)
    setMsg("")
    const result = await fetchAvailableReviewDataRooms()
    if (result.ok) {
      setRooms(result.rooms)
    } else {
      setMsg(result.message)
    }
    setLoading(false)
  }

  async function handleSave() {
    if (!selected) return
    setSaving(true)
    setMsg("")
    const result = await saveReviewDataRoom(selected)
    setMsg(result?.message ?? "")
    setSaving(false)
    if (result?.ok) router.refresh()
  }

  return (
    <div className="border border-border bg-card/30 p-6">
      <h3 className="font-serif text-lg text-foreground mb-2">
        Papermark Data Room (API sync)
      </h3>
      <p className="text-sm text-foreground/70 mb-4">
        Select the Complimentary Review Data Room for document synchronisation.
        This Data Room is used only for backend sync — it is not shown to visitors.
      </p>
      {dataroomId && (
        <p className="text-xs text-muted-foreground mb-3">
          Current Data Room ID: <code className="bg-black/5 px-1 py-0.5">{dataroomId}</code>
        </p>
      )}
      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          {rooms.length > 0 ? (
            <select value={selected} onChange={(e) => setSelected(e.target.value)} className={field}>
              <option value="">Choose a Data Room...</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.documentCount} docs)
                </option>
              ))}
            </select>
          ) : (
            <button type="button" onClick={loadRooms} disabled={loading} className={btnSecondary}>
              {loading ? "Loading..." : "Load Data Rooms from Papermark"}
            </button>
          )}
        </div>
        {rooms.length > 0 && (
          <button type="button" onClick={handleSave} disabled={!selected || saving} className={btnPrimary}>
            {saving ? "Saving..." : "Save Data Room"}
          </button>
        )}
      </div>
      {msg && <p className="text-sm mt-2 text-foreground/70">{msg}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

function SyncSection({
  dataroomId,
  lastSyncAt,
  lastSyncResult,
}: {
  dataroomId: string
  lastSyncAt: string
  lastSyncResult: string
}) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState("")
  const [repairBusy, setRepairBusy] = useState(false)
  const [repairMsg, setRepairMsg] = useState("")
  const router = useRouter()

  async function handleSync() {
    setBusy(true)
    setMsg("")
    const result = await syncReviewLibrary()
    setMsg(result?.message ?? "")
    setBusy(false)
    if (result?.ok) router.refresh()
  }

  async function handleRepair() {
    setRepairBusy(true)
    setRepairMsg("")
    const result = await repairMissingMappings()
    setRepairMsg(result?.message ?? "")
    setRepairBusy(false)
    router.refresh()
  }

  return (
    <div className="border border-border bg-card/30 p-6">
      <h3 className="font-serif text-lg text-foreground mb-2">
        Sync Documents
      </h3>
      <p className="text-sm text-foreground/70 mb-4">
        Fetch documents from the selected Data Room and detect new editions.
        This does not change the public website — new versions are held for your review.
      </p>
      {lastSyncAt && (
        <p className="text-xs text-muted-foreground mb-2">
          Last sync: {new Date(lastSyncAt).toLocaleString()}
          {lastSyncResult && <> &mdash; {lastSyncResult}</>}
        </p>
      )}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={handleSync}
          disabled={busy || !dataroomId}
          className={btnPrimary}
        >
          {busy ? "Syncing..." : "Sync"}
        </button>
        <button
          type="button"
          onClick={handleRepair}
          disabled={repairBusy}
          className={btnSecondary}
        >
          {repairBusy ? "Repairing..." : "Repair missing mappings"}
        </button>
        {!dataroomId && (
          <span className="text-xs text-amber-600">Select a Data Room first.</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-2">
        Sync already reattaches any slot whose Papermark document is missing when
        exactly one recognised document matches. Use Repair on its own after
        renaming a file or removing a duplicate.
      </p>
      {msg && (
        <p className={`text-sm mt-3 ${msg.startsWith("Synced") ? "text-accent" : "text-red-600"}`}>
          {msg}
        </p>
      )}
      {repairMsg && (
        <p className={`text-sm mt-2 ${repairMsg.startsWith("Repair") || repairMsg.startsWith("All three") ? "text-accent" : "text-red-600"}`}>
          {repairMsg}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

function CandidatesSection({
  candidates,
  slots,
}: {
  candidates: Candidate[]
  slots: ReviewSlot[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState("")

  const pendingCandidates = candidates.filter((c) => c.syncStatus === 'pending' && c.isPresent)

  async function handleMap(candidateId: string, slotKey: string) {
    setBusy(candidateId)
    setMsg("")
    const result = await mapCandidateToCard(candidateId, slotKey)
    setMsg(result?.message ?? "")
    setBusy(null)
    if (result?.ok) router.refresh()
  }

  async function handleIgnore(candidateId: string) {
    setBusy(candidateId)
    setMsg("")
    const result = await ignoreCandidate(candidateId)
    setMsg(result?.message ?? "")
    setBusy(null)
    if (result?.ok) router.refresh()
  }

  if (pendingCandidates.length === 0) return null

  const unmappedSlots = slots.filter((s) => !s.papermarkDocumentId)

  return (
    <div className="border border-border bg-card/30 p-6">
      <h3 className="font-serif text-lg text-foreground mb-4">
        Pending Candidates
      </h3>
      {msg && <p className="text-sm mb-4 text-foreground/70">{msg}</p>}
      <div className="space-y-3">
        {pendingCandidates.map((c) => (
          <div key={c.id} className="border border-border/50 bg-background p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{c.rawFilename}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {c.detectedSeries ? (
                    <span className="font-medium text-accent">{c.detectedSeries}</span>
                  ) : (
                    <span className="text-amber-600">Unrecognised</span>
                  )}
                  {c.detectedEditionDate && <> &middot; {c.detectedEditionDate}</>}
                  {c.numPages != null && <> &middot; {c.numPages} pages</>}
                </p>
              </div>
              <span className="shrink-0 inline-flex items-center px-2 py-1 text-xs font-medium bg-amber-100 text-amber-800">
                Pending
              </span>
            </div>
            <div className="mt-3 flex items-center gap-3 flex-wrap">
              {c.detectedSeries && unmappedSlots.find((s) => s.slotKey === c.detectedSeries) && (
                <button
                  type="button"
                  onClick={() => handleMap(c.id, c.detectedSeries)}
                  disabled={busy === c.id}
                  className="text-xs text-accent hover:text-accent-hover transition-colors disabled:opacity-50 cursor-pointer"
                >
                  Map to {SLOT_LABELS[c.detectedSeries] ?? c.detectedSeries}
                </button>
              )}
              <button
                type="button"
                onClick={() => handleIgnore(c.id)}
                disabled={busy === c.id}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 cursor-pointer"
              >
                Ignore
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Slot Card
// ---------------------------------------------------------------------------

function SlotCard({
  slot,
  candidates,
}: {
  slot: ReviewSlot
  candidates: Candidate[]
}) {
  const action = saveReviewItemDetails.bind(null, slot.id)
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {})
  const [editMode, setEditMode] = useState(false)
  const [linkUrl, setLinkUrl] = useState(slot.secureLinkUrl)
  const [linkBusy, setLinkBusy] = useState(false)
  const [linkMsg, setLinkMsg] = useState("")
  const [linkOk, setLinkOk] = useState(false)
  const [manualMode, setManualMode] = useState(false)
  const [pendBusy, setPendBusy] = useState(false)
  const [pendMsg, setPendMsg] = useState("")
  const [genBusy, setGenBusy] = useState(false)
  const [makeBusy, setMakeBusy] = useState(false)
  const router = useRouter()

  async function handleSaveLink() {
    setLinkBusy(true)
    setLinkMsg("")
    const result = await updateSlotSecureLink(slot.slotKey, linkUrl)
    setLinkMsg(result?.message ?? "")
    setLinkOk(!!result?.ok)
    setLinkBusy(false)
    if (result?.ok) router.refresh()
  }

  async function handleCreateLink() {
    setLinkBusy(true)
    setLinkMsg("")
    const result = await createSlotSecureLink(slot.slotKey)
    setLinkMsg(result?.message ?? "")
    setLinkOk(!!result?.ok)
    setLinkBusy(false)
    if (result?.ok) router.refresh()
  }

  async function handleVerifyLink() {
    setLinkBusy(true)
    setLinkMsg("")
    const result = await verifySlotSecureLink(slot.slotKey)
    setLinkMsg(result?.message ?? "")
    setLinkOk(!!result?.ok)
    setLinkBusy(false)
    if (result?.ok) router.refresh()
  }

  async function handlePreparePendingLink() {
    setPendBusy(true)
    setPendMsg("")
    const result = await preparePendingSecureLink(slot.slotKey)
    setPendMsg(result?.message ?? "")
    setPendBusy(false)
    if (result?.ok) router.refresh()
  }

  async function handleGenerate() {
    setGenBusy(true)
    const result = await generateSlotDetails(slot.slotKey)
    setGenBusy(false)
    if (result?.ok) router.refresh()
  }

  async function handleMakeCurrent() {
    if (!window.confirm(`Make the pending version current for ${SLOT_LABELS[slot.slotKey]}? This replaces the existing edition.`)) return
    setMakeBusy(true)
    const result = await makeVersionCurrent(slot.slotKey)
    setMakeBusy(false)
    if (result?.ok) router.refresh()
  }

  const hasSecureLink = !!slot.secureLinkUrl
  const hasPending = !!slot.pendingDocumentId
  const hasDoc = !!slot.papermarkDocumentId

  // The slot stores only the Papermark document id; the filename, page count
  // and folder live on the sync candidate, which is the single record of what
  // is actually in the Data Room. Reading them from there rather than copying
  // them onto the slot keeps one source of truth.
  const mappedCandidate = candidates.find(
    (c) => c.papermarkDocumentId === slot.papermarkDocumentId,
  )

  // Recognised, still-present documents for this series -- what a repair would
  // choose between.
  const slotOptions = candidates.filter(
    (c) => c.detectedSeries === slot.slotKey && c.isPresent && c.syncStatus !== 'ignored',
  )

  // Ready means the API confirmed this exact link targets the document the slot
  // is mapped to. A URL alone is not ready: it may point at a stale edition, or
  // at the whole Data Room.
  const linkReady =
    hasSecureLink &&
    !!slot.secureLinkVerifiedAt &&
    !!slot.secureLinkDocumentId &&
    slot.secureLinkDocumentId === slot.papermarkDocumentId

  const linkStale =
    hasSecureLink && !!slot.secureLinkDocumentId &&
    slot.secureLinkDocumentId !== slot.papermarkDocumentId

  const pendingLinkReady =
    !!slot.pendingSecureLinkId &&
    !!slot.pendingSecureLinkUrl &&
    !!slot.pendingSecureLinkVerifiedAt &&
    slot.pendingSecureLinkDocumentId === slot.pendingDocumentId

  return (
    <div className="border border-border bg-card/30 p-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="font-serif text-lg text-foreground">
            {SLOT_LABELS[slot.slotKey] ?? slot.slotKey}
          </h3>
          <p className="text-sm text-foreground/70 mt-1">{slot.pubTitle}</p>
          <div className="mt-1">
            <PublicationTitleEditor
              slotKey={slot.slotKey}
              currentTitle={slot.pubTitle}
              approvedTitle={slot.approvedTitle}
              slug={slot.slug}
            />
          </div>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <span className="text-xs text-muted-foreground">
              Slot: <span className="font-medium">{slot.slotKey}</span>
            </span>
            {slot.papermarkDocumentId && (
              <span className="text-xs text-muted-foreground">
                Papermark PDF:{' '}
                <span className="font-medium">
                  {mappedCandidate?.rawFilename ?? mappedCandidate?.cleanTitle ?? slot.pubTitle}
                </span>
                {typeof mappedCandidate?.numPages === 'number' && (
                  <> &middot; {mappedCandidate.numPages} pages</>
                )}
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              Mapping: <span className="font-medium">{hasDoc ? 'Mapped' : 'Not mapped'}</span>
            </span>
            {slot.lastSyncedAt && (
              <span className="text-xs text-muted-foreground">
                Last synced: {new Date(slot.lastSyncedAt).toLocaleString()}
              </span>
            )}
          </div>
          {slot.papermarkDocumentId && (
            <p className="text-xs text-muted-foreground mt-1 font-mono break-all">
              Document ID: {slot.papermarkDocumentId}
            </p>
          )}
          {slot.secureLinkId && (
            <p className="text-xs text-muted-foreground mt-1 font-mono break-all">
              Link ID: {slot.secureLinkId}
              {slot.secureLinkVerifiedAt && (
                <span className="font-sans">
                  {' '}&middot; verified {new Date(slot.secureLinkVerifiedAt).toLocaleString()}
                </span>
              )}
            </p>
          )}
          {slot.ownerEditedFields.length > 0 && (
            <p className="text-xs text-amber-600 mt-1">
              Owner-edited: {slot.ownerEditedFields.join(', ')}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {linkReady ? (
            <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-accent/10 text-accent">
              Ready
            </span>
          ) : linkStale ? (
            <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-red-100 text-red-800">
              Error: link points elsewhere
            </span>
          ) : hasSecureLink ? (
            <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-amber-100 text-amber-800">
              Unverified
            </span>
          ) : (
            <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-amber-100 text-amber-800">
              No link
            </span>
          )}
          {hasPending && (
            <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800">
              New version
            </span>
          )}
        </div>
      </div>

      {/* Pending version */}
      {hasPending && (
        <div className="border border-blue-200 bg-blue-50 p-4 mb-4">
          <p className="text-sm text-blue-900 mb-2">
            <strong>Pending edition:</strong> {slot.pendingCleanTitle}
          </p>
          {slot.pendingDetectedAt && (
            <p className="text-xs text-blue-700 mb-2">
              Detected: {new Date(slot.pendingDetectedAt).toLocaleString()}
            </p>
          )}
          <p className="text-xs text-blue-700 font-mono break-all mb-3">
            Document ID: {slot.pendingDocumentId}
          </p>

          {pendingLinkReady ? (
            <p className="text-xs text-blue-900 mb-3">
              Secure link prepared and verified. This edition is <strong>not public yet</strong>.
            </p>
          ) : (
            <p className="text-xs text-blue-800 mb-3">
              This edition needs its own verified secure link before it can go live.
            </p>
          )}

          <div className="flex items-center gap-4 flex-wrap">
            <button
              type="button"
              onClick={handlePreparePendingLink}
              disabled={pendBusy}
              className="text-xs text-blue-700 font-medium hover:text-blue-900 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {pendBusy
                ? "Preparing..."
                : pendingLinkReady
                  ? "Re-prepare secure link"
                  : "Prepare secure link"}
            </button>
            <button
              type="button"
              onClick={handleMakeCurrent}
              disabled={makeBusy || !pendingLinkReady}
              title={pendingLinkReady ? undefined : "Prepare a verified secure link for this edition first."}
              className="text-xs text-blue-700 font-medium hover:text-blue-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              {makeBusy ? "Updating..." : "Make current"}
            </button>
          </div>
          {pendMsg && (
            <p className="text-xs mt-2 text-blue-900">{pendMsg}</p>
          )}
        </div>
      )}

      {/* Secure link */}
      <div className="border border-border/50 bg-background p-4 mb-4">
        <label className={label}>Secure Document Link</label>
        <p className="text-xs text-muted-foreground mb-3">
          APRI creates this link through the Papermark API against this slot&rsquo;s exact
          PDF, with verified-email access and the Complimentary Review watermark.
          Visitors click &ldquo;Access review copy&rdquo; on the public page to open it directly.
        </p>

        {!hasDoc && (
          <div className="border border-amber-200 bg-amber-50 p-3 mb-3">
            {slotOptions.length === 0 ? (
              <p className="text-xs text-amber-800">
                No recognised {slot.slotKey} document was found in the Complimentary
                Review Data Room. Check that a {slot.slotKey} PDF is present and that
                its filename or folder identifies the series, then run Sync again.
              </p>
            ) : slotOptions.length === 1 ? (
              <>
                <p className="text-xs text-amber-800 mb-2">
                  One recognised {slot.slotKey} document is available. Running Sync or
                  Repair missing mappings will attach it automatically.
                </p>
                <UseThisDocumentButton
                  candidateId={slotOptions[0]!.id}
                  slotKey={slot.slotKey}
                  filename={slotOptions[0]!.rawFilename || slotOptions[0]!.cleanTitle}
                />
              </>
            ) : (
              <>
                <p className="text-xs text-amber-800 mb-2">
                  {slotOptions.length} recognised {slot.slotKey} documents were found, so
                  the mapping is ambiguous and was <strong>not</strong> chosen
                  automatically. Pick the correct one:
                </p>
                <ul className="space-y-2">
                  {slotOptions.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 flex-wrap">
                      <span className="text-xs text-amber-900">
                        {c.rawFilename || c.cleanTitle}
                        {typeof c.numPages === 'number' && <> &middot; {c.numPages} pages</>}
                        {c.detectedEditionDate && <> &middot; {c.detectedEditionDate}</>}
                      </span>
                      <UseThisDocumentButton
                        candidateId={c.id}
                        slotKey={slot.slotKey}
                        filename={c.rawFilename || c.cleanTitle}
                      />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {hasSecureLink && (
          <p className="text-xs text-muted-foreground mb-3 break-all">
            Current URL:{' '}
            <a
              href={slot.secureLinkUrl}
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:text-accent-hover transition-colors"
            >
              {slot.secureLinkUrl}
            </a>
          </p>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          {!hasSecureLink ? (
            <button
              type="button"
              onClick={handleCreateLink}
              disabled={linkBusy || !hasDoc}
              className={btnSecondary}
            >
              {linkBusy ? "Creating..." : "Create secure review link"}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleVerifyLink}
                disabled={linkBusy || !hasDoc || !slot.secureLinkId}
                className={btnSecondary}
              >
                {linkBusy ? "Checking..." : "Verify/update secure review link"}
              </button>
              {linkStale && (
                <button
                  type="button"
                  onClick={handleCreateLink}
                  disabled={linkBusy || !hasDoc}
                  className={btnSecondary}
                >
                  Recreate for mapped document
                </button>
              )}
            </>
          )}
        </div>

        {linkMsg && (
          <p className={`text-xs mt-2 ${linkOk ? "text-accent" : "text-red-600"}`}>
            {linkMsg}
          </p>
        )}

        {/* Emergency fallback. A pasted URL is still verified through the
            Papermark API before the slot counts as Ready. */}
        <div className="mt-4 pt-4 border-t border-border/50">
          {!manualMode ? (
            <button
              type="button"
              onClick={() => setManualMode(true)}
              className="text-xs text-muted-foreground underline hover:text-foreground transition-colors cursor-pointer"
            >
              Emergency fallback: paste a Papermark URL manually
            </button>
          ) : (
            <>
              <label className={label}>Emergency fallback — paste URL</label>
              <p className="text-xs text-muted-foreground mb-2">
                Use this only if the API button will not work. The URL is still verified
                against Papermark as a single-document link before this slot goes public.
              </p>
              <div className="flex items-end gap-3">
                <input
                  type="url"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://..."
                  className={`${field} flex-1`}
                />
                <button type="button" onClick={handleSaveLink} disabled={linkBusy} className={btnSecondary}>
                  {linkBusy ? "..." : "Verify and save"}
                </button>
              </div>
              <button
                type="button"
                onClick={() => setManualMode(false)}
                className="text-xs text-muted-foreground mt-2 cursor-pointer hover:text-foreground transition-colors"
              >
                Hide
              </button>
            </>
          )}
        </div>
      </div>

      {/* Card details */}
      {editMode ? (
        <form action={formAction} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={label}>Publication Type</label>
              <input name="publicationType" defaultValue={slot.publicationType} className={field} />
            </div>
            <div>
              <label className={label}>Frequency</label>
              <input name="frequency" defaultValue={slot.frequency} className={field} />
            </div>
          </div>
          <div>
            <label className={label}>Description</label>
            <textarea name="description" defaultValue={slot.description} rows={4} className={field} />
          </div>
          <div>
            <label className={label}>Intended Audience</label>
            <input name="audience" defaultValue={slot.audience} className={field} />
          </div>
          <div className="flex items-center gap-4">
            <button type="submit" disabled={pending} className={btnSecondary}>
              {pending ? "Saving..." : "Save card details"}
            </button>
            <button type="button" onClick={() => setEditMode(false)} className="text-xs text-muted-foreground cursor-pointer">
              Cancel
            </button>
            {state?.message && (
              <p className={`text-sm ${state.ok ? "text-accent" : "text-red-600"}`}>
                {state.message}
              </p>
            )}
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <div>
              <span className="text-xs text-muted-foreground">Type:</span>{' '}
              <span className="text-foreground">{slot.publicationType || '—'}</span>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Frequency:</span>{' '}
              <span className="text-foreground">{slot.frequency || '—'}</span>
            </div>
          </div>
          <div className="text-sm">
            <span className="text-xs text-muted-foreground">Description:</span>{' '}
            <span className="text-foreground/80">{slot.description ? slot.description.slice(0, 200) + (slot.description.length > 200 ? '...' : '') : '—'}</span>
          </div>
          <div className="text-sm">
            <span className="text-xs text-muted-foreground">Audience:</span>{' '}
            <span className="text-foreground/80">{slot.audience || '—'}</span>
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button type="button" onClick={() => setEditMode(true)} className="text-xs text-accent hover:text-accent-hover transition-colors cursor-pointer">
              Edit details
            </button>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={genBusy}
              className="text-xs text-accent hover:text-accent-hover transition-colors disabled:opacity-50 cursor-pointer"
            >
              {genBusy ? "..." : "Generate missing details"}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Attaches one specific candidate to a fixed slot.
 *
 * Shown when a repair found several recognised documents for a series and
 * therefore refused to guess, so the choice is made explicitly here.
 */
function UseThisDocumentButton({
  candidateId,
  slotKey,
  filename,
}: {
  candidateId: string
  slotKey: string
  filename: string
}) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState("")
  const router = useRouter()

  async function handleUse() {
    if (!window.confirm(`Map "${filename}" to ${slotKey}?`)) return
    setBusy(true)
    setMsg("")
    const result = await mapCandidateToCard(candidateId, slotKey)
    setMsg(result?.message ?? "")
    setBusy(false)
    if (result?.ok) router.refresh()
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={handleUse}
        disabled={busy}
        className="text-xs font-medium text-accent hover:text-accent-hover transition-colors disabled:opacity-50 cursor-pointer"
      >
        {busy ? "Mapping..." : "Use this document"}
      </button>
      {msg && !busy && <span className="text-xs text-muted-foreground">{msg}</span>}
    </span>
  )
}
