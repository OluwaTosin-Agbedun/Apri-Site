"use server"

/**
 * The one response every sign-in request gets.
 *
 * Identical whether the address is a live subscriber, a lapsed one, or unknown
 * to us entirely. A subscriber list is confidential, so the form must not become
 * an oracle that tells a stranger who is on it.
 */

/**
 * Requests a sign-in link.
 *
 * Note what this function never does: return a different value, take a
 * different amount of visible work, or redirect, depending on whether the
 * address exists. Everything below the throttle check ends at the same NEUTRAL.
 */

// Throttled per address and per IP, on the same table the admin login uses.
// The key is namespaced so subscriber attempts cannot lock out an admin.

// A live seat gets a link. Anything else gets an explanation by email, which
// keeps the on-screen response identical either way.
// A mail failure must not tell the caller anything. The token simply
// expires unused.
// As above.

// 'pending' and 'suspended' are told nothing at all: a seat that has not
// been activated, or has been suspended deliberately, should not learn its
// own state from an automated message.

import { readSubscriberTerm } from "@/lib/subscriber-principal"
import { signInDecision } from "@/lib/subscription-term"
import { redirect } from "next/navigation"
import { headers, cookies } from "next/headers"
import { randomBytes } from "node:crypto"
import * as z from "zod"
import { getSql } from "@/lib/db"
import { issueToken, signInWithCode, signInWithToken } from "@/lib/magic-link"
import { hashToken } from "@/lib/magic-token"
import { PENDING_COOKIE, LINK_COOKIE, pendingCookieOptions, linkCookieOptions } from "@/lib/sign-in-cookies"
import {
  sendSignInLink,
  sendLapsedNotice,
} from "@/lib/subscriber-email"
import { destroySubscriberSession } from "@/lib/subscriber-session"
import type { FormState } from "@/lib/definitions"

const MAX_REQUESTS = 5
const WINDOW_MINUTES = 15
const NEUTRAL: FormState = {
  ok: true,
  message:
    "If that address is on our subscriber list, a sign-in link is on its way. Please check your email.",
}

const EmailOnly = z.object({
  email: z.string().trim().toLowerCase().min(3).max(254),
})

async function clientIp(): Promise<string> {
  const h = await headers()
  const forwarded = h.get("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0]!.trim().slice(0, 64)
  return h.get("x-real-ip")?.slice(0, 64) ?? ""
}
export async function requestSignInLink(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = EmailOnly.safeParse({ email: formData.get("email") })
  if (!parsed.success) return NEUTRAL

  // This browser's own marker, set whether or not the address is on the list
  // so the response never differs. Its hash travels with the link: this
  // browser's click on it signs in at once, and the code in the same email
  // signs in whichever browser it is typed into.
  const pending = randomBytes(32).toString("base64url")
  ;(await cookies()).set(PENDING_COOKIE, pending, pendingCookieOptions())

  const { email } = parsed.data
  const ip = await clientIp()
  const sql = getSql()
  const key = `portal:${email}`

  const [{ recent }] = (await sql`
    select count(*)::int as recent
    from login_attempts
    where successful = false
      and created_at > now() - (${WINDOW_MINUTES} || ' minutes')::interval
      and (email_key = ${key} or (ip <> '' and ip = ${ip} and email_key like 'portal:%'))
  `) as { recent: number }[]

  if (recent >= MAX_REQUESTS) {
    return {
      message: `Too many requests. Please try again in ${WINDOW_MINUTES} minutes.`,
    }
  }

  await sql`
    insert into login_attempts (email_key, ip, successful)
    values (${key}, ${ip}, false)
  `

  const subscriber = await readSubscriberTerm({ email })
  if (!subscriber) return NEUTRAL

  const fullName = subscriber.fullName
  const decision = signInDecision(subscriber.subscription)
  if (decision.ok) {
    const token = await issueToken(subscriber.id, { bindingHash: hashToken(pending) })
    try {
      await sendSignInLink({ subscriberId:subscriber.id, email: subscriber.email, fullName, token })
    } catch {}
    return NEUTRAL
  }

  // Only a subscription that has genuinely ended is told about renewal.
  if (subscriber.subscription.state === "expired") {
    try {
      await sendLapsedNotice({ email: subscriber.email, fullName })
    } catch {}
  }
  return NEUTRAL
}

export async function subscriberSignOut(): Promise<void> {
  await destroySubscriberSession()
  redirect("/portal/sign-in?signed_out=1")
}

const CODE_FAILURES_PER_DAY = 10
const CODE_FAILED: FormState = {
  message: "That code did not work. Check that it is from your latest APRI email and was sent in the last 15 minutes, or use the link in that email.",
}

/**
 * Signs in with the 8-digit code from a sign-in email -- in THIS browser.
 *
 * Wrong codes are limited per address (ten a day) and per network address,
 * on top of the five-try limit on each code, so a code cannot be guessed. An
 * unknown address and a wrong code give the same answer.
 */
export async function signInWithEmailCode(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = EmailOnly.safeParse({ email: formData.get("email") })
  if (!parsed.success) return CODE_FAILED
  const { email } = parsed.data
  const ip = await clientIp()
  const sql = getSql()
  // The address is kept only as a hash in the throttle.
  const key = `portal-code:${hashToken(email)}`
  const [{ recent, fromIp }] = (await sql`
    select
      count(*) filter (where email_key = ${key} and created_at > now() - interval '24 hours')::int as recent,
      count(*) filter (where ip <> '' and ip = ${ip} and email_key like 'portal-code:%' and created_at > now() - interval '15 minutes')::int as "fromIp"
    from login_attempts where successful = false
  `) as { recent: number; fromIp: number }[]
  if (recent >= CODE_FAILURES_PER_DAY || fromIp >= 20) {
    return { message: "Too many codes were tried. Use the link in your latest APRI email, or try again later." }
  }

  const result = await signInWithCode(email, String(formData.get("code") ?? ""))
  if (!result.ok) {
    if (result.reason === "session-failed") {
      return { message: "Your code was right, but signing in could not be finished just now. Try the same code again in a minute." }
    }
    if (result.reason === "suspended") return { message: "This APRI subscription is currently suspended. Contact APRI for help." }
    if (result.reason === "subscription-expired") return { message: "This subscription has expired. Contact APRI to renew access." }
    if (result.reason === "inactive") return { message: "This APRI account is not active. Contact APRI if you believe this is incorrect." }
    await sql`insert into login_attempts (email_key, ip, successful) values (${key}, ${ip}, false)`
    return CODE_FAILED
  }
  ;(await cookies()).set(PENDING_COOKIE, "", { ...pendingCookieOptions(), maxAge: 0 })
  redirect("/portal")
}

/**
 * The confirming click for a link opened in a browser that did not ask for
 * it: signs in THIS browser. The link waits in a short-lived cookie scoped to
 * /portal/verify, never in a URL.
 */
export async function continueSignInHere(): Promise<void> {
  const store = await cookies()
  const token = store.get(LINK_COOKIE)?.value ?? ""
  store.set(LINK_COOKIE, "", { ...linkCookieOptions(), maxAge: 0 })
  if (!token) redirect("/portal/sign-in?reason=used")
  let result: Awaited<ReturnType<typeof signInWithToken>>
  try {
    result = await signInWithToken(token)
  } catch {
    store.set(LINK_COOKIE, token, linkCookieOptions())
    redirect("/portal/verify/continue?retry=1")
  }
  if (!result.ok) {
    if (result.reason === "session-failed") {
      store.set(LINK_COOKIE, token, linkCookieOptions())
      redirect("/portal/verify/continue?retry=1")
    }
    redirect(`/portal/sign-in?reason=${result.reason}`)
  }
  redirect("/portal")
}

