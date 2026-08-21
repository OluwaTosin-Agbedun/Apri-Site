/**
 * Site-level configuration.
 *
 * BRIEFING_FORM_URL is the external Microsoft Forms / Google Forms page that all
 * "Request a ... Briefing" buttons should lead to, per the publication brief.
 *
 * It is intentionally null until the real form URL is supplied. While it is null
 * the buttons fall back to the built-in request form at /request-briefing, which
 * captures the same fields. Do not put a placeholder or guessed URL here: a wrong
 * link means briefing requests are silently delivered nowhere.
 */
export const BRIEFING_FORM_URL: string | null = null;

/** Public contact address for APRI enquiries. */
export const CONTACT_EMAIL = 'intelligence@athenacentre.org';
