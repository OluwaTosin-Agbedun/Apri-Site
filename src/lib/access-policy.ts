/**
 * Which paid editions one subscriber sees in their portal: the single rule.
 *
 *   An edition appears when it is switched On for subscribers, ticked for the
 *   subscriber's plan, and dated within their term.
 *
 * Two individual adjustments sit on top: "Also give" (for example a back
 * issue promised at sign-up) and "Hide", which always wins. A subscription
 * that has ended, is suspended or is not active yet shows nothing.
 *
 * Every path that lists, opens, downloads, provisions, repairs or withdraws a
 * subscriber's documents asks this function, through
 * src/lib/access-policy-dal.ts. Admin, the rollout report and the batch tool
 * ask it too, so what Admin shows is what the portal and Papermark enforce.
 *
 * Three outcomes, never two:
 *
 *  - allowed    shown: the subscriber gets their own link;
 *  - excluded   a deliberate or confirmed "no" (Off, Hide, not their plan,
 *               outside their term, subscription over): a live link is withdrawn;
 *  - unresolved something is missing (no date, no plan ticked, not switched
 *               on yet, no publication record, term dates to fix): nothing new
 *               is issued and nothing already issued is taken away.
 *
 * Dependency-free apart from the term rule, so every branch is tested
 * directly (tests/access-policy.test.mjs).
 */
import { dateOnly, type SubscriptionStatus } from "./subscription-term.ts"

/** Switched On (released) or Off (withheld) for subscribers; null until someone decides. */
export type PaidRelease = "released" | "withheld" | null

export type Period = {
  startsOn: string
  endsOn: string
  level?: string
  /** A term voided as a mistake grants nothing, but stays in the history. */
  voided?: boolean
}

export type PublicationFacts = {
  /** The publication record behind the document, or null when none is linked. */
  publicationId: string | null
  editionDate: string | null
  /** Only OPEN matters here: a public publication is never issued as a paid document. */
  visibility: string | null
  series: string | null
  /** The explicit On/Off decision, when one exists. */
  paidRelease: PaidRelease
  /** The record's editorial status: draft, published or archived. */
  editorialStatus: string | null
  /** The plans ticked for this edition, as stored plan names. Null when they cannot be read. */
  plans: readonly string[] | null
}

export type PolicyInput = {
  subscription: SubscriptionStatus
  /** The subscriber's plan, as its stored name (for example "Individual Access"). */
  plan: string | null
  /** Earlier terms, kept automatically: editions dated inside them stay covered. */
  periods: readonly Period[]
  exception: "allow" | "block" | null
  publication: PublicationFacts
}

export type AllowedReason = "within_term" | "also_given"
export type ExcludedReason =
  | "subscription_ended"
  | "subscription_suspended"
  | "subscription_inactive"
  | "subscription_not_started"
  | "hidden"
  | "public_publication"
  | "switched_off"
  | "not_in_plan"
  | "before_term"
  | "outside_term"
export type UnresolvedReason =
  | "term_needs_correction"
  | "plan_missing"
  | "no_publication_record"
  | "not_switched_on"
  | "no_plan_ticked"
  | "plans_unavailable"
  | "edition_date_missing"

export type AccessDecision =
  | { outcome: "allowed"; reason: AllowedReason }
  | { outcome: "excluded"; reason: ExcludedReason }
  | { outcome: "unresolved"; reason: UnresolvedReason }

export const REASON_TEXT: Record<AllowedReason | ExcludedReason | UnresolvedReason, string> = {
  within_term: "In their plan and dated within their term",
  also_given: "Also given to this subscriber",
  subscription_ended: "Their subscription has ended",
  subscription_suspended: "Their subscription is suspended",
  subscription_inactive: "Their subscription is not active yet",
  subscription_not_started: "Their subscription has not started yet",
  hidden: "Hidden for this subscriber",
  public_publication: "A public publication, not a paid edition",
  switched_off: "Switched off for subscribers",
  not_in_plan: "Not ticked for their plan",
  before_term: "Dated before their term started",
  outside_term: "Dated outside their term",
  term_needs_correction: "Their term dates need correcting",
  plan_missing: "They have no plan set",
  no_publication_record: "No publication record is linked to this file",
  not_switched_on: "Not switched on for subscribers yet",
  no_plan_ticked: "No plan is ticked for this edition",
  plans_unavailable: "Plan ticks could not be read",
  edition_date_missing: "The edition has no date",
}

/**
 * The effective On/Off. An explicit decision wins. Without one, a record an
 * administrator published counts as On and an archived one as Off; a draft is
 * not switched on yet -- never assumed either way.
 */
export function effectiveRelease(publication: Pick<PublicationFacts, "paidRelease" | "editorialStatus">): PaidRelease {
  if (publication.paidRelease === "released" || publication.paidRelease === "withheld") return publication.paidRelease
  const status = (publication.editorialStatus ?? "").toLowerCase()
  if (status === "published") return "released"
  if (status === "archived") return "withheld"
  return null
}

export function decideAccess(input: PolicyInput): AccessDecision {
  const excluded = (reason: ExcludedReason): AccessDecision => ({ outcome: "excluded", reason })
  const unresolved = (reason: UnresolvedReason): AccessDecision => ({ outcome: "unresolved", reason })

  // 1. The subscription itself: nothing is shown outside a current one.
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

  // 2. Hide always wins.
  if (input.exception === "block") return excluded("hidden")

  const pub = input.publication
  if (!pub.publicationId) return unresolved("no_publication_record")
  if ((pub.visibility ?? "").toUpperCase() === "OPEN") return excluded("public_publication")

  // 3. Off is a deliberate decision for everyone, "Also give" included.
  const release = effectiveRelease(pub)
  if (release === "withheld") return excluded("switched_off")

  // 4. Also give: this one subscriber, whatever the plan or date.
  if (input.exception === "allow") return { outcome: "allowed", reason: "also_given" }

  // 5. Their plan: an edition for other plans is simply not theirs.
  if (!input.plan) return unresolved("plan_missing")
  if (pub.plans === null) return unresolved("plans_unavailable")
  if (pub.plans.length === 0) return unresolved("no_plan_ticked")
  if (!pub.plans.includes(input.plan)) return excluded("not_in_plan")

  if (release === null) return unresolved("not_switched_on")

  // 6. Dated within their term (or an earlier term of theirs).
  const edition = dateOnly(pub.editionDate)
  if (!edition) return unresolved("edition_date_missing")
  const terms = [
    { startsOn: input.subscription.termStart, endsOn: input.subscription.termEnd },
    ...input.periods.filter((p) => !p.voided).map((p) => ({ startsOn: dateOnly(p.startsOn), endsOn: dateOnly(p.endsOn) })),
  ].filter((t): t is { startsOn: string; endsOn: string } => Boolean(t.startsOn && t.endsOn))
  if (terms.some((t) => t.startsOn <= edition && t.endsOn >= edition)) return { outcome: "allowed", reason: "within_term" }
  const first = terms.map((t) => t.startsOn).sort()[0]
  return excluded(first && edition < first ? "before_term" : "outside_term")
}

/** A short account of one decision for Admin. */
export function describeDecision(decision: AccessDecision): string {
  return REASON_TEXT[decision.reason]
}
