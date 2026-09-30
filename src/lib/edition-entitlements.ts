import type { Level, Visibility } from "./entitlements.ts"
import { decideAccess, type AccessDecision } from "./access-policy.ts"

export type CoveragePeriod = { startsOn: string; endsOn: string; level: Level }
export type AccessReason = "within covered dates" | "before coverage" | "uncovered gap" | "manually allowed" | "manually blocked" | "missing metadata" | "inactive subscription" | "content level"

const REASON: Record<AccessDecision["reason"], AccessReason> = {
  within_paid_period: "within covered dates",
  manually_allowed: "manually allowed",
  manually_blocked: "manually blocked",
  before_coverage: "before coverage",
  outside_paid_periods: "uncovered gap",
  period_level: "content level",
  above_level: "content level",
  public_publication: "content level",
  subscription_ended: "inactive subscription",
  subscription_suspended: "inactive subscription",
  subscription_inactive: "inactive subscription",
  subscription_not_started: "inactive subscription",
  term_needs_correction: "missing metadata",
  level_missing: "missing metadata",
  no_publication_record: "missing metadata",
  release_undecided: "missing metadata",
  edition_date_missing: "missing metadata",
  no_coverage_history: "missing metadata",
  withheld: "missing metadata",
}

/**
 * The date rule alone, for a released edition: a thin view of the access
 * policy (src/lib/access-policy.ts), which is the one decision everything
 * enforces. Kept for callers that only ask "is this date covered".
 */
export function editionAccess(input: { active: boolean; currentLevel: Level; editionDate: string | null; visibility: Visibility; periods: readonly CoveragePeriod[]; exception?: "allow" | "block" | null }): { allowed: boolean; reason: AccessReason } {
  const decision = decideAccess({
    subscription: { state: input.active ? "active" : "inactive", termStart: null, termEnd: null },
    level: input.currentLevel,
    periods: input.periods,
    periodsKnown: true,
    exception: input.exception ?? null,
    publication: { publicationId: "edition", editionDate: input.editionDate, visibility: input.visibility, series: null, paidRelease: "released", editorialStatus: "published" },
  })
  return { allowed: decision.outcome === "allowed", reason: REASON[decision.reason] }
}
