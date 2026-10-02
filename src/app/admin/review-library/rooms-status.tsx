"use client"

import { useActionState } from "react"
import { prepareRoomsFor } from "@/app/actions/review-reader-rooms"
import { Busy } from "@/components/Spinner"

const LABEL: Record<string, { text: string; tone: string }> = {
  ready: { text: "Ready", tone: "text-green-700" },
  updating: { text: "Preparing", tone: "text-amber-700" },
  closed: { text: "Closed until repaired", tone: "text-red-700" },
  failed: { text: "Needs repair", tone: "text-red-700" },
}

/** Owner-facing personal room status: ready, preparing or needs repair, with one Repair action. */
export default function RoomsStatus({ rooms }: { rooms: { email: string; state: string; visible: number; lastError: string | null }[] }) {
  const [state, repair, pending] = useActionState(prepareRoomsFor, undefined)
  if (rooms.length === 0) return null
  const problems = rooms.filter((r) => r.state !== "ready")
  return (
    <section className="mb-10 border border-border bg-card/30 p-5 sm:p-6">
      <h2 className="font-serif text-2xl mb-1">Personal rooms</h2>
      <p className="text-sm text-foreground/70 mb-4">
        {rooms.length - problems.length} ready · {problems.length} need attention
      </p>
      <ul className="divide-y divide-border text-sm">
        {rooms.map((r) => {
          const l = LABEL[r.state] ?? { text: r.state, tone: "" }
          return (
            <li key={r.email} className="py-2 flex flex-wrap items-center justify-between gap-2">
              <span className="break-all">{r.email}</span>
              <span className="flex items-center gap-3">
                <span className={`text-xs ${l.tone}`}>
                  {l.text}
                  {r.state === "ready" ? ` · ${r.visible} edition${r.visible === 1 ? "" : "s"}` : ""}
                </span>
                {r.state !== "ready" && (
                  <form action={repair}>
                    <input type="hidden" name="emails" value={r.email} />
                    <button className="btn-secondary text-xs" disabled={pending} aria-busy={pending}>
                      <Busy pending={pending} idle="Repair" busy="Repairing…" />
                    </button>
                  </form>
                )}
              </span>
              {r.state !== "ready" && r.lastError && <span className="basis-full text-xs text-muted-foreground">{r.lastError}</span>}
            </li>
          )
        })}
      </ul>
      {state?.message && <p className={`mt-3 text-xs ${state.ok ? "text-foreground/80" : "text-red-700"}`}>{state.message}</p>}
    </section>
  )
}
