import Link from "next/link"
import { requireAdmin } from "@/lib/dal"
import { getSql } from "@/lib/db"
import AdminShell from "@/components/AdminShell"
import { tierDisplayName } from "@/lib/entitlements"
import { formatLagos } from "@/lib/engagement-metrics"
import { loadSubscriberAccess, accessCounts } from "@/lib/access-policy-dal"
import { loadReconciliationHealth, type ReconciliationHealth } from "@/lib/subscriber-access-reconciliation"

export const metadata = { title: "Access Health · APRI" }
export const dynamic = "force-dynamic"

const STATE_LABEL: Record<string, string> = {
  active: "Current",
  not_started: "Not started",
  expired: "Ended",
  suspended: "Suspended",
  inactive: "Not active",
  term_missing: "Term dates to fix",
}

const OUTCOME_LABEL: Record<string, string> = {
  ready: "Ready",
  ready_with_unresolved: "Ready, some undecided",
  no_eligible: "Nothing permitted",
  partial: "Not ready",
  failed: "Failed",
  not_applicable: "No Data Room",
  superseded: "Overtaken",
}

/** At most this many subscribers are evaluated on one page load. */
const LIMIT = 300

/**
 * Subscribers → Access Health: every subscriber, what the access policy
 * expects them to hold, what they hold, and what the last reconciliation
 * found. Read-only; repair is on each subscriber's page or through the
 * batch tool, and never sends email.
 */
export default async function AccessHealthPage() {
  const admin = await requireAdmin()
  const sql = getSql()
  const subscribers = (await sql`
    select id, coalesce(nullif(full_name, ''), name, email) as name, email, public_tier, level, seats,
           to_char(term_start, 'YYYY-MM-DD') as term_start, to_char(term_end, 'YYYY-MM-DD') as term_end
    from subscribers
    where client_type = 'subscriber'
    order by lower(status) = 'active' desc, term_end desc nulls last, name
    limit ${LIMIT}
  `) as { id: string; name: string; email: string; public_tier: string | null; level: string | null; seats: number; term_start: string | null; term_end: string | null }[]

  let health = new Map<string, ReconciliationHealth>()
  try {
    health = await loadReconciliationHealth(subscribers.map((s) => s.id))
  } catch {}

  const rows = []
  for (const s of subscribers) {
    const access = await loadSubscriberAccess(s.id)
    rows.push({ s, access, counts: access.state === "ok" ? accessCounts(access.documents) : null, health: health.get(s.id) ?? null })
  }
  const needingAttention = rows.filter(
    (r) => r.access.state !== "ok" || (r.counts && (r.counts.missing > 0 || r.counts.unresolved > 0 || r.counts.excludedWithLinks > 0)) || (r.health && r.health.state === "failed"),
  ).length

  return (
    <AdminShell
      admin={admin}
      current="/admin/subscribers"
      title="Access Health"
      description={`${rows.length} subscriber${rows.length === 1 ? "" : "s"}; ${needingAttention} need attention. Counts come from the same access policy the portal and Papermark enforce.`}
    >
      <p className="text-sm text-muted-foreground mb-4 max-w-3xl">
        Expected is what the policy permits; Linked is what has a personal link recorded; Missing is permitted but not
        yet linked; Failed is what the last reconciliation could not prepare or verify; Unresolved awaits a release
        decision, publication details or paid-period history and is neither issued nor withdrawn. Repair a subscriber from
        their page, or many at once with <code className="text-xs">scripts/reconcile-subscriber-document-links.mjs</code>{" "}
        (dry run first). Nothing here sends email.
      </p>
      <p className="text-sm mb-6">
        <Link href="/admin/subscribers" className="text-accent hover:text-accent-hover">← All subscribers</Link>
      </p>
      <div className="border border-border bg-card/30 overflow-x-auto">
        <table className="w-full text-left text-sm min-w-[64rem]">
          <thead className="border-b border-border bg-black/5 text-foreground/70">
            <tr>
              <th className="font-medium p-3">Subscriber</th>
              <th className="font-medium p-3">Level</th>
              <th className="font-medium p-3">Active dates</th>
              <th className="font-medium p-3 text-right">Expected</th>
              <th className="font-medium p-3 text-right">Linked</th>
              <th className="font-medium p-3 text-right">Missing</th>
              <th className="font-medium p-3 text-right">Failed</th>
              <th className="font-medium p-3 text-right">Unresolved</th>
              <th className="font-medium p-3">Last reconciliation</th>
              <th className="font-medium p-3 text-right">Repair</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(({ s, access, counts, health: h }) => (
              <tr key={s.id} className="align-top">
                <td className="p-3">
                  <p className="text-foreground">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{s.email}</p>
                </td>
                <td className="p-3 text-xs">
                  {s.public_tier ? tierDisplayName(s.public_tier) : "—"}
                  <span className="block text-muted-foreground">{s.level ?? "No level"}{s.seats > 1 ? ` · ${s.seats} seats` : ""}</span>
                </td>
                <td className="p-3 text-xs tabular-nums">
                  {s.term_start ?? "—"} to {s.term_end ?? "—"}
                  <span className="block text-muted-foreground">{access.state === "ok" ? STATE_LABEL[access.subscriber.subscription.state] : "—"}</span>
                </td>
                {counts ? (
                  <>
                    <td className="p-3 text-right tabular-nums">{counts.expected}</td>
                    <td className="p-3 text-right tabular-nums">{counts.linked}</td>
                    <td className={`p-3 text-right tabular-nums ${counts.missing ? "text-amber-700" : ""}`}>{counts.missing}</td>
                    <td className={`p-3 text-right tabular-nums ${h?.failed ? "text-red-700" : ""}`}>{h?.failed ?? "—"}</td>
                    <td className={`p-3 text-right tabular-nums ${counts.unresolved ? "text-amber-700" : ""}`}>{counts.unresolved}</td>
                  </>
                ) : (
                  <td className="p-3 text-xs text-red-700" colSpan={5}>{access.state === "unavailable" ? access.message : "Not found"}</td>
                )}
                <td className="p-3 text-xs">
                  {h ? (
                    <>
                      {h.running ? "Running" : h.outcome ? OUTCOME_LABEL[h.outcome] ?? h.outcome : h.state}
                      <span className="block text-muted-foreground">{h.lastVerifiedAt ? formatLagos(h.lastVerifiedAt) : "Never verified"}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Never run</span>
                  )}
                </td>
                <td className="p-3 text-right text-xs">
                  <Link href={`/admin/subscribers/${s.id}#access`} className="text-accent hover:text-accent-hover">Review and repair</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {subscribers.length === LIMIT && (
        <p className="text-xs text-muted-foreground mt-3">Showing the first {LIMIT} subscribers. The batch tool covers everyone.</p>
      )}
    </AdminShell>
  )
}
