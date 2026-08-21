import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { getSql } from './db'
import { readSession } from './session'

export type CurrentAdmin = {
  id: string
  name: string
  email: string
  role: 'owner' | 'editor'
}

/**
 * The single authorisation boundary for the admin surface.
 *
 * A valid cookie alone is not enough: the account is re-read from the database
 * on every request so that deactivating an admin takes effect immediately
 * rather than whenever their 8-hour token happens to expire. `cache` collapses
 * the repeat lookups within one render pass into a single query.
 *
 * Returns null instead of redirecting so callers can choose the behaviour.
 */
export const getCurrentAdmin = cache(async (): Promise<CurrentAdmin | null> => {
  const session = await readSession()
  if (!session) return null

  const sql = getSql()
  const rows = (await sql`
    select id, name, email, role
    from admins
    where id = ${session.adminId}
      and is_active = true
    limit 1
  `) as CurrentAdmin[]

  return rows[0] ?? null
})

/** Use in any admin page, layout, or server action that must not be public. */
export async function requireAdmin(): Promise<CurrentAdmin> {
  const admin = await getCurrentAdmin()
  if (!admin) redirect('/admin/login')
  return admin
}

/** Owner-only actions, e.g. inviting or deactivating other administrators. */
export async function requireOwner(): Promise<CurrentAdmin> {
  const admin = await requireAdmin()
  if (admin.role !== 'owner') redirect('/admin')
  return admin
}

/**
 * Whether the one-time setup screen is still open. Latched on a persisted flag,
 * never on "are there zero admins?" -- the latter would reopen public account
 * creation if every admin row were ever deleted.
 */
export const isSetupComplete = cache(async (): Promise<boolean> => {
  const sql = getSql()
  const rows = (await sql`
    select 1 from app_settings where key = 'setup_completed' limit 1
  `) as unknown[]
  return rows.length > 0
})
