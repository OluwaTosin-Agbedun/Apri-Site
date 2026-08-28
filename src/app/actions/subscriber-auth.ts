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

import { redirect } from "next/navigation"
import { headers } from "next/headers"
import * as z from "zod"
import { getSql } from "@/lib/db"
import { issueToken, issueBriefingToken } from "@/lib/magic-link"
import {
  sendSignInLink,
  sendLapsedNotice,
  sendBriefingWelcome,
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

  const rows = (await sql`
    select id, email, full_name, name, status, term_end
    from subscribers
    where lower(email) = ${email}
    limit 1
  `) as {
    id: string
    email: string
    full_name: string | null
    name: string
    status: string
    term_end: string | null
  }[]

  const subscriber = rows[0]
  if (!subscriber) {
    const briefings =
      (await sql`select id,name,email,status from briefing_requests
      where lower(email)=${email} order by created_at desc limit 1`) as {
        id: string
        name: string
        email: string
        status: string
      }[]
    const briefing = briefings[0]
    if (briefing?.status === "Active") {
      const token = await issueBriefingToken(briefing.id)
      try {
        await sendBriefingWelcome({
          briefingRequestId: briefing.id,
          email: briefing.email,
          fullName: briefing.name,
          token,
        })
      } catch {}
    }
    return NEUTRAL
  }

  const status = subscriber.status.toLowerCase()
  const termEnd = subscriber.term_end
  const termCurrent = !termEnd || new Date(termEnd) >= startOfToday()
  const fullName = subscriber.full_name || subscriber.name || ""
  if (status === "active" && termCurrent) {
    const token = await issueToken(subscriber.id)
    try {
      await sendSignInLink({ subscriberId:subscriber.id, email: subscriber.email, fullName, token })
    } catch {}
    return NEUTRAL
  }

  if (status === "active" || status === "lapsed") {
    try {
      await sendLapsedNotice({ email: subscriber.email, fullName })
    } catch {}
  }
  return NEUTRAL
}

export async function subscriberSignOut(): Promise<void> {
  await destroySubscriberSession()
  redirect("/portal/sign-in")
}

function startOfToday(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}
