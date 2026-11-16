"use client"

import { useActionState, useId } from "react"
import { beginStaffEnrollment, removeStaffMfa, revokeAdminBrowsers, updateStaffMfaPolicy, type SecurityFormState } from "@/app/actions/staff-security"
import SubmitButton from "@/components/SubmitButton"

export function SecurityForm({ kind, adminId, required }: { kind: "enroll" | "remove" | "revoke" | "policy"; adminId?: string; required?: boolean }) {
  const action = { enroll: beginStaffEnrollment, remove: removeStaffMfa, revoke: revokeAdminBrowsers, policy: updateStaffMfaPolicy }[kind]
  const [state, formAction] = useActionState<SecurityFormState, FormData>(action, undefined)
  const id = useId()
  return <form action={formAction} className="space-y-3 max-w-md">
    {adminId && <input type="hidden" name="adminId" value={adminId} />}
    {kind === "policy" && <label className="flex gap-2 items-start text-sm"><input className="mt-1" type="checkbox" name="required" value="yes" defaultChecked={required} />Require an authenticator for every administrator</label>}
    <div><label htmlFor={`${id}-password`} className="block text-sm mb-1">Your current password</label>
      <input id={`${id}-password`} name="password" type="password" autoComplete="current-password" maxLength={200} required className="w-full min-h-11 rounded border border-border px-3 py-2 bg-background" /></div>
    {kind === "remove" && <div><label htmlFor={`${id}-code`} className="block text-sm mb-1">Fresh authenticator or unused recovery code</label><input id={`${id}-code`} name="code" autoComplete="one-time-code" maxLength={100} required className="w-full rounded border border-border px-3 py-2 bg-background" /></div>}
    {state && <p role={state.ok ? "status" : "alert"} className="text-sm">{state.message}</p>}
    <SubmitButton busy="Checking…" className="min-h-11 rounded bg-foreground text-background px-4 py-2 text-sm disabled:opacity-60">
      {{ enroll: "Set up authenticator", remove: "Remove authenticator", revoke: "Sign out existing browsers", policy: "Save sign-in requirement" }[kind]}
    </SubmitButton>
  </form>
}
