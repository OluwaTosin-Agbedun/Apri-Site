import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { staffChallengeView, STAFF_CHALLENGE_COOKIE } from "@/lib/admin-security"
import { cancelStaffMfa } from "@/app/actions/staff-security"
import MfaForm from "./mfa-form"

export const dynamic = "force-dynamic"
export const metadata = { title: "Sign-in check · APRA", robots: { index: false, follow: false } }

export default async function StaffMfaPage() {
  const token = (await cookies()).get(STAFF_CHALLENGE_COOKIE)?.value ?? ""
  const challenge = await staffChallengeView(token)
  if (!challenge) redirect("/admin/login")
  return <main className="min-h-screen px-4 sm:px-6 py-12 max-w-xl mx-auto">
    <h1 className="font-serif text-2xl mb-4">{challenge.kind === "enroll" ? "Set up your authenticator" : "Confirm your sign-in"}</h1>
    <p className="text-sm text-foreground/75 mb-6">{challenge.kind === "enroll" ? "Add this account to your authenticator app, save the recovery codes privately, then enter its six-digit code." : "Enter a fresh six-digit code from your authenticator, or one unused recovery code."}</p>
    {challenge.kind === "enroll" && <section className="border border-border p-5 mb-6 space-y-4">
      <p className="text-sm break-all">Account: {challenge.email}</p>
      <p className="text-sm">Service: APRA Admin. Use a time-based code with a 30-second interval.</p>
      <label className="block text-sm">Setup key<input className="block mt-2 w-full border border-border p-3 font-mono text-sm" readOnly value={challenge.secret ?? ""} /></label>
      <h2 className="font-medium text-sm">Recovery codes — save these privately</h2>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">{challenge.recoveryCodes.map((code) => <li key={code}>{code}</li>)}</ul>
      <p className="text-sm">Each recovery code works once. These codes are not sent by email or stored in plain text after setup.</p>
    </section>}
    <MfaForm enrolling={challenge.kind === "enroll"} />
    <form action={cancelStaffMfa} className="mt-6"><button className="min-h-11 text-sm underline underline-offset-4">Cancel and return to sign-in</button></form>
  </main>
}
