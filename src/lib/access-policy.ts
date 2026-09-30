/**
 * Which paid publications one subscriber may open: the single decision.
 *
 * Every path that lists, opens, downloads, provisions, repairs or revokes a
 * subscriber's document access asks this function, through
 * src/lib/access-policy-dal.ts, which loads its inputs. Admin previews, the
 * rollout report and the batch repair script ask it too, so what Admin shows is
 * what the portal and Papermark enforce.
 *
 * Three outcomes, never two:
 *
 *  - allowed    the subscriber is owed a personal link to this document;
 *  - excluded   confirmed: the subscription has ended or is suspended, the
 *               document is blocked, withheld, above the subscriber's level or
 *               outside every paid period. A live link is revoked;
 *  - unresolved the decision cannot be made yet: no publication record, no
 *               release decision, no edition date, no paid-period history or a
 *               term that needs correcting. Nothing new is issued, and nothing
 *               already issued is taken away -- missing information is never
 *               treated as a confirmed "no".
 *
 * Dependency-free apart from the level and term rules, so every branch is
 * tested directly (tests/access-policy.test.mjs).
 */
import { isEntitled, isLevel, type Level } from "./entitlements.ts"
import { dateOnly, type SubscriptionStatus } from "./subscription-term.ts"

/**
 * Whether an edition is released to paid subscribers. Separate from the
 * record's editorial status and from Complimentary Review publication or
 * withdrawal: an administrator releases it, or withholds it, deliberately.
 */
export type PaidRelease = "released" | "withheld" | null

export type Period = {
  startsOn: string
  endsOn: string
  level: string
  /** A period voided as a mistake grants nothing, but stays in the history. */
  voided?: boolean
}

export type PublicationFacts = {
  /** The publication record behind the document, or null when none is linked. */
  publicationId: string | null
  editionDate: string | null
  visibility: string | null
  series: string | null
  /** The administrator's explicit decision, when one exists. */
  paidRelease: PaidRelease
  /** The record's editorial status: draft, published or archived. */
  editorialStatus: string | null
}

export type PolicyInput = {
  subscription: SubscriptionStatus
  /** The subscriber's current commercial level. */
  level: string | null
  /** Paid periods, including voided ones (which grant nothing). */
  periods: readonly Period[]
  /** Whether paid-period history can be read at all (the migration exists). */
  periodsKnown: boolean
  exception: "allow" | "block" | null
  publication: PublicationFacts
}

export type AllowedReason = "within_paid_period" | "manually_allowed"
export type ExcludedReason =
  | "subscription_ended"
  | "subscription_suspended"
  | "subscription_inactive"
  | "subscription_not_started"
  | "manually_blocked"
  | "public_publication"
  | "withheld"
  | "above_level"
  | "before_coverage"
  | "outside_paid_periods"
  | "period_level"
export type UnresolvedReason =
  | "term_needs_correction"
  | "level_missing"
  | "no_publication_record"
  | "release_undecided"
  | "edition_date_missing"
  | "no_coverage_history"

export type AccessDecision =
  | { outcome: "allowed"; reason: AllowedReason }
  | { outcome: "excluded"; reason: ExcludedReason }
  | { outcome: "unresolved"; reason: UnresolvedReason }

export const REASON_TEXT: Record<AllowedReason | ExcludedReason | UnresolvedReason, string> = {
  within_paid_period: "Edition date is inside a paid period",
  manually_allowed: "Individually allowed by an administrator",
  subscription_ended: "Subscription has ended",
  subscription_suspended: "Subscription is suspended",
  subscription_inactive: "Subscription is not active",
  subscription_not_started: "Subscription has not started yet",
  manually_blocked: "Individually blocked by an administrator",
  public_publication: "Public publication, not issued as a paid document",
  withheld: "Withheld from paid subscribers",
  above_level: "Above the subscriber's access level",
  before_coverage: "Edition date is before the first paid period",
  outside_paid_periods: "Edition date is outside every paid period",
  period_level: "Paid period for this date is at a lower level",
  term_needs_correction: "Subscription term dates need correcting",
  level_missing: "Subscriber has no access level set",
  no_publication_record: "No publication record is linked to this document",
  release_undecided: "Release to paid subscribers not yet decided",
  edition_date_missing: "Publication record has no edition date",
  no_coverage_history: "No paid-period history recorded for this subscriber",
}

/**
 * The effective release decision. An explicit decision wins. Without one, a
 * record an administrator published is released and an archived one is
 * withheld; a draft is undecided -- never assumed either way.
 */
export function effectiveRelease(publication: Pick<PublicationFacts, "paidRelease" | "editorialStatus">): PaidRelease {
  if (publication.paidRelease === "released" || publication.paidRelease === "withheld") return publication.paidRelease
  const status = (publication.editorialStatus ?? "").toLowerCase()
  if (status === "published") return "released"
  if (status === "archived") return "withheld"
  return null
}

function rank(level: string | null | undefined): number {
  return isLevel(level) ? { L1: 1, L2: 2, L3: 3, L4: 4 }[level] : 0
}

export function decideAccess(input: PolicyInput): AccessDecision {
  const excluded = (reason: ExcludedReason): AccessDecision => ({ outcome: "excluded", reason })
  const unresolved = (reason: UnresolvedReason): AccessDecision => ({ outcome: "unresolved", reason })

  // 1. The subscription itself. Nothing is owed outside a current one; a term
  //    whose dates cannot be read is a record to correct, not an ended one.
  switch (input.subscription.state) {
    case "expired":
      return excluded("subscription_ended")
    case "suspended":
      return excluded("subscription_suspended")
    case "inactive":
      return excluded("subscription_inactive")
    case "not_started":
      return excluded("subscription_not_started")
    case "term_missing":
      return unresolved("term_needs_correction")
  }

  // 2. An individual Block always wins.
  if (input.exception === "block") return excluded("manually_blocked")

  const pub = input.publication
  if (!pub.publicationId) return unresolved("no_publication_record")
  if ((pub.visibility ?? "").toUpperCase() === "OPEN") return excluded("public_publication")

  const release = effectiveRelease(pub)
  if (release === "withheld") return excluded("withheld")

  // 3. Content level: Allow never lifts a subscriber above their level.
  if (!isLevel(input.level)) return unresolved("level_missing")
  if (!isLevel(pub.visibility)) return unresolved("no_publication_record")
  if (!isEntitled(input.level as Level, pub.visibility)) return excluded("above_level")

  if (release === null) return unresolved("release_undecided")

  const edition = dateOnly(pub.editionDate)
  if (!edition) return unresolved("edition_date_missing")

  // 4. An individual Allow, bounded by everything above.
  if (input.exception === "allow") return { outcome: "allowed", reason: "manually_allowed" }

  // 5. Paid periods, by the edition's own date.
  const periods = input.periods
    .filter((p) => !p.voided)
    .map((p) => ({ startsOn: dateOnly(p.startsOn), endsOn: dateOnly(p.endsOn), level: p.level }))
    .filter((p): p is { startsOn: string; endsOn: string; level: string } => Boolean(p.startsOn && p.endsOn))
  if (!input.periodsKnown || periods.length === 0) return unresolved("no_coverage_history")

  const covering = periods.filter((p) => p.startsOn <= edition && p.endsOn >= edition)
  if (covering.some((p) => rank(p.level) >= rank(pub.visibility))) return { outcome: "allowed", reason: "within_paid_period" }
  if (covering.length > 0) return excluded("period_level")
  const first = periods.map((p) => p.startsOn).sort()[0]!
  return excluded(edition < first ? "before_coverage" : "outside_paid_periods")
}

/** A short account of one decision for Admin: the outcome and its reason. */
export function describeDecision(decision: AccessDecision): string {
  return REASON_TEXT[decision.reason]
}
