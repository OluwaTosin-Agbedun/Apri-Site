"use client"

import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import {
  initialTeamImageState,
  type TeamImageActionState,
} from "@/lib/team-image-action-state"
import {
  removeTeamImage,
  saveTeamImage,
} from "@/app/actions/team-images"

function SubmitButton({
  children,
  className,
}: {
  children: React.ReactNode
  className: string
}) {
  const { pending } = useFormStatus()
  return (
    <button
      disabled={pending}
      className={`${className} disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {pending ? "Saving…" : children}
    </button>
  )
}

function Result({ state }: { state: TeamImageActionState }) {
  if (state.status === "idle") return null
  return (
    <p
      role="status"
      className={`mt-3 text-sm ${
        state.status === "error" ? "text-red-700" : "text-green-700"
      }`}
    >
      {state.message}
    </p>
  )
}

export default function TeamImageForm({
  memberKey,
  memberName,
  currentAlt,
  hasImage,
}: {
  memberKey: string
  memberName: string
  currentAlt?: string
  hasImage: boolean
}) {
  const [saveState, saveAction] = useActionState(
    saveTeamImage,
    initialTeamImageState,
  )
  const [removeState, removeAction] = useActionState(
    removeTeamImage,
    initialTeamImageState,
  )
  return (
    <>
      <form action={saveAction} className="space-y-4">
        <input type="hidden" name="memberKey" value={memberKey} />
        <label className="block text-sm">
          Upload JPEG, PNG or WebP (maximum 4 MB)
          <input
            name="file"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="block mt-2"
          />
        </label>
        <label className="block text-sm">
          Or paste an HTTPS image URL
          <input
            name="imageUrl"
            type="url"
            placeholder="https://…"
            className="mt-2 w-full border border-border px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          Accessible alt text
          <input
            name="altText"
            defaultValue={currentAlt || `Portrait of ${memberName}`}
            required
            maxLength={200}
            className="mt-2 w-full border border-border px-3 py-2"
          />
        </label>
        <SubmitButton className="btn-primary">
          Save or replace image
        </SubmitButton>
      </form>
      <Result state={saveState} />
      {hasImage && (
        <form action={removeAction} className="mt-3">
          <input type="hidden" name="memberKey" value={memberKey} />
          <SubmitButton className="text-sm underline text-red-700">
            Remove image
          </SubmitButton>
        </form>
      )}
      <Result state={removeState} />
    </>
  )
}
