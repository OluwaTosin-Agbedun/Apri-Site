/**
 * The on-screen selection in one edition's "Who may open this edition" panel.
 *
 * Pure and dependency-free, so the client component can use it and the rules
 * are tested directly. Nothing here saves, applies or calls a server: it only
 * computes what one panel shows. Each panel keeps its own selection, and every
 * function returns a new set rather than changing the one it was given, so a
 * bulk change in one edition's panel can never reach another's. Saving is
 * still the separate Save -> Preview -> Apply workflow.
 */

export const WITHDRAW_TO_END_ACCESS_HINT =
  "To end access to a published edition, use Withdraw from Complimentary Review instead."

/**
 * Every address one panel offers, sorted and de-duplicated: the address book,
 * the edition's saved recipients, and anything added on screen.
 */
export function selectableAddresses(
  addressBook: readonly string[],
  saved: readonly string[],
  addedOnScreen: Iterable<string>,
): string[] {
  const all = new Set<string>()
  for (const list of [addressBook, saved, [...addedOnScreen]]) {
    for (const value of list) {
      const email = (value ?? "").trim().toLowerCase()
      if (email) all.add(email)
    }
  }
  return [...all].sort()
}

/** A new selection holding every address the panel offers. */
export function selectAll(addresses: readonly string[]): Set<string> {
  return new Set(addresses)
}

/** A new, empty selection. The panel's saved list is untouched until Save. */
export function unselectAll(): Set<string> {
  return new Set()
}

/** A new selection with one address ticked or unticked. */
export function toggleAddress(
  selection: ReadonlySet<string>,
  email: string,
  checked: boolean,
): Set<string> {
  const next = new Set(selection)
  if (checked) next.add(email)
  else next.delete(email)
  return next
}

export function sameSelection(a: Iterable<string>, b: Iterable<string>): boolean {
  const left = new Set(a)
  const right = new Set(b)
  if (left.size !== right.size) return false
  for (const value of left) if (!right.has(value)) return false
  return true
}

/** "3 of 12 selected". */
export function selectionSummary(selectedCount: number, totalCount: number): string {
  return `${selectedCount} of ${totalCount} selected`
}

export type SelectionGuard = {
  /** Whether Save may be offered for this selection. */
  canSave: boolean
  /** Shown beside the selection, or null when there is nothing to say. */
  warning: string | null
}

/**
 * Whether the current selection may be saved.
 *
 * An empty selection is allowed on screen -- Unselect all is how a smaller
 * group is started -- but it can never be saved for an edition that has a
 * Papermark link, because Papermark treats an empty allow list as open to
 * anyone. The server refuses it too; this only explains why before anyone
 * tries.
 */
export function selectionGuard(args: {
  selectedCount: number
  hasLink: boolean
  published: boolean
}): SelectionGuard {
  if (args.selectedCount > 0) return { canSave: true, warning: null }
  if (args.hasLink) {
    return {
      canSave: false,
      warning:
        "No one is selected. An edition with a Papermark link must keep at least one recipient, because " +
        "Papermark treats an empty list as open to anyone. Select at least one person to save." +
        (args.published ? ` ${WITHDRAW_TO_END_ACCESS_HINT}` : ""),
    }
  }
  return {
    canSave: true,
    warning:
      "No one is selected. Saving leaves this edition with no recipients: it cannot be linked or granted until some are chosen.",
  }
}
