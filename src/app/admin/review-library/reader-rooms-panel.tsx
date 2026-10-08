"use client"

import { useActionState } from "react"
import { prepareRoomsFor, checkAllRooms, prepareAllApprovedRooms } from "@/app/actions/review-reader-rooms"
import { Busy } from "@/components/Spinner"

type Room = { email: string; state: string; visible: number; verifiedAt: string | null; lastError: string | null; openUntil: string | null }

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" }) : "—"

function Result({ state }: { state: { ok?: boolean; message?: string } | undefined }) {
  if (!state?.message) return null
  return <p className={`mt-2 text-xs ${state.ok ? "text-foreground/80" : "text-red-700"}`} role="status">{state.message}</p>
}

/**
 * Advanced: the personal Papermark access behind the Review Library, for
 * checking and repair. Rooms are prepared automatically when a reader signs in;
 * nothing here is a setup step. No room link is shown: a reader's link asks
 * for no second code, so it is handed only to that reader's signed-in browser.
 */
export default function ReaderRoomsPanel({ schemaReady, windowReady, rooms }: { schemaReady: boolean; windowReady: boolean; rooms: Room[] }) {
  const [prepared, prepare, preparing] = useActionState(prepareRoomsFor, undefined)
  const [checked, check, checking] = useActionState(checkAllRooms, undefined)
  const [all, prepareAll, preparingAll] = useActionState(prepareAllApprovedRooms, undefined)
  const input = "border border-border bg-background px-3 py-2 text-sm"

  return (
    <section className="mb-8 border border-border p-6">
      <h3 className="text-xs font-medium uppercase tracking-wider text-accent mb-3">Personal reader access (Papermark)</h3>
      <p className="text-xs text-muted-foreground leading-relaxed mb-4 max-w-3xl">
        Behind the Review Library, each approved reader has their own Papermark group holding only their email, with view
        and download permission for exactly the published editions assigned to them, and one personal link. APRI
        checks the reader&rsquo;s email with its own one-time code, so that link asks for no second code; it is open only
        while the reader is signed in to the library (24 hours from their code) and closes when they sign out. Every
        change is read back from Papermark before it counts.
      </p>
      {!schemaReady ? (
        <p className="text-xs">Apply 20261009_review_reader_rooms.sql and 20261010_review_access_reliability.sql first.</p>
      ) : (
        <>
          {!windowReady && (
            <p className="text-xs mb-4">
              Apply 20261011_review_reader_open_window.sql to turn this on. Until then the library sends readers to each
              edition&rsquo;s own Papermark link, which asks for a Papermark code per edition.
            </p>
          )}
          <form action={prepare} className="flex flex-wrap items-center gap-2 mb-2">
            <input name="emails" className={`${input} grow min-w-[16rem]`} placeholder="reader@…, another@…" aria-label="Reader addresses" />
            <button className="btn-secondary text-xs" disabled={preparing} aria-busy={preparing}>
              <Busy pending={preparing} idle="Prepare or repair" busy="Working…" />
            </button>
          </form>
          <Result state={prepared} />

          {rooms.length > 0 && (
            <div className="overflow-x-auto mt-5">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Reader</th>
                    <th className="py-2 pr-3 font-medium">Access</th>
                    <th className="py-2 pr-3 font-medium">Editions</th>
                    <th className="py-2 pr-3 font-medium">Link open until</th>
                    <th className="py-2 pr-3 font-medium">Confirmed with Papermark</th>
                    <th className="py-2 font-medium">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {rooms.map((r) => (
                    <tr key={r.email} className="border-t border-border align-top">
                      <td className="py-2 pr-3 break-all">{r.email}</td>
                      <td className="py-2 pr-3">
                        {r.state === "ready" ? "Ready" : r.state === "closed" ? "Closed until repaired" : r.state === "updating" ? "Updating" : "Needs repair"}
                      </td>
                      <td className="py-2 pr-3">{r.visible}</td>
                      <td className="py-2 pr-3">{r.openUntil && new Date(r.openUntil) > new Date() ? when(r.openUntil) : "Closed (not signed in)"}</td>
                      <td className="py-2 pr-3">{when(r.verifiedAt)}</td>
                      <td className="py-2 text-muted-foreground break-words max-w-[24rem]">{r.lastError ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap gap-2 mt-4">
            <form action={check}>
              <button className="btn-secondary text-xs" disabled={checking} aria-busy={checking}>
                <Busy pending={checking} idle="Check all with Papermark" busy="Checking…" />
              </button>
            </form>
            <form action={prepareAll}>
              <button className="btn-secondary text-xs" disabled={preparingAll || !windowReady} aria-busy={preparingAll}>
                <Busy pending={preparingAll} idle="Prepare every approved reader" busy="Starting…" />
              </button>
            </form>
          </div>
          <Result state={checked} />
          <Result state={all} />
        </>
      )}
    </section>
  )
}
