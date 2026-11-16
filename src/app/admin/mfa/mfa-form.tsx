"use client"
import { useActionState } from "react"
import { verifyStaffMfa } from "@/app/actions/staff-security"
import SubmitButton from "@/components/SubmitButton"

export default function MfaForm({ enrolling }: { enrolling: boolean }) {
  const [state, action] = useActionState(verifyStaffMfa, undefined)
  return <form action={action} className="space-y-5">
    <label className="block text-sm font-medium">{enrolling ? "Authenticator code" : "Authenticator or recovery code"}
      <input name="code" type="text" inputMode={enrolling ? "numeric" : "text"} autoComplete="one-time-code" maxLength={100} required className="block mt-2 w-full min-h-11 border border-foreground/50 bg-background p-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2" />
    </label>
    {enrolling && <label className="flex gap-3 text-sm items-start"><input type="checkbox" name="saved" value="yes" required className="mt-1" /><span>I have saved the recovery codes somewhere private.</span></label>}
    {state?.message && <p role="alert" className="text-sm border border-border p-3">{state.message}</p>}
    <SubmitButton busy="Checking…" className="btn-primary w-full">{enrolling ? "Finish setup and sign in" : "Confirm sign-in"}</SubmitButton>
  </form>
}
