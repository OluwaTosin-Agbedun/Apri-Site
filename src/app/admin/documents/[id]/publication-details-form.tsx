"use client"

import { useActionState, useState } from "react"
import Link from "next/link"
import { savePublicationDetails } from "@/app/actions/publication-metadata"
import { Busy } from "@/components/Spinner"
import type { FormState } from "@/lib/definitions"
import {
  MAX_AUTHOR_EDITOR_LENGTH,
  MAX_READING_MINUTES,
  TAG_KINDS,
  TAG_KIND_LABELS,
  type EditorialMetadata,
  type TagRecord,
} from "@/lib/publication-metadata"
import { AddTagForm } from "@/app/admin/tags/tag-forms"

const field = "w-full border border-border bg-background p-3 text-sm focus:outline-none focus:border-accent"
const label = "block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2"

type Values = {
  authorEditor: string
  coveredPeriodStart: string
  coveredPeriodEnd: string
  informationCutoff: string
  readingMinutes: string
}

const toValues = (m: EditorialMetadata): Values => ({
  authorEditor: m.authorEditor ?? "",
  coveredPeriodStart: m.coveredPeriodStart ?? "",
  coveredPeriodEnd: m.coveredPeriodEnd ?? "",
  informationCutoff: m.informationCutoff ?? "",
  readingMinutes: m.readingMinutes === null ? "" : String(m.readingMinutes),
})

/**
 * The publication editor's "Reader details and tags" panel: author/editor,
 * covered period, information cut-off, reading time (each optional, entered
 * by an editor, shown on subscriber cards only when filled in) and the
 * edition's subjects, sectors and geography from the controlled vocabulary.
 * The fields are controlled, so a refused save keeps what was typed. The
 * server re-checks everything.
 */
export default function PublicationDetailsForm({
  id,
  ready,
  metadata,
  tags,
  assigned,
  detailsVersion,
  pendingMessage,
  publicEdition,
}: {
  id: string
  ready: boolean
  metadata: EditorialMetadata
  /** Active tags, plus retired ones this publication already carries. */
  tags: TagRecord[]
  assigned: string[]
  /** Identifies the stored details shown here; the save refuses if they changed meanwhile. */
  detailsVersion: string
  pendingMessage: string
  publicEdition: boolean
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(savePublicationDetails.bind(null, id), undefined)
  const savedKey = JSON.stringify([metadata, [...assigned].sort()])
  const [shownKey, setShownKey] = useState(savedKey)
  const [values, setValues] = useState<Values>(toValues(metadata))
  const [chosen, setChosen] = useState<Set<string>>(new Set(assigned))
  // After a save the page re-renders with what was stored: show that.
  if (shownKey !== savedKey) {
    setShownKey(savedKey)
    setValues(toValues(metadata))
    setChosen(new Set(assigned))
  }
  const errors = state?.errors ?? {}
  const set = (key: keyof Values) => (event: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [key]: event.target.value }))
  const toggle = (tagId: string) => setChosen((current) => {
    const next = new Set(current)
    if (next.has(tagId)) next.delete(tagId)
    else next.add(tagId)
    return next
  })
  const err = (name: string) => errors[name] ? <p id={`details-${name}-error`} className="mt-2 text-xs text-red-700">{errors[name][0]}</p> : null
  const invalid = (name: string) => (errors[name] ? { "aria-invalid": true as const, "aria-describedby": `details-${name}-error` } : {})

  return (
    <section aria-labelledby="reader-details-title" className="mt-6 border border-border bg-card/30 p-6 sm:p-8">
      <h2 id="reader-details-title" className="font-serif text-xl">Reader details and tags</h2>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
        Optional, entered by an editor: nothing here is calculated or filled in for you. Subscribers who may read this
        edition see each detail on its card only when it is filled in, and can filter by its subjects, sectors and
        geography. Missing details never stop anyone opening the edition. The series, title and edition date are set
        above; coverage areas (above) are the public detail page&apos;s list and are separate from these tags.
      </p>
      {!ready && (
        <p role="status" className="mt-4 border border-red-200 bg-red-50 p-3 text-sm text-red-700">{pendingMessage}</p>
      )}
      {ready && publicEdition && (
        <p className="mt-4 text-sm text-foreground/80">
          This edition is public (Open), so it never appears in the subscriber library and these details are not shown to anyone.
        </p>
      )}

      <form action={action} className="mt-6">
        <input type="hidden" name="detailsVersion" value={detailsVersion} />
        <fieldset disabled={!ready} className="space-y-6 disabled:opacity-60">
          <legend className="sr-only">Reader details</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="sm:col-span-2">
              <label htmlFor="details-authorEditor" className={label}>Author / editor</label>
              <input id="details-authorEditor" name="authorEditor" value={values.authorEditor} onChange={set("authorEditor")} maxLength={MAX_AUTHOR_EDITOR_LENGTH} className={field} placeholder="e.g. APRI Research Team" {...invalid("authorEditor")} />
              {err("authorEditor")}
            </div>
            <div>
              <label htmlFor="details-coveredPeriodStart" className={label}>Covered period: from</label>
              <input id="details-coveredPeriodStart" name="coveredPeriodStart" type="date" value={values.coveredPeriodStart} onChange={set("coveredPeriodStart")} className={field} {...invalid("coveredPeriodStart")} />
              {err("coveredPeriodStart")}
            </div>
            <div>
              <label htmlFor="details-coveredPeriodEnd" className={label}>Covered period: to</label>
              <input id="details-coveredPeriodEnd" name="coveredPeriodEnd" type="date" value={values.coveredPeriodEnd} onChange={set("coveredPeriodEnd")} className={field} {...invalid("coveredPeriodEnd")} />
              {err("coveredPeriodEnd")}
            </div>
            <div>
              <label htmlFor="details-informationCutoff" className={label}>Information cut-off</label>
              <input id="details-informationCutoff" name="informationCutoff" type="date" value={values.informationCutoff} onChange={set("informationCutoff")} className={field} {...invalid("informationCutoff")} />
              <p className="mt-2 text-xs text-muted-foreground">The date the edition&apos;s information runs to.</p>
              {err("informationCutoff")}
            </div>
            <div>
              <label htmlFor="details-readingMinutes" className={label}>Reading time (minutes)</label>
              <input id="details-readingMinutes" name="readingMinutes" type="number" inputMode="numeric" min={1} max={MAX_READING_MINUTES} step={1} value={values.readingMinutes} onChange={set("readingMinutes")} className={field} {...invalid("readingMinutes")} />
              <p className="mt-2 text-xs text-muted-foreground">As the editor judges it. Never estimated by the site.</p>
              {err("readingMinutes")}
            </div>
          </div>

          <div className="space-y-5 pt-6 border-t border-border">
            <p className="text-xs text-muted-foreground">
              Tick the tags that apply. Retired tags stay on publications that already carry them and can be removed, but
              not added. <Link href="/admin/tags" className="underline underline-offset-4 hover:no-underline">Manage the tag vocabulary</Link>.
            </p>
            {TAG_KINDS.map((kind) => {
              const options = tags.filter((t) => t.kind === kind)
              return (
                <fieldset key={kind}>
                  <legend className={label}>{TAG_KIND_LABELS[kind].plural}</legend>
                  {options.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No {TAG_KIND_LABELS[kind].plural.toLowerCase()} in the vocabulary yet. Add one below.</p>
                  ) : (
                    <div className="flex flex-wrap gap-x-5 gap-y-2">
                      {options.map((tag) => {
                        const checked = chosen.has(tag.id)
                        // A retired tag can only be kept or removed, never newly ticked.
                        const locked = !tag.active && !checked && !assigned.includes(tag.id)
                        return (
                          <label key={tag.id} className="inline-flex min-h-9 items-center gap-2 text-sm text-foreground/85">
                            <input type="checkbox" name="tags" value={tag.id} checked={checked} disabled={locked} onChange={() => toggle(tag.id)} />
                            <span>{tag.label}{!tag.active && <span className="text-xs text-muted-foreground"> (retired)</span>}</span>
                          </label>
                        )
                      })}
                    </div>
                  )}
                </fieldset>
              )
            })}
            {err("tags")}
          </div>

          <div className="flex justify-end pt-4 border-t border-border">
            <button type="submit" disabled={pending} className="bg-accent text-white px-6 py-2 text-sm font-medium tracking-wide hover:bg-accent-hover disabled:opacity-50 transition-colors cursor-pointer">
              <Busy pending={pending} idle="Save reader details" busy="Saving…" />
            </button>
          </div>
        </fieldset>
        {state?.message && (
          <p role="status" className={`mt-4 text-sm p-3 border ${state.ok ? "text-foreground border-border bg-accent/5" : "text-red-700 border-red-200 bg-red-50"}`}>
            {state.message}
          </p>
        )}
      </form>

      <div className="mt-6 pt-6 border-t border-border">
        <h3 className="text-xs font-medium uppercase tracking-wider text-accent mb-3">Add a tag to the vocabulary</h3>
        <AddTagForm publicationId={id} disabled={!ready} />
      </div>
    </section>
  )
}
