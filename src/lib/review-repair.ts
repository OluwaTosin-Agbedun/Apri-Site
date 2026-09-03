/**
 * Fixed-slot mapping repair — the decision, with no database in the way.
 *
 * Kept separate from the server action so the rule can be tested directly.
 * This module deliberately imports nothing: the caller reads the slot and its
 * candidates, this decides what should happen, and the caller performs it.
 *
 * The fault it exists to fix: a fixed slot can hold its publication record and
 * `slot_key` while its `papermark_document_id` is null. The Phase 3 sync
 * candidates were already in the database, so a later sync compared each file's
 * version key, found nothing changed, took the no-op branch, and never attached
 * anything to the slot. The slot then reported "No Papermark document is mapped
 * to this slot yet" indefinitely and its secure-link buttons stayed disabled,
 * however many times sync ran.
 */

/** One recognised Data Room document that could back a slot. */
export type RepairCandidate = {
  id: string
  documentId: string
  dataroomId: string
  cleanTitle: string
  rawFilename: string
  versionKey: string
  folderPath: string | null
  numPages: number | null
  /** Whether the file is still in the Data Room. */
  isPresent: boolean
  /** 'pending' | 'approved' | 'ignored' | ... */
  syncStatus: string
}

export type RepairStatus =
  | 'already-mapped'
  | 'repaired'
  | 'ambiguous'
  | 'no-candidate'
  | 'no-slot'

/**
 * What the caller should do about one slot.
 *
 * `map` is the only outcome that writes a mapping, and it names exactly one
 * candidate. Ambiguity produces `ambiguous` with the competing documents so a
 * human chooses, never a guess.
 */
export type RepairDecision = {
  slotKey: string
  status: RepairStatus
  reason: string
  /** Set only when status is 'map'-worthy, i.e. 'repaired'. */
  candidate?: RepairCandidate
  /** Set only when status is 'ambiguous'. */
  options?: RepairCandidate[]
  /** Set when the slot was already mapped, for reporting. */
  currentDocumentId?: string
}

/** A candidate is usable if it is still in the room and not set aside. */
export function isUsableCandidate(c: RepairCandidate): boolean {
  return c.isPresent && c.syncStatus !== 'ignored' && c.documentId.trim() !== ''
}

/**
 * Narrows a candidate list to the distinct usable documents for one series.
 *
 * Deduplicated by Papermark document id, because the same file listed twice is
 * one document and must not read as ambiguity.
 */
export function usableCandidatesForSlot(
  slotKey: string,
  candidates: RepairCandidate[],
): RepairCandidate[] {
  const byDoc = new Map<string, RepairCandidate>()
  for (const c of candidates) {
    if (!isUsableCandidate(c)) continue
    if (!byDoc.has(c.documentId)) byDoc.set(c.documentId, c)
  }
  return [...byDoc.values()]
}

/**
 * Decides whether a fixed slot should be repaired, and how.
 *
 * The order of these checks is the safety guarantee:
 *
 *  1. A slot that does not exist yet cannot be repaired.
 *  2. A slot that already has a current document is left alone. This is what
 *     makes the pass idempotent and stops a repair silently replacing a live
 *     edition — sync may run any number of times without effect.
 *  3. Only a single unambiguous match is applied.
 *  4. Several matches produce a question, not a choice.
 *  5. No match produces the specific reason, not a generic failure.
 */
export function decideSlotRepair(args: {
  slotKey: string
  slotExists: boolean
  currentDocumentId: string | null
  candidates: RepairCandidate[]
}): RepairDecision {
  const { slotKey, slotExists, currentDocumentId, candidates } = args

  if (!slotExists) {
    return {
      slotKey,
      status: 'no-slot',
      reason: `Slot ${slotKey} does not exist yet. Use "Initialise fixed slots" first.`,
    }
  }

  const current = (currentDocumentId ?? '').trim()
  if (current) {
    return {
      slotKey,
      status: 'already-mapped',
      reason: `${slotKey} already has a mapped document.`,
      currentDocumentId: current,
    }
  }

  const usable = usableCandidatesForSlot(slotKey, candidates)

  if (usable.length === 0) {
    return {
      slotKey,
      status: 'no-candidate',
      reason:
        `No recognised ${slotKey} document was found in the Complimentary Review Data Room. ` +
        `Check that a ${slotKey} PDF is present and that its filename or folder identifies ` +
        `the series, then sync again.`,
    }
  }

  if (usable.length > 1) {
    return {
      slotKey,
      status: 'ambiguous',
      reason:
        `${usable.length} recognised ${slotKey} documents were found, so the mapping is ` +
        `ambiguous. Choose the correct one with "Use this document".`,
      options: usable,
    }
  }

  const only = usable[0]!
  return {
    slotKey,
    status: 'repaired',
    reason: `${slotKey} mapped to "${only.cleanTitle || only.rawFilename}".`,
    candidate: only,
  }
}

/** One short line summarising a repair pass, for the sync result message. */
export function summariseRepair(decisions: RepairDecision[]): string {
  const pick = (s: RepairStatus) => decisions.filter((d) => d.status === s)
  const names = (ds: RepairDecision[]) => ds.map((d) => d.slotKey).join(', ')

  const parts: string[] = []
  const repaired = pick('repaired')
  const ambiguous = pick('ambiguous')
  const missing = pick('no-candidate')

  if (repaired.length > 0) parts.push(`mapped ${names(repaired)}`)
  if (ambiguous.length > 0) parts.push(`${names(ambiguous)} ambiguous - choose below`)
  if (missing.length > 0) parts.push(`no document found for ${names(missing)}`)

  return parts.join('; ')
}
