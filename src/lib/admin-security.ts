import "server-only"
import { randomBytes } from "node:crypto"
import { getSql } from "./db"
import { challengeHash, matchingTotpStep, newAuthenticatorSecret, newRecoveryCodes, openStaffSecret, recoveryHash, sealStaffSecret } from "./admin-mfa"

type Sql = ReturnType<typeof getSql>
export const STAFF_CHALLENGE_COOKIE = "apri_staff_challenge"
export const STAFF_SECURITY_MIGRATION = "20261115_stage4_operations_security.sql"

export async function staffSecurityReady(sql: Sql = getSql()): Promise<boolean> {
  const [row] = await sql`select to_regclass('public.admin_security') is not null as security,
    to_regclass('public.admin_auth_challenges') is not null as challenges,
    to_regclass('public.admin_security_policy') is not null as policy`
  const existing=[row?.security,row?.challenges,row?.policy].filter(v=>v===true).length
  if (existing!==0 && existing!==3) throw new Error("Staff security schema is incomplete")
  if (existing===0) {
    const [marker]=await sql`select 1 as ok from app_settings where key='staff_security_schema_v1'`
    if (marker) throw new Error("Staff security schema is missing after activation")
  }
  return existing===3
}

function master(): string {
  const value = process.env.SESSION_SECRET
  if (!value || value.length < 32) throw new Error("Staff security is not configured")
  return value
}

export type StaffSecurity = { version: number; enabled: boolean; required: boolean }

export async function staffSecurityState(adminId: string, sql: Sql = getSql()): Promise<StaffSecurity | null> {
  if (!(await staffSecurityReady(sql))) return null
  const [row] = await sql`select coalesce(s.session_version, 0)::text as version,
    s.totp_ciphertext is not null as enabled, p.require_mfa as required
    from admins a cross join admin_security_policy p
    left join admin_security s on s.admin_id = a.id
    where a.id = ${adminId}::uuid and a.is_active = true and p.singleton = true`
  if (!row) throw new Error("Staff security configuration is unavailable")
  const version = Number(row.version)
  if (!Number.isSafeInteger(version) || version < 0) throw new Error("Invalid staff security version")
  return { version, enabled: row.enabled === true, required: row.required === true }
}

export async function recordStaffSecurityEvent(event: string, actor: string | null, target: string | null, sql: Sql = getSql()): Promise<void> {
  await sql`insert into admin_security_events(actor_admin_id,target_admin_id,event_type)
    values(${actor}::uuid,${target}::uuid,${event})`
}

type Enrollment = { secret: string; recoveryCodes: string[] }
type Challenge = {
  token_hash: string; admin_id: string; kind: "verify" | "enroll"; session_version: string
  enrollment_ciphertext: string | null; attempts: number; email: string; role: "owner" | "editor"
}

/** Only called after a password check. Tokens carry no identity and grant no Admin rights. */
export async function issueStaffChallenge(adminId: string, kind: "verify" | "enroll", sql: Sql = getSql()): Promise<string | null> {
  if (!(await staffSecurityReady(sql))) return null
  const state = await staffSecurityState(adminId, sql)
  if (!state || (kind === "verify" && !state.enabled) || (kind === "enroll" && state.enabled)) return null
  await sql`insert into admin_security(admin_id) values(${adminId}::uuid) on conflict do nothing`
  const budget = await sql`update admin_security set
    challenge_issues = case when challenge_window_started <= now() - interval '15 minutes' then 1 else challenge_issues + 1 end,
    challenge_window_started = case when challenge_window_started <= now() - interval '15 minutes' then now() else challenge_window_started end
    where admin_id = ${adminId}::uuid and (challenge_window_started <= now() - interval '15 minutes' or challenge_issues < 5)
    returning admin_id`
  if (!budget.length) return null
  const enrollment: Enrollment | null = kind === "enroll" ? { secret: newAuthenticatorSecret(), recoveryCodes: newRecoveryCodes() } : null
  const cipher = enrollment ? sealStaffSecret(JSON.stringify(enrollment), master(), adminId) : null
  const token = randomBytes(32).toString("base64url")
  const hash = challengeHash(token)
  await sql`insert into admin_auth_challenges(token_hash,admin_id,kind,session_version,enrollment_ciphertext,expires_at)
    values(${hash},${adminId}::uuid,${kind},${state.version},${cipher},now() + interval '5 minutes')`
  return token
}

async function readChallenge(token: string, sql: Sql): Promise<Challenge | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !(await staffSecurityReady(sql))) return null
  const [row] = await sql`select c.*, c.session_version::text, a.email, a.role
    from admin_auth_challenges c join admins a on a.id = c.admin_id
    left join admin_security s on s.admin_id = a.id
    where c.token_hash = ${challengeHash(token)} and c.consumed_at is null
      and c.expires_at > now() and c.attempts < 5 and a.is_active = true
      and c.session_version = coalesce(s.session_version, 0)`
  return (row as Challenge | undefined) ?? null
}

export async function staffChallengeView(token: string, sql: Sql = getSql()): Promise<{ kind: "verify" | "enroll"; email: string; secret: string | null; recoveryCodes: string[] } | null> {
  const row = await readChallenge(token, sql)
  if (!row) return null
  const enrollment = row.enrollment_ciphertext
    ? JSON.parse(openStaffSecret(row.enrollment_ciphertext, master(), row.admin_id)) as Enrollment : null
  return { kind: row.kind, email: row.email, secret: enrollment?.secret ?? null, recoveryCodes: enrollment?.recoveryCodes ?? [] }
}

/** Atomically consumes a fresh OTP step or one recovery hash. */
async function claimSecondFactor(adminId: string, version: number, input: string, sql: Sql): Promise<boolean> {
  const budget = await sql`update admin_security set
    factor_attempts=case when factor_window_started<=now()-interval '15 minutes' then 1 else factor_attempts+1 end,
    factor_window_started=case when factor_window_started<=now()-interval '15 minutes' then now() else factor_window_started end
    where admin_id=${adminId}::uuid and session_version=${version}
      and (factor_window_started<=now()-interval '15 minutes' or factor_attempts<5) returning admin_id`
  if (!budget.length) return false
  const [security] = await sql`select totp_ciphertext,last_totp_step::text from admin_security
    where admin_id = ${adminId}::uuid and session_version = ${version}`
  if (!security?.totp_ciphertext) return false
  const secret = openStaffSecret(String(security.totp_ciphertext), master(), adminId)
  const step = matchingTotpStep(secret, input, Date.now(), Number(security.last_totp_step ?? -1))
  if (step !== null) {
    const rows = await sql`update admin_security set last_totp_step = ${step}, updated_at = now()
      where admin_id = ${adminId}::uuid and session_version = ${version}
        and (last_totp_step is null or last_totp_step < ${step}) returning admin_id`
    return rows.length === 1
  }
  const hash = recoveryHash(input, master(), adminId)
  if (!hash) return false
  const rows = await sql`update admin_security set recovery_hashes = array_remove(recovery_hashes, ${hash}), updated_at = now()
    where admin_id = ${adminId}::uuid and session_version = ${version} and ${hash} = any(recovery_hashes) returning admin_id`
  return rows.length === 1
}

export async function completeStaffChallenge(token: string, input: string, savedRecoveryCodes: boolean, sql: Sql = getSql()): Promise<{ adminId: string; role: "owner" | "editor"; securityVersion: number; mfaVerified: true } | null> {
  const row = await readChallenge(token, sql)
  if (!row || (row.kind === "enroll" && !savedRecoveryCodes)) return null
  const claimed = await sql`update admin_auth_challenges set attempts = attempts + 1
    where token_hash = ${row.token_hash} and consumed_at is null and expires_at > now() and attempts < 5
    returning token_hash`
  if (!claimed.length) return null
  let version = Number(row.session_version)
  if (row.kind === "enroll") {
    if (!row.enrollment_ciphertext) return null
    const setup = JSON.parse(openStaffSecret(row.enrollment_ciphertext, master(), row.admin_id)) as Enrollment
    const step = matchingTotpStep(setup.secret, input)
    if (step === null) return null
    const hashes = setup.recoveryCodes.map((code) => recoveryHash(code, master(), row.admin_id)!)
    const cipher = sealStaffSecret(setup.secret, master(), row.admin_id)
    const changed = await sql`update admin_security set totp_ciphertext = ${cipher}, last_totp_step = ${step},
      recovery_hashes = ${hashes}::text[], session_version = session_version + 1, updated_at = now()
      where admin_id = ${row.admin_id}::uuid and session_version = ${version} and totp_ciphertext is null
      returning session_version::text as version`
    if (!changed.length) return null
    version = Number(changed[0]!.version)
  } else if (!(await claimSecondFactor(row.admin_id, version, input, sql))) {
    return null
  }
  const consumed = await sql`update admin_auth_challenges set consumed_at = now(), enrollment_ciphertext = null
    where token_hash = ${row.token_hash} and consumed_at is null and expires_at > now() returning token_hash`
  if (!consumed.length) return null
  const fresh = await staffSecurityState(row.admin_id, sql)
  if (!fresh || fresh.version !== version) return null
  await recordStaffSecurityEvent(row.kind === "enroll" ? "mfa_enrolled" : "mfa_signed_in", row.admin_id, row.admin_id, sql)
  return { adminId: row.admin_id, role: row.role, securityVersion: version, mfaVerified: true }
}

export async function revokeStaffSessions(actorId: string, targetId: string, sql: Sql = getSql()): Promise<void> {
  await sql`with changed as (insert into admin_security(admin_id,session_version) values(${targetId}::uuid,1)
    on conflict(admin_id) do update set session_version = admin_security.session_version + 1,updated_at = now() returning admin_id)
    insert into admin_security_events(actor_admin_id,target_admin_id,event_type)
    select ${actorId}::uuid,admin_id,'sessions_revoked' from changed`
}

export async function setStaffMfaPolicy(actorId: string, enabled: boolean, sql: Sql = getSql()): Promise<void> {
  // Serialize policy changes with authenticator removal. The second statement
  // gets a fresh snapshot after the lock; a check followed by an unlocked write
  // could require MFA just as the last enrolled owner removes their factor.
  const [, changed] = await sql.transaction([
    sql`select singleton from admin_security_policy where singleton=true for update`,
    sql`with changed as (update admin_security_policy set require_mfa=${enabled},updated_by=${actorId}::uuid,updated_at=now()
      where singleton=true and (not ${enabled} or not exists(
        select 1 from admins a left join admin_security s on s.admin_id=a.id
        where a.is_active=true and s.totp_ciphertext is null)) returning singleton),
      audit as (insert into admin_security_events(actor_admin_id,event_type)
        select ${actorId}::uuid,${enabled?"mfa_required":"mfa_requirement_removed"} from changed)
      select singleton from changed`,
  ])
  if (!changed.length) throw new Error("Every active administrator must finish authenticator setup first.")
}

export async function disableStaffMfa(adminId: string, input: string, sql: Sql = getSql()): Promise<boolean> {
  const state = await staffSecurityState(adminId, sql)
  if (!state?.enabled || state.required || !(await claimSecondFactor(adminId, state.version, input, sql))) return false
  const [, rows] = await sql.transaction([
    sql`select singleton from admin_security_policy where singleton=true for update`,
    sql`with changed as (update admin_security set totp_ciphertext=null,last_totp_step=null,recovery_hashes='{}',
      session_version=session_version+1,updated_at=now()
      where admin_id=${adminId}::uuid and session_version=${state.version}
        and exists(select 1 from admin_security_policy where singleton=true and require_mfa=false) returning admin_id),
      audit as (insert into admin_security_events(actor_admin_id,target_admin_id,event_type)
        select admin_id,admin_id,'mfa_disabled' from changed) select admin_id from changed`,
  ])
  if (!rows.length) return false
  return true
}
