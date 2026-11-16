import "server-only"
import bcrypt from "bcryptjs"
import { getSql } from "./db"

/** Re-authentication for sensitive staff actions, with a persisted five-try limit. */
export async function confirmStaffPassword(adminId: string, password: FormDataEntryValue | null): Promise<boolean> {
  if (typeof password !== "string" || password.length < 1 || password.length > 200) return false
  const sql = getSql()
  const [admin] = await sql`select email,password_hash from admins where id=${adminId}::uuid and is_active=true`
  if (!admin) return false
  // Reserve a failed attempt before the expensive comparison. The row lock
  // makes concurrent requests share the same five-attempt allowance.
  const [,reserved]=await sql.transaction([
    sql`select id from admins where id=${adminId}::uuid for update`,
    sql`insert into login_attempts(email_key,ip,successful)
      select email,'',false from admins where id=${adminId}::uuid and is_active=true and password_hash=${admin.password_hash}
        and (select count(*) from login_attempts where email_key=${admin.email} and successful=false
          and created_at>now()-interval '15 minutes')<5 returning id`,
  ])
  if (!reserved.length) return false
  const ok = await bcrypt.compare(password, String(admin.password_hash))
  if (ok) await sql`delete from login_attempts where id=${reserved[0]!.id}`
  return ok
}
