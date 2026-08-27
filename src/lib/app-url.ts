export const APRI_PRODUCTION_URL = 'https://apri.athenacentre.org'

export function portalVerificationUrl(token: string): string {
  return `${APRI_PRODUCTION_URL}/portal/verify?token=${encodeURIComponent(token)}`
}
