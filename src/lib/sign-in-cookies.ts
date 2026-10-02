/**
 * The two short-lived cookies of a sign-in in progress. Neither is a session.
 *
 *  - PENDING: set on the browser that asks for a sign-in email. Only its hash
 *    is stored with the link, so the same browser's click on that link signs
 *    in at once. Fifteen minutes, the life of the link.
 *  - LINK: holds a link opened in a browser that did not ask for it, while
 *    that browser is asked to confirm. Scoped to /portal/verify.
 */
export const PENDING_COOKIE = "apri_signin_pending"
export const LINK_COOKIE = "apri_signin_link"

const base = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 15 * 60,
})

export function pendingCookieOptions() {
  return { ...base(), path: "/portal" }
}

export function linkCookieOptions() {
  return { ...base(), path: "/portal/verify" }
}
