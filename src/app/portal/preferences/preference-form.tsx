"use client"
import { useActionState } from "react"
import SubmitButton from "@/components/SubmitButton"
import { savePublicationEmailPreference } from "@/app/actions/publication-notifications"
export default function PreferenceForm({ enabled }: { enabled: boolean }) {
  const [state, action] = useActionState(
    savePublicationEmailPreference,
    undefined,
  )
  return (
    <form action={action} className="space-y-5">
      <label className="flex gap-3 items-start">
        <input
          className="mt-1"
          type="checkbox"
          name="enabled"
          value="yes"
          defaultChecked={enabled}
        />
        <span>
          Email me when a newly released publication or approved update is
          available within my access.
        </span>
      </label>
      {state && <p role={state.ok ? "status" : "alert"}>{state.message}</p>}
      <SubmitButton busy="Saving…" className="btn-primary">
        Save email preference
      </SubmitButton>
    </form>
  )
}
