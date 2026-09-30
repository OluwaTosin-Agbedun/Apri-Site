/**
 * Whether a subscription is current: one rule, in Africa/Lagos calendar days,
 * for sign-in, the sign-in link request, the portal, activation and Admin.
 *
 * Dependency-free so it is tested directly (tests/subscription-term.test.mjs).
 *
 * Term dates are PostgreSQL `date` values. Read them as text in SQL
 * (to_char(term_end, 'YYYY-MM-DD')) wherever possible: the Neon driver parses
 * a `date` column into a JavaScript Date at local midnight, and comparing that
 * object with a "YYYY-MM-DD" string is always false. That comparison is what
 * locked every current subscriber out of the portal after d004268.
 *
 * The term includes the whole of its first and last day in Lagos, whatever
 * the server's own time zone.
 */

export const TERM_TIME_ZONE = "Africa/Lagos"

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/

/** A real calendar date as "YYYY-MM-DD", or null. */
function validYmd(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || year < 1900 || year > 9999) return null
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

/**
 * A date-only value as "YYYY-MM-DD", or null when it is missing or not a real
 * calendar date.
 *
 * Accepts the text SQL should return, and -- because older queries still
 * select the raw column -- a Date produced by a driver's date parser. A parser
 * builds that Date at midnight, either UTC midnight or the server's local
 * midnight, so whichever of the two it is gives back the stored calendar
 * date. Never uses toISOString() on a locally parsed date, which moves the day
 * back in any time zone east of UTC. Any other instant is read as its Lagos
 * calendar day.
 */
export function dateOnly(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null
  if (typeof value === "string") {
    const trimmed = value.trim()
    const match = YMD.exec(trimmed.slice(0, 10))
    // "YYYY-MM-DD" alone, or followed by a time (a timestamp's text form).
    if (!match || (trimmed.length > 10 && !/^[T ]/.test(trimmed.slice(10)))) return null
    return validYmd(Number(match[1]), Number(match[2]), Number(match[3]))
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    if (value.getUTCHours() === 0 && value.getUTCMinutes() === 0 && value.getUTCSeconds() === 0 && value.getUTCMilliseconds() === 0) {
      return validYmd(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate())
    }
    if (value.getHours() === 0 && value.getMinutes() === 0 && value.getSeconds() === 0 && value.getMilliseconds() === 0) {
      return validYmd(value.getFullYear(), value.getMonth() + 1, value.getDate())
    }
    return lagosDate(value)
  }
  return null
}

/** The Lagos calendar date of an instant. */
export function lagosDate(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TERM_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at)
}

/** Today in Lagos as "YYYY-MM-DD". */
export function lagosToday(now: Date = new Date()): string {
  return lagosDate(now)
}

/**
 * The subscription, apart from authentication and apart from which documents
 * it covers or whether their links are ready:
 *
 *  - active       status active and today inside the term;
 *  - not_started  status active, the term begins after today;
 *  - expired      the term's last day has passed, or the seat is marked lapsed;
 *  - suspended    the seat is suspended;
 *  - inactive     pending, declined or any other status;
 *  - term_missing status active but a term date is missing or unreadable -- a
 *                 record to correct, never a reason to call the term ended.
 */
export type SubscriptionState = "active" | "not_started" | "expired" | "suspended" | "inactive" | "term_missing"

export type SubscriptionStatus = {
  state: SubscriptionState
  termStart: string | null
  termEnd: string | null
}

export function subscriptionStatus(
  input: { status: string | null | undefined; termStart: unknown; termEnd: unknown },
  today: string = lagosToday(),
): SubscriptionStatus {
  const termStart = dateOnly(input.termStart)
  const termEnd = dateOnly(input.termEnd)
  const status = (input.status ?? "").trim().toLowerCase()
  const result = (state: SubscriptionState): SubscriptionStatus => ({ state, termStart, termEnd })

  if (status === "suspended") return result("suspended")
  if (status === "lapsed") return result("expired")
  if (status !== "active") return result("inactive")
  // An end date that has passed is decisive even when the start is missing.
  if (termEnd && termEnd < today) return result("expired")
  if (!termStart || !termEnd || termEnd < termStart) return result("term_missing")
  if (termStart > today) return result("not_started")
  return result("active")
}

/** True only while the subscription is current: the gate for every document. */
export function subscriptionCurrent(status: SubscriptionStatus): boolean {
  return status.state === "active"
}

export type SignInRefusal = "inactive" | "suspended" | "subscription-expired"

/**
 * Whether a sign-in link may be issued or consumed.
 *
 * The same outcome as before for every current seat. A seat whose term has
 * not started, or whose term dates need correcting, may still sign in: the
 * portal then says exactly that, instead of the email step pretending the
 * subscription has ended. Expired, suspended and inactive seats are refused.
 */
export function signInDecision(status: SubscriptionStatus): { ok: true } | { ok: false; reason: SignInRefusal } {
  switch (status.state) {
    case "active":
    case "not_started":
    case "term_missing":
      return { ok: true }
    case "expired":
      return { ok: false, reason: "subscription-expired" }
    case "suspended":
      return { ok: false, reason: "suspended" }
    default:
      return { ok: false, reason: "inactive" }
  }
}
