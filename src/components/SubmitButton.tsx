"use client"

import { useFormStatus } from "react-dom"
import { Busy } from "./Spinner"

/**
 * A submit button for a form whose action runs on the server: while the form
 * is submitting it shows the spinner and is disabled, so it cannot be pressed
 * twice and never looks as if the click did nothing.
 */
export default function SubmitButton({
  children,
  busy,
  className,
  disabled,
}: {
  children: React.ReactNode
  busy: string
  className?: string
  disabled?: boolean
}) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className={className} disabled={disabled || pending} aria-busy={pending}>
      <Busy pending={pending} idle={children} busy={busy} />
    </button>
  )
}
