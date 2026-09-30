import Link from "next/link"
import { loadSubscriberAccess, accessCounts, type DocumentAccess } from "@/lib/access-policy-dal"
import { describeDecision } from "@/lib/access-policy"
import { loadReconciliationHealth, type ReconciliationHealth } from "@/lib/subscriber-access-reconciliation"
import { ACCESS_HEALTH_MIGRATION_PENDING } from "@/lib/access-health-schema"
import { EDITION_ENTITLEMENT_MIGRATION_PENDING } from "@/lib/edition-entitlement-schema"
import { LEVELS } from "@/lib/entitlements"
import { formatLagos } from "@/lib/engagement-metrics"
import { AddPeriodForm, PublicationAccessControl, RepairForm, VoidPeriodForm } from "./access-forms"

const SUBSCRIPTION_LABEL: Record<string, string> = {
  active: "Active: inside the current term",
  not_started: "Active, but the term has not started yet",
  expired: "Ended: the term's last day has passed",
  suspended: "Suspended",
  inactive: "Not active (pending or declined)",
  term_missing: "Active, but the term dates are missing or invalid: correct them below",
}

const OUTCOME_LABEL: Record<string, string> = {
  ready: "Ready: every permitted document verified",
  ready_with_unresolved: "Ready, with documents awaiting a decision",
  no_eligible: "No permitted documents",
  partial: "Not ready: some documents failed",
  failed: "Failed: access could not be checked",
  not_applicable: "Not on a Data Room",
  superseded: "Overtaken by a newer change",
}

const RELEASE_LABEL = { released: "Released", withheld: "Withheld" } as const

function releaseLabel(d: DocumentAccess): string {
  if (!d.publicationId) return "No publication record"
  if (d.explicitRelease) return RELEASE_LABEL[d.explicitRelease]
  if (d.release) return `${RELEASE_LABEL[d.release]} (from editorial status)`
  return "Undecided"
}

function linkLabel(d: DocumentAccess): string {
  if (d.decision.outcome === "allowed") return d.link ? "Personal link recorded" : "Missing: to be created"
  if (d.decision.outcome === "excluded") return d.link ? "Live link: to be withdrawn" : "No link"
  return d.link ? "Kept open (issued earlier)" : "No link"
}

const OUTCOME_TONE: Record<string, string> = {
  allowed: "text-foreground",
  excluded: "text-muted-foreground",
  unresolved: "text-amber-700",
}

function Count({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="border border-border p-3 min-w-[7rem]" title={hint}>
      <p className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-lg tabular-nums text-foreground">{value}</p>
    </div>
  )
}

function when(value: string | null): string {
  return value ? formatLagos(value) : "—"
}

/**
 * Subscribers → subscriber → Access: the one place an administrator sees what
 * the access policy decides for this person and why, and changes its inputs.
 */
export default async function AccessPanel({ subscriberId, canRepair }: { subscriberId: string; canRepair: boolean }) {
  const access = await loadSubscriberAccess(subscriberId)
  let health: ReconciliationHealth | null = null
  try {
    health = (await loadReconciliationHealth([subscriberId])).get(subscriberId) ?? null
  } catch {}

  if (access.state === "unavailable") {
    return (
      <section className="my-6 border border-border bg-card/30 p-6">
        <h2 className="font-serif text-xl mb-2">Document access</h2>
        <p className="text-sm text-red-700">{access.message} Nothing has been changed.</p>
      </section>
    )
  }
  if (access.state === "not_found") return null

  const counts = accessCounts(access.documents)
  const sub = access.subscriber
  const unresolvedDocs = access.documents.filter((d) => d.decision.outcome === "unresolved")

  return (
    <section className="my-6 border border-border bg-card/30 p-6" id="access">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="font-serif text-xl mb-1">Document access</h2>
          <p className="text-sm text-foreground/80">{SUBSCRIPTION_LABEL[sub.subscription.state] ?? sub.subscription.state}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Term {sub.subscription.termStart ?? "no start"} to {sub.subscription.termEnd ?? "no end"} (Africa/Lagos, inclusive) · Level {sub.level ?? "not set"}
            {access.room ? ` · Data Room ${access.room.source === "override" ? "(override)" : access.room.source === "level" ? "(from level)" : "(assigned)"}` : " · No Data Room"}
          </p>
        </div>
        {canRepair && <RepairForm subscriberId={subscriberId} />}
      </div>

      {!access.entitlementSchema && <p className="text-sm text-red-700 mb-4">{EDITION_ENTITLEMENT_MIGRATION_PENDING}</p>}
      {access.entitlementSchema && !access.healthSchema && <p className="text-sm text-red-700 mb-4">{ACCESS_HEALTH_MIGRATION_PENDING}</p>}

      <div className="flex flex-wrap gap-2 mb-5">
        <Count label="In Data Room" value={counts.documents} />
        <Count label="Expected" value={counts.expected} hint="Permitted by the access policy" />
        <Count label="Linked" value={counts.linked} hint="Permitted, with a personal link recorded" />
        <Count label="Verified" value={health?.verified ?? "—"} hint="Confirmed with Papermark by the last reconciliation" />
        <Count label="Missing" value={counts.missing} hint="Permitted, but no personal link yet" />
        <Count label="Excluded" value={counts.excluded} hint="Confirmed not permitted" />
        <Count label="Unresolved" value={counts.unresolved} hint="Awaiting a release decision, details or paid-period history" />
      </div>

      <div className="border border-border p-4 mb-6 text-sm">
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Last reconciliation</p>
        {health ? (
          <>
            <p className="text-foreground">
              {health.running ? "Running now" : health.outcome ? (OUTCOME_LABEL[health.outcome] ?? health.outcome) : health.state === "pending" ? "Pending" : health.state}
            </p>
            {health.detail && <p className="text-xs text-red-700 mt-1">{health.detail}</p>}
            {health.problems.length > 0 && (
              <ul className="text-xs text-muted-foreground mt-2 list-disc pl-5 space-y-1">
                {health.problems.slice(0, 8).map((p, i) => <li key={i}>“{p.title}”: {p.reason}</li>)}
              </ul>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              Last verified {when(health.lastVerifiedAt)} · Requested {when(health.requestedAt)}
              {health.trigger ? ` by ${health.trigger.replace("_", " ")}` : ""}
              {health.attempts > 0 ? ` · ${health.attempts} failed attempt${health.attempts === 1 ? "" : "s"}, next retry ${when(health.nextAttemptAt)}` : ""}
            </p>
          </>
        ) : (
          <p className="text-muted-foreground">Never run. Repair document links prepares and verifies this subscriber&rsquo;s access.</p>
        )}
      </div>

      <h3 className="text-xs font-medium uppercase tracking-wider text-accent mb-2">Paid periods</h3>
      <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
        Editions are covered when their edition date falls inside a paid period, at or below that period&rsquo;s level.
        A renewal is a new period; an unpaid gap is the absence of one. Someone starting on 30 September does not
        receive a 1 September edition unless it is individually allowed below. Void a period entered by mistake:
        it then grants nothing and stays in the history.
      </p>
      {access.periods.length === 0 ? (
        <p className="text-sm text-amber-700 mb-3">No paid periods are recorded, so no edition can be decided for this subscriber yet. Add the agreed term below.</p>
      ) : (
        <div className="overflow-x-auto mb-3">
          <table className="w-full text-xs min-w-[36rem]">
            <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-3 font-medium">From</th><th className="py-1 pr-3 font-medium">To</th><th className="py-1 pr-3 font-medium">Level</th><th className="py-1 pr-3 font-medium">Source</th><th className="py-1 pr-3 font-medium">Status</th><th className="py-1 font-medium" /></tr></thead>
            <tbody className="divide-y divide-border">
              {access.periods.map((p) => (
                <tr key={p.id} className={p.voided ? "text-muted-foreground line-through decoration-muted-foreground/40" : ""}>
                  <td className="py-1.5 pr-3 tabular-nums">{p.startsOn}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{p.endsOn}</td>
                  <td className="py-1.5 pr-3">{p.level}</td>
                  <td className="py-1.5 pr-3">{p.source}</td>
                  <td className="py-1.5 pr-3 no-underline">{p.voided ? `Voided${p.voidReason ? `: ${p.voidReason}` : ""}` : "Counts"}</td>
                  <td className="py-1.5"><VoidPeriodForm subscriberId={subscriberId} periodId={p.id} voided={p.voided === true} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mb-8"><AddPeriodForm subscriberId={subscriberId} levels={LEVELS} /></div>

      <h3 className="text-xs font-medium uppercase tracking-wider text-accent mb-2">Publications in their Data Room</h3>
      {!access.room ? (
        <p className="text-sm text-muted-foreground">No Data Room is assigned, so this subscriber reads the legacy library.</p>
      ) : access.documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">The Data Room has no synced documents yet. Sync it under Data Rooms.</p>
      ) : (
        <>
          {counts.expected === 0 && (
            <p className="text-sm text-muted-foreground mb-3">
              The Data Room has {counts.documents} document{counts.documents === 1 ? "" : "s"}, but none is permitted for this subscriber yet{counts.unresolved ? `: ${counts.unresolved} await a decision` : ""}.
            </p>
          )}
          {unresolvedDocs.length > 0 && (
            <p className="text-xs text-amber-700 mb-3 max-w-3xl">
              Unresolved documents are neither issued nor withdrawn. Settle each one: release it (or withhold it) on its
              publication record, fill in a missing edition date, or record the subscriber&rsquo;s paid periods.
            </p>
          )}
          <div className="space-y-2">
            {access.documents.map((d) => (
              <div key={d.rowId} className="border border-border p-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0 text-xs">
                  <p className="text-sm font-medium text-foreground break-words">{(d.titleOverride && d.editorialTitle) || d.fileTitle || d.editorialTitle || "Untitled document"}</p>
                  <p className="text-muted-foreground mt-0.5">
                    {[d.series || "No series", d.editionDate || "No edition date", d.visibility || "No level", releaseLabel(d)].join(" · ")}
                    {d.publicationId && (
                      <> · <Link className="text-accent hover:text-accent-hover" href={`/admin/documents/${d.publicationId}`}>Publication record</Link></>
                    )}
                  </p>
                  <p className={`mt-1 ${OUTCOME_TONE[d.decision.outcome]}`}>
                    <span className="uppercase tracking-wider text-[0.65rem] mr-1">{d.decision.outcome}</span>
                    {describeDecision(d.decision)} · {linkLabel(d)}
                  </p>
                  {d.exception && (
                    <p className="text-muted-foreground mt-1">
                      {d.exception.decision === "allow" ? "Allowed" : "Blocked"} by {d.exception.administrator ?? "an administrator"}
                      {d.exception.at ? ` on ${formatLagos(d.exception.at)}` : ""}: {d.exception.reason}
                    </p>
                  )}
                </div>
                {d.publicationId && access.entitlementSchema && (
                  <PublicationAccessControl subscriberId={subscriberId} publicationId={d.publicationId} title={d.editorialTitle || d.fileTitle} current={d.exception?.decision ?? null} />
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
