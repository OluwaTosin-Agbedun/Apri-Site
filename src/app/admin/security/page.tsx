import { requireAdmin } from "@/lib/dal"
import { getSql } from "@/lib/db"
import { staffSecurityReady, staffSecurityState, STAFF_SECURITY_MIGRATION } from "@/lib/admin-security"
import AdminShell from "@/components/AdminShell"
import { SecurityForm } from "./security-forms"

export const dynamic = "force-dynamic"
export const metadata = { title: "Staff sign-in security · Athena Strategic Advisory", robots: { index: false, follow: false } }

export default async function SecurityPage() {
  const admin = await requireAdmin()
  const ready = await staffSecurityReady()
  const state = ready ? await staffSecurityState(admin.id) : null
  const sql = getSql()
  const staff = ready && admin.role === "owner" ? await sql`select a.id,a.name,a.is_active,
    s.totp_ciphertext is not null as enrolled from admins a left join admin_security s on s.admin_id=a.id order by a.name,a.id` : []
  const events = ready && admin.role === "owner" ? await sql`select e.event_type,e.created_at,a.name as actor,t.name as target
    from admin_security_events e left join admins a on a.id=e.actor_admin_id left join admins t on t.id=e.target_admin_id
    order by e.created_at desc,e.id limit 20` : []
  return <AdminShell admin={admin} current="/admin/security" title="Staff sign-in security" description="Protect administrator accounts. Subscriber and review-reader sign-in are separate.">
    {!ready || !state ? <p className="p-4 border border-border rounded">Apply {STAFF_SECURITY_MIGRATION} to enable these controls.</p> : <div className="space-y-8">
      <section className="border border-border rounded p-5 space-y-4"><h3 className="font-medium">Your authenticator: {state.enabled ? "set up" : "not set up"}</h3>
        <p className="text-sm text-foreground/70">Use an authenticator app and keep its one-use recovery codes somewhere private. Setup signs out older staff sessions. It does not change reader accounts.</p>
        {!state.enabled ? <SecurityForm kind="enroll" /> : state.required ? <p className="text-sm">The owner requires authenticators for all staff. Removal is unavailable.</p> : <details><summary className="cursor-pointer text-sm">Remove your authenticator</summary><div className="mt-3"><SecurityForm kind="remove" /></div></details>}
      </section>
      <section className="border border-border rounded p-5 space-y-4"><h3 className="font-medium">Sign out your existing browsers</h3><p className="text-sm">Ends all your current staff sessions. You will need to sign in again.</p><SecurityForm kind="revoke" adminId={admin.id} /></section>
      {admin.role === "owner" && <>
        <section className="border border-border rounded p-5 space-y-4"><h3 className="font-medium">Staff requirement</h3><p className="text-sm">First let every active administrator finish setup. Requiring it then protects every staff login; newly invited staff must enrol before entering Admin.</p><SecurityForm kind="policy" required={state.required} /></section>
        <section className="space-y-3"><h3 className="font-medium">Administrator access</h3>{staff.map((person) => <details key={String(person.id)} className="border border-border rounded p-4"><summary className="cursor-pointer">{String(person.name)} — {person.is_active ? person.enrolled ? "authenticator set up" : "setup needed" : "inactive"}</summary><div className="mt-3"><SecurityForm kind="revoke" adminId={String(person.id)} /></div></details>)}</section>
        <section><h3 className="font-medium mb-3">Recent security activity</h3><ul className="space-y-2 text-sm">{events.map((event, i) => <li key={i}>{new Date(event.created_at as string).toLocaleString("en-GB", { timeZone: "Africa/Lagos" })} — {String(event.event_type).replaceAll("_", " ")} · {String(event.actor ?? "Former staff")} {event.target ? `→ ${event.target}` : ""}</li>)}</ul></section>
      </>}
    </div>}
  </AdminShell>
}
