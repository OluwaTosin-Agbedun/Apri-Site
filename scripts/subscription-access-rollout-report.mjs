#!/usr/bin/env node
/**
 * Read-only rollout report: every subscriber -- including those with no
 * published documents or no paid periods -- with the exact documents the
 * access policy would add, keep undecided or withdraw. The same policy and
 * plan that enforcement and the batch repair tool use.
 *
 *   node scripts/subscription-access-rollout-report.mjs
 *
 * Use a read-only database credential. Changes nothing, calls no Papermark
 * write and sends no email. Prints titles, dates and reasons only: never a
 * link, link id or URL, since a Papermark link id is the secure part of a
 * document's address.
 */
import { loadApp, requireDatabase } from "./lib/load-app.mjs"

requireDatabase()
const { subscriberInventory } = await loadApp("lib/access-report.ts")
const subscribers = await subscriberInventory({ limit: 5000 })

console.log(
  JSON.stringify(
    subscribers.map((s) => ({
      id: s.id,
      subscriber: s.name,
      email: s.email,
      status: s.status,
      public_tier: s.publicTier,
      level: s.level,
      seats: s.seats,
      term: { start: s.termStart, end: s.termEnd },
      periods: s.periods,
      ...(s.plan.state === "ok"
        ? {
            subscription: s.plan.subscription,
            data_room: s.plan.dataroomId ? "assigned" : "none",
            counts: s.plan.counts,
            editions_to_add: s.plan.items.filter((i) => i.action === "create").map((i) => ({ title: i.title, series: i.series, edition_date: i.editionDate })),
            editions_to_remove: s.plan.items.filter((i) => i.action === "revoke").map((i) => ({ title: i.title, reason: i.reason })),
            undecided: s.plan.items.filter((i) => i.outcome === "unresolved").map((i) => ({ title: i.title, reason: i.reason, kept_open: i.hasLink })),
            links_outside_room: s.plan.orphans,
          }
        : { error: s.plan.state === "unavailable" ? s.plan.message : "not found" }),
      ambiguous: s.periods === 0 ? "No paid period recorded; Admin must add the agreed term before anything is decided" : "",
      notes: s.notes,
    })),
    null,
    2,
  ),
)
