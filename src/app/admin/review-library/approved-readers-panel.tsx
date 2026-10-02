"use client"

import { useActionState } from "react"
import { lookupApprovedReader, changeReaderOnEdition, type ReaderLookup } from "@/app/actions/review-approved-readers"
import { prepareRoomsFor } from "@/app/actions/review-reader-rooms"
import { Busy } from "@/components/Spinner"

const STATE_LABEL: Record<string, string> = { published: "Published", draft: "Draft", withdrawn: "Withdrawn" }
const ROOM_LABEL: Record<string, string> = { ready: "Ready", updating: "Preparing", closed: "Closed until repaired", failed: "Needs repair" }
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" }) : "—"

/**
 * Find one address and see exactly which editions it can open -- the same
 * rule the reader's own library uses -- then add or remove it per edition.
 * Each change goes through the edition's own safeguards and is applied to its
 * Papermark link with a read-back.
 */
export default function ApprovedReadersPanel() {
  const [found, find, finding] = useActionState(lookupApprovedReader, undefined)
  const [changed, change, changing] = useActionState(changeReaderOnEdition, undefined)
  const [repaired, repair, repairing] = useActionState(prepareRoomsFor, undefined)
  // The newest answer wins, so a change shows its updated list at once.
  const view: ReaderLookup | undefined = changed?.email && changed.email === found?.email ? changed : found
  return (
    <section className="mb-10 border border-border bg-card/30 p-5 sm:p-6">
      <h2 className="font-serif text-2xl mb-1">Approved readers</h2>
      <p className="text-sm text-foreground/70 mb-4 max-w-3xl">
        Find an email to see exactly which published editions it can open. A review request or a confirmed email is not
        approval: an address can open an edition only when it is on that edition&rsquo;s own reader list.
      </p>
      <form action={find} className="flex flex-wrap gap-2">
        <input
          name="email"
          type="email"
          required
          defaultValue={view?.email ?? ""}
          placeholder="reader@organisation.com"
          aria-label="Reader email"
          className="border border-border bg-background px-3 py-2 text-sm grow min-w-[16rem]"
        />
        <button className="btn-primary text-xs" disabled={finding} aria-busy={finding}>
          <Busy pending={finding} idle="Find reader" busy="Finding…" />
        </button>
      </form>
      {view?.message && !view.editions && <p className="mt-2 text-xs text-red-700">{view.message}</p>}

      {view?.editions && (
        <div className="mt-5">
          <p className="text-sm mb-3">
            <strong>{view.email}</strong> can open{" "}
            <strong>{view.editions.filter((e) => e.canOpen).length}</strong> published edition
            {view.editions.filter((e) => e.canOpen).length === 1 ? "" : "s"}.
          </p>
          {changed?.message && changed.email === view.email && (
            <p className={`mb-3 text-xs ${changed.ok ? "text-foreground/80" : "text-red-700"}`} role="status">
              {changed.message}
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Edition</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Can open</th>
                  <th className="py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {view.editions.map((e) => (
                  <tr key={e.id} className="border-t border-border align-top">
                    <td className="py-2 pr-3">
                      <span className="text-xs text-accent mr-2">{e.series ?? "—"}</span>
                      {e.label || e.title}
                    </td>
                    <td className="py-2 pr-3 text-xs">{STATE_LABEL[e.state] ?? e.state}</td>
                    <td className="py-2 pr-3 text-xs">
                      {e.canOpen && (e.sharedLegacy || e.papermarkInSync)
                        ? "Yes"
                        : e.canOpen
                          ? "Listed; Papermark link not yet updated"
                          : e.isRecipient
                            ? "Listed, not open yet"
                            : "No"}
                    </td>
                    <td className="py-2 text-right">
                      {e.sharedLegacy ? (
                        <span className="text-xs text-muted-foreground">Old shared list</span>
                      ) : e.state === "withdrawn" ? null : (
                        <form action={change}>
                          <input type="hidden" name="email" value={view.email} />
                          <input type="hidden" name="editionId" value={e.id} />
                          <input type="hidden" name="include" value={e.isRecipient ? "0" : "1"} />
                          <button className="btn-secondary text-xs" disabled={changing} aria-busy={changing}>
                            <Busy pending={changing} idle={e.isRecipient ? "Remove" : "Add"} busy="Updating…" />
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 text-xs text-foreground/80 space-y-1">
            <p>
              Personal room: {view.room ? `${ROOM_LABEL[view.room.state] ?? view.room.state}, ${view.room.visible} edition(s), confirmed ${when(view.room.verifiedAt)}` : "none yet"}
              {view.room?.lastError ? ` — ${view.room.lastError}` : ""}
            </p>
            {view.room && view.room.state !== "ready" && (
              <form action={repair}>
                <input type="hidden" name="emails" value={view.email} />
                <button className="btn-secondary text-xs mt-1" disabled={repairing} aria-busy={repairing}>
                  <Busy pending={repairing} idle="Repair room" busy="Repairing…" />
                </button>
              </form>
            )}
            {repaired?.message && <p className={repaired.ok ? "" : "text-red-700"}>{repaired.message}</p>}
            {view.emails && view.emails.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer">Recent APRI emails to this address</summary>
                <ul className="mt-1 space-y-1">
                  {view.emails.map((m, i) => (
                    <li key={i}>
                      {when(m.at)} · {m.kind.replace(/_/g, " ")} · {m.status}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
