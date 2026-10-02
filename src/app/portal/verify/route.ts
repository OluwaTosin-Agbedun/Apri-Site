import { NextResponse } from "next/server"
import { headers, cookies } from "next/headers"
import { getSql } from "@/lib/db"
import { signInWithToken, inspectToken } from "@/lib/magic-link"
import { hashToken } from "@/lib/magic-token"
import { signInSchemaReady } from "@/lib/sign-in-schema"
import { PENDING_COOKIE, LINK_COOKIE, linkCookieOptions, pendingCookieOptions } from "@/lib/sign-in-cookies"

export const dynamic = "force-dynamic"

/**
 * GET /portal/verify?token=…
 *
 * Consumes the token from the emailed link and opens the session.
 *
 * A Route Handler rather than a page, because Next.js permits cookie writes
 * only from a Server Action or a Route Handler -- and a magic link arrives as a
 * plain GET, which a page render cannot answer with a Set-Cookie.
 *
 * Both outcomes redirect. Success lands on the library; failure lands on the
 * sign-in form with a safe recovery message for the token or account state.
 */
/** Attempts allowed from one address inside the window. */
const MAX_ATTEMPTS = 10
const WINDOW_MINUTES = 15

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token")

  const failed = NextResponse.redirect(
    new URL("/portal/sign-in?expired=1", request.url),
  )

  if (!token) return failed

  // Throttled per address.
  //
  // Not because the token is guessable -- it is 256 bits of randomness, and no
  // number of attempts gets anywhere. It is because every attempt costs a
  // database round trip, so an unthrottled endpoint is a cheap way to exhaust
  // the connection pool from a single machine.
  const ip = await clientIp()
  if (ip && (await tooManyAttempts(ip))) {
    return NextResponse.redirect(
      new URL("/portal/sign-in?expired=1", request.url),
    )
  }

  // Once sign-in sessions are recorded, a link spends itself at once only in
  // the browser that asked for it. Opened anywhere else -- the browser built
  // into an email app, another device, or a mail scanner following links --
  // it asks for a confirming click, and the sign-in page offers the code
  // instead, so the session lands in the browser the subscriber returns to.
  try {
    if (await signInSchemaReady()) {
      const cookieStore = await cookies()
      const pending = cookieStore.get(PENDING_COOKIE)?.value
      const state = await inspectToken(token, pending ? hashToken(pending) : null)
      if (!state.usable) {
        await recordAttempt(ip)
        return NextResponse.redirect(new URL(`/portal/sign-in?reason=${state.reason}`, request.url))
      }
      if (!state.sameBrowser) {
        cookieStore.set(LINK_COOKIE, token, linkCookieOptions())
        return NextResponse.redirect(new URL("/portal/verify/continue", request.url), 303)
      }
    }
  } catch {
    return NextResponse.redirect(new URL("/portal/sign-in?reason=unavailable", request.url))
  }

  let signedIn: Awaited<ReturnType<typeof signInWithToken>>
  try {
    signedIn = await signInWithToken(token)
  } catch {
    // The link was not checked (the database could not be reached): it is
    // still unspent, so the same link can simply be tried again.
    return NextResponse.redirect(
      new URL("/portal/sign-in?reason=unavailable", request.url),
    )
  }

  // Only failures are recorded. A subscriber who signs in successfully should
  // never be counted toward a limit meant for someone probing.
  if (!signedIn.ok) {
    if (signedIn.reason !== "session-failed") await recordAttempt(ip)
    return NextResponse.redirect(
      new URL(`/portal/sign-in?reason=${signedIn.reason}`, request.url),
    )
  }

  ;(await cookies()).set(PENDING_COOKIE, "", { ...pendingCookieOptions(), maxAge: 0 })
  return NextResponse.redirect(new URL("/portal", request.url))
}

async function clientIp(): Promise<string> {
  const h = await headers()
  const forwarded = h.get("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0]!.trim().slice(0, 64)
  return h.get("x-real-ip")?.slice(0, 64) ?? ""
}

async function tooManyAttempts(ip: string): Promise<boolean> {
  try {
    const sql = getSql()
    const [{ recent }] = (await sql`
      select count(*)::int as recent
      from login_attempts
      where email_key = 'verify'
        and ip = ${ip}
        and successful = false
        and created_at > now() - (${WINDOW_MINUTES} || ' minutes')::interval
    `) as { recent: number }[]
    return recent >= MAX_ATTEMPTS
  } catch {
    // A throttle that cannot be read must not lock out a legitimate subscriber.
    return false
  }
}

async function recordAttempt(ip: string): Promise<void> {
  if (!ip) return
  try {
    const sql = getSql()
    await sql`
      insert into login_attempts (email_key, ip, successful)
      values ('verify', ${ip}, false)
    `
  } catch {
    // Best effort.
  }
}
