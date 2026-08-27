import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { getSql } from "@/lib/db"
import { signInWithToken } from "@/lib/magic-link"

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

  let signedIn: Awaited<ReturnType<typeof signInWithToken>>
  try {
    signedIn = await signInWithToken(token)
  } catch {
    // Database/configuration failures must still land on a useful recovery page.
    return NextResponse.redirect(
      new URL("/portal/sign-in?expired=1", request.url),
    )
  }

  // Only failures are recorded. A subscriber who signs in successfully should
  // never be counted toward a limit meant for someone probing.
  if (!signedIn.ok) {
    await recordAttempt(ip)
    return NextResponse.redirect(
      new URL(`/portal/sign-in?reason=${signedIn.reason}`, request.url),
    )
  }

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
