import { NextRequest, NextResponse } from 'next/server'
import { decrypt, COOKIE_NAME } from '@/lib/session'

/**
 * In Next 16 this file replaces `middleware.ts`.
 *
 * This is an OPTIMISTIC check only: it reads the signed cookie and nothing
 * else. It exists so an unauthenticated visitor is bounced before any admin
 * page renders, avoiding a flash of protected chrome. It deliberately does not
 * touch the database, because the proxy runs on every request including
 * prefetches.
 *
 * The real authorisation boundary is `requireAdmin()` in src/lib/dal.ts, which
 * re-reads the account on each request. Never rely on this file alone.
 */
export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Public entry points to the admin area.
  if (pathname === '/admin/setup' || pathname === '/admin/login') {
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

export const config = {
  matcher: ['/admin', '/admin/:path*'],
}
