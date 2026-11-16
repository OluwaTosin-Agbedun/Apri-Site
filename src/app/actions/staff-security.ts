"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { getSql } from "@/lib/db"
import { requireAdmin, requireOwner } from "@/lib/dal"
import { createSession, destroySession } from "@/lib/session"
import { confirmStaffPassword } from "@/lib/staff-password"
import { completeStaffChallenge, disableStaffMfa, issueStaffChallenge, revokeStaffSessions,
  setStaffMfaPolicy, staffChallengeView, staffSecurityReady, staffSecurityState, STAFF_CHALLENGE_COOKIE, STAFF_SECURITY_MIGRATION } from "@/lib/admin-security"

export type SecurityFormState = { ok?: boolean; message: string } | undefined
const cookieOptions = () => ({ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" as const, path: "/admin", maxAge: 300 })

export async function beginStaffEnrollment(_previous: SecurityFormState, form: FormData): Promise<SecurityFormState> {
  const admin = await requireAdmin()
  if (!(await staffSecurityReady())) return { message: `Apply ${STAFF_SECURITY_MIGRATION} first.` }
  if (!(await confirmStaffPassword(admin.id, form.get("password")))) return { message: "The password could not be confirmed. Check it or try again in 15 minutes." }
  const token = await issueStaffChallenge(admin.id, "enroll")
  if (!token) return { message: "Setup is unavailable or too many checks were requested. Try again in 15 minutes." }
  ;(await cookies()).set(STAFF_CHALLENGE_COOKIE, token, cookieOptions())
  redirect("/admin/mfa")
}

/** Public sign-in action: the short-lived password-proven challenge is its authority. */
export async function verifyStaffMfa(_previous: SecurityFormState, form: FormData): Promise<SecurityFormState> {
  const jar = await cookies()
  const token = jar.get(STAFF_CHALLENGE_COOKIE)?.value ?? ""
  const input = form.get("code")
  if (typeof input !== "string" || input.length > 100) return { message: "Enter a fresh authenticator code or an unused recovery code." }
  const result = await completeStaffChallenge(token, input, form.get("saved") === "yes")
  if (!result) return { message: "That check did not succeed. Use a fresh code; after five tries or five minutes, sign in again." }
  await createSession(result)
  jar.set(STAFF_CHALLENGE_COOKIE, "", { ...cookieOptions(), maxAge: 0 })
  const sql = getSql()
  await sql`update admins set last_login_at=now() where id=${result.adminId}::uuid`
  await sql`insert into login_attempts(email_key,ip,successful)
    select email,'',true from admins where id=${result.adminId}::uuid`
  redirect("/admin")
}

export async function cancelStaffMfa(): Promise<void> {
  const jar = await cookies()
  const token = jar.get(STAFF_CHALLENGE_COOKIE)?.value ?? ""
  // Cancelling grants nothing; no token or identity is accepted from the form.
  if (await staffChallengeView(token)) {
    const { challengeHash } = await import("@/lib/admin-mfa")
    await getSql()`update admin_auth_challenges set consumed_at=now(),enrollment_ciphertext=null where token_hash=${challengeHash(token)}`
  }
  jar.set(STAFF_CHALLENGE_COOKIE, "", { ...cookieOptions(), maxAge: 0 })
  redirect("/admin/login")
}

export async function revokeAdminBrowsers(_previous: SecurityFormState, form: FormData): Promise<SecurityFormState> {
  const admin = await requireAdmin()
  if (!(await staffSecurityReady())) return { message: `Apply ${STAFF_SECURITY_MIGRATION} first.` }
  const requested = String(form.get("adminId") ?? admin.id)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requested)) return { message: "Choose an administrator." }
  if (requested !== admin.id) await requireOwner()
  if (!(await confirmStaffPassword(admin.id, form.get("password")))) return { message: "The password could not be confirmed. Check it or try again in 15 minutes." }
  if (!(await getSql()`select id from admins where id=${requested}::uuid`).length) return { message: "That administrator no longer exists." }
  await revokeStaffSessions(admin.id, requested)
  if (requested === admin.id) { await destroySession(); redirect("/admin/login") }
  revalidatePath("/admin/security")
  return { ok: true, message: "That administrator's existing sessions have been signed out." }
}

export async function updateStaffMfaPolicy(_previous: SecurityFormState, form: FormData): Promise<SecurityFormState> {
  const owner = await requireOwner()
  if (!(await staffSecurityReady())) return { message: `Apply ${STAFF_SECURITY_MIGRATION} first.` }
  if (!(await confirmStaffPassword(owner.id, form.get("password")))) return { message: "The password could not be confirmed. Check it or try again in 15 minutes." }
  try { await setStaffMfaPolicy(owner.id, form.get("required") === "yes") }
  catch (error) { return { message: error instanceof Error && error.message === "Every active administrator must finish authenticator setup first."
    ? error.message : "The security setting could not be saved. Try again." } }
  revalidatePath("/admin/security")
  return { ok: true, message: "Staff sign-in policy saved." }
}

export async function removeStaffMfa(_previous: SecurityFormState, form: FormData): Promise<SecurityFormState> {
  const admin = await requireAdmin()
  if (!(await staffSecurityReady())) return { message: `Apply ${STAFF_SECURITY_MIGRATION} first.` }
  if (!(await confirmStaffPassword(admin.id, form.get("password")))) return { message: "The password could not be confirmed. Check it or try again in 15 minutes." }
  const code = form.get("code")
  if (typeof code !== "string" || code.length > 100 || !(await disableStaffMfa(admin.id, code))) return { message: "Use a fresh code. An authenticator cannot be removed while it is required for all staff." }
  const security = await staffSecurityState(admin.id)
  if (!security) throw new Error("Staff security could not be checked")
  await createSession({ adminId: admin.id, role: admin.role, securityVersion: security.version, mfaVerified: false })
  revalidatePath("/admin/security")
  return { ok: true, message: "Authenticator removed and previous sessions signed out." }
}
