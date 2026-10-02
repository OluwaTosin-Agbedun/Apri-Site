export const APRI_PRODUCTION_URL = 'https://apri.athenacentre.org'

export function portalVerificationUrl(token: string): string {
  return `${APRI_PRODUCTION_URL}/portal/verify?token=${encodeURIComponent(token)}`
}

/**
 * The stable portal sign-in page, safe to hand to a subscriber in a separate
 * onboarding message.
 *
 * Deliberately not the URL in the access email. That one carries a single-use
 * sign-in token, which is a bearer credential: whoever holds it is signed in.
 * This page carries nothing -- the subscriber enters their own address and
 * receives their own one-time link there -- so it is the same for everyone and
 * grants no access by itself.
 */
export function portalSignInUrl(): string {
  return `${APRI_PRODUCTION_URL}/portal/sign-in`
}

/**
 * The origin in Complimentary Review emails (review request confirmation,
 * access and reader sign-in emails, and the manager's links): APP_URL when it
 * names an http(s) origin, as a sandbox does, otherwise the production site,
 * exactly as the subscriber emails above.
 *
 * Review emails used to require APP_URL and threw before sending when it was
 * unset. The live deployment has no APP_URL, so every review email failed
 * there while subscriber emails, which never read it, were delivered.
 */
export function emailOrigin(): string {
  const raw = (process.env.APP_URL ?? '').trim()
  if (raw) {
    try {
      const url = new URL(raw)
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.origin
    } catch {
      // A malformed value falls back to the production site.
    }
  }
  return APRI_PRODUCTION_URL
}
