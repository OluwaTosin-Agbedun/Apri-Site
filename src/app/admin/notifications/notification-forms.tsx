"use client"
import { useActionState, useId, type ReactNode } from "react"
import SubmitButton from "@/components/SubmitButton"
import {
  configurePublicationNotices,
  approvePublicationCorrection,
  retryRefusedPublicationNotice,
  type NoticeFormState,
} from "@/app/actions/publication-notifications"
const input =
  "block w-full min-h-11 rounded border border-border bg-background px-3 py-2 text-sm"
function Field({
  name,
  label,
  type = "text",
  maxLength = 300,
}: {
  name: string
  label: string
  type?: string
  maxLength?: number
}) {
  const id = useId()
  return (
    <label htmlFor={id} className="block text-sm space-y-1">
      <span>{label}</span>
      <input
        id={id}
        name={name}
        type={type}
        className={input}
        required
        maxLength={maxLength}
        autoComplete={type === "password" ? "current-password" : undefined}
      />
    </label>
  )
}
function Form({
  action,
  label,
  children,
}: {
  action: (state: NoticeFormState, form: FormData) => Promise<NoticeFormState>
  label: string
  children: ReactNode
}) {
  const [state, submit] = useActionState(action, undefined)
  return (
    <form action={submit} className="space-y-3 max-w-lg">
      {children}
      {state && (
        <p role={state.ok ? "status" : "alert"} className="text-sm">
          {state.message}
        </p>
      )}
      <SubmitButton
        busy="Saving…"
        className="min-h-11 rounded bg-foreground text-background px-4 py-2 text-sm disabled:opacity-60"
      >
        {label}
      </SubmitButton>
    </form>
  )
}
export function NotificationSettingsForm({ enabled }: { enabled: boolean }) {
  return (
    <Form
      action={configurePublicationNotices}
      label="Save notification setting"
    >
      <label className="flex gap-2 text-sm">
        <input
          name="enabled"
          type="checkbox"
          value="yes"
          defaultChecked={enabled}
        />
        Enable new-publication email alerts
      </label>
      <label className="flex gap-2 text-sm items-start">
        <input
          name="baselineConfirmed"
          type="checkbox"
          value="yes"
          className="mt-1"
        />
        <span>
          I reviewed the counts. Editions already released when I approve are
          excluded from automatic first-publication emails. Previously queued
          jobs remain recorded.
        </span>
      </label>
      <Field name="reason" label="Approval reason" />
      <Field
        name="password"
        label="Your current password"
        type="password"
        maxLength={200}
      />
    </Form>
  )
}
export function CorrectionNoticeForm({
  publications,
}: {
  publications: {
    id: string
    title: string
  }[]
}) {
  return (
    <Form
      action={approvePublicationCorrection}
      label="Approve and queue update"
    >
      <label className="block text-sm space-y-1">
        <span>Released publication</span>
        <select name="publicationId" className={input} required>
          <option value="">Choose an edition</option>
          {publications.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </label>
      <Field
        name="version"
        label="Approved version label (use the same label when retrying)"
        maxLength={80}
      />
      <Field
        name="reason"
        label="What changed and why readers should be notified"
        maxLength={200}
      />
      <label className="flex gap-2 text-sm items-start">
        <input
          name="approved"
          type="checkbox"
          value="yes"
          required
          className="mt-1"
        />
        <span>
          I checked the reading copy. This is a substantive approved update, not
          a title-only edit.
        </span>
      </label>
      <Field
        name="password"
        label="Your current password"
        type="password"
        maxLength={200}
      />
    </Form>
  )
}
export function RetryNoticeForm({ jobId }: { jobId: string }) {
  return (
    <Form action={retryRefusedPublicationNotice} label="Retry known refusal">
      <input type="hidden" name="jobId" value={jobId} />
      <Field
        name="password"
        label="Your current password"
        type="password"
        maxLength={200}
      />
    </Form>
  )
}
