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
