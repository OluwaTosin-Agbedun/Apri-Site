'use server'

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import bcrypt from 'bcryptjs'
import { getSql } from '@/lib/db'
import { createSession, destroySession } from '@/lib/session'
import { getCurrentAdmin, isSetupComplete, requireOwner } from '@/lib/dal'
import {
  InviteAdminSchema,
  LoginSchema,
  SetupSchema,
  fieldErrors,
  type FormState,
} from '@/lib/definitions'

const BCRYPT_COST = 12
const MAX_FAILURES = 5
const LOCKOUT_MINUTES = 15

/**
 * A bcrypt hash of a value nobody knows. Compared against when the email does
 * not exist, so a missing account costs the same time as a wrong password.
 * Without this, response timing tells an attacker which addresses are real.
 */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.HqjPgJnQKQF9pJXCkTMhqxvHZUOZ2Fu'

async function clientIp(): Promise<string> {
  const h = await headers()
  const forwarded = h.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]!.trim().slice(0, 64)
  return h.get('x-real-ip')?.slice(0, 64) ?? ''
}

// ---------------------------------------------------------------------------
// One-time setup: create the first owner account.
// ---------------------------------------------------------------------------
export async function setupFirstAdmin(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  if (await isSetupComplete()) {
    // Latched shut. Never allow a second run, whatever the caller posts.
    return { message: 'Setup has already been completed.' }
  }

  const parsed = SetupSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  })

  if (!parsed.success) {
    return { errors: fieldErrors(parsed.error) }
  }

  const { name, email, password } = parsed.data
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST)
  const sql = getSql()

  // The insert into app_settings carries the latch. If two people submit the
  // form at the same instant, the primary key on `key` means exactly one wins.
  try {
    await sql`insert into app_settings (key, value) values ('setup_completed', now()::text)`
  } catch {
    return { message: 'Setup has already been completed.' }
  }

  const rows = (await sql`
    insert into admins (name, email, password_hash, role)
    values (${name}, ${email}, ${passwordHash}, 'owner')
    returning id
  `) as { id: string }[]

  const admin = rows[0]
  if (!admin) return { message: 'Could not create the account. Try again.' }

  await createSession({ adminId: admin.id, role: 'owner' })
  redirect('/admin')
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
export async function login(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })

  // One message for every failure path below. Never reveal whether the address
  // exists, is deactivated, or simply had the wrong password.
  const GENERIC = { message: 'Those details are not correct.' }

  if (!parsed.success) return GENERIC

  const { email, password } = parsed.data
  const ip = await clientIp()
  const sql = getSql()

  const [{ failures }] = (await sql`
    select count(*)::int as failures
    from login_attempts
    where successful = false
      and created_at > now() - (${LOCKOUT_MINUTES} || ' minutes')::interval
      and (email_key = ${email} or (ip <> '' and ip = ${ip}))
  `) as { failures: number }[]

  if (failures >= MAX_FAILURES) {
    return {
      message: `Too many attempts. Try again in ${LOCKOUT_MINUTES} minutes.`,
    }
  }

  const rows = (await sql`
    select id, password_hash, role, is_active
    from admins
    where lower(email) = ${email}
    limit 1
  `) as {
    id: string
    password_hash: string
    role: 'owner' | 'editor'
    is_active: boolean
  }[]

  const admin = rows[0]
  // Always run a real bcrypt comparison, even with no matching row, so the
  // response time does not distinguish "no such user" from "wrong password".
  const matches = await bcrypt.compare(password, admin?.password_hash ?? DUMMY_HASH)

  if (!admin || !admin.is_active || !matches) {
    await sql`
      insert into login_attempts (email_key, ip, successful)
      values (${email}, ${ip}, false)
    `
    return GENERIC
  }

  await sql`
    insert into login_attempts (email_key, ip, successful)
    values (${email}, ${ip}, true)
  `
  // Clear the counter so a successful login does not stay throttled.
  await sql`
    delete from login_attempts
    where successful = false and (email_key = ${email} or (ip <> '' and ip = ${ip}))
  `
  await sql`update admins set last_login_at = now() where id = ${admin.id}`

  await createSession({ adminId: admin.id, role: admin.role })
  redirect('/admin')
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------
export async function logout(): Promise<void> {
  await destroySession()
  redirect('/admin/login')
}

// ---------------------------------------------------------------------------
// Invite a further administrator (owners only)
// ---------------------------------------------------------------------------
export async function inviteAdmin(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  await requireOwner()

  const parsed = InviteAdminSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
    role: formData.get('role'),
  })

  if (!parsed.success) return { errors: fieldErrors(parsed.error) }

  const { name, email, password, role } = parsed.data
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST)
  const sql = getSql()

  try {
    await sql`
      insert into admins (name, email, password_hash, role)
      values (${name}, ${email}, ${passwordHash}, ${role})
    `
  } catch {
    return { message: 'An administrator with that email already exists.' }
  }

  return { ok: true, message: `${name} can now sign in.` }
}

// ---------------------------------------------------------------------------
// Deactivate an administrator (owners only). Never a hard delete, so the audit
// trail of who changed what survives.
// ---------------------------------------------------------------------------
export async function deactivateAdmin(adminId: string): Promise<FormState> {
  const owner = await requireOwner()
  if (adminId === owner.id) {
    return { message: 'You cannot deactivate your own account.' }
  }

  const sql = getSql()
  await sql`update admins set is_active = false where id = ${adminId}`
  return { ok: true, message: 'Administrator deactivated.' }
}

export async function currentAdmin() {
  return getCurrentAdmin()
}
