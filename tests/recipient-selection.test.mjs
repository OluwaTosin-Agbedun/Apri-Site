/**
 * Select all / Unselect all in each edition's "Who may open this edition"
 * panel, and the empty-list safeguard.
 *
 * The selection rules live in src/lib/recipient-selection.ts, which the panel
 * uses and these tests run directly. They prove:
 *
 *  - bulk selection selects or clears exactly what the panel offers, and shows
 *    how many are selected;
 *  - it changes only that one panel's on-screen selection: nothing is saved,
 *    nothing reaches Papermark, and no other edition's panel is affected;
 *  - an empty selection may be made on screen but can never be saved or
 *    applied to an edition with a live Papermark link, and a published
 *    edition's owner is pointed to Withdraw from Complimentary Review;
 *  - editions still on the shared list keep the adoption requirement.
 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import {
  sameSelection,
  selectAll,
  selectableAddresses,
  selectionGuard,
  selectionSummary,
  toggleAddress,
  unselectAll,
  WITHDRAW_TO_END_ACCESS_HINT,
} from "../src/lib/recipient-selection.ts"
import { decideApply, decideRecipientSave, WITHDRAW_TO_END_ACCESS } from "../src/lib/edition-recipients.ts"

const ROOT = resolve(import.meta.dirname, "..")
const read = (p) => readFileSync(join(ROOT, p), "utf8")
const PANEL = "src/app/admin/review-library/edition-access-panel.tsx"

const book = ["b@example.org", "a@example.org", "c@example.org"]

describe("bulk selection", () => {
  it("offers the address book, saved recipients and anything added on screen, once each, sorted", () => {
    assert.deepEqual(
      selectableAddresses(book, ["d@example.org", "A@example.org"], ["e@example.org", "d@example.org"]),
      ["a@example.org", "b@example.org", "c@example.org", "d@example.org", "e@example.org"],
    )
  })

  it("Select all selects exactly what the panel offers", () => {
    const offered = selectableAddresses(book, [], [])
    assert.deepEqual([...selectAll(offered)].sort(), offered)
  })

  it("Unselect all clears the selection", () => {
    assert.equal(unselectAll().size, 0)
  })

  it("shows how many are selected", () => {
    assert.equal(selectionSummary(3, 12), "3 of 12 selected")
    assert.equal(selectionSummary(0, 12), "0 of 12 selected")
  })

  it("a single tick adds or removes one address", () => {
    const start = new Set(["a@example.org"])
    assert.deepEqual([...toggleAddress(start, "b@example.org", true)].sort(), ["a@example.org", "b@example.org"])
    assert.deepEqual([...toggleAddress(start, "a@example.org", false)], [])
  })

  it("an on-screen change is compared with what is saved", () => {
    assert.equal(sameSelection(["a@example.org", "b@example.org"], ["b@example.org", "a@example.org"]), true)
    assert.equal(sameSelection(["a@example.org"], []), false)
  })
})

describe("each edition's selection is its own", () => {
  it("every operation returns a new selection and never changes the one it was given", () => {
    const offered = selectableAddresses(book, [], [])
    const mine = new Set(["a@example.org"])
    const all = selectAll(offered)
    const none = unselectAll()
    const toggled = toggleAddress(mine, "b@example.org", true)
    assert.deepEqual([...mine], ["a@example.org"], "the original is untouched")
    assert.notEqual(all, mine)
    assert.notEqual(none, mine)
    assert.notEqual(toggled, mine)
  })

  it("selecting all in one edition's panel leaves another's selection exactly as it was", () => {
    const offered = selectableAddresses(book, [], [])
    const september = new Set(["a@example.org"])
    const august = new Set(["c@example.org"])
    const septemberNext = selectAll(offered)
    const augustAfter = unselectAll()
    assert.deepEqual([...august], ["c@example.org"], "a bulk change elsewhere does not reach this set")
    assert.equal(septemberNext.size, 3)
    assert.equal(augustAfter.size, 0)
    assert.deepEqual([...september], ["a@example.org"])
  })

  it("the panel keeps its selection in its own component state", () => {
    const panel = read(PANEL)
    assert.match(panel, /const \[selection, setSelection\] = useState<Set<string>>\(\(\) => new Set\(access\.recipients\)\)/)
    // One panel per edition card, keyed by edition.
    assert.match(read("src/app/admin/review-library/review-form.tsx"), /<EditionCard\s+key=\{e\.id\}/)
  })

  it("Select all and Unselect all only change the on-screen selection", () => {
    const panel = read(PANEL)
    const buttons = panel.slice(panel.indexOf("On-screen only"), panel.indexOf("selectionSummary(selection.size"))
    assert.match(buttons, /type="button"[\s\S]*onClick=\{\(\) => choose\(selectAll\(candidates\)\)\}/)
    assert.match(buttons, /type="button"[\s\S]*onClick=\{\(\) => choose\(unselectAll\(\)\)\}/)
    // Nothing that saves or reaches Papermark is called from either button.
    assert.doesNotMatch(buttons, /saveEditionRecipients|applyEditionRecipients|previewEditionRecipients|act\(/)
    const choose = panel.slice(panel.indexOf("function choose("), panel.indexOf("async function act"))
    assert.match(choose, /setSelection\(next\)/)
    assert.doesNotMatch(choose, /saveEditionRecipients|applyEditionRecipients|previewEditionRecipients/)
  })

  it("the count is announced and marks an unsaved change", () => {
    const panel = read(PANEL)
    assert.match(panel, /aria-live="polite"/)
    assert.match(panel, /selectionSummary\(selection\.size, candidates\.length\)/)
    assert.match(panel, /dirty \? " · not saved yet" : ""/)
  })
})

describe("the empty-list safeguard", () => {
  it("an empty selection may be made on screen, but not saved for a linked edition", () => {
    const g = selectionGuard({ selectedCount: 0, hasLink: true, published: false })
    assert.equal(g.canSave, false)
    assert.match(g.warning, /must keep at least one recipient/)
    assert.doesNotMatch(g.warning, /Withdraw/)
  })

  it("a published edition's owner is told to withdraw it to end access", () => {
    const g = selectionGuard({ selectedCount: 0, hasLink: true, published: true })
    assert.equal(g.canSave, false)
    assert.match(g.warning, /use Withdraw from Complimentary Review instead/)
    assert.equal(WITHDRAW_TO_END_ACCESS_HINT, WITHDRAW_TO_END_ACCESS, "the panel and the server say the same thing")
  })

  it("an unlinked draft may be saved empty, with a note that it cannot be linked or granted", () => {
    const g = selectionGuard({ selectedCount: 0, hasLink: false, published: false })
    assert.equal(g.canSave, true)
    assert.match(g.warning, /cannot be linked or granted until some are chosen/)
  })

  it("any selection of one or more needs no warning", () => {
    assert.deepEqual(selectionGuard({ selectedCount: 1, hasLink: true, published: true }), { canSave: true, warning: null })
  })

  it("the panel disables Save when the guard says so, and shows why", () => {
    const panel = read(PANEL)
    assert.match(panel, /const guard = selectionGuard\(\{ selectedCount: selection\.size, hasLink, published \}\)/)
    assert.match(panel, /disabled=\{busy \|\| !dirty \|\| !guard\.canSave\}/)
    assert.match(panel, /\{guard\.warning && \(/)
  })

  it("the server refuses to save an empty list for a published, linked edition, and says to withdraw", () => {
    const d = decideRecipientSave({ mode: "edition", hasLink: true, published: true, current: ["a@example.org"], proposed: [] })
    assert.equal(d.ok, false)
    assert.match(d.message, /use Withdraw from Complimentary Review instead/)
    assert.match(d.message, /Nothing was saved\./)
  })

  it("the server never applies an empty list to a live link, and says to withdraw", () => {
    const d = decideApply({ mode: "edition", secureLinkId: "lnk-1", desired: [], previewedHash: "x".repeat(64) })
    assert.equal(d.ok, false)
    assert.match(d.message, /never sent an empty list/)
    assert.match(d.message, /use Withdraw from Complimentary Review instead/)
  })

  it("the Papermark service refuses an empty list itself, as a last line", () => {
    const service = read("src/lib/papermark-datarooms.ts")
    const set = service.slice(service.indexOf("export async function setReviewLinkAllowList("))
    assert.match(set.slice(0, set.indexOf("return attempt(")), /if \(args\.allowList\.length === 0\)/)
  })
})

describe("editions still on the shared list", () => {
  it("keep the adoption requirement: no selector, only Adopt", () => {
    const panel = read(PANEL)
    const legacy = panel.slice(panel.indexOf('if (access.mode === "shared_legacy")'), panel.indexOf("// --- Edition-mode"))
    assert.match(legacy, /Adopt current Papermark access/)
    assert.doesNotMatch(legacy, /Select all|Unselect all|saveEditionRecipients/)
  })

  it("the server still refuses to save a list for them", () => {
    const d = decideRecipientSave({ mode: "shared_legacy", hasLink: true, current: [], proposed: ["a@example.org"] })
    assert.equal(d.ok, false)
    assert.match(d.message, /Adopt this edition's current Papermark access/)
  })
})
