#!/usr/bin/env node
/**
 * Read-only production recovery preview: what every subscriber holds, what
 * the access policy expects, and which paid publication records need a
 * decision before access can be settled.
 *
 *   node scripts/access-recovery-preview.mjs [--json]
 *
 * Use a read-only database credential. Changes nothing, calls no Papermark
 * write and sends no email. Output has titles, dates, counts and reasons,
 * never a link, link id or URL.
 *
 * The one write it can make, only when asked, is the reviewed release
 * backfill: marking named publication records as released to paid
 * subscribers, for records the preview lists as already delivered to them
 * (links issued or paid views recorded) and still undecided. It records the
 * administrator and reason, and changes no link -- run the batch repair tool's
 * dry run afterwards to see its effect:
 *
 *   node scripts/access-recovery-preview.mjs --apply-release <id,id,...> --reason "<why>" --admin-email <your admin email>
 */
import { loadApp, requireDatabase, flag, option } from "./lib/load-app.mjs"

requireDatabase()
const { subscriberInventory, publicationReadiness } = await loadApp("lib/access-report.ts")
const { getSql } = await loadApp("lib/db.ts")

const releaseIds = option("apply-release")
if (releaseIds) {
  const reason = (option("reason") ?? "").trim()
  const adminEmail = (option("admin-email") ?? "").trim().toLowerCase()
  if (!reason || !adminEmail) {
    console.error("--apply-release needs --reason and --admin-email.")
    process.exit(2)
  }
  const sql = getSql()
  const admins = await sql`select id from admins where lower(email) = ${adminEmail} limit 1`
  if (!admins[0]) {
    console.error("No administrator has that email address.")
    process.exit(2)
  }
  const ids = releaseIds.split(",").map((s) => s.trim()).filter(Boolean)
  const candidates = new Map((await publicationReadiness()).filter((p) => p.backfillCandidate).map((p) => [p.publicationId, p]))
  let released = 0
  for (const id of ids) {
    const candidate = candidates.get(id)
    if (!candidate) {
      console.log(`${id}: not a backfill candidate (already decided, not in a paid room, or no evidence of delivery). Skipped.`)
      continue
    }
    const rows = await sql`
      update documents
      set paid_release_state = 'released', paid_release_changed_at = now(), paid_release_changed_by = ${admins[0].id}::uuid,
          paid_release_reason = ${reason}, updated_at = now()
      where id = ${id}::uuid and paid_release_state is null and visibility <> 'OPEN'
      returning id`
    if (!rows[0]) {
      console.log(`${id}: changed since the preview. Skipped.`)
      continue
    }
    await sql`
      insert into publication_release_events (publication_id, state, reason, administrator_id, source)
      values (${id}::uuid, 'released', ${reason}, ${admins[0].id}::uuid, 'backfill')`
    released++
    console.log(`${candidate.title}: released to paid subscribers.`)
  }
  console.log(`\n${released} record(s) released. No link was changed and no email was sent. Next: node scripts/reconcile-subscriber-document-links.mjs (dry run).`)
  process.exit(0)
}

const [subscribers, publications] = [await subscriberInventory({ limit: 5000 }), await publicationReadiness()]

if (flag("json")) {
  console.log(JSON.stringify({ subscribers, publications }, null, 2))
  process.exit(0)
}

console.log("SUBSCRIBERS (every subscriber, including those with nothing published or no paid periods)")
for (const s of subscribers) {
  const p = s.plan
  const line =
    p.state === "ok"
      ? `expected ${p.counts.expected}, linked ${p.counts.linked}, missing ${p.counts.missing}, excluded ${p.counts.excluded} (${p.counts.excludedWithLinks} with live links), undecided ${p.counts.unresolved} (${p.counts.preserved} kept open), orphan links ${p.orphans}, room links ${p.counts.roomLinks}`
      : `cannot evaluate: ${p.state === "unavailable" ? p.message : "not found"}`
  console.log(`- ${s.name || "(no name)"} <${s.email}> ${s.status} ${s.termStart ?? "?"}..${s.termEnd ?? "?"} ${s.level ?? "no level"}; periods ${s.periods}; ${p.state === "ok" ? p.subscription : ""}`)
  console.log(`    ${line}`)
  for (const n of s.notes) console.log(`    note: ${n}`)
}

console.log("\nPAID PUBLICATION RECORDS IN DATA ROOMS")
for (const r of publications) {
  const release = r.explicitRelease === "released" ? "On" : r.explicitRelease === "withheld" ? "Off" : r.editorialStatus === "published" ? "On (from status)" : r.editorialStatus === "archived" ? "Off (from status)" : "NOT SWITCHED ON"
  console.log(`- ${r.title} [${r.publicationId}] ${r.series ?? "no series"} ${r.editionDate ?? "NO DATE"} plans ${r.plans.length ? r.plans.join("/") : "NONE"}; ${release}; issued to ${r.subscribersIssued}, live ${r.subscribersLive}, paid views ${r.paidViews}`)
  for (const f of r.flags) console.log(`    check: ${f}`)
}

const candidates = publications.filter((p) => p.backfillCandidate)
console.log(`\nSWITCH-ON CANDIDATES: ${candidates.length} edition(s) not switched on yet but already delivered to paid subscribers`)
for (const c of candidates) console.log(`- ${c.title} [${c.publicationId}]: issued to ${c.subscribersIssued}, paid views ${c.paidViews}`)
if (candidates.length) {
  console.log(`\nAfter review, switch them On with:\n  node scripts/access-recovery-preview.mjs --apply-release ${candidates.map((c) => c.publicationId).join(",")} --reason "Already delivered to paid subscribers through the Data Room before release decisions existed" --admin-email <your admin email>`)
}
console.log("\nRead-only: nothing was changed, no Papermark call was made and no email was sent.")
