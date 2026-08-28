"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { saveFolderAndSyncLibrary, type ClientKind } from "@/app/actions/papermark-client-library"
import type { PapermarkFolder } from "@/lib/papermark"

/**
 * Choosing a client's private Papermark folder, and filling their library from it.
 *
 * One button. The previous version had a Sync button that refused to run until
 * the folder had been saved by a different form elsewhere on the page, which
 * left an administrator looking at a valid selection and a disabled control
 * with no way to tell what it was waiting for. The action now saves the folder
 * and syncs from it in one step, so the folder being synced is always the one
 * on screen.
 */
export default function PapermarkFolderSelector({
  kind,
  id,
  value,
  folders,
  error,
  lastSyncedAt,
}: {
  kind: ClientKind
  id: string
  value: string
  folders: PapermarkFolder[]
  error?: string
  lastSyncedAt?: string | null
}) {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState(value)
  const [pending, start] = useTransition()
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  const visible = useMemo(
    () => folders.filter((f) => f.name.toLowerCase().includes(search.toLowerCase())),
    [folders, search],
  )

  const savedFolder = folders.find((folder) => folder.id === value)
  const selectedFolder = folders.find((folder) => folder.id === selected)
  const isSaved = selected === value && Boolean(value)

  return (
    <div className="space-y-3">
      <label
        htmlFor="papermarkFolderId"
        className="block text-xs font-medium uppercase tracking-wider text-muted-foreground"
      >
        Private Papermark folder
      </label>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search folders…"
        aria-label="Search Papermark folders"
        className="w-full border border-border bg-background p-3 text-sm"
      />

      <select
        id="papermarkFolderId"
        name="papermarkFolderId"
        value={selected}
        onChange={(e) => {
          setSelected(e.target.value)
          setResult(null)
        }}
        className="w-full border border-border bg-background p-3 text-sm"
      >
        <option value="">No folder selected — use private link fallback</option>
        {visible.map((folder) => (
          <option key={folder.id} value={folder.id}>
            {folder.name}
          </option>
        ))}
      </select>

      {error && <p className="text-xs text-red-700">{error}</p>}
      {!error && folders.length === 0 && (
        <p className="text-xs text-muted-foreground">No client folders were found.</p>
      )}

      {/* What is on the record now, so the button's effect is never a guess. */}
      <p className="text-xs text-muted-foreground">
        {savedFolder ? (
          <>
            Saved folder: <span className="text-foreground">{savedFolder.name}</span>.{" "}
            {lastSyncedAt
              ? `Last synchronised ${formatWhen(lastSyncedAt)}.`
              : "Not synchronised yet."}
          </>
        ) : (
          "No folder is saved for this client yet."
        )}
        {!isSaved && selectedFolder && (
          <>
            {" "}
            Saving and syncing will move this client to{" "}
            <span className="text-foreground">{selectedFolder.name}</span>.
          </>
        )}
      </p>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => router.refresh()}
          disabled={pending}
          className="border border-border px-4 py-2 text-sm disabled:opacity-40"
        >
          Refresh folders
        </button>
        <button
          type="button"
          // Disabled only when there is nothing valid to sync, or a sync is
          // already running. A second click cannot start a second run.
          disabled={pending || !selected}
          aria-busy={pending}
          onClick={() =>
            start(async () => {
              setResult(null)
              const outcome = await saveFolderAndSyncLibrary(kind, id, selected)
              setResult({ ok: Boolean(outcome?.ok), message: outcome?.message ?? "" })
              if (outcome?.ok) router.refresh()
            })
          }
          className="bg-foreground text-background px-4 py-2 text-sm disabled:opacity-40"
        >
          {pending ? "Saving and syncing…" : "Save and sync library"}
        </button>
      </div>

      {pending && (
        <p className="text-sm text-muted-foreground" role="status">
          Reading the folder, checking each document&rsquo;s private link, and rebuilding
          the library. Nothing already in place is removed until this finishes.
        </p>
      )}

      {result && !pending && (
        <p
          role={result.ok ? "status" : "alert"}
          className={`text-sm ${result.ok ? "text-foreground" : "text-red-700"}`}
        >
          {result.message}
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        Only direct children of the configured {kind} root are shown. One folder belongs
        to one client.
      </p>
    </div>
  )
}

function formatWhen(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "recently"
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}
