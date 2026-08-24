import { NextResponse } from 'next/server'
import { signInWithToken } from '@/lib/magic-link'

export const dynamic = 'force-dynamic'

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
 * sign-in form with a flag that shows one message covering every cause --
 * expired, already used, never existed, or a seat suspended since it was sent.
 * Distinguishing them would turn this URL into a probe for valid tokens.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token')

  const failed = NextResponse.redirect(new URL('/portal/sign-in?expired=1', request.url))

  if (!token) return failed

  const signedIn = await signInWithToken(token)
  if (!signedIn) return failed

  return NextResponse.redirect(new URL('/portal', request.url))
}
