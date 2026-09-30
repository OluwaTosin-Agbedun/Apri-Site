#!/usr/bin/env node
/**
 * Batch repair of subscriber document links: the same reconciliation the
 * subscriber page's "Repair document links" runs, for many subscribers.
 *
 *   Dry run (default; changes nothing, calls no Papermark write):
 *     node scripts/reconcile-subscriber-document-links.mjs [--subscriber <id>] [--limit 25] [--offset 0] [--json]
 *
 *   Apply exactly the plan that was reviewed:
 *     node scripts/reconcile-subscriber-document-links.mjs --apply --plan <fingerprint> [same selection flags] [--retries 2]
 *
 * The dry run prints every subscriber's planned creates, verifications,
 * withdrawals and undecided documents, and a fingerprint of that plan. Apply
 * recomputes the plan and refuses unless the fingerprint still matches, so
 * nothing runs that was not reviewed. Bounded (--limit, at most 200 per run),
 * idempotent (a second run changes nothing already right), one run per
 * subscriber at a time (the reconciliation lease), no duplicate links (one
 * live link per subscriber and document, enforced by the database), retries
 * with backoff, and no email: reconciliation never sends any.
 *
 * Output contains titles, counts and reasons only -- never a link or link id.
 */
import { createHash } from "node:crypto"
import { loadApp, requireDatabase, flag, option } from "./lib/load-app.mjs"

requireDatabase()
const apply = flag("apply")
const json = flag("json")
const limit = Math.min(Math.max(Number(option("limit") ?? 25) || 25, 1), 200)
const offset = Math.max(Number(option("offset") ?? 0) || 0, 0)
const only = option("subscriber")
const retries = Math.min(Math.max(Number(option("retries") ?? 2) || 0, 0), 5)
const reviewed = option("plan")

if (apply && !reviewed) {
  console.error("--apply needs --plan <fingerprint> from a dry run of the same selection. Run without --apply first.")
  process.exit(2)
}
if (apply && !process.env.PAPERMARK_API_TOKEN) {
  console.error("--apply needs PAPERMARK_API_TOKEN: links are created, verified and withdrawn in Papermark.")
  process.exit(2)
}

const { subscriberInventory } = await loadApp("lib/access-report.ts")
const { reconcileSubscriberAccess, queueSubscriberAccessReconciliation } = await loadApp("lib/subscriber-access-reconciliation.ts")

const inventory = await subscriberInventory(only ? { ids: [only] } : { limit, offset })
const planned = inventory.map((s) => ({
  id: s.id,
  name: s.name,
  status: s.status,
  term: `${s.termStart ?? "?"}..${s.termEnd ?? "?"}`,
  plan:
    s.plan.state === "ok"
      ? {
          subscription: s.plan.subscription,
          dataRoom: s.plan.dataroomId ? "assigned" : "none",
          create: s.plan.items.filter((i) => i.action === "create").map((i) => i.title),
          verify: s.plan.items.filter((i) => i.action === "verify").length,
          withdraw: s.plan.items.filter((i) => i.action === "revoke").map((i) => `${i.title} (${i.reason})`),
          withdrawOrphans: s.plan.orphans,
          keepUndecided: s.plan.items.filter((i) => i.action === "keep").map((i) => `${i.title} (${i.reason})`),
          undecidedWithoutLink: s.plan.items.filter((i) => i.outcome === "unresolved" && !i.hasLink).length,
          retireRoomLinks: s.plan.retireRoomLinks ? s.plan.counts.roomLinks : 0,
        }
      : { error: s.plan.state === "unavailable" ? s.plan.message : "not found" },
  notes: s.notes,
}))
const fingerprint = createHash("sha256").update(JSON.stringify(planned)).digest("hex").slice(0, 16)

if (!apply) {
  if (json) {
    console.log(JSON.stringify({ fingerprint, subscribers: planned }, null, 2))
  } else {
    for (const p of planned) {
      console.log(`\n${p.name || "(no name)"} [${p.id}] ${p.status} ${p.term}`)
      if (p.plan.error) {
        console.log(`  Cannot plan: ${p.plan.error}. Nothing would change.`)
        continue
      }
      console.log(`  Subscription: ${p.plan.subscription}; Data Room: ${p.plan.dataRoom}`)
      if (p.plan.create.length) console.log(`  Create ${p.plan.create.length}: ${p.plan.create.join("; ")}`)
      if (p.plan.verify) console.log(`  Verify ${p.plan.verify} stored link(s) with Papermark`)
      if (p.plan.withdraw.length) console.log(`  Withdraw ${p.plan.withdraw.length}: ${p.plan.withdraw.join("; ")}`)
      if (p.plan.withdrawOrphans) console.log(`  Withdraw ${p.plan.withdrawOrphans} link(s) to documents no longer in their Data Room`)
      if (p.plan.keepUndecided.length) console.log(`  Keep open, undecided ${p.plan.keepUndecided.length}: ${p.plan.keepUndecided.join("; ")}`)
      if (p.plan.undecidedWithoutLink) console.log(`  Undecided, not issued: ${p.plan.undecidedWithoutLink}`)
      if (p.plan.retireRoomLinks) console.log(`  Retire ${p.plan.retireRoomLinks} unrestricted room link(s) once the above verifies`)
      for (const n of p.notes) console.log(`  Note: ${n}`)
    }
    console.log(`\nDry run: nothing was changed and no email was sent.`)
    console.log(`Plan fingerprint: ${fingerprint}`)
    console.log(`To apply exactly this plan: node scripts/reconcile-subscriber-document-links.mjs --apply --plan ${fingerprint}${only ? ` --subscriber ${only}` : ` --limit ${limit} --offset ${offset}`}`)
  }
  process.exit(0)
}

if (reviewed !== fingerprint) {
  console.error(`The plan has changed since it was reviewed (now ${fingerprint}). Run the dry run again and review it.`)
  process.exit(3)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
for (const p of planned) {
  if (p.plan.error) {
    results.push({ id: p.id, name: p.name, state: "skipped", message: p.plan.error })
    continue
  }
  let outcome = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    await queueSubscriberAccessReconciliation(p.id, "batch")
    outcome = await reconcileSubscriberAccess(p.id, { trigger: "batch" })
    if (outcome.state === "complete" || outcome.state === "not_applicable") break
    if (attempt < retries) await sleep(2000 * (attempt + 1) ** 2)
  }
  results.push({ id: p.id, name: p.name, state: outcome.state, outcome: outcome.outcome, message: outcome.message })
  console.log(`${p.name || p.id}: ${outcome.state} -- ${outcome.message}`)
}
const ok = results.filter((r) => r.state === "complete" || r.state === "not_applicable").length
console.log(`\nApplied to ${results.length} subscriber(s): ${ok} complete, ${results.length - ok} need attention. No email was sent.`)
if (json) console.log(JSON.stringify(results, null, 2))
process.exit(ok === results.length ? 0 : 1)
