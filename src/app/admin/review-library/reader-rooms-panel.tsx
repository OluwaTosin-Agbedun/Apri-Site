"use client"

import { useActionState } from "react"
import {
  prepareRoomsFor,
  checkAllRooms,
  prepareAllApprovedRooms,
  recordRoomsProof,
  withdrawRoomsProof,
} from "@/app/actions/review-reader-rooms"
import { Busy } from "@/components/Spinner"

type Room = { email: string; state: string; visible: number; verifiedAt: string | null; lastError: string | null; linkUrl: string | null }

const CHECKS: [string, string][] = [
  ["one_code", "Each reader was asked for ONE Papermark code"],
  ["all_assigned_open", "Each opened every assigned PDF without another code"],
  ["no_other_or_withdrawn", "Neither could see the other reader's or a withdrawn PDF"],
  ["no_download", "Neither could download"],
  ["removal_hides", "Removing a recipient hid that edition from their room"],
  ["new_edition_appears", "A newly assigned edition appeared in their room"],
]

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" }) : "—"

function Result({ state }: { state: { ok?: boolean; message?: string } | undefined }) {
  if (!state?.message) return null
  return <p className={`mt-2 text-xs ${state.ok ? "text-foreground/80" : "text-red-700"}`} role="status">{state.message}</p>
}

/**
 * Personal Papermark rooms: the controlled test, the proof, and the rollout.
 * Nothing in Papermark changes until an owner presses one of these buttons.
 */
export default function ReaderRoomsPanel({
  schemaReady,
  proof,
  rooms,
}: {
  schemaReady: boolean
  proof: { at: string } | null
  rooms: Room[]
}) {
  const [prepared, prepare, preparing] = useActionState(prepareRoomsFor, undefined)
  const [checked, check, checking] = useActionState(checkAllRooms, undefined)
  const [all, prepareAll, preparingAll] = useActionState(prepareAllApprovedRooms, undefined)
  const [recorded, record, recording] = useActionState(recordRoomsProof, undefined)
  const [withdrawn, withdraw, withdrawing] = useActionState(withdrawRoomsProof, undefined)
  const input = "border border-border bg-background px-3 py-2 text-sm"

  return (
    <section className="mb-8 border border-border bg-card/30 p-6">
      <h3 className="text-xs font-medium uppercase tracking-wider text-accent mb-3">Personal Papermark rooms (one code per reader)</h3>
      <p className="text-xs text-muted-foreground leading-relaxed mb-4 max-w-3xl">
        Each approved reader gets their own Papermark group, holding only their email, with view permission for exactly
        the published editions assigned to them, downloads off, and one email-verified link. Papermark asks for one code,
        and its session then opens all their editions on that browser for about 23 hours; a new browser or device, or
        the next day, needs a fresh code. Withdrawn and unassigned PDFs in the Review Data Room stay hidden.
      </p>
      {!schemaReady ? (
        <p className="text-xs text-red-700">Apply 20261009_review_reader_rooms.sql first.</p>
      ) : (
        <>
          <ol className="text-xs text-foreground/80 leading-relaxed list-decimal pl-5 space-y-1 mb-5 max-w-3xl">
            <li>Assign two test addresses you control to <em>different</em> editions (Edition recipients above).</li>
            <li>Prepare their rooms here, then open each &ldquo;Open room&rdquo; link in its own private browser window.</li>
            <li>Check each reader is asked for one code, can open every assigned PDF, sees nothing else, and cannot download.</li>
            <li>Remove one recipient, then assign a different edition; press <em>Check all rooms</em> and confirm each room follows.</li>
            <li>Record the test below. Only then can the public cards open personal rooms.</li>
          </ol>

          <form action={prepare} className="flex flex-wrap items-center gap-2 mb-2">
            <input name="emails" className={`${input} grow min-w-[18rem]`} placeholder="test-reader-a@…, test-reader-b@…" aria-label="Reader addresses" />
            <button className="btn-primary text-xs" disabled={preparing} aria-busy={preparing}>
              <Busy pending={preparing} idle="Prepare rooms" busy="Preparing…" />
            </button>
          </form>
          <Result state={prepared} />

          {rooms.length > 0 && (
            <div className="overflow-x-auto mt-5">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Reader</th>
                    <th className="py-2 pr-3 font-medium">Room</th>
                    <th className="py-2 pr-3 font-medium">Editions visible</th>
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
                        {r.state === "ready" && r.linkUrl && (
                          <a href={r.linkUrl} target="_blank" rel="noopener noreferrer" className="block text-accent mt-1">Open room</a>
                        )}
                      </td>
                      <td className="py-2 pr-3">{r.visible}</td>
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
                <Busy pending={checking} idle="Check all rooms" busy="Checking…" />
              </button>
            </form>
            {proof && (
              <form action={prepareAll}>
                <button className="btn-secondary text-xs" disabled={preparingAll} aria-busy={preparingAll}>
                  <Busy pending={preparingAll} idle="Prepare all approved readers" busy="Starting…" />
                </button>
              </form>
            )}
          </div>
          <Result state={checked} />
          <Result state={all} />

          <div className="mt-6 pt-5 border-t border-border">
            {proof ? (
              <>
                <p className="text-xs text-foreground/80">Two-reader test recorded on {when(proof.at)}.</p>
                <form action={withdraw} className="mt-2">
                  <button className="text-xs text-red-700 hover:underline" disabled={withdrawing} aria-busy={withdrawing}>
                    <Busy pending={withdrawing} idle="Withdraw the test result (cards go back to Papermark links)" busy="Withdrawing…" />
                  </button>
                </form>
                <Result state={withdrawn} />
              </>
            ) : (
              <form action={record} className="space-y-2">
                <p className="text-xs font-medium">Record the controlled two-reader test</p>
                <div className="flex flex-wrap gap-2">
                  <input name="readerA" className={input} placeholder="Test reader A" aria-label="Test reader A" />
                  <input name="readerB" className={input} placeholder="Test reader B" aria-label="Test reader B" />
                </div>
                {CHECKS.map(([name, label]) => (
                  <label key={name} className="flex items-center gap-2 text-xs">
                    <input type="checkbox" name={name} /> {label}
                  </label>
                ))}
                <button className="btn-primary text-xs" disabled={recording} aria-busy={recording}>
                  <Busy pending={recording} idle="Record test as passed" busy="Recording…" />
                </button>
                <Result state={recorded} />
              </form>
            )}
          </div>
        </>
      )}
    </section>
  )
}
