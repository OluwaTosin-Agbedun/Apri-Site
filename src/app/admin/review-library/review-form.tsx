"use client"

import { useActionState, useState } from "react"
import { useRouter } from "next/navigation"
import {
  saveReviewLibrarySettings,
  saveReviewDataRoom,
  fetchAvailableReviewDataRooms,
  syncReviewLibrary,
  updateEditionDetails,
  generateEditionDefaults,
  prepareEditionSecureLink,
  publishEditionAsLatest,
  publishHistoricalEdition,
  setEditionReviewState,
} from "@/app/actions/review-library"
import type { FormState } from "@/lib/definitions"

const field =
  "w-full border border-border bg-background p-3 text-sm focus:outline-none focus:border-accent"
const label =
  "block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2"
const primary =
  "bg-foreground text-background px-5 py-2.5 text-sm font-medium disabled:opacity-40 cursor-pointer"
const secondary =
  "border border-border px-4 py-2 text-sm hover:bg-black/5 disabled:opacity-40 cursor-pointer"

type Edition = {
  id: string
  series: string | null
  title: string
  editionLabel: string
  editionSortKey: string
  papermarkFilename: string
  numPages: number | null
  papermarkDocumentId: string
  papermarkDataroomId: string | null
  lastSyncedAt: string | null
  publicationType: string
  description: string
  frequency: string
  audience: string
  secureLinkUrl: string
  secureLinkId: string | null
  secureLinkDocumentId: string | null
  secureLinkVerifiedAt: string | null
  publicationState: string
  isLatest: boolean
  ownerEditedFields: string[]
  mappingStatus: string
}

export default function ReviewLibraryForm(props: {
  enabled: boolean
  dataroomId: string
  lastSyncAt: string
  lastSyncResult: string
  editions: Edition[]
}) {
  return (
    <div className="space-y-8">
      <EnableSection enabled={props.enabled} />
      <DataRoomSection dataroomId={props.dataroomId} />
      <SyncSection
        dataroomId={props.dataroomId}
        lastSyncAt={props.lastSyncAt}
        lastSyncResult={props.lastSyncResult}
      />
      <EditionsSection editions={props.editions} />
    </div>
  )
}

function EnableSection({ enabled }: { enabled: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    saveReviewLibrarySettings,
    {},
  )
  return (
    <section className="border border-border bg-card/30 p-6">
      <h3 className="font-serif text-lg mb-4">Library status</h3>
      <form action={action} className="flex gap-4 items-center flex-wrap">
        <label className="text-sm">
          <input
            className="mr-3 accent-accent"
            type="checkbox"
            name="enabled"
            defaultChecked={enabled}
          />
            Enable complimentary review library
          </label>
        <button className={primary} disabled={pending}>
          Save
          </button>
        {state?.message && <p className="text-sm">{state.message}</p>}
      </form>
    </section>
  )
}

function DataRoomSection({ dataroomId }: { dataroomId: string }) {
  const [rooms, setRooms] = useState<{
    id: string
    name: string
    documentCount: number
  }[]>([])
  const [selected, setSelected] = useState(dataroomId)
  const [message, setMessage] = useState("")
  const router = useRouter()
  return (
    <section className="border border-border bg-card/30 p-6">
      <h3 className="font-serif text-lg">Papermark Data Room (API sync)</h3>
      <p className="text-sm text-foreground/70 my-3">
        The configured Complimentary Review room is read only during an explicit
        Sync. Its URL is never public.
      </p>
      <p className="text-xs font-mono break-all mb-4">
        Configured Data Room ID: {dataroomId || "Not configured"}
        </p>
      {rooms.length ? (
        <div className="flex gap-3">
          <select
            className={field}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                {r.name} ({r.documentCount})
                </option>
              ))}
            </select>
          <button
            className={primary}
            onClick={async () => {
              const x = await saveReviewDataRoom(selected)
              setMessage(x?.message ?? "")
              if (x?.ok) router.refresh()
            }}
          >
            Save Data Room
            </button>
        </div>
      ) : (
        <button
          className={secondary}
          onClick={async () => {
            const x = await fetchAvailableReviewDataRooms()
            if (x.ok) setRooms(x.rooms)
            else setMessage(x.message)
          }}
        >
          Load Data Rooms from Papermark
          </button>
        )}
      {message && <p className="text-sm mt-3">{message}</p>}
    </section>
  )
}

function SyncSection({
  dataroomId,
  lastSyncAt,
  lastSyncResult,
}: {
  dataroomId: string
  lastSyncAt: string
  lastSyncResult: string
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const router = useRouter()
  return (
    <section className="border border-border bg-card/30 p-6">
      <h3 className="font-serif text-lg">Sync documents</h3>
      <p className="text-sm text-foreground/70 my-3">
        Discover and refresh documents as private Draft editions. Sync never
        publishes, replaces a predecessor, or changes Papermark links.
      </p>
      {lastSyncAt && (
        <p className="text-xs text-muted-foreground mb-3">
          Last sync: {new Date(lastSyncAt).toLocaleString()} — {lastSyncResult}
        </p>
      )}
        <button
        className={primary}
          disabled={busy || !dataroomId}
        onClick={async () => {
          setBusy(true)
          const x = await syncReviewLibrary()
          setMessage(x?.message ?? "")
          setBusy(false)
          if (x?.ok) router.refresh()
        }}
              >
        {busy ? "Syncing…" : "Sync"}
              </button>
      {message && <p className="text-sm mt-3">{message}</p>}
    </section>
  )
}

function EditionsSection({ editions }: { editions: Edition[] }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState("")
  const router = useRouter()
  async function run(id: string, fn: () => Promise<FormState>) {
    setBusy(id)
    setMessage("")
    const x = await fn()
    setBusy(null)
    setMessage(x?.message ?? "")
    if (x?.ok) router.refresh()
  }
  return (
    <section>
      <div className="mb-5">
        <h2 className="font-serif text-2xl">Publication editions</h2>
        <p className="text-sm text-foreground/70 mt-2">
          One versioned workflow for every synced document. Only explicitly
          published editions are public.
      </p>
            </div>
      {message && (
        <p className="border border-border p-3 text-sm mb-4">{message}</p>
              )}
      <div className="space-y-6">
        {editions.map((e) => (
          <EditionCard key={e.id} edition={e} busy={busy === e.id} run={run} />
        ))}
      </div>
    </section>
  )
}

function EditionCard({
  edition: e,
  busy,
  run,
}: {
  edition: Edition
  busy: boolean
  run: (id: string, fn: () => Promise<FormState>) => Promise<void>
}) {
  const exact =
    !!e.secureLinkId &&
    !!e.secureLinkUrl &&
    !!e.secureLinkVerifiedAt &&
    e.secureLinkDocumentId === e.papermarkDocumentId
  const status = e.isLatest
    ? "Latest"
    : e.publicationState === "published"
      ? "Published Historical"
      : e.publicationState === "ignored"
        ? "Ignored"
        : "Pending / Draft"
  return (
    <article className="border border-border bg-card/30 p-6">
      <div className="flex justify-between gap-4 mb-5">
        <div>
          <p className="text-xs uppercase tracking-wider text-accent">
            {e.series ?? "Unassigned"}
            </p>
          <h3 className="font-serif text-xl mt-1">
            {e.title || e.papermarkFilename}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            {e.editionLabel || "Edition label needed"}
            </p>
        </div>
        <span className="text-xs font-medium">{status}</span>
      </div>
      <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-2 text-xs mb-6">
        <Info
          name="Papermark PDF filename"
          value={e.papermarkFilename || "Not recorded"}
        />
        <Info
          name="Page count"
          value={e.numPages == null ? "Not reported" : String(e.numPages)}
        />
        <Info name="Mapping status" value={e.mappingStatus} />
        <Info
          name="Last synced"
          value={
            e.lastSyncedAt
              ? new Date(e.lastSyncedAt).toLocaleString()
              : "Not recorded"
          }
        />
        <Info name="Papermark document ID" value={e.papermarkDocumentId} />
        <Info
          name="Configured Data Room ID"
          value={e.papermarkDataroomId ?? "Not recorded"}
        />
        <Info name="Secure-link ID" value={e.secureLinkId ?? "Not prepared"} />
        <Info
          name="Verified"
          value={
            e.secureLinkVerifiedAt
              ? new Date(e.secureLinkVerifiedAt).toLocaleString()
              : "Not verified"
          }
        />
        <Info
          name="Current secure URL"
          value={e.secureLinkUrl || "Not prepared"}
        />
        <Info
          name="Secure-link security"
          value={
            exact
              ? "Exact document verified"
              : "Not verified for exact document"
          }
        />
      </dl>
      <form
        className="grid md:grid-cols-2 gap-4"
        onSubmit={(ev) => {
          ev.preventDefault()
          const f = new FormData(ev.currentTarget)
          void run(e.id, () =>
            updateEditionDetails(e.id, {
              series: String(f.get("series")),
              editionLabel: String(f.get("editionLabel")),
              title: String(f.get("title")),
              publicationType: String(f.get("publicationType")),
              description: String(f.get("description")),
              frequency: String(f.get("frequency")),
              audience: String(f.get("audience")),
            }),
          )
        }}
            >
        <Field title="Assigned publication series">
          <select name="series" defaultValue={e.series ?? ""} className={field}>
            <option value="">Choose series</option>
            <option>MIN</option>
            <option>AIU</option>
            <option>PLM</option>
          </select>
        </Field>
        <Field title="Edition label / publication period">
          <input
            name="editionLabel"
            defaultValue={e.editionLabel}
            className={field}
                />
        </Field>
        <Field title="Public publication title">
          <input name="title" defaultValue={e.title} className={field} />
        </Field>
        <Field title="Publication type">
          <input
            name="publicationType"
            defaultValue={e.publicationType}
            className={field}
                      />
        </Field>
        <div className="md:col-span-2">
          <Field title="Description">
            <textarea
              name="description"
              defaultValue={e.description}
              className={field}
              rows={4}
            />
          </Field>
          </div>
        <Field title="Frequency">
          <input
            name="frequency"
            defaultValue={e.frequency}
            className={field}
          />
        </Field>
        <Field title="Audience">
          <input name="audience" defaultValue={e.audience} className={field} />
        </Field>
        <button className={primary} disabled={busy}>
          Save publication details
        </button>
      </form>
      <div className="flex flex-wrap gap-3 mt-5 pt-5 border-t border-border/50">
        <button
          className={secondary}
          disabled={busy || !e.series}
          onClick={() => run(e.id, () => generateEditionDefaults(e.id))}
            >
          Apply missing series defaults
        </button>
            <button
          className={secondary}
          disabled={busy || !e.series || exact}
          onClick={() => run(e.id, () => prepareEditionSecureLink(e.id))}
            >
          {exact ? "Exact link verified" : "Prepare & verify secure link"}
            </button>
        {e.publicationState !== "published" &&
          e.publicationState !== "ignored" && (
            <>
              <button
                className={primary}
                disabled={busy || !exact}
                onClick={() => run(e.id, () => publishEditionAsLatest(e.id))}
              >
                Publish as latest edition
              </button>
                <button
                className={secondary}
                disabled={busy || !exact}
                onClick={() => run(e.id, () => publishHistoricalEdition(e.id))}
                >
                Publish as historical edition
                </button>
            </>
          )}
        {e.publicationState === "draft" && (
            <button
            className={secondary}
            disabled={busy}
            onClick={() =>
              run(e.id, () => setEditionReviewState(e.id, "ignored"))
            }
            >
            Ignore document
            </button>
        )}
        {e.publicationState === "ignored" && (
              <button
            className={secondary}
            disabled={busy}
            onClick={() =>
              run(e.id, () => setEditionReviewState(e.id, "draft"))
            }
              >
            Return to Draft
            </button>
            )}
          </div>
    </article>
  )
}
function Info({ name, value }: { name: string; value: string }) {
  return (
            <div>
      <dt className="text-muted-foreground">{name}</dt>
      <dd className="font-mono break-all mt-0.5">{value}</dd>
    </div>
  )
}
function Field({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <label>
      <span className={label}>{title}</span>
      {children}
    </label>
  )
}
