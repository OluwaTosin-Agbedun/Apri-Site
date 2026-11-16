import { NextRequest, NextResponse } from 'next/server'
import { decrypt, COOKIE_NAME } from '@/lib/session'
import { mayIndexRequest, migrationDestination } from '@/lib/site-config'
import {
  SUBSCRIBER_COOKIE_NAME,
  verifySubscriberSession,
  signSubscriberSession,
  subscriberCookieOptions,
  shouldRenew,
} from '@/lib/subscriber-session-token'

/**
 * In Next 16 this file replaces `middleware.ts`.
 *
 * Admin: an OPTIMISTIC check only. It reads the signed cookie and nothing
 * else, so an unauthenticated visitor is bounced before any admin page
 * renders. The real authorisation boundary is `requireAdmin()` in
 * src/lib/dal.ts, which re-reads the account on each request. Never rely on
 * this file alone.
 *
 * Portal: renews a subscriber's recorded session while they use it, at most
 * once a day, so a reader who keeps coming back stays signed in. Renewal never
 * grants anything: every portal request still checks the session record, the
 * subscriber's status and their term against the database.
 */
export default async function proxy(req: NextRequest) {
  // Host only selects a known route/indexing policy; canonical URLs always
  // come from trusted deployment configuration, never this header.
  const requestedHost=(req.headers.get('host')??req.nextUrl.hostname).toLowerCase().replace(/:\d+$/,'')
  const incoming=new URL(req.nextUrl.href)
  if (['apri.athenacentre.org','athenaadvisory.ng','www.athenaadvisory.ng'].includes(requestedHost)) {incoming.hostname=requestedHost;incoming.port=''}
  const destination=['apri.athenacentre.org','athenaadvisory.ng','www.athenaadvisory.ng'].includes(requestedHost)?migrationDestination(incoming,req.method):null
  if (destination) {
    const response=NextResponse.redirect(destination,308)
    response.headers.set('Cache-Control','private, no-store')
    response.headers.set('X-Robots-Tag','noindex, nofollow')
    return response
  }
  const response=await routeRequest(req)
  if (!mayIndexRequest(req.nextUrl.pathname,requestedHost)) response.headers.set('X-Robots-Tag','noindex, nofollow, nosnippet')
  if (/^\/(?:admin|portal|api)(?:\/|$)/.test(req.nextUrl.pathname)||/^\/review\//.test(req.nextUrl.pathname)) {
    response.headers.set('Cache-Control','private, no-store, max-age=0')
  }
  return response
}

async function routeRequest(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (pathname === '/portal' || pathname.startsWith('/portal/')) {
    return renewSubscriberSession(req)
  }

  // Public entry points to the admin area.
  if (pathname === '/admin/setup' || pathname === '/admin/login' || pathname === '/admin/mfa') {
    return NextResponse.next()
  }

  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    const session = await decrypt(req.cookies.get(COOKIE_NAME)?.value)
    if (!session) {
      const url = req.nextUrl.clone()
      url.pathname = '/admin/login'
      url.search = ''
      return NextResponse.redirect(url)
    }
  }

  return NextResponse.next()
}

async function renewSubscriberSession(req: NextRequest) {
  const response = NextResponse.next()
  // Page views only: never a form post (signing out must not be undone), a
  // prefetch, or the sign-in steps themselves.
  if (req.method !== 'GET' || req.headers.get('next-router-prefetch') || req.nextUrl.pathname.startsWith('/portal/verify')) {
    return response
  }
  try {
    const claims = await verifySubscriberSession(req.cookies.get(SUBSCRIBER_COOKIE_NAME)?.value)
    if (claims && shouldRenew(claims)) {
      const token = await signSubscriberSession({ principalId: claims.principalId, sid: claims.sid })
      response.cookies.set(SUBSCRIBER_COOKIE_NAME, token, subscriberCookieOptions())
    }
  } catch {
    // Renewal is a convenience; the existing cookie stands.
  }
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|opengraph-image).*)'],
}
