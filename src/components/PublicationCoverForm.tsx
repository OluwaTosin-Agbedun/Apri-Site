"use client"

import { useActionState, useEffect, useId, useState, type ChangeEvent } from "react"
import { savePublicationCover, removePublicationCover } from "@/app/actions/publication-covers"
import { EMPTY_COVER_STATE, MAX_COVER_BYTES, type CoverKind, type StoredPublicationCover } from "@/lib/publication-cover"
import PublicationCover from "./PublicationCover"

export default function PublicationCoverForm({ kind, id, title, current, ready }: {
  kind: CoverKind; id: string; title: string; current?: StoredPublicationCover; ready: boolean
}) {
  const fieldId = useId()
  const [result, action, busy] = useActionState((state: typeof EMPTY_COVER_STATE, form: FormData) =>
    form.get("operation") === "remove"
      ? removePublicationCover(kind, id, state, form)
      : savePublicationCover(kind, id, state, form), EMPTY_COVER_STATE)
  const [selection, setSelection] = useState({ url: "", revision: "" })
  const preview = selection.revision === (current?.revision ?? "") ? selection.url : ""
  const [fileError, setFileError] = useState("")
  useEffect(() => () => { if (selection.url) URL.revokeObjectURL(selection.url) }, [selection.url])
  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    setSelection({ url: "", revision: current?.revision ?? "" })
    setFileError("")
    if (!file) return
    if (!Object.hasOwn({ "image/jpeg": 1, "image/png": 1, "image/webp": 1 }, file.type) || file.size > MAX_COVER_BYTES) {
      setFileError("Choose a JPEG, PNG or WebP image, 4 MB or smaller.")
      event.target.value = ""
      return
    }
    setSelection({ url: URL.createObjectURL(file), revision: current?.revision ?? "" })
  }
  return (
    <section aria-labelledby={`${fieldId}-heading`} className="my-6 border-t border-border py-6" data-cover-editor>
      <h2 id={`${fieldId}-heading`} className="font-serif text-xl">Publication cover</h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">Use the actual approved cover, as a JPEG, PNG or WebP image, maximum 4 MB. It will be visible on the public website when this edition is published. Upload the report PDF through the existing publication process.</p>
      {!ready && <p role="status" className="mt-3 text-sm">Cover information could not be loaded. Refresh this page before making changes.</p>}
      <div className="mt-5 flex flex-col items-start gap-6 sm:flex-row">
        <div className="w-32 shrink-0">
          <p className="mb-2 text-sm font-medium">{preview ? "Selected cover preview" : "Current cover"}</p>
          {preview ? <PublicationCover cover={{ src: preview, alt: "Selected cover preview", credit: "" }} className="w-32" /> :
            current?.image ? <PublicationCover cover={current.image} className="w-32" /> : <p className="text-sm text-muted-foreground">No cover uploaded.</p>}
        </div>
        <div className="w-full min-w-0 max-w-xl">
          <form action={action} className="space-y-4">
            <input type="hidden" name="operation" value="upload" />
            <input type="hidden" name="revision" value={current?.revision ?? ""} />
            <fieldset disabled={!ready || busy} className="space-y-4 disabled:opacity-60">
              <legend className="sr-only">Upload a cover for {title}</legend>
              <label className="block text-sm">Cover image<input key={current?.revision ?? "first"} type="file" name="file" accept="image/jpeg,image/png,image/webp" required onChange={selectFile} className="mt-2 block w-full min-w-0 text-sm" /></label>
              {fileError && <p role="alert" className="text-sm text-red-700">{fileError}</p>}
              <label className="block text-sm">Image description<input name="alt" defaultValue={current?.image?.alt ?? `Cover of ${title}`.slice(0, 200)} required maxLength={200} className="mt-2 w-full border border-border p-3" /></label>
              <label className="block text-sm">Image credit (optional)<input name="credit" defaultValue={current?.image?.credit ?? ""} maxLength={200} className="mt-2 w-full border border-border p-3" /></label>
              <label className="flex items-start gap-3 text-sm leading-relaxed"><input type="checkbox" name="approved" required className="mt-1" /><span>This cover image is approved for public display.</span></label>
              <button type="submit" className="min-h-11 bg-foreground px-5 py-2.5 text-sm font-medium text-background disabled:opacity-50">{busy ? "Saving…" : current?.image ? "Replace cover" : "Upload cover"}</button>
            </fieldset>
          </form>
          {current?.image && <form action={action} className="mt-4"><input type="hidden" name="operation" value="remove" /><input type="hidden" name="revision" value={current.revision} /><button disabled={!ready || busy} type="submit" className="min-h-11 text-sm text-red-700 underline disabled:opacity-50">{busy ? "Saving…" : "Remove cover"}</button></form>}
          {result.message && <p role="status" className={`mt-3 text-sm ${result.ok ? "text-foreground" : "text-red-700"}`}>{result.message}</p>}
        </div>
      </div>
    </section>
  )
}
