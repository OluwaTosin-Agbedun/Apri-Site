import type { Level, Visibility } from "./entitlements.ts"
import { isEntitled } from "./entitlements.ts"

export type CoveragePeriod = { startsOn: string; endsOn: string; level: Level }
export type AccessReason = "within covered dates" | "before coverage" | "uncovered gap" | "manually allowed" | "manually blocked" | "missing metadata" | "inactive subscription" | "content level"

/** Date-only policy: PostgreSQL date values and editorial dates are YYYY-MM-DD, inclusive at both ends. */
export function editionAccess(input: { active: boolean; currentLevel: Level; editionDate: string | null; visibility: Visibility; periods: readonly CoveragePeriod[]; exception?: "allow" | "block" | null }): { allowed: boolean; reason: AccessReason } {
  if (!input.active) return { allowed: false, reason: "inactive subscription" }
  if (!isEntitled(input.currentLevel, input.visibility)) return { allowed: false, reason: "content level" }
  if (!input.editionDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.editionDate)) return { allowed: false, reason: "missing metadata" }
  if (input.exception === "block") return { allowed: false, reason: "manually blocked" }
  if (input.exception === "allow") return { allowed: true, reason: "manually allowed" }
  const covered = input.periods.some((p) => isEntitled(p.level, input.visibility) && p.startsOn <= input.editionDate! && p.endsOn >= input.editionDate!)
  if (covered) return { allowed: true, reason: "within covered dates" }
  const first = input.periods.map((p) => p.startsOn).sort()[0]
  return { allowed: false, reason: first && input.editionDate < first ? "before coverage" : "uncovered gap" }
}

/** Shared SQL predicate used by listings, viewer/download routes and provisioning. */
export const EDITION_ACCESS_SQL = `
  d.edition_date is not null
  and not exists (select 1 from subscriber_publication_exceptions x where x.subscriber_id = s.id and x.publication_id = d.id and x.decision = 'block')
  and (exists (select 1 from subscriber_publication_exceptions x where x.subscriber_id = s.id and x.publication_id = d.id and x.decision = 'allow')
       or exists (select 1 from subscriber_subscription_periods p where p.subscriber_id = s.id and d.edition_date between p.starts_on and p.ends_on
         and case d.visibility when 'L1' then 1 when 'L2' then 2 when 'L3' then 3 when 'L4' then 4 else 99 end <= case p.level when 'L1' then 1 when 'L2' then 2 when 'L3' then 3 when 'L4' then 4 else 0 end))`
